'use strict';

/**
 * AC-7 offline write-confirmation smoke (no network, no API key).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault } = require('../packages/vault/lib/create.js');
const repo = require('./lib/repo');

let asserts = 0;
function assert(cond, msg) {
  asserts += 1;
  if (!cond) throw new Error(msg);
}

(async () => {
  // Plugin-owned modules (ESM) — formerly src/agent/{proposals,paths,search,engine}.js
  const {
    proposeCreate,
    proposeMove,
    proposeEdit,
    applyProposal,
    discardProposal,
    formatProposalReview,
  } = await import('../packages/proposals/lib/index.js');
  const { resolveVaultPath } = await import('../packages/vault/lib/index.js');
  const { createSkillsEngine } = await import('../packages/skills/lib/index.js');
  const { searchVault, SEARCH_EXCLUDED_TOP } = await import('../packages/search/lib/index.js');
  // Offline skills engine over the pure plugin helpers (what the old createMockEngine facade did).
  const createMockEngine = () =>
    createSkillsEngine(
      {
        style: 'mock',
        hasKey: false,
        backend: 'mock',
        search: searchVault,
        resolve: resolveVaultPath,
        proposeMove,
        proposeCreate,
      },
      { id: 'mock', backend: 'mock' },
    );
  const templateRoot = require('../packages/template/lib/index.js').templateRoot;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-agent-smoke-'));
  const created = createVault({ parentDir: tmp, rawName: 'Agent_Smoke', templateRoot });
  assert(created.ok, created.error || 'createVault failed');
  const vault = created.vaultPath;

  // W1 §4: OA dirs present; fingerprint for ask/sort non-damage
  const oaRequired = [
    '00-系统/公众号/voice.md',
    '01-收件箱/公众号线索',
    '10-卡片盒/公众号/briefs',
    '10-卡片盒/公众号/drafts',
    '10-卡片盒/公众号/review',
    '90-附件/公众号/layout',
    '05-归档/公众号',
    '04-资源/公众号/analytics',
  ];
  for (const rel of oaRequired) {
    assert(fs.existsSync(path.join(vault, ...rel.split('/'))), 'OA missing ' + rel);
  }
  function oaFingerprint() {
    const roots = [
      '00-系统/公众号',
      '01-收件箱/公众号线索',
      '10-卡片盒/公众号',
      '90-附件/公众号',
      '05-归档/公众号',
      '04-资源/公众号',
    ];
    const lines = [];
    function walk(rel) {
      const abs = path.join(vault, ...rel.split('/'));
      if (!fs.existsSync(abs)) return;
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        for (const name of fs.readdirSync(abs).sort()) walk(rel + '/' + name);
      } else {
        lines.push(rel + ':' + st.size);
      }
    }
    for (const r of roots) walk(r);
    return lines.join('|');
  }
  // Seed a brief so sidebar listWechatOa has something
  const briefRel = '10-卡片盒/公众号/briefs/smoke-brief.md';
  fs.writeFileSync(path.join(vault, ...briefRel.split('/')), '# Smoke Brief\n\n选题测试\n', 'utf8');
  const { listWechatOaNotes, listInboxNotes } = require('../packages/search/lib/index.js');
  const oaNotes = listWechatOaNotes(vault);
  assert(oaNotes.includes(briefRel), 'listWechatOaNotes includes brief');
  assert(!listInboxNotes(vault).some((n) => n.startsWith('01-收件箱/公众号线索/')), 'inbox excludes 公众号线索');
  const oaBefore = oaFingerprint();

  const inboxNote = path.join(vault, '01-收件箱', '待处理', 'smoke-note.md');
  fs.mkdirSync(path.dirname(inboxNote), { recursive: true });
  fs.writeFileSync(inboxNote, '# Smoke Note\n\n这是一条待归类的项目想法。\n', 'utf8');
  const noteRel = '01-收件箱/待处理/smoke-note.md';

  // (a) propose create → disk unchanged
  const pCreate = proposeCreate(vault, '10-卡片盒/概念卡片/smoke-card.md', '# Card\n', 'test create');
  assert(pCreate.ok, pCreate.error);
  assert(
    !fs.existsSync(path.join(vault, '10-卡片盒', '概念卡片', 'smoke-card.md')),
    'create should not touch disk before apply'
  );

  // (b) Discard → disk unchanged
  discardProposal(pCreate.proposal);
  assert(
    !fs.existsSync(path.join(vault, '10-卡片盒', '概念卡片', 'smoke-card.md')),
    'discard must leave disk untouched'
  );

  // (c) Apply create → file appears
  const applied = applyProposal(vault, pCreate.proposal);
  assert(applied.ok, applied.error);
  assert(
    fs.existsSync(path.join(vault, '10-卡片盒', '概念卡片', 'smoke-card.md')),
    'apply create failed'
  );

  // (c1) AL-0 / PR-0 TOCTOU: edit Apply refuses when the file changed after propose
  {
    const staleRel = '10-卡片盒/概念卡片/smoke-card.md';
    const staleAbs = path.join(vault, '10-卡片盒', '概念卡片', 'smoke-card.md');
    const pStale = proposeEdit(vault, staleRel, '# Card (agent)\n', 'stale edit');
    assert(pStale.ok && /^[0-9a-f]{64}$/.test(pStale.proposal.beforeSha256 || ''), 'AL-0: edit proposal records beforeSha256');
    fs.writeFileSync(staleAbs, '# Card\nuser edit after propose\n', 'utf8');
    const staleBytes = fs.readFileSync(staleAbs);
    const staleRes = applyProposal(vault, pStale.proposal);
    assert(!staleRes.ok && staleRes.code === 'STALE', 'AL-0: stale edit Apply refused');
    assert(/文件已被改动，请重新生成建议/.test(staleRes.error || ''), 'AL-0: refusal asks to regenerate');
    assert(fs.readFileSync(staleAbs).equals(staleBytes), 'AL-0: disk byte-identical after refusal');
    const pFresh = proposeEdit(vault, staleRel, '# Card\n', 'fresh edit');
    assert(pFresh.ok && applyProposal(vault, pFresh.proposal).ok, 'AL-0: unchanged file applies normally');
    assert(fs.readFileSync(staleAbs, 'utf8') === '# Card\n', 'AL-0: fresh edit written');
  }

  // (c2) Apply move
  const pMove = proposeMove(vault, noteRel, '02-项目/个人项目/smoke-note.md', 'sort');
  assert(pMove.ok, pMove.error);
  assert(fs.existsSync(inboxNote), 'move must not happen before apply');
  const moved = applyProposal(vault, pMove.proposal);
  assert(moved.ok, moved.error);
  assert(!fs.existsSync(inboxNote), 'source should be gone after move');
  assert(
    fs.existsSync(path.join(vault, '02-项目', '个人项目', 'smoke-note.md')),
    'dest missing after move'
  );

  // (d) rejects
  for (const bad of ['../outside.md', '/etc/passwd', '.obsidian/app.json', '00-系统/HOME.md', '00-系统/evil.md']) {
    const r = resolveVaultPath(vault, bad);
    assert(!r.ok, `should reject ${bad}`);
  }
  assert(!proposeCreate(vault, '00-系统/hack.md', 'x', 'bad').ok, 'reject 00-系统');
  assert(!proposeCreate(vault, '90-附件/公众号/layout/x.html', 'x', 'bad').ok, 'reject 90-附件');
  assert(
    !proposeMove(vault, '02-项目/个人项目/smoke-note.md', '.obsidian/x.md', 'bad').ok,
    'reject .obsidian'
  );

  // (e) create onto existing → rejected
  assert(
    !proposeCreate(vault, '10-卡片盒/概念卡片/smoke-card.md', '# again', 'dup').ok,
    'must reject create onto existing file'
  );

  // Mock engine: proposals only
  const engine = createMockEngine();
  const inbox2 = path.join(vault, '01-收件箱', '待处理', 'another.md');
  fs.mkdirSync(path.dirname(inbox2), { recursive: true });
  fs.writeFileSync(inbox2, '# Another\n方法流程说明\n', 'utf8');
  assert(engine.viaSkills === true, 'createMockEngine is skills facade');
  const sortRes = await engine.sortInbox({
    vaultRoot: vault,
    noteRel: '01-收件箱/待处理/another.md',
  });
  assert(sortRes.ok && sortRes.proposals.length === 1, 'sort propose');
  assert(sortRes.viaSkills && sortRes.skill === 'sortInbox', 'sort via skills-logic');
  assert(fs.existsSync(inbox2), 'no write before apply');
  const cardRes = await engine.makeCard({
    vaultRoot: vault,
    noteRel: '01-收件箱/待处理/another.md',
  });
  assert(cardRes.ok && cardRes.proposals.length === 1, 'card propose');
  assert(cardRes.viaSkills && cardRes.skill === 'makeCard', 'card via skills-logic');
  assert(!fs.existsSync(path.join(vault, cardRes.proposals[0].path)), 'card not written');

  const askRes = await engine.ask({ vaultRoot: vault, question: 'Smoke Note 项目' });
  assert(askRes.ok && askRes.citations.length >= 0, 'ask ok');
  assert(askRes.viaSkills && askRes.skill === 'ask', 'ask via skills-logic');

  // sort must refuse 公众号 pipeline notes; OA tree fingerprint unchanged after ask/sort
  const sortOa = await engine.sortInbox({ vaultRoot: vault, noteRel: briefRel });
  assert(!sortOa.ok, 'sort must refuse OA brief');
  assert(/公众号/.test(String(sortOa.error || '')), 'sort OA error mentions 公众号');
  assert(oaFingerprint() === oaBefore, 'ask/sort must not damage 公众号 tree');
  assert(fs.existsSync(path.join(vault, ...briefRel.split('/'))), 'brief still on disk');
  assert(fs.existsSync(path.join(vault, '10-卡片盒', '公众号', 'drafts')), 'drafts dir intact');
  assert(fs.existsSync(path.join(vault, '00-系统', '公众号', 'voice.md')), 'voice intact after ask/sort');

  // dsh-llm in-process mount via composition root (no network)
  const { smokeMount } = await import('../apps/desktop/lib/runtime/boot.js');
  const mount = await smokeMount();
  assert(mount.ok && mount.providers.includes('deepseek-official'), 'dsh-llm mount');
  assert(mount.hasCredentials, 'kvd-keychain provides credentials');
  assert(mount.hasVault, 'kvd-vault provides vault');
  assert(mount.hasVaultSearch, 'kvd-search provides vaultSearch');
  assert(mount.hasProposals, 'kvd-proposals provides proposals');
  assert(mount.hasIpc, 'kvd-ipc-bridge provides ipc');
  assert(mount.hasSkills, 'kvd-skills provides kvdSkills');
  assert(mount.hasMockProvider, 'kvd-llm-mock registered kvd-mock provider');

  // --- PR-2 + PR-3: credentials + privacy gate (offline) ---
  delete process.env.DEEPSEEK_API_KEY;
  assert(process.env.DEEPSEEK_API_KEY === undefined, 'env key must start undefined');

  const runtimeSrc = ['apps/desktop/src/runtime/boot.ts', 'packages/skills/src/index.ts', 'packages/keychain/src/index.ts']
    .map((f) => fs.readFileSync(path.join(repo.ROOT, f), 'utf8'))
    .join('\n');
  assert(!/process\.env\.DEEPSEEK_API_KEY\s*=/.test(runtimeSrc), 'runtime (boot/kvd-skills/kvd-keychain) must not assign DEEPSEEK_API_KEY');

  const mainSrc = fs.readFileSync(path.join(repo.APP, 'src', 'main.ts'), 'utf8');
  assert(/agent-sort[\s\S]*needPrivacy/.test(mainSrc), 'G1: agent-sort must check privacy');
  assert(/agent-card[\s\S]*needPrivacy/.test(mainSrc), 'G1: agent-card must check privacy');

  const { getRuntime, disposeRuntime, wasDisposeCalled } = await import('../apps/desktop/lib/runtime/boot.js');
  const { credentialRef } = await import('@deepseek-ai/dsh-credentials');
  const llmMod = await import('@deepseek-ai/dsh-llm');
  const { BlockAssembler, createSystemMessage, createUserMessage } = llmMod;

  const rt = await getRuntime();
  assert(rt && rt.ctx, 'runtime ctx');
  const ctx = rt.ctx;
  const credentials = ctx.get('credentials');
  const kvdPrefs = ctx.get('kvdPrefs');
  assert(credentials, 'credentials service');
  assert(kvdPrefs, 'kvdPrefs service');

  // --- PR-4: kvd-vault resolve + realpath + blocked prefixes ---
  const vaultSvc = ctx.get('vault');
  assert(vaultSvc, 'vault service');
  assert(vaultSvc.getRoot() === null, 'vault starts unset');

  let vaultChangedEvents = [];
  const offVault = ctx.on('kvd/vault-changed', (ev) => {
    vaultChangedEvents.push(ev);
  });
  const setRes = vaultSvc.setRoot(vault);
  assert(setRes.ok && setRes.vaultPath === path.resolve(vault), 'vault.setRoot');
  assert(vaultSvc.getRoot() === path.resolve(vault), 'vault.getRoot');
  assert(vaultChangedEvents.length === 1 && vaultChangedEvents[0].root === path.resolve(vault), 'kvd/vault-changed on set');

  const okRel = vaultSvc.resolve('01-收件箱/待处理/another.md');
  assert(okRel.ok && okRel.rel === '01-收件箱/待处理/another.md', 'resolve inbox note');
  assert(fs.existsSync(okRel.abs), 'resolved abs exists');

  // realpath: symlink escape must be rejected
  const outside = path.join(tmp, 'outside-secret.md');
  fs.writeFileSync(outside, 'SECRET', 'utf8');
  const linkDir = path.join(vault, '01-收件箱', 'link-escape');
  fs.mkdirSync(linkDir, { recursive: true });
  const escapeLink = path.join(linkDir, 'escaped.md');
  try {
    fs.symlinkSync(outside, escapeLink);
  } catch (err) {
    // Some CI images disallow symlinks; skip realpath escape if so.
    console.log('  (skip symlink realpath: ' + err.message + ')');
  }
  if (fs.existsSync(escapeLink) && fs.lstatSync(escapeLink).isSymbolicLink()) {
    const escaped = vaultSvc.resolve('01-收件箱/link-escape/escaped.md');
    assert(!escaped.ok, 'realpath must reject symlink escape');
  }

  for (const bad of [
    '../outside.md',
    '/etc/passwd',
    '.obsidian/app.json',
    '00-系统/HOME.md',
    '00-系统/evil.md',
  ]) {
    const r = vaultSvc.resolve(bad);
    assert(!r.ok, 'vault.resolve rejects ' + bad);
    const r2 = resolveVaultPath(vault, bad);
    assert(!r2.ok, 'resolveVaultPath rejects ' + bad);
  }
  assert(
    vaultSvc.forbiddenPrefixes.includes('00-系统') && vaultSvc.forbiddenPrefixes.includes('.obsidian'),
    'FORBIDDEN_PREFIXES exposed'
  );

  vaultSvc.clear();
  assert(vaultSvc.getRoot() === null, 'vault.clear');
  assert(
    vaultChangedEvents.length === 2 && vaultChangedEvents[1].root === null,
    'kvd/vault-changed on clear'
  );
  if (typeof offVault === 'function') offVault();
  // Restore active root for remaining engine tests that use vault path directly
  vaultSvc.setRoot(vault);

  // --- PR-4b: kvd-search Chinese bigram + excluded dirs ---
  const vaultSearch = ctx.get('vaultSearch');
  assert(vaultSearch, 'vaultSearch service');

  // Seed inbox with a Chinese phrase that bigrams must match
  const zhNote = path.join(vault, '01-收件箱', '待处理', 'zh-bigram.md');
  fs.mkdirSync(path.dirname(zhNote), { recursive: true });
  fs.writeFileSync(
    zhNote,
    '# 写盘确认\n\nVault Agent 默认档写盘前要做什么：先拟改动再 Apply。\n',
    'utf8'
  );
  // Plantable markers inside excluded dirs — must NOT appear in hits
  const sysNote = path.join(vault, '00-系统', 'secret-hit.md');
  fs.mkdirSync(path.dirname(sysNote), { recursive: true });
  fs.writeFileSync(sysNote, '# 写盘\n系统目录里的写盘不应被搜到 SECRET_SYS\n', 'utf8');
  const attNote = path.join(vault, '90-附件', 'secret-att.md');
  fs.mkdirSync(path.dirname(attNote), { recursive: true });
  fs.writeFileSync(attNote, '# 写盘\n附件目录里的写盘不应被搜到 SECRET_ATT\n', 'utf8');

  const bigrams = vaultSearch.tokenize('Vault Agent 默认档写盘前要做什么');
  assert(bigrams.includes('写盘'), 'tokenize yields 写盘 bigram');

  const found = vaultSearch.search('Vault Agent 默认档写盘前要做什么', 10);
  assert(found.ok, 'vaultSearch.search ok');
  assert(
    found.hits.some((h) => h.path.includes('zh-bigram.md')),
    'Chinese bigram search finds inbox note'
  );
  assert(
    !found.hits.some((h) => h.path.startsWith('00-系统/') || h.path.startsWith('90-附件/')),
    'excluded dirs 00-系统 / 90-附件 not searched'
  );
  const leak = vaultSearch.search('SECRET_SYS', 10);
  assert(leak.ok && leak.hits.length === 0, '00-系统 content not searchable');
  const leakAtt = vaultSearch.search('SECRET_ATT', 10);
  assert(leakAtt.ok && leakAtt.hits.length === 0, '90-附件 content not searchable');

  // Pure search.js path also excludes those dirs
  assert(
    SEARCH_EXCLUDED_TOP.includes('00-系统') && SEARCH_EXCLUDED_TOP.includes('90-附件'),
    'SEARCH_EXCLUDED_TOP'
  );
  const pure = searchVault(vault, 'SECRET_SYS', 10);
  assert(pure.ok && pure.hits.length === 0, 'search.js excludes 00-系统');

  // --- agent-log PR-1: append-only log under .vault/ + .vault guard (AL-1/2/4/5/8) ---
  {
    const { createAgentLog, sha256Hex: logSha } = await import('../packages/agent-log/lib/index.js');
    const { resolveVaultPath: rvp, isReadableRel: readable } = await import('../packages/vault/lib/index.js');
    const MARK = 'AGENTLOG_SMOKE_MARKER_42';
    const warns = [];
    const alog = createAgentLog({ getVaultRoot: () => vault, deviceId: 'smoke', app: '0.0.0-smoke', utcOffsetMinutes: 480, onWarn: (m) => warns.push(m) });
    const rec = alog.append({ ev: 'proposal.created', id: 'chg_smoke', kind: 'edit', path: '01-收件箱\\smoke.md', origin: 'skill:makeCard', actor: 'agent', beforeSha256: logSha(MARK), content: MARK, summary: MARK, prompt: MARK });
    assert(rec && rec.path === '01-收件箱/smoke.md', 'AL-8: log stores vault paths with /');
    const day = rec.ts.slice(0, 10);
    const logFile = path.join(vault, '.vault', 'agent-log', `${day}.smoke.jsonl`);
    assert(fs.existsSync(logFile) && /\+08:00$/.test(rec.ts), 'AL-1: day file <vault>/.vault/agent-log/<day>.<device>.jsonl, ts +08:00');
    assert(alog.append({ ev: 'proposal.apply_failed', id: 'chg_smoke', error: 'stale', stale: true }), 'AL-1: apply_failed with error code appended');
    assert(alog.readDay(day).length === 2, 'AL-1: read back both events');
    assert(!fs.readFileSync(logFile, 'utf8').includes(MARK), 'AL-2: no note content / summary / prompt in the log');
    assert(!rvp(vault, '.vault/agent-log/x.jsonl').ok && !readable(`.vault/agent-log/${day}.smoke.jsonl`), 'AL-4: agents can neither write nor read .vault/');
    fs.appendFileSync(logFile, `${MARK}\n`);
    assert(searchVault(vault, MARK, 10).hits.length === 0, 'AL-4: search never indexes .vault/');
    let threw = false;
    fs.writeFileSync(path.join(vault, 'not-a-dir'), '');
    let failed = 'unset';
    try { failed = createAgentLog({ getVaultRoot: () => path.join(vault, 'not-a-dir'), deviceId: 'x', onWarn: () => {} }).append({ ev: 'proposal.applied' }); } catch { threw = true; }
    fs.rmSync(path.join(vault, 'not-a-dir'));
    assert(!threw && failed === null, 'AL-5: a failing log write never throws into the caller');
    fs.rmSync(path.join(vault, '.vault'), { recursive: true, force: true });
  }

  // --- PR-5: kvd-proposals clears on vault switch (G4) + ipc bridge ---
  const proposals = ctx.get('proposals');
  const ipc = ctx.get('ipc');
  assert(proposals, 'proposals service');
  assert(ipc, 'ipc service');
  assert(ipc.listHandled().includes('agent-apply'), 'ipc registered agent-apply');
  assert(ipc.listHandled().includes('agent-discard'), 'ipc registered agent-discard');

  const pCreated = proposals.create('10-卡片盒/概念卡片/pr5-pending.md', '# pending\n', 'g4');
  assert(pCreated.ok, pCreated.error || 'proposals.create');
  assert(proposals.size() === 1, 'one pending proposal');

  // Switching vault must clear pending (kvd/vault-changed)
  const vault2 = path.join(tmp, 'vault-b');
  fs.mkdirSync(vault2, { recursive: true });
  const switched = vaultSvc.setRoot(vault2);
  assert(switched.ok, 'switch vault');
  assert(proposals.size() === 0, 'G4: pending cleared on vault switch');

  // Switch back for remaining tests
  vaultSvc.setRoot(vault);
  assert(proposals.size() === 0, 'still clear after switch back');

  // --- Spec R1/R2: Agent cannot accept its own proposals + global write pause ---
  {
    const { createWritePause, LOCAL_UI_ORIGIN } = await import('../packages/proposals/lib/index.js');
    const rejections = [];
    const offReject = proposals.onApplyRejected((r) => rejections.push(r));
    const rel = '10-卡片盒/概念卡片/self-accept.md';
    const abs = path.join(vault, ...rel.split('/'));
    const mine = proposals.create(rel, '# self\n', 'agent self-accept attempt');
    assert(mine.ok, 'R1: agent proposal created');
    const snap = () => (fs.existsSync(abs) ? fs.readFileSync(abs, 'base64') : null);
    for (const origin of [undefined, { kind: 'agent', channel: 'dsh-agent' }, { kind: 'tool', channel: 'vault_propose_change' }, { kind: 'remote', channel: 'feishu' }]) {
      const r = proposals.apply(mine.proposal.id, origin);
      assert(!r.ok && r.code === 'APPLY_FORBIDDEN', `AC-P1: Apply from ${origin ? origin.kind : 'no origin'} refused`);
    }
    assert(snap() === null, 'AC-P1: disk unchanged after refused self-Apply');
    assert(rejections.length === 4 && rejections.every((r) => r.code === 'APPLY_FORBIDDEN' && r.reason), 'AC-P1: refusal reasons reach the log listener');

    let prefs = {};
    const pause = createWritePause({ readPrefs: () => prefs, writePrefs: (x) => (prefs = { ...prefs, ...x }) });
    proposals.attachWritePause(pause);
    assert(pause.pause({ kind: 'agent' }).ok && proposals.isWritePaused(), 'AC-P3: any origin may pause writes');
    const blocked = proposals.create('10-卡片盒/概念卡片/paused.md', 'x', 'paused');
    assert(!blocked.ok && blocked.code === 'WRITE_PAUSED' && /写入已暂停/.test(blocked.error), 'AC-P3: no new proposal while paused');
    const lockedApply = proposals.apply(mine.proposal.id, LOCAL_UI_ORIGIN);
    assert(!lockedApply.ok && lockedApply.code === 'WRITE_PAUSED' && snap() === null, 'AC-P3: existing proposal cannot Apply while paused');
    const pausedAsk = await ctx.get('kvdSkills').ask({ question: '项目想法有哪些？', forceMock: true });
    assert(pausedAsk.ok, 'AC-P3: A1 ask still answers while paused');
    for (const origin of [undefined, { kind: 'agent' }, { kind: 'remote', channel: 'wecom' }]) {
      assert(!pause.resume(origin).ok && proposals.isWritePaused(), 'AC-P4: agent/remote cannot lift the pause');
    }
    assert(pause.resume(LOCAL_UI_ORIGIN).ok && !proposals.isWritePaused(), 'AC-P4: local manual resume is immediate');
    assert(proposals.apply(mine.proposal.id, LOCAL_UI_ORIGIN).ok && snap() !== null, 'R1: human click in the renderer applies');
    const again = proposals.create('10-卡片盒/概念卡片/self-accept-2.md', 'x', 'discard me');
    pause.pause();
    assert(proposals.discard(again.proposal.id).ok, 'AC-P3: Discard still works while paused');
    pause.resume(LOCAL_UI_ORIGIN);
    proposals.attachWritePause(null);
    offReject();
    fs.unlinkSync(abs);
  }

  // ipc.push is callable (no window in pure-Node → false)
  assert(ipc.push('agent-proposal', { id: 'x' }) === false, 'ipc.push no-ops without window');

  // --- PR-6: kvd-skills + kvd-llm-mock (adapter swap, not parallel engine) ---
  const kvdSkills = ctx.get('kvdSkills');
  assert(kvdSkills, 'kvdSkills service');
  assert(ctx.llm.listProviders().some((p) => p.id === 'kvd-mock'), 'kvd-mock in listProviders');

  // Offline skills path (forceMock): goes through kvd-mock adapter / skills-logic
  kvdPrefs.clearPrivacyForTests();
  assert(!kvdPrefs.getPrivacyAccepted(), 'privacy unset before mock skills');

  const skillAsk = await kvdSkills.ask({ question: '写盘确认', forceMock: true });
  assert(skillAsk.ok && skillAsk.viaSkills && skillAsk.skill === 'ask', 'skills ask viaSkills');
  assert(/模拟|写盘|zh-bigram|出处/.test(String(skillAsk.answer || '')), 'skills ask mock answer');

  const skillSort = await kvdSkills.sortInbox({
    noteRel: '01-收件箱/待处理/another.md',
    forceMock: true,
  });
  assert(skillSort.ok && skillSort.viaSkills && skillSort.skill === 'sortInbox', 'skills sort');
  assert(skillSort.proposals && skillSort.proposals.length === 1, 'skills sort proposes');
  assert(fs.existsSync(path.join(vault, '01-收件箱', '待处理', 'another.md')), 'skills sort no write');

  const skillCard = await kvdSkills.makeCard({
    noteRel: '01-收件箱/待处理/another.md',
    forceMock: true,
  });
  assert(skillCard.ok && skillCard.viaSkills && skillCard.skill === 'makeCard', 'skills card');
  assert(skillCard.proposals && skillCard.proposals.length === 1, 'skills card proposes');
  assert(!fs.existsSync(path.join(vault, skillCard.proposals[0].path)), 'skills card no write');

  // kvd-mock provider exempt from privacy (offline); mock-offline remains gated below
  {
    const assembler = new BlockAssembler();
    for await (const chunk of ctx.llm.stream({
      provider: 'kvd-mock',
      model: 'mock',
      messages: [
        createSystemMessage('你是 Knowledge Vault 的助手。只根据提供的笔记片段回答。'),
        createUserMessage({
          content: [{ type: 'text', text: '问题：x\n\n笔记片段：\n### a.md\nsnippet\n\n请回答并列出出处路径。' }],
        }),
      ],
    })) {
      assembler.push(chunk);
    }
    assert(!(assembler.finish && assembler.finish.kind === 'error'), 'kvd-mock exempt from privacy');
    const parts = (assembler.message() && assembler.message().content) || assembler.blocks() || [];
    const out = parts.filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    assert(/模拟/.test(out), 'kvd-mock returns mock ask text');
  }

  // main.js default-mode IPC must call runSkill / kvdSkills (not duplicated engine path)
  assert(/runSkill\(['"]ask['"]/.test(mainSrc), 'main agent-ask uses runSkill');
  assert(/runSkill\(['"]sortInbox['"]/.test(mainSrc), 'main agent-sort uses runSkill');
  assert(/runSkill\(['"]makeCard['"]/.test(mainSrc), 'main agent-card uses runSkill');
  assert(!/getEngine\(\)\.ask/.test(mainSrc), 'main no longer getEngine().ask');

  kvdPrefs.clearPrivacyForTests();
  assert(!kvdPrefs.getPrivacyAccepted(), 'privacy starts unset');

  const ref = credentialRef('DEEPSEEK_API_KEY');
  await credentials.set(ref, 'smoke-offline-key');

  const mockAdapter = {
    providerInfo(id) {
      return { id, name: 'Offline Mock' };
    },
    providerRetryPolicy() {
      return undefined;
    },
    imageRequestPricing() {
      return undefined;
    },
    listModels() {
      return Promise.resolve([{ id: 'mock', name: 'mock' }]);
    },
    resolveModel(provider, model) {
      return Promise.resolve({ provider, id: model, name: model });
    },
    async prepareCall(provider, model, signal) {
      const resolved = await this.resolveModel(provider, model, signal);
      return { model: resolved, stream: (options) => this.stream(options) };
    },
    async *stream(_options) {
      const hit = await ctx.get('credentials').resolve(ref);
      if (!hit || !hit.value) throw new Error('mock: missing credential');
      if (Object.prototype.hasOwnProperty.call(process.env, 'DEEPSEEK_API_KEY')) {
        throw new Error('env DEEPSEEK_API_KEY defined during stream');
      }
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'pong' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'pong' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  ctx.llm.registerAdapter(['mock-offline'], mockAdapter);

  async function collectStream(provider) {
    const assembler = new BlockAssembler();
    for await (const chunk of ctx.llm.stream({
      provider,
      model: 'mock',
      messages: [
        createSystemMessage('smoke'),
        createUserMessage({ content: [{ type: 'text', text: 'ping' }] }),
      ],
    })) {
      assembler.push(chunk);
    }
    return assembler;
  }

  // Without consent: llm/stream blocked (privacy gate)
  {
    const blocked = await collectStream('mock-offline');
    assert(blocked.finish && blocked.finish.kind === 'error', 'privacy blocks stream');
    assert(blocked.finish.failure && blocked.finish.failure.code === 'PRIVACY_REQUIRED', 'PRIVACY_REQUIRED');
  }

  // Without consent: ask + sort via DeepSeek engine (hits llm/stream) are blocked
  // Live path = kvd-skills with a key in credentials (deepseek-official route).
  const liveEngine = kvdSkills;
  const askBlocked = await liveEngine.ask({ vaultRoot: vault, question: 'anything' });
  assert(!askBlocked.ok, 'ask blocked without privacy');
  assert(
    /隐私|PRIVACY/i.test(String(askBlocked.error || askBlocked.code || '')),
    'ask privacy error'
  );
  const sortBlocked = await liveEngine.sortInbox({
    vaultRoot: vault,
    noteRel: '01-收件箱/待处理/another.md',
  });
  assert(!sortBlocked.ok, 'sort blocked without privacy');
  assert(
    /隐私|PRIVACY/i.test(String(sortBlocked.error || sortBlocked.code || '')),
    'sort privacy error'
  );
  // Stronger: streamText itself is blocked
  // (kvd-skills.streamText: live deepseek-official route, key from credentials)
  const stBlocked = await kvdSkills.streamText({
    provider: 'deepseek-official',
    system: 's',
    user: 'u',
  });
  assert(!stBlocked.ok, 'streamText blocked without privacy');
  assert(/隐私|PRIVACY/i.test(String(stBlocked.error || stBlocked.code || '')), 'streamText privacy');

  // After consent: streams pass (offline mock)
  kvdPrefs.acceptPrivacy();
  assert(kvdPrefs.getPrivacyAccepted(), 'privacy accepted');

  let envLeaked = false;
  const checkEnv = () => {
    if (Object.prototype.hasOwnProperty.call(process.env, 'DEEPSEEK_API_KEY')) envLeaked = true;
    if (process.env.DEEPSEEK_API_KEY !== undefined) envLeaked = true;
  };
  const iv = setInterval(checkEnv, 1);

  const [hitA, hitB] = await Promise.all([credentials.resolve(ref), credentials.resolve(ref)]);
  assert(hitA && hitB && hitA.value === 'smoke-offline-key' && hitB.value === 'smoke-offline-key', 'concurrent resolve');

  async function streamOnce() {
    checkEnv();
    const assembler = await collectStream('mock-offline');
    assert(!(assembler.finish && assembler.finish.kind === 'error'), 'consent allows stream');
    const parts = (assembler.message() && assembler.message().content) || assembler.blocks() || [];
    const textOut = parts.filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    assert(textOut === 'pong', 'mock stream text after consent');
    return textOut;
  }

  await Promise.all([streamOnce(), streamOnce()]);
  clearInterval(iv);
  checkEnv();
  assert(!envLeaked, 'DEEPSEEK_API_KEY must never appear on process.env');
  assert(process.env.DEEPSEEK_API_KEY === undefined, 'env still undefined after concurrent streams');

  // Mock engine ask/sort still work offline after consent (skills-logic facade)
  const mockOk = await engine.ask({ vaultRoot: vault, question: 'Smoke Note 项目' });
  assert(mockOk.ok && mockOk.viaSkills, 'mock ask after consent via skills');
  const mockSort = await engine.sortInbox({
    vaultRoot: vault,
    noteRel: '01-收件箱/待处理/another.md',
  });
  assert(mockSort.ok && mockSort.proposals.length === 1 && mockSort.viaSkills, 'mock sort after consent');

  // Live engine facade also marks viaSkills (privacy already accepted; stream uses mock-offline only in collectStream)
  assert(askBlocked.viaSkills === true && sortBlocked.viaSkills === true, 'live path is kvd-skills (viaSkills)');

  await credentials.unset(ref);
  kvdPrefs.clearPrivacyForTests();

  // Composition root dispose (simulates before-quit / will-quit)
  await disposeRuntime();
  assert(wasDisposeCalled(), 'dispose must be called on quit');
  assert(rt.ctx.get('llm') === undefined, 'llm service removed after dispose');

  // AC-8 across the monorepo (apps/desktop + packages/*): no umbrella anywhere;
  // every declaration of a pinned package is exact (no ^/~), never another version.
  const pkg = repo.readJson(path.join(repo.APP, 'package.json'));
  assert(repo.declaredVersions('@deepseek-ai/dsh').length === 0, 'dsh umbrella must not be listed (any package)');
  const exactPins = {
    '@deepseek-ai/cordis': '4.0.4',
    '@deepseek-ai/dsh-credentials': '0.2.0-rc.2',
    '@deepseek-ai/dsh-llm': '0.2.0-rc.2',
    '@deepseek-ai/dsh-llm-deepseek-api-key': '0.2.0-rc.2',
    '@deepseek-ai/dsh-tool-pwsh': '0.2.0-rc.2',
    '@deepseek-ai/dsh-pwsh-sandbox': '0.2.0-rc.2',
    '@deepseek-ai/dsh-pwsh-local': '0.2.0-rc.2',
    '@deepseek-ai/schemastery': '3.18.4',
  };
  for (const [name, ver] of Object.entries(exactPins)) {
    assert(pkg.dependencies[name] === ver, name + ' exact pin');
    assert(!/[~^]/.test(String(pkg.dependencies[name])), name + ' must not use range');
    const decls = repo.declaredVersions(name);
    assert(decls.length >= 1, name + ' declared somewhere');
    for (const d of decls) {
      assert(d.spec === ver, `${name} pinned exactly to ${ver} in ${d.where} (got ${d.spec})`);
    }
  }
  // every @deepseek-ai/* declaration in every package is an exact version
  for (const { dir, pkg: p } of repo.manifests()) {
    for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
      for (const [n, v] of Object.entries(p[field] || {})) {
        if (n.startsWith('@deepseek-ai/')) assert(/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v), `${path.relative(repo.ROOT, dir)} ${n} exact (${v})`);
        if (n.startsWith('@kvd/')) assert(v === 'workspace:*', `${path.relative(repo.ROOT, dir)} ${n} uses workspace: protocol`);
      }
    }
  }
  assert(pkg.devDependencies.electron === '39.8.10', 'electron pin');
  const lock = repo.pnpmLock();
  assert(!/embedded-agent-kit/.test(lock), 'no embedded-agent-kit');
  assert(!/^\s+'?@deepseek-ai\/dsh'?:/m.test(lock) && !/\/@deepseek-ai\/dsh@|^\s+'?@deepseek-ai\/dsh@/m.test(lock), 'no dsh umbrella in pnpm-lock.yaml');
  for (const [name, ver] of Object.entries(exactPins)) {
    assert(lock.includes(`${name}@${ver}`), `pnpm-lock resolves ${name}@${ver}`);
  }

  // cordis.yml is the composition source (no hardcoded row table)
  const comp = await import('../apps/desktop/lib/runtime/composition.js');
  assert(comp.DEFAULT_ROWS.length === 11 && comp.ADVANCED_ROWS.length === 17, 'cordis.yml declares 11 default + 17 advanced rows');
  for (const row of [...comp.DEFAULT_ROWS, ...comp.ADVANCED_ROWS]) {
    assert(Object.prototype.hasOwnProperty.call(pkg.dependencies, row.name.split('/').slice(0, 2).join('/')), `cordis.yml row ${row.id} -> ${row.name} is an apps/desktop dependency`);
  }


  // --- W2: Brief → draft → titles → layout (local tool, not Apply into 90-附件) ---
  {
    const { writeWechatLayoutHtml } = await import('../packages/vault/lib/index.js');
    const { hasPendingMarker } = await import('../packages/skills-core/lib/index.js');
    const { proposeEdit } = await import('../packages/proposals/lib/index.js');
    const w2Brief = '10-卡片盒/公众号/briefs/w2-smoke-brief.md';
    fs.writeFileSync(
      path.join(vault, ...w2Brief.split('/')),
      '# W2 Smoke Brief\n\n写一篇 Knowledge Vault 公众号流水线说明：Brief→成稿→标题→排版。材料公开可核验，禁止占位待补段。\n',
      'utf8',
    );
    const w2Engine = createSkillsEngine(
      {
        style: 'mock',
        hasKey: false,
        backend: 'mock',
        search: searchVault,
        resolve: resolveVaultPath,
        proposeMove,
        proposeCreate,
        proposeEdit,
        writeLayout: (root, rel, html) => {
          const w = writeWechatLayoutHtml(root, rel, html);
          return w.ok ? { ok: true, path: w.path } : w;
        },
      },
      { id: 'mock-w2', backend: 'mock' },
    );
    const draftRes = await w2Engine.wechatDraft({ vaultRoot: vault, briefRel: w2Brief });
    assert(draftRes.ok && draftRes.skill === 'wechatDraft', 'w2 draft ok');
    assert(draftRes.proposals && draftRes.proposals.length === 1, 'w2 draft proposal');
    assert(!hasPendingMarker(draftRes.proposals[0].content), 'w2 draft no 【待补】');
    assert(
      String(draftRes.proposals[0].path).startsWith('10-卡片盒/公众号/drafts/'),
      'w2 draft path under drafts',
    );
    assert(
      !fs.existsSync(path.join(vault, ...String(draftRes.proposals[0].path).split('/'))),
      'w2 draft not on disk before Apply',
    );
    assert(applyProposal(vault, draftRes.proposals[0]).ok, 'w2 apply draft');
    const draftRel = draftRes.proposals[0].path;
    assert(fs.existsSync(path.join(vault, ...draftRel.split('/'))), 'w2 draft on disk after Apply');

    const titlesRes = await w2Engine.wechatTitles({ vaultRoot: vault, draftRel });
    assert(titlesRes.ok && titlesRes.skill === 'wechatTitles', 'w2 titles ok');
    assert(String(titlesRes.proposals[0].path).startsWith('10-卡片盒/公众号/review/'), 'w2 titles under review');
    assert(applyProposal(vault, titlesRes.proposals[0]).ok, 'w2 apply titles');

    assert(
      !proposeCreate(vault, '90-附件/公众号/layout/smoke-hack.html', '<p>x</p>', 'bad').ok,
      'w2 still reject propose into 90-附件',
    );

    const layoutRes = await w2Engine.wechatLayout({ vaultRoot: vault, draftRel });
    assert(layoutRes.ok && layoutRes.skill === 'wechatLayout', 'w2 layout ok');
    assert((layoutRes.proposals || []).length === 0, 'w2 layout has no proposals');
    assert(layoutRes.layoutPath && layoutRes.layoutPath.startsWith('90-附件/公众号/layout/'), 'w2 layout path');
    assert(fs.existsSync(path.join(vault, ...layoutRes.layoutPath.split('/'))), 'w2 layout on disk via local tool');
    const layoutHtml = fs.readFileSync(path.join(vault, ...layoutRes.layoutPath.split('/')), 'utf8');
    assert(/复制到公众号/.test(layoutHtml), 'w2 layout has copy button');
    assert(layoutRes.backend === 'local-tool', 'w2 layout backend local-tool');

    const oaNotes2 = listWechatOaNotes(vault);
    assert(oaNotes2.includes(w2Brief), 'w2 brief listed');
    assert(oaNotes2.includes(draftRel), 'w2 draft listed');

    // --- W3: copy HTML resolve + publish/archive via proposal → Apply ---
    const { extractPasteableHtml, withPublishedMark, publishedRelForSlug } = await import(
      '../packages/skills-core/lib/index.js'
    );
    const { readWechatLayoutHtml } = await import('../packages/vault/lib/index.js');

    const copyRes = await w2Engine.wechatCopyHtml({ vaultRoot: vault, draftRel });
    assert(copyRes.ok && copyRes.skill === 'wechatCopyHtml', 'w3 copy ok');
    assert(copyRes.html && /<section/.test(copyRes.html), 'w3 copy has pasteable html');
    assert(copyRes.layoutPath && copyRes.layoutPath.startsWith('90-附件/公众号/layout/'), 'w3 copy layout path');
    const layoutRead = readWechatLayoutHtml(vault, copyRes.layoutPath);
    assert(layoutRead.ok, 'w3 layout readable');
    assert(
      extractPasteableHtml(layoutRead.html) === copyRes.html ||
        extractPasteableHtml(layoutRead.html).includes('<section'),
      'w3 extract aligns with copy payload',
    );
    // clipboard APIs are Electron-only — smoke stubs by asserting resolve + html only
    assert(typeof copyRes.html === 'string' && copyRes.html.length > 40, 'w3 html payload non-empty');

    const pubRes = await w2Engine.wechatPublish({
      vaultRoot: vault,
      draftRel,
      publishedAt: '2026-10-17',
    });
    assert(pubRes.ok && pubRes.skill === 'wechatPublish', 'w3 publish ok');
    assert(pubRes.proposals && pubRes.proposals.length === 2, 'w3 publish edit+move proposals');
    assert(pubRes.proposals[0].kind === 'edit', 'w3 first proposal is edit mark');
    assert(pubRes.proposals[1].kind === 'move', 'w3 second proposal is move archive');
    // Reviewable note diff (探索者 #2): edit payload carries before+content → unified review text
    assert(typeof pubRes.proposals[0].before === 'string', 'w3 edit has before for review diff');
    const editReview = formatProposalReview(pubRes.proposals[0]);
    assert(/^编辑 /.test(editReview), 'w3 edit review shows path');
    assert(/^[+-]/m.test(editReview), 'w3 edit review has +/- unified lines');
    const moveReview = formatProposalReview(pubRes.proposals[1]);
    assert(/→/.test(moveReview), 'w3 move review shows from→to');
    assert(/wechat_status: published/.test(pubRes.proposals[0].content), 'w3 frontmatter mark');
    assert(
      String(pubRes.proposals[1].to).startsWith('05-归档/公众号/'),
      'w3 archive under 05-归档/公众号',
    );
    assert(
      !fs.existsSync(path.join(vault, ...String(pubRes.proposals[1].to).split('/'))),
      'w3 archive not on disk before Apply',
    );
    // R2.6: 「标记已发布」 is a human desktop click with no model call → initiator 'user';
    // it is created AND Applied while writes are paused (Apply still a desktop click).
    {
      const { createWritePause, LOCAL_UI_ORIGIN, initiatorFromOrigin, isBlockedByWritePause } = await import('../packages/proposals/lib/index.js');
      const { renderWechatLayoutHtml } = await import('../packages/skills-core/lib/index.js');
      // The composition root was disposed above; mount a fresh proposals fiber on its own Context.
      const { Context, Service } = await import('@deepseek-ai/cordis');
      const { default: IpcBridge } = await import('../packages/ipc-bridge/lib/index.js');
      const { default: ProposalsService } = await import('../packages/proposals/lib/index.js');
      class SmokeVault extends Service {
        constructor(c) { super(c, 'vault'); }
        getRoot() { return vault; }
      }
      const pctx = new Context();
      pctx.plugin(IpcBridge);
      pctx.plugin(SmokeVault);
      pctx.plugin(ProposalsService);
      await new Promise((r) => setTimeout(r, 0));
      const proposals = pctx.get('proposals');
      assert(proposals, 'R2.6: standalone proposals service mounted');
      let prefs = {};
      const pause = createWritePause({ readPrefs: () => prefs, writePrefs: (x) => (prefs = { ...prefs, ...x }) });
      proposals.attachWritePause(pause);
      pause.pause({ kind: 'agent' });
      assert(proposals.isWritePaused(), 'R2.6: paused for publish-archive check');
      // Layout HTML: fixed-rule local render (no model) of an Applied draft, desktop click → not paused.
      const md = '# T\n\n段落 **粗体**\n\n- a\n- b\n';
      assert(renderWechatLayoutHtml({ title: 'T', markdown: md, style: 'OpenAI' }) === renderWechatLayoutHtml({ title: 'T', markdown: md, style: 'OpenAI' }), 'R2.6: layout HTML is deterministic (no model)');
      assert(!isBlockedByWritePause(initiatorFromOrigin(LOCAL_UI_ORIGIN), true), 'R2.6: desktop-click layout not blocked while paused');
      assert(isBlockedByWritePause(initiatorFromOrigin({ kind: 'remote', channel: 'ipc-foreign-url' }), true), 'R2.6: non-desktop layout request blocked while paused');
      const layoutPaused = await w2Engine.wechatLayout({ vaultRoot: vault, draftRel: draftRel });
      assert(layoutPaused.ok && layoutPaused.backend === 'local-tool' && fs.existsSync(path.join(vault, ...layoutPaused.layoutPath.split('/'))), 'R2.6: layout local tool writes while paused');
      const agentTry = proposals.stashManyStored(pubRes.proposals, { origin: { kind: 'agent', channel: 'dsh-agent' } });
      assert(agentTry.length === 0, 'R2.6: same publish proposals from an agent origin are dropped while paused');
      const stored = proposals.stashManyStored(pubRes.proposals, { origin: LOCAL_UI_ORIGIN });
      assert(stored.length === 2 && stored.every((p) => p.initiator === 'user' && Object.isFrozen(p)), 'R2.6: publish-archive proposals stamped initiator=user (frozen)');
      assert(!proposals.apply(stored[0].id, { kind: 'agent' }).ok, 'R2.6/AC-P1: user-initiated proposal still refuses non-desktop Apply');
      assert(proposals.apply(stored[0].id, LOCAL_UI_ORIGIN).ok, 'R2.6: w3 apply edit mark while paused');
      assert(proposals.apply(stored[1].id, LOCAL_UI_ORIGIN).ok, 'R2.6: w3 apply move archive while paused');
      const agentEdit = proposals.create('10-卡片盒/公众号/drafts/agent-paused.md', 'x', 'agent while paused');
      assert(!agentEdit.ok && agentEdit.code === 'WRITE_PAUSED', 'R2.6: agent-initiated proposal still blocked while paused');
      pause.resume(LOCAL_UI_ORIGIN);
      proposals.attachWritePause(null);
    }
    const archivedRel = pubRes.proposals[1].to;
    assert(fs.existsSync(path.join(vault, ...archivedRel.split('/'))), 'w3 archived on disk');
    assert(!fs.existsSync(path.join(vault, ...draftRel.split('/'))), 'w3 draft left drafts/');
    const archivedBody = fs.readFileSync(path.join(vault, ...archivedRel.split('/')), 'utf8');
    assert(/wechat_status: published/.test(archivedBody), 'w3 archived has published mark');
    assert(/published_at: 2026-10-17/.test(archivedBody), 'w3 archived has published_at');

    // path helpers + mark idempotence (no WeChat network)
    assert(publishedRelForSlug('x').startsWith('05-归档/公众号/'), 'w3 publishedRel helper');
    assert(/wechat_status: published/.test(withPublishedMark('body', '2026-10-17')), 'w3 withPublishedMark');
    assert(
      !proposeCreate(vault, '90-附件/公众号/layout/w3-hack.html', '<p>x</p>', 'bad').ok,
      'w3 still reject propose into 90-附件',
    );

    const previewRes = await w2Engine.wechatPreview({
      vaultRoot: vault,
      layoutRel: copyRes.layoutPath,
    });
    assert(previewRes.ok && previewRes.layoutAbs, 'w3 preview resolves abs path');
  }

  console.log('AGENT_SMOKE_OK', `${asserts} asserts`, vault);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
