'use strict';

/**
 * AC-7 offline write-confirmation smoke (no network, no API key).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault } = require('../src/vault');
const {
  proposeCreate,
  proposeMove,
  applyProposal,
  discardProposal,
} = require('../src/agent/proposals');
const { resolveVaultPath } = require('../src/agent/paths');
const { createMockEngine } = require('../src/agent/engine');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const templateRoot = path.join(__dirname, '..', 'resources', 'template');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-agent-smoke-'));
  const created = createVault({ parentDir: tmp, rawName: 'Agent_Smoke', templateRoot });
  assert(created.ok, created.error || 'createVault failed');
  const vault = created.vaultPath;

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
  const sortRes = await engine.sortInbox({
    vaultRoot: vault,
    noteRel: '01-收件箱/待处理/another.md',
  });
  assert(sortRes.ok && sortRes.proposals.length === 1, 'sort propose');
  assert(fs.existsSync(inbox2), 'no write before apply');
  const cardRes = await engine.makeCard({
    vaultRoot: vault,
    noteRel: '01-收件箱/待处理/another.md',
  });
  assert(cardRes.ok && cardRes.proposals.length === 1, 'card propose');
  assert(!fs.existsSync(path.join(vault, cardRes.proposals[0].path)), 'card not written');

  const askRes = await engine.ask({ vaultRoot: vault, question: 'Smoke Note 项目' });
  assert(askRes.ok && askRes.citations.length >= 0, 'ask ok');

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert(pkg.dependencies['@deepseek-ai/dsh'] === '0.2.0-rc.2', 'dsh pin');
  const lock = fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8');
  assert(!/embedded-agent-kit/.test(lock), 'no embedded-agent-kit');

  console.log('AGENT_SMOKE_OK', vault);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
