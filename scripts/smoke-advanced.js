'use strict';

/**
 * Advanced-mode smoke (AC-11..14) on the Cordis composition root (PR-7).
 * Part A: controller / origin / log / static policy (any Node).
 * Part B: real in-process advanced fiber + tools/pre-execute ask + approval
 *         (Node >= 22; Electron 39 embeds 22.22.1). Offline, no network.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Isolate every config write (keystore, prefs, tool log) from the real user.
const SMOKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-adv-home-'));
process.env.HOME = SMOKE_HOME;
process.env.USERPROFILE = SMOKE_HOME;
delete process.env.DEEPSEEK_API_KEY;

const ROOT = path.join(__dirname, '..');
const repo = require('./lib/repo');
const { createAdvancedController } = require('../packages/advanced/lib/controller.js');
const { classifyIpcOrigin, localOrigin, remoteOrigin, RENDERER_URL } = require('../packages/advanced/lib/origin.js');
const { createToolLog } = require('../packages/advanced/lib/tool-log.js');

const FAKE_KEY = ['sk', 'offlinesmoke', 'NOTAREALKEY', '0123456789'].join('-');

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

function memPrefs() {
  let prefs = {};
  return {
    readPrefs: () => ({ ...prefs }),
    writePrefs: (p) => {
      prefs = { ...prefs, ...p };
      return prefs;
    },
  };
}

function grepTree(dir, needle) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        try {
          if (fs.readFileSync(p).includes(needle)) hits.push(p);
        } catch {
          /* unreadable */
        }
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hits;
}

/** path -> sha256 of every file under dir (for "nothing was written" checks). */
function snapshotTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { out[`${path.relative(dir, p)}/`] = 'dir'; walk(p); }
      else out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

/** True when a raw JSON request body would trip DeepSeek's "unexpected end of hex escape". */
function hasLoneSurrogate(raw) {
  if (!String(raw).isWellFormed()) return true;
  // escaped form produced by JSON.stringify for a lone surrogate
  return /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f][0-9a-f]{2})|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i.test(raw);
}

/**
 * Offline scripted LLM adapter (provider route 'kvd-smoke-scripted'). Each
 * stream() pops one step: { tool, input } -> one tool call, { text } -> final answer.
 */
function scriptedAdapter() {
  const queue = [];
  const requests = [];
  let n = 0;
  const adapter = {
    providerInfo: (id) => ({ id, name: 'KVD smoke scripted' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    listModels: () => Promise.resolve([{ id: 'scripted', name: 'scripted' }]),
    resolveModel: (provider, model) => Promise.resolve({ provider, id: model, name: model }),
    async prepareCall(provider, model) {
      return { model: { provider, id: model, name: model }, stream: (o) => adapter.stream(o) };
    },
    async *stream(options) {
      requests.push(JSON.parse(JSON.stringify(options.messages || [])));
      n += 1;
      const step = queue.shift() || { text: 'done' };
      if (step.tool) {
        const id = `call_s${n}`;
        const argsJson = JSON.stringify(step.input);
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id, name: step.tool, argumentsDelta: argsJson };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: step.tool, arguments: argsJson } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: step.text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: step.text } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    },
  };
  return { adapter, queue, requests };
}

function majorOf(v) {
  const m = /^v?(\d+)\./.exec(String(v || ''));
  return m ? Number(m[1]) : 0;
}

async function partA(tmp) {
  console.log('Part A — controller, origin, log, static policy');

  const c = createAdvancedController(memPrefs());
  ok(c.getState().enabled === false, 'advanced mode is OFF by default');
  ok(c.getState().policy === 'approve', "tool policy defaults to 'approve each call'");
  const remoteEnable = c.enable(remoteOrigin('feishu'), { acknowledgeRisk: true });
  ok(!remoteEnable.ok && remoteEnable.code === 'REMOTE_FORBIDDEN' && !c.getState().enabled, 'remote origin (feishu) cannot enable advanced mode');
  ok(c.enable({ kind: 'local-renderer-spoof' }, { acknowledgeRisk: true }).code === 'REMOTE_FORBIDDEN', 'unknown origin kinds are treated as remote');
  ok(c.enable(undefined, { acknowledgeRisk: true }).code === 'REMOTE_FORBIDDEN', 'missing origin is rejected');
  const noAck = c.enable(localOrigin());
  ok(!noAck.ok && noAck.needRiskAck === 'enable' && !c.getState().enabled, 'first local enable requires the one-time risk warning');
  ok(c.enable(localOrigin(), { acknowledgeRisk: true }).ok && c.getState().enabled, 'local enable with acknowledgement turns advanced mode on');
  c.disable(localOrigin());
  ok(c.enable(localOrigin()).ok, 'risk warning is one-time (second enable needs no re-ack)');
  ok(c.setPolicy(remoteOrigin('wecom'), 'log-only', { acknowledgeRisk: true }).code === 'REMOTE_FORBIDDEN' && c.getState().policy === 'approve', 'remote origin (wecom) cannot change the tool policy');
  const lo = c.setPolicy(localOrigin(), 'log-only');
  ok(!lo.ok && lo.needRiskAck === 'log-only', "switching to 'run directly, log only' shows a one-time risk warning");
  ok(c.setPolicy(localOrigin(), 'log-only', { acknowledgeRisk: true }).ok && c.getState().policy === 'log-only', 'local + acknowledged switch to log-only works');
  ok(c.setPolicy(localOrigin(), 'bogus').code === 'BAD_POLICY', 'unknown policy values are rejected');

  const wc = { id: 1 };
  const win = { webContents: wc };
  ok(classifyIpcOrigin({ sender: wc, senderFrame: { url: RENDERER_URL, parent: null } }, win).kind === 'local-renderer', 'IPC from our main window top frame is LOCAL');
  ok(classifyIpcOrigin({ sender: { id: 2 }, senderFrame: { url: RENDERER_URL } }, win).kind === 'remote', 'IPC from another webContents is rejected');
  ok(classifyIpcOrigin({ sender: wc, senderFrame: { url: 'https://evil.example/index.html' } }, win).kind === 'remote', 'IPC from a foreign URL is rejected');
  ok(classifyIpcOrigin({ sender: wc, senderFrame: { url: RENDERER_URL, parent: {} } }, win).kind === 'remote', 'IPC from a subframe is rejected');
  ok(classifyIpcOrigin({ sender: wc, senderFrame: { url: RENDERER_URL } }, null).kind === 'remote', 'IPC without a main window is rejected');

  const mainSrc = fs.readFileSync(path.join(repo.APP, 'src', 'main.ts'), 'utf8');
  for (const ch of ['advanced-enable', 'advanced-set-policy', 'advanced-approval-reply']) {
    const re = new RegExp(`ipcMain\\.handle\\('${ch}'[\\s\\S]{0,300}?classifyIpcOrigin\\(`);
    ok(re.test(mainSrc), `main.js '${ch}' handler classifies the IPC origin before acting`);
  }

  const vault = path.join(tmp, 'vault-a');
  fs.mkdirSync(vault, { recursive: true });
  const logDir = path.join(tmp, 'config', 'logs');
  const log = createToolLog({ dir: logDir, getSecrets: () => [FAKE_KEY] });
  ok(!path.resolve(log.file).startsWith(path.resolve(vault) + path.sep), 'tool-call log lives outside the vault');

  log.append({
    event: 'tool-call',
    callId: 'c1',
    tool: 'bash',
    arguments: { command: `echo ${FAKE_KEY}` },
    policy: 'log-only',
    decision: 'allow',
    decidedBy: 'policy',
  });
  log.append({
    event: 'tool-result',
    callId: 'c1',
    tool: 'bash',
    isError: false,
    output: `token=${FAKE_KEY}\nAuthorization: Bearer ${FAKE_KEY}`,
  });
  const raw = fs.readFileSync(log.file, 'utf8');
  ok(!raw.includes(FAKE_KEY) && raw.includes('[REDACTED]'), 'log-only mode: key-shaped secrets are redacted from the log');
  ok(log.read().every((x) => typeof x.time === 'string'), 'every log record carries a timestamp');

  // Static policy: composition root, no umbrella / sdk-minimal / embedded-agent-kit
  const pkg = repo.readJson(path.join(repo.APP, 'package.json'));
  ok(repo.declaredVersions('@deepseek-ai/dsh').length === 0, 'no @deepseek-ai/dsh umbrella dependency (any workspace package)');
  ok(repo.declaredVersions('@deepseek-ai/dsh-sdk-client').length === 0, 'no dsh-sdk-client (composition root, not sdk profile)');
  ok(repo.declaredVersions('@deepseek-ai/dsh-sdk-minimal').length === 0, 'no dsh-sdk-minimal package');
  for (const name of [
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-user-approval',
    '@deepseek-ai/dsh-tool-bash',
    '@deepseek-ai/dsh-bash-sandbox',
    '@deepseek-ai/dsh-tool-pwsh',
    '@deepseek-ai/dsh-pwsh-sandbox',
    '@deepseek-ai/dsh-pwsh-local',
    '@deepseek-ai/dsh-sandbox-policy',
  ]) {
    ok(pkg.dependencies[name] === '0.2.0-rc.2', `${name} pinned exactly to 0.2.0-rc.2`);
    ok(repo.declaredVersions(name).every((d) => d.spec === '0.2.0-rc.2'), `${name} exact 0.2.0-rc.2 in every package that declares it`);
  }
  ok(!/embedded-agent-kit/.test(repo.pnpmLock()), 'no embedded-agent-kit in the lockfile');

  const srcHits = [];
  const walkSrc = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkSrc(p);
      else if (/\.(c|m)?[jt]s$/.test(e.name)) {
        const code = fs.readFileSync(p, 'utf8');
        if (/['"`]sdk-minimal['"`]/.test(code)) srcHits.push(p);
        if (/embedded-agent-kit/.test(code)) srcHits.push(p);
        if (/--profile\s+sdk\b/.test(code)) srcHits.push(p);
      }
    }
  };
  for (const d of repo.sourceRoots()) walkSrc(d);
  ok(srcHits.length === 0, 'no sdk-minimal / --profile sdk / embedded-agent-kit anywhere in apps/*/src or packages/*/src');

  const composition = fs.readFileSync(path.join(repo.APP, 'src', 'runtime', 'composition.ts'), 'utf8');
  const cordisYml = fs.readFileSync(path.join(repo.APP, 'cordis.yml'), 'utf8');
  ok(/ADVANCED_ROWS/.test(composition), 'composition.mjs declares ADVANCED_ROWS');
  ok(/cordis\.yml/.test(composition) && !/@deepseek-ai\/dsh-|@kvd\//.test(composition.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'composition.mjs loads cordis.yml and hardcodes no plugin package');
  ok(/mode:\s*['"]read-only['"]/.test(composition), 'advanced sandbox-policy row is re-pinned read-only at mount time');
  ok(/name: '@deepseek-ai\/dsh-sandbox-policy'\s*\n\s*config:[\s\S]{0,200}?mode:\s*read-only/.test(cordisYml), 'cordis.yml sandbox-policy row declares read-only');
  ok(!/danger-full-access/.test(composition) && !/danger-full-access/.test(cordisYml), 'composition never selects danger-full-access');
  {
    const comp = await import('../apps/desktop/lib/runtime/composition.js');
    const sp = comp.advancedRowsFor({ workspaceRoot: '/tmp/x' }).find((r) => r.id === 'dsh-sandbox-policy');
    ok(sp && sp.config.mode === 'read-only' && sp.config.workspaceRoot === '/tmp/x', 'advancedRowsFor pins read-only + vault root');
    ok(comp.DEFAULT_ROWS.every((r) => !/dsh-tool|dsh-bash|dsh-sandbox|@kvd\/advanced/.test(r.name)), 'default-mode rows mount no tool / sandbox / advanced plugins');
  }

  for (const f of ['packages/skills/src/index.ts', 'apps/desktop/src/runtime/boot.ts']) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    ok(!/dsh-sdk-client|dsh-tool-|dsh-bash|advanced\//.test(code), `default-mode ${f} imports no tool packages, SDK client, or advanced runtime`);
  }

  // ---- Bug A: search snippets are sliced by code point, around the BODY match ----
  {
    const { searchVault, makeSnippet } = await import('../packages/search/lib/index.js');
    const sv = path.join(tmp, 'vault-search');
    fs.mkdirSync(path.join(sv, '01-收件箱'), { recursive: true });
    // 219 BMP chars + emoji: a UTF-16 slice(0, 220) would end on a lone high surrogate.
    const emojiText = `${'a'.repeat(219)}😀 tail 周会纪要`;
    ok(!emojiText.slice(0, 220).isWellFormed(), 'fixture: old UTF-16 slice would split the emoji (regression guard is real)');
    fs.writeFileSync(path.join(sv, '01-收件箱', 'emoji.md'), emojiText);
    let r = searchVault(sv, 'aaaa', 5);
    const hit = r.hits.find((h) => h.path === '01-收件箱/emoji.md');
    ok(hit && hit.snippet.isWellFormed(), 'AC4: snippet with an emoji at the cut boundary is well-formed UTF-16');
    ok(hit && hit.snippet.endsWith('😀'), 'AC4: snippet keeps the whole emoji (sliced by character)');
    ok(!hasLoneSurrogate(JSON.stringify({ text: hit.snippet })), 'AC4: JSON-encoded snippet has no lone-surrogate escape');
    // many emoji everywhere around the boundary
    for (let pad = 210; pad <= 230; pad++) {
      const t = `${'b'.repeat(pad)}${'🙂'.repeat(20)}`;
      if (!makeSnippet(t, t.toLowerCase(), 0).isWellFormed()) throw new Error(`FAIL: snippet ill-formed at pad ${pad}`);
    }
    ok(true, 'AC4: snippets are well-formed for every pad length 210..230 around emoji runs');
    // Offset bug: index must come from the body, not path+body.
    const longDir = `01-收件箱/${'深'.repeat(40)}/${'层'.repeat(40)}`;
    fs.mkdirSync(path.join(sv, longDir), { recursive: true });
    const body = `${'填充文字。'.repeat(120)}关键词ZETA出现在这里${'后文。'.repeat(40)}`;
    fs.writeFileSync(path.join(sv, longDir, 'deep.md'), body);
    r = searchVault(sv, 'zeta', 5);
    const deep = r.hits.find((h) => h.path.endsWith('deep.md'));
    ok(deep && /ZETA/.test(deep.snippet), 'search snippet is centred on the body match even with a long path (offset bug)');
    fs.writeFileSync(path.join(sv, longDir, 'pathonly-qwerty.md'), `开头内容。${'x'.repeat(400)}`);
    r = searchVault(sv, 'qwerty', 5);
    const po = r.hits.find((h) => h.path.endsWith('pathonly-qwerty.md'));
    ok(po && po.snippet.startsWith('开头内容'), 'path-only match snippets start at the top of the note');
  }

  // ---- Model ID consistency (Bug B) ----
  {
    const { DEFAULT_MODEL, APP_MODELS } = await import('../packages/shared/lib/models.js');
    ok(APP_MODELS.includes(DEFAULT_MODEL) && DEFAULT_MODEL === 'deepseek-flash', 'app default model is deepseek-flash, one of the listed models');
    const hostSrc = fs.readFileSync(path.join(repo.PACKAGES, 'advanced', 'src', 'host.ts'), 'utf8');
    ok(!/model:\s*['"]deepseek-chat['"]/.test(hostSrc) && /DEFAULT_MODEL/.test(hostSrc), 'advanced host uses the app model constant, not deepseek-chat');
    const offenders = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(c|m)?[jt]s$/.test(e.name) && /['"`]deepseek-chat['"`]/.test(fs.readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    for (const d of repo.sourceRoots()) walk(d);
    ok(offenders.length === 0, "no 'deepseek-chat' model id anywhere in apps/*/src or packages/*/src");
    ok(/ipcMain\.handle\('advanced-run'[\s\S]{0,900}?host\.run\(/.test(mainSrc), "main.js 'advanced-run' forwards the prompt to host.run (no canned answer)");
    ok(!/高级档已就绪（组合根插件）/.test(mainSrc), 'advanced-run no longer returns the fixed placeholder string');
  }

  // ---- Bug C: approval bridge escalation guard (unit, fake ctx) ----
  {
    const bridge = await import('../packages/advanced/lib/approval-bridge.js');
    ok(bridge.findEscalation({ command: 'x', sandbox_permissions: 'workspace-write' }) === 'workspace-write', 'findEscalation: sandbox_permissions in args');
    ok(bridge.findEscalation('{"command":"x","sandbox_permissions":"danger-full-access"}') === 'danger-full-access', 'findEscalation: JSON-string args');
    ok(bridge.findEscalation({ command: 'x', sandbox_permissions: 'read-only' }) === null, 'findEscalation: read-only is not an escalation');
    ok(bridge.isEscalationRequest({ reason: 'escalate sandbox to workspace-write: need it' }), 'isEscalationRequest: dsh escalation reason');
    ok(!bridge.isEscalationRequest({ reason: 'Knowledge Vault requires approval for this tool call' }), 'isEscalationRequest: normal ask is not an escalation');

    for (const policy of ['approve', 'log-only']) {
      const handlers = {};
      const fake = { on: (ev, fn) => { handlers[ev] = fn; }, effect: () => {} };
      const ui = [];
      const records = [];
      bridge.apply(fake, {
        getPolicy: () => policy,
        requestApproval: async (r) => { ui.push(r); return 'allow'; },
        onToolCall: (r) => records.push(r),
      });
      let nextCalled = 0;
      const next = () => { nextCalled += 1; return { kind: 'ran' }; };
      // 1) escalation in args at pre-execute: denied before any policy branch
      const pre = await handlers['tools/pre-execute']({ callId: 'c-esc', name: 'bash', arguments: { command: 'echo x > f', sandbox_permissions: 'workspace-write', justification: 'j' } }, next);
      ok(pre && pre.kind === 'deny' && nextCalled === 0 && ui.length === 0, `[${policy}] pre-execute hard-denies sandbox_permissions (no run, no modal)`);
      // 2) normal call, then the escalation ask REUSING the same callId
      const pre2 = await handlers['tools/pre-execute']({ callId: 'c-same', name: 'bash', arguments: { command: 'echo x > f' } }, next);
      if (policy === 'approve') {
        ok(pre2.kind === 'ask', '[approve] normal call asks for approval');
        ok(await handlers['approval/request']({ callId: 'c-same', toolName: 'bash', reason: 'Knowledge Vault requires approval for this tool call' }) === 'allowed-once' && ui.length === 1, '[approve] normal call shows exactly one modal');
      } else {
        ok(nextCalled === 1 && ui.length === 0, '[log-only] normal call runs without a modal');
      }
      const uiBefore = ui.length;
      const esc = await handlers['approval/request']({ callId: 'c-same', toolName: 'bash', reason: 'escalate sandbox to workspace-write: need to write', displayReason: { en: 'x', zh: 'y' } });
      ok(esc === 'rejected' && ui.length === uiBefore, `[${policy}] AC1: escalation ask with a reused callId is auto-rejected without a modal`);
      // 3) a second ask for an already-approved callId (no escalation wording) is still not approvable
      const again = await handlers['approval/request']({ callId: policy === 'approve' ? 'c-same' : 'c-other', toolName: 'bash', reason: 'please' });
      ok(again === 'rejected' && ui.length === uiBefore, `[${policy}] repeat / unexpected asks never reach the modal`);
      const escLogs = records.filter((r) => r.event === 'escalation-rejected');
      ok(escLogs.length >= 2 && escLogs.every((r) => r.decision === 'deny' && r.decidedBy === 'escalation-guard'), `[${policy}] escalations logged as escalation-rejected`);
    }
  }

  // Default mode: tools service must not exist on the default composition
  const { bootRuntime, disposeRuntime, isAdvancedMounted } = await import('../apps/desktop/lib/runtime/boot.js');
  // Use a fresh process-level check via dynamic import of composition only —
  // bootRuntime is singleton; Part B will mount advanced. Here only assert rows.
  ok(isAdvancedMounted() === false, 'advanced fiber is not mounted before enable');
  void bootRuntime; // referenced for static presence
  void disposeRuntime;
}

async function partB(tmp) {
  console.log('Part B — composition advanced fiber + tools/pre-execute ask (offline)');
  if (majorOf(process.versions.node) < 22) {
    console.log(`  ! SKIPPED: need Node >= 22 (have ${process.versions.node})`);
    return { skipped: true };
  }
  console.log(`  using Node ${process.versions.node}`);

  const { createAdvancedHost } = await import('../packages/advanced/lib/host.js');
  const { isAdvancedMounted, unmountAdvanced, getRuntime } = await import('../apps/desktop/lib/runtime/boot.js');
  const { proposeCreate, applyProposal } = await import('../packages/proposals/lib/index.js');
  const { advancedRunResult } = require('../packages/advanced/lib/run-result.js');

  const vault = path.join(tmp, 'vault-b');
  fs.mkdirSync(path.join(vault, '01-收件箱'), { recursive: true });
  fs.writeFileSync(path.join(vault, '01-收件箱', 'idea.md'), '# 想法\n离线 smoke 笔记。\n');
  const configDir = path.join(tmp, 'config-b');
  const log = createToolLog({ dir: path.join(configDir, 'logs'), getSecrets: () => [FAKE_KEY] });

  const ctl = createAdvancedController(memPrefs());
  const scripted = scriptedAdapter();
  let route = { provider: 'kvd-smoke-scripted', model: 'scripted' };
  const approvals = [];
  let answer = 'deny';
  const pending = new Map();

  const runtimeHandle = await import('../apps/desktop/lib/runtime/boot.js');
  const host = createAdvancedHost({
    runtime: runtimeHandle,
    controller: ctl,
    log,
    requestApproval: async (req) => {
      approvals.push(req);
      return answer;
    },
    onPropose: (change) => {
      const res = proposeCreate(vault, change.path, change.content, change.summary);
      if (!res.ok) return res;
      pending.set(res.proposal.id, res.proposal);
      return { ok: true, proposalId: res.proposal.id };
    },
    getVaultRoot: () => vault,
    getSecrets: () => [FAKE_KEY],
    getModelRoute: () => route,
  });
  const vaultBefore = snapshotTree(vault);
  // Advanced shell per platform (cordis.yml `platforms`): bash on macOS/Linux,
  // PowerShell on Windows (issue #18). Same checks, real sandbox, both shells.
  const comp = await import('../apps/desktop/lib/runtime/composition.js');
  const SH = process.platform === 'win32' ? 'pwsh' : 'bash';
  const SH_CMD = SH === 'pwsh'
    ? {
        pwn: "Set-Content -Path pwned.txt -Value pwned; Get-Content -Encoding utf8 '01-收件箱/idea.md'",
        allow: "Set-Content -Path pwned2.txt -Value pwned2; Get-Content -Encoding utf8 '01-收件箱/idea.md'; Get-ChildItem -Name",
        read: "Get-Content -Encoding utf8 '01-收件箱/idea.md'",
        ls: 'Get-ChildItem -Name',
        noop: 'Write-Output ok',
      }
    : {
        pwn: 'echo pwned > pwned.txt && cat 01-收件箱/idea.md',
        allow: 'echo pwned2 > pwned2.txt; cat 01-收件箱/idea.md; ls',
        read: 'cat 01-收件箱/idea.md',
        ls: 'ls',
        noop: 'true',
      };
  console.log(`  advanced shell tool on ${process.platform}: ${SH}`);
  ok(comp.shellToolOf(comp.ADVANCED_ROWS) === SH, `cordis.yml mounts exactly the ${SH} shell tool on ${process.platform}`);
  ok(comp.ADVANCED_ROWS.filter((r) => /^dsh-tool-(bash|pwsh)$/.test(r.id)).length === 1, 'exactly one shell tool row mounts per platform');
  {
    const prompt = comp.advancedRowsFor({ workspaceRoot: vault }).find((r) => r.id === 'dsh-system-prompt').config.personaPrefix;
    ok(!prompt.includes('{{shellTool}}') && prompt.includes('`' + SH + '`') && (SH === 'pwsh' ? /PowerShell/.test(prompt) && /there is no bash/.test(prompt) : !/pwsh|PowerShell/.test(prompt)), `system prompt names the ${SH === 'pwsh' ? 'PowerShell' : 'bash'} shell tool`);
  }

  try {
    let threw = null;
    try {
      await host.runTool({ name: SH, arguments: { command: 'echo hi', description: 'x' }, callId: 'pre' });
    } catch (e) {
      threw = e.message;
    }
    ok(threw && /未开启/.test(threw) && !host.status().running && !isAdvancedMounted(), 'default mode: advanced host refuses to start, no tools fiber');

    ctl.enable(localOrigin(), { acknowledgeRisk: true });

    const pwnCmd = SH_CMD.pwn;
    answer = 'deny';
    let res = await host.runTool({
      name: SH,
      arguments: { command: pwnCmd, description: 'smoke deny' },
      callId: 'toolu_deny',
    });
    ok(host.status().running && isAdvancedMounted(), 'advanced on: composition advanced fiber mounted');
    {
      const enc = await import('../apps/desktop/lib/runtime/pwsh-encoding.js');
      ok(enc.isSafePwshEncodingPreambleInstalled(), 'safe pwsh encoding preamble installed at advanced mount (issue #20)');
      ok(enc.SAFE_ENCODING_PREAMBLE.includes('SilentlyContinue') && enc.SAFE_ENCODING_PREAMBLE.includes('try'), 'SAFE_ENCODING_PREAMBLE is ConstrainedLanguage-defensive');
      const { ENCODING_PREAMBLE } = await import('@deepseek-ai/dsh-pwsh-local');
      ok(enc.withSafeEncodingPreamble(ENCODING_PREAMBLE + 'x') === enc.SAFE_ENCODING_PREAMBLE + 'x', 'withSafeEncodingPreamble swaps upstream preamble');
    }
    const a1 = approvals.find((x) => x.tool === SH);
    ok(a1 && a1.command === pwnCmd && a1.arguments.description === 'smoke deny', 'real call intercepted BEFORE execution with full command + all arguments (AC-13)');
    ok(JSON.stringify(a1.arguments) === JSON.stringify({ command: pwnCmd, description: 'smoke deny' }), 'approval modal payload includes ALL arguments');
    ok(a1.commandLanguage === (SH === 'pwsh' ? 'PowerShell' : 'bash'), `approval dialog labels the command as ${SH === 'pwsh' ? 'PowerShell' : 'bash'}`);
    {
      const { approvalCommandHeading } = await import('../packages/advanced/lib/approval-bridge.js');
      const want = SH === 'pwsh' ? 'PowerShell 命令' : 'bash 命令';
      ok(approvalCommandHeading(a1.commandLanguage) === want, `approval dialog heading is exactly "${want}"`);
      const appSrc = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/renderer/app.ts'), 'utf8');
      ok(/approvalCommandHeading\(req\.commandLanguage\)/.test(appSrc) && /\$\{lang\} 命令/.test(appSrc), 'renderer applies approvalCommandHeading for the dialog label');
    }
    ok(res.isError, 'deny returns an error tool result');
    ok(!fs.existsSync(path.join(vault, 'pwned.txt')), 'Deny prevents execution (file not created)');
    ok(log.read().some((x) => x.event === 'tool-result' && x.tool === SH && x.isError), 'denied call reported as error result and logged');

    answer = 'allow';
    res = await host.runTool({
      name: SH,
      arguments: { command: SH_CMD.allow, description: 'smoke allow' },
      callId: 'toolu_allow',
    });
    const r2 = log.read().filter((x) => x.event === 'tool-result' && x.tool === SH).pop();
    ok(r2 && typeof r2.output === 'string', 'approved call executed and its result was logged');
    console.log(`    (sandbox output: ${JSON.stringify((r2.output || '').replace(/\u0000/g, '').slice(0, 400))})`);
    ok(!fs.existsSync(path.join(vault, 'pwned2.txt')), 'approved command still cannot write: sandbox is read-only');
    // Issue #18: the absence of pwned2.txt alone is vacuous if the shell never ran
    // (Windows: WSL launcher / MSYS2 under the restricted token). Prove the confined
    // shell really executed: the note text and the directory listing are in the output.
    ok(/离线 smoke/.test(r2.output || '') && /01-收件箱/.test(r2.output || ''), `read-only check is not vacuous: confined ${SH} actually ran (read + listing output present)`);
    ok(!/E_ACCESSDENIED|Error code: Bash|fatal error - /.test((r2.output || '').replace(/\u0000/g, '')), `sandbox ${SH} is a working shell (no WSL launcher Bash/E_ACCESSDENIED, no MSYS2 fatal error)`);

    answer = 'allow';
    res = await host.runTool({
      name: 'vault_propose_change',
      arguments: { kind: 'create', path: '10-卡片盒/smoke.md', content: '# 卡片\n', summary: 'smoke card' },
      callId: 'toolu_prop',
    });
    ok(pending.size === 1 && !fs.existsSync(path.join(vault, '10-卡片盒', 'smoke.md')), 'vault_propose_change creates a §11.3 proposal; nothing written before Apply');
    res = await host.runTool({
      name: 'vault_propose_change',
      arguments: { kind: 'create', path: '.obsidian/evil.json', content: '{}' },
      callId: 'toolu_evil',
    });
    ok(pending.size === 1 && !fs.existsSync(path.join(vault, '.obsidian')), 'proposals into .obsidian/ are rejected');

    // ---- Bug B / AC3: the task box run reaches the model and the approval flow ----
    {
      const { ctx } = await getRuntime();
      ctx.llm.registerAdapter(['kvd-smoke-scripted'], scripted.adapter);
      ctx.kvdPrefs.acceptPrivacy(); // tmp HOME prefs; scripted route is gated like any non-mock provider

      answer = 'allow';
      const nA = approvals.length;
      scripted.queue.push(
        { tool: SH, input: { command: SH_CMD.read, description: 'read note' } },
        { text: '笔记内容是：离线 smoke 笔记。' },
      );
      const run1 = await host.run({ prompt: '读一下 idea.md 并告诉我内容', timeoutMs: 30000 });
      const firstReq = scripted.requests[scripted.requests.length - 2];
      const userMsgs = (firstReq || []).filter((m) => m.role === 'user');
      ok(userMsgs.some((m) => JSON.stringify(m.content).includes('读一下 idea.md')), "AC3: prompt reaches the model as a role:'user' message");
      const ap = approvals.slice(nA);
      ok(ap.length === 1 && ap[0].tool === SH && ap[0].command === SH_CMD.read, 'AC3: model tool call raised exactly one approval request with the full command');
      ok(run1.toolCalls.length === 1 && run1.toolCalls[0].name === SH && /离线 smoke/.test(run1.toolCalls[0].output || ''), 'AC3: approved call executed; its result is in the run summary');
      ok(run1.answer === '笔记内容是：离线 smoke 笔记。' && !run1.timedOut, 'AC3: final model answer returned by host.run');
      const ipc = advancedRunResult(run1, host.status());
      ok(ipc.ok && ipc.answer === run1.answer && ipc.toolCalls[0].name === SH && ipc.toolCalls[0].command === SH_CMD.read, 'AC3: IPC result carries answer + tool-call summary for the UI');
      ok(run1.route === 'kvd-smoke-scripted/scripted', 'run used the configured model route');

      // Deny path through the model loop
      answer = 'deny';
      scripted.queue.push(
        { tool: SH, input: { command: SH_CMD.ls, description: 'list' } },
        { text: '用户拒绝了。' },
      );
      const runDeny = await host.run({ prompt: '列一下文件', timeoutMs: 30000 });
      ok(runDeny.toolCalls[0] && runDeny.toolCalls[0].isError && runDeny.answer === '用户拒绝了。', 'AC3: denied call returns an error result to the model and the run still finishes');

      // ---- Bug C / AC1: model retries a denied write with sandbox escalation ----
      answer = 'allow'; // even if a modal appeared, the user would click Allow
      const nB = approvals.length;
      // Out-of-vault write probe: an escalated write to os.tmpdir() must not land either.
      const tmpProbe = path.join(os.tmpdir(), `kvd-esc-probe-${process.pid}-${Date.now()}.txt`);
      scripted.queue.push(
        { tool: SH, input: { command: 'echo esc > esc.txt', description: 'write' } },
        { tool: SH, input: { command: 'echo esc > esc.txt', description: 'write', sandbox_permissions: 'workspace-write', justification: 'need to write the note' } },
        { tool: SH, input: { command: 'echo esc > esc2.txt', description: 'write', sandbox_permissions: 'danger-full-access', justification: 'really' } },
        { tool: SH, input: { command: `echo esc > "${tmpProbe}"`, description: 'write tmp', sandbox_permissions: 'danger-full-access', justification: 'tmp' } },
        { text: '无法写入。' },
      );
      const runEsc = await host.run({ prompt: '在 vault 里写一个 esc.txt', timeoutMs: 30000 });
      ok(approvals.length - nB === 1 && !approvals.slice(nB).some((a) => a.arguments && a.arguments.sandbox_permissions), 'AC1 [approve]: escalation requests never show an approval modal');
      ok(!fs.existsSync(path.join(vault, 'esc.txt')) && !fs.existsSync(path.join(vault, 'esc2.txt')), 'AC1 [approve]: no direct write happened (esc.txt / esc2.txt absent)');
      ok(runEsc.toolCalls.length === 4 && runEsc.toolCalls[1].isError && runEsc.toolCalls[2].isError && runEsc.toolCalls[3].isError, 'AC1 [approve]: escalation calls come back as errors to the model');
      ok(!fs.existsSync(tmpProbe), 'AC1 [approve]: escalated write to os.tmpdir() did not land');
      const escRec = log.read().filter((x) => x.event === 'escalation-rejected' && x.policy === 'approve');
      ok(escRec.length >= 2 && escRec.some((x) => x.requestedMode === 'workspace-write') && escRec.some((x) => x.requestedMode === 'danger-full-access'), 'AC1 [approve]: tool log records escalation-rejected events');

      // ---- AC2: the model's only write path is vault_propose_change -> Apply ----
      scripted.queue.push(
        { tool: 'vault_propose_change', input: { kind: 'create', path: '10-卡片盒/run.md', content: '# run card\n', summary: 'card from run' } },
        { text: '已提出改动，等待 Apply。' },
      );
      const before = pending.size;
      const runProp = await host.run({ prompt: '做一张卡片', timeoutMs: 30000 });
      ok(pending.size === before + 1 && !fs.existsSync(path.join(vault, '10-卡片盒', 'run.md')), 'AC2: model write becomes a proposal; nothing on disk before Apply');
      ok(runProp.answer === '已提出改动，等待 Apply。', 'AC2: run reports the pending proposal');
    }

    ctl.setPolicy(localOrigin(), 'log-only', { acknowledgeRisk: true });
    const n = approvals.length;
    res = await host.runTool({
      name: SH,
      arguments: { command: 'ls 01-收件箱', description: 'smoke log-only' },
      callId: 'toolu_lo',
    });
    ok(approvals.length === n, 'log-only: call ran without an approval prompt');
    ok(log.read().some((x) => x.event === 'tool-call' && x.policy === 'log-only' && x.arguments && x.arguments.command === 'ls 01-收件箱'), 'log-only: call logged with full arguments');

    // ---- AC1 under log-only: escalation is still hard-rejected ----
    {
      const nL = approvals.length;
      scripted.queue.push(
        { tool: SH, input: { command: 'echo lo > lo.txt', description: 'write' } },
        { tool: SH, input: { command: 'echo lo > lo.txt', description: 'write', sandbox_permissions: 'workspace-write', justification: 'log-only bypass' } },
        { text: '写入失败。' },
      );
      const runLo = await host.run({ prompt: 'log-only 下写 lo.txt', timeoutMs: 30000 });
      ok(approvals.length === nL, 'AC1 [log-only]: no approval modal for the escalation');
      ok(!fs.existsSync(path.join(vault, 'lo.txt')), 'AC1 [log-only]: escalation rejected, nothing written');
      ok(runLo.toolCalls[1] && runLo.toolCalls[1].isError, 'AC1 [log-only]: escalation call is an error result');
      ok(log.read().some((x) => x.event === 'escalation-rejected' && x.policy === 'log-only' && x.requestedMode === 'workspace-write'), 'AC1 [log-only]: logged as escalation-rejected');
    }

    // ---- AC2: across every advanced run above, the vault is byte-identical ----
    const vaultAfter = snapshotTree(vault);
    ok(JSON.stringify(vaultAfter) === JSON.stringify(vaultBefore), 'AC2: no advanced-mode path (bash approve/deny, escalation, log-only, proposals) wrote into the vault');
    ok(!Object.keys(vaultAfter).some((k) => k.startsWith('.obsidian') || k.startsWith('00-系统')), 'AC2: nothing under .obsidian/ or 00-系统/');
    const runProposal = [...pending.values()].find((pr) => pr.path === '10-卡片盒/run.md' || pr.relPath === '10-卡片盒/run.md' || JSON.stringify(pr).includes('10-卡片盒/run.md'));
    const applied = applyProposal(vault, runProposal);
    ok(applied && applied.ok !== false && fs.readFileSync(path.join(vault, '10-卡片盒', 'run.md'), 'utf8') === '# run card\n', 'AC2: only Apply writes the proposed note to disk');

    ctl.disable(localOrigin());
    ok(!host.status().running && !isAdvancedMounted(), 'disable stops/unmounts the advanced fiber immediately (AC-12)');
    threw = null;
    try {
      await host.runTool({ name: SH, arguments: { command: SH_CMD.noop, description: 'x' }, callId: 'after' });
    } catch (e) {
      threw = e.message;
    }
    ok(threw && /未开启/.test(threw), 'after disable, advanced runs are refused (default behaviour restored)');

    ok(grepTree(configDir, FAKE_KEY).length === 0, 'key never written to the app config dir');
    ok(grepTree(vault, FAKE_KEY).length === 0, 'key never written into the vault');
  } finally {
    await host.stop('smoke-done');
    await unmountAdvanced().catch(() => {});
  }
  return { skipped: false };
}

async function partC(tmp, mock) {
  console.log('Part C — default-mode ask over the real DeepSeek transport (local mock server, offline)');
  const { getRuntime } = await import('../apps/desktop/lib/runtime/boot.js');
  const { ctx } = await getRuntime();
  const { credentialRef } = await import('@deepseek-ai/dsh-credentials');
  const ref = credentialRef('DEEPSEEK_API_KEY');
  const vault = path.join(tmp, 'vault-c');
  fs.mkdirSync(path.join(vault, '01-收件箱'), { recursive: true });
  fs.writeFileSync(path.join(vault, '01-收件箱', '项目周会纪要.md'), `${'周'.repeat(219)}😀 讨论了知识库项目的进度。`);
  await ctx.get('credentials').set(ref, FAKE_KEY); // keystore under the smoke tmp HOME
  try {
    ctx.kvdPrefs.acceptPrivacy();
    ctx.vault.setRoot(vault);
    mock.queue.push({ text: '周会讨论了知识库项目的进度 😀' });
    const nReq = mock.requests.length;
    const res = await ctx.kvdSkills.ask({ question: '周周周周会讨论了什么' });
    const reqs = mock.requests.slice(nReq).filter((r) => r.url.endsWith('/messages'));
    ok(reqs.length === 1, 'ask issued exactly one Messages request to the local mock (no real network)');
    const raw = reqs[0].body;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* fail below */ }
    ok(parsed && raw.includes('😀'), 'AC4: request body is valid JSON and carries the emoji intact');
    ok(!hasLoneSurrogate(raw), "AC4: request body has no lone surrogate (no DeepSeek 400 'unexpected end of hex escape')");
    ok(parsed.model === 'deepseek-flash' && parsed.messages[0].role === 'user', 'AC4: request uses the app model and a role:user message');
    ok(res.ok && /进度/.test(res.answer), 'AC4: ask round-trips through the transport and returns the answer');
    ok(!String(reqs[0].headers.authorization || '').includes('undefined'), 'mock received an auth header from the keychain (fake key)');
  } finally {
    await ctx.get('credentials').unset(ref);
    ctx.vault.clear();
  }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-adv-smoke-'));
  const { startMockAnthropic } = require('./lib/mock-anthropic');
  const mock = await startMockAnthropic();
  process.env.DEEPSEEK_BASE_URL = mock.baseURL; // must be set before the runtime boots
  await partA(tmp);
  const b = await partB(tmp);
  if (!b.skipped) await partC(tmp, mock);
  await mock.close();
  console.log(`ADVANCED_SMOKE_OK ${passed} checks${b.skipped ? ' (Part B skipped: no Node 22)' : ''}`);
  if (b.skipped && process.env.KVD_REQUIRE_DSH_E2E) {
    console.error('KVD_REQUIRE_DSH_E2E is set but Part B was skipped');
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
