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

  
  // dsh-llm in-process mount via composition root (no network)
  const { smokeMount } = require('../src/agent/dsh-runtime');
  const mount = await smokeMount();
  assert(mount.ok && mount.providers.includes('deepseek-official'), 'dsh-llm mount');
  assert(mount.hasCredentials, 'kvd-keychain provides credentials');

  // --- PR-2: credentials seam; process.env.DEEPSEEK_API_KEY never defined ---
  delete process.env.DEEPSEEK_API_KEY;
  assert(process.env.DEEPSEEK_API_KEY === undefined, 'env key must start undefined');

  const runtimeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', 'dsh-runtime.js'), 'utf8');
  assert(!/process\.env\.DEEPSEEK_API_KEY\s*=/.test(runtimeSrc), 'dsh-runtime must not assign DEEPSEEK_API_KEY');

  const { getRuntime, disposeRuntime, wasDisposeCalled } = await import('../src/runtime/boot.mjs');
  const { credentialRef } = await import('@deepseek-ai/dsh-credentials');
  const llmMod = await import('@deepseek-ai/dsh-llm');
  const { BlockAssembler, createSystemMessage, createUserMessage } = llmMod;
  const rt = await getRuntime();
  assert(rt && rt.ctx, 'runtime ctx');
  const ctx = rt.ctx;
  const credentials = ctx.get('credentials');
  assert(credentials, 'credentials service');
  const ref = credentialRef('DEEPSEEK_API_KEY');
  await credentials.set(ref, 'smoke-offline-key');

  let envLeaked = false;
  const checkEnv = () => {
    if (Object.prototype.hasOwnProperty.call(process.env, 'DEEPSEEK_API_KEY')) envLeaked = true;
    if (process.env.DEEPSEEK_API_KEY !== undefined) envLeaked = true;
  };
  const iv = setInterval(checkEnv, 1);

  const [hitA, hitB] = await Promise.all([credentials.resolve(ref), credentials.resolve(ref)]);
  assert(hitA && hitB && hitA.value === 'smoke-offline-key' && hitB.value === 'smoke-offline-key', 'concurrent resolve');
  checkEnv();

  // Offline mock adapter (no network): streams must resolve credentials without env
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
      checkEnv();
      const hit = await ctx.get('credentials').resolve(ref);
      checkEnv();
      if (!hit || !hit.value) throw new Error('mock: missing credential');
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'pong' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'pong' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  ctx.llm.registerAdapter(['mock-offline'], mockAdapter);

  async function streamOnce() {
    checkEnv();
    const assembler = new BlockAssembler();
    for await (const chunk of ctx.llm.stream({
      provider: 'mock-offline',
      model: 'mock',
      messages: [
        createSystemMessage('smoke'),
        createUserMessage({ content: [{ type: 'text', text: 'ping' }] }),
      ],
    })) {
      checkEnv();
      assembler.push(chunk);
    }
    const parts = (assembler.message() && assembler.message().content) || assembler.blocks() || [];
    const text = parts.filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    assert(text === 'pong', 'mock stream text');
    return text;
  }

  await Promise.all([streamOnce(), streamOnce()]);
  clearInterval(iv);
  checkEnv();
  assert(!envLeaked, 'DEEPSEEK_API_KEY must never appear on process.env');
  assert(process.env.DEEPSEEK_API_KEY === undefined, 'env still undefined after concurrent streams');
  await credentials.unset(ref);

  // Composition root dispose (simulates before-quit / will-quit)
  await disposeRuntime();
  assert(wasDisposeCalled(), 'dispose must be called on quit');
  assert(rt.ctx.get('llm') === undefined, 'llm service removed after dispose');

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert(pkg.dependencies['@deepseek-ai/dsh'] === '0.2.0-rc.2', 'dsh pin');
  assert(pkg.devDependencies.electron === '39.8.10', 'electron pin');
  const lock = fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8');
  assert(!/embedded-agent-kit/.test(lock), 'no embedded-agent-kit');

  console.log('AGENT_SMOKE_OK', vault);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
