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

const ROOT = path.join(__dirname, '..');
const { createAdvancedController } = require('../src/agent/advanced/controller');
const { classifyIpcOrigin, localOrigin, remoteOrigin, RENDERER_URL } = require('../src/agent/advanced/origin');
const { createToolLog } = require('../src/agent/advanced/tool-log');

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

  const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
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
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ok(!pkg.dependencies['@deepseek-ai/dsh'], 'no @deepseek-ai/dsh umbrella dependency');
  ok(!pkg.dependencies['@deepseek-ai/dsh-sdk-client'], 'no dsh-sdk-client (composition root, not sdk profile)');
  ok(!pkg.dependencies['@deepseek-ai/dsh-sdk-minimal'], 'no dsh-sdk-minimal package');
  for (const name of [
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-user-approval',
    '@deepseek-ai/dsh-tool-bash',
    '@deepseek-ai/dsh-sandbox-policy',
  ]) {
    ok(pkg.dependencies[name] === '0.2.0-rc.2', `${name} pinned exactly to 0.2.0-rc.2`);
  }
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  ok(!JSON.stringify(lock).includes('embedded-agent-kit'), 'no embedded-agent-kit in the lockfile');

  const srcHits = [];
  const walkSrc = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkSrc(p);
      else if (/\.(c|m)?js$/.test(e.name)) {
        const code = fs.readFileSync(p, 'utf8');
        if (/['"`]sdk-minimal['"`]/.test(code)) srcHits.push(p);
        if (/embedded-agent-kit/.test(code)) srcHits.push(p);
        if (/--profile\s+sdk\b/.test(code)) srcHits.push(p);
      }
    }
  };
  walkSrc(path.join(ROOT, 'src'));
  ok(srcHits.length === 0, 'no sdk-minimal / --profile sdk / embedded-agent-kit anywhere in src/');

  const composition = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'composition.mjs'), 'utf8');
  ok(/ADVANCED_ROWS/.test(composition), 'composition.mjs declares ADVANCED_ROWS');
  ok(/mode:\s*['"]read-only['"]/.test(composition), 'advanced sandbox-policy row pins read-only');
  ok(!/danger-full-access/.test(composition), 'composition never selects danger-full-access');

  for (const f of ['engine.js', 'dsh-runtime.js']) {
    const code = fs.readFileSync(path.join(ROOT, 'src', 'agent', f), 'utf8');
    ok(!/dsh-sdk-client|dsh-tool-|dsh-bash|advanced\//.test(code), `default-mode ${f} imports no tool packages, SDK client, or advanced runtime`);
  }

  // Default mode: tools service must not exist on the default composition
  const { bootRuntime, disposeRuntime, isAdvancedMounted } = await import('../src/runtime/boot.mjs');
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

  const { createAdvancedHost } = await import('../src/agent/advanced/host.mjs');
  const { isAdvancedMounted, unmountAdvanced } = await import('../src/runtime/boot.mjs');
  const { proposeCreate } = require('../src/agent/proposals');

  const vault = path.join(tmp, 'vault-b');
  fs.mkdirSync(path.join(vault, '01-收件箱'), { recursive: true });
  fs.writeFileSync(path.join(vault, '01-收件箱', 'idea.md'), '# 想法\n离线 smoke 笔记。\n');
  const configDir = path.join(tmp, 'config-b');
  const log = createToolLog({ dir: path.join(configDir, 'logs'), getSecrets: () => [FAKE_KEY] });

  const ctl = createAdvancedController(memPrefs());
  const approvals = [];
  let answer = 'deny';
  const pending = new Map();

  const host = createAdvancedHost({
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
  });

  try {
    let threw = null;
    try {
      await host.runTool({ name: 'bash', arguments: { command: 'echo hi', description: 'x' }, callId: 'pre' });
    } catch (e) {
      threw = e.message;
    }
    ok(threw && /未开启/.test(threw) && !host.status().running && !isAdvancedMounted(), 'default mode: advanced host refuses to start, no tools fiber');

    ctl.enable(localOrigin(), { acknowledgeRisk: true });

    const pwnCmd = 'echo pwned > pwned.txt && cat 01-收件箱/idea.md';
    answer = 'deny';
    let res = await host.runTool({
      name: 'bash',
      arguments: { command: pwnCmd, description: 'smoke deny' },
      callId: 'toolu_deny',
    });
    ok(host.status().running && isAdvancedMounted(), 'advanced on: composition advanced fiber mounted');
    const a1 = approvals.find((x) => x.tool === 'bash');
    ok(a1 && a1.command === pwnCmd && a1.arguments.description === 'smoke deny', 'real call intercepted BEFORE execution with full command + all arguments (AC-13)');
    ok(JSON.stringify(a1.arguments) === JSON.stringify({ command: pwnCmd, description: 'smoke deny' }), 'approval modal payload includes ALL arguments');
    ok(res.isError, 'deny returns an error tool result');
    ok(!fs.existsSync(path.join(vault, 'pwned.txt')), 'Deny prevents execution (file not created)');
    ok(log.read().some((x) => x.event === 'tool-result' && x.tool === 'bash' && x.isError), 'denied call reported as error result and logged');

    answer = 'allow';
    res = await host.runTool({
      name: 'bash',
      arguments: { command: 'echo pwned2 > pwned2.txt; cat 01-收件箱/idea.md; ls', description: 'smoke allow' },
      callId: 'toolu_allow',
    });
    const r2 = log.read().filter((x) => x.event === 'tool-result' && x.tool === 'bash').pop();
    ok(r2 && typeof r2.output === 'string', 'approved call executed and its result was logged');
    ok(!fs.existsSync(path.join(vault, 'pwned2.txt')), 'approved command still cannot write: sandbox is read-only');
    console.log(`    (sandbox output: ${JSON.stringify((r2.output || '').slice(0, 160))})`);

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

    ctl.setPolicy(localOrigin(), 'log-only', { acknowledgeRisk: true });
    const n = approvals.length;
    res = await host.runTool({
      name: 'bash',
      arguments: { command: 'ls 01-收件箱', description: 'smoke log-only' },
      callId: 'toolu_lo',
    });
    ok(approvals.length === n, 'log-only: call ran without an approval prompt');
    ok(log.read().some((x) => x.event === 'tool-call' && x.policy === 'log-only' && x.arguments && x.arguments.command === 'ls 01-收件箱'), 'log-only: call logged with full arguments');

    ctl.disable(localOrigin());
    ok(!host.status().running && !isAdvancedMounted(), 'disable stops/unmounts the advanced fiber immediately (AC-12)');
    threw = null;
    try {
      await host.runTool({ name: 'bash', arguments: { command: 'true', description: 'x' }, callId: 'after' });
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

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-adv-smoke-'));
  await partA(tmp);
  const b = await partB(tmp);
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
