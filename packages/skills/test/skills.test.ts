import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as skills from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('skills re-exports the core helpers and is a Cordis service', () => {
  assert.equal(skills.name, 'kvd-skills');
  assert.deepEqual(skills.inject, ['llm', 'vault', 'vaultSearch', 'proposals']);
  assert.equal(typeof skills.pickParaDest, 'function');
  assert.equal(typeof skills.createSkillsEngine, 'function');
});

test('no import cycle: skills does not import @kvd/llm-mock', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'index.ts'), 'utf8');
  assert.ok(!/(from|import\()\s*'(@kvd\/llm-mock|\.\/kvd-llm-mock\.mjs)'/.test(src));
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
  assert.ok(!pkg.dependencies['@kvd/llm-mock']);
});

test('never assigns DEEPSEEK_API_KEY into process.env', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'index.ts'), 'utf8');
  assert.ok(!/process\.env\.DEEPSEEK_API_KEY\s*=/.test(src));
});


import os from 'node:os';
import { proposeCreate, proposeMove, proposeEdit, applyProposal } from '@kvd/proposals';
import { resolveVaultPath, writeWechatLayoutHtml } from '@kvd/vault';
import { searchVault } from '@kvd/search';
import { hasPendingMarker } from '@kvd/skills-core';

function seedOaVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-w2-'));
  for (const rel of [
    '10-卡片盒/公众号/briefs',
    '10-卡片盒/公众号/drafts',
    '10-卡片盒/公众号/review',
    '90-附件/公众号/layout',
    '05-归档/公众号',
  ]) {
    fs.mkdirSync(path.join(vault, ...rel.split('/')), { recursive: true });
  }
  return vault;
}

test('W2 wechatDraft → titles → layout local tool (no 【待补】, no propose into 90-附件)', async () => {
  const vault = seedOaVault();
  const briefRel = '10-卡片盒/公众号/briefs/unit-brief.md';
  fs.writeFileSync(
    path.join(vault, ...briefRel.split('/')),
    '# Unit Brief\n\n写一篇 vault 内公众号流水线说明，材料公开可核验。\n',
    'utf8',
  );

  const engine = skills.createSkillsEngine(
    {
      style: 'mock',
      hasKey: false,
      backend: 'mock',
      search: searchVault,
      resolve: resolveVaultPath,
      proposeMove,
      proposeCreate,
      writeLayout: (root, rel, html) => {
        const w = writeWechatLayoutHtml(root, rel, html);
        return w.ok ? { ok: true, path: w.path } : w;
      },
    },
    { id: 'mock', backend: 'mock' },
  );

  const draftRes = await engine.wechatDraft({ vaultRoot: vault, briefRel });
  assert.equal(draftRes.ok, true);
  assert.equal(draftRes.skill, 'wechatDraft');
  assert.ok(draftRes.proposals && draftRes.proposals.length === 1);
  const draftProp = draftRes.proposals[0]!;
  assert.ok(draftProp.path && draftProp.path.startsWith('10-卡片盒/公众号/drafts/'));
  assert.equal(hasPendingMarker(draftProp.content), false);
  assert.equal(fs.existsSync(path.join(vault, ...draftProp.path.split('/'))), false);
  assert.equal(applyProposal(vault, draftProp).ok, true);
  const draftRel = draftProp.path;

  const titlesRes = await engine.wechatTitles({ vaultRoot: vault, draftRel });
  assert.equal(titlesRes.ok, true);
  assert.ok(titlesRes.proposals && titlesRes.proposals.length === 1);
  const titlesProp = titlesRes.proposals[0]!;
  assert.ok(titlesProp.path && titlesProp.path.startsWith('10-卡片盒/公众号/review/'));
  assert.equal(applyProposal(vault, titlesProp).ok, true);

  assert.equal(proposeCreate(vault, '90-附件/公众号/layout/hack.html', 'x', 'bad').ok, false);

  const layoutRes = await engine.wechatLayout({ vaultRoot: vault, draftRel });
  assert.equal(layoutRes.ok, true);
  assert.equal(layoutRes.skill, 'wechatLayout');
  assert.equal((layoutRes.proposals || []).length, 0);
  assert.ok(layoutRes.layoutPath && layoutRes.layoutPath.startsWith('90-附件/公众号/layout/'));
  const layoutAbs = path.join(vault, ...layoutRes.layoutPath.split('/'));
  assert.equal(fs.existsSync(layoutAbs), true);
  const html = fs.readFileSync(layoutAbs, 'utf8');
  assert.match(html, /复制到公众号/);
});

test('W3 copy html resolve + publish via proposal→Apply (no silent move)', async () => {
  const vault = seedOaVault();
  const briefRel = '10-卡片盒/公众号/briefs/w3-brief.md';
  fs.writeFileSync(
    path.join(vault, ...briefRel.split('/')),
    '# W3 Brief\n\n发布辅助：复制 HTML 与归档。\n',
    'utf8',
  );
  const engine = skills.createSkillsEngine(
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
    { id: 'mock-w3', backend: 'mock' },
  );

  const draftRes = await engine.wechatDraft({ vaultRoot: vault, briefRel });
  assert.equal(draftRes.ok, true);
  assert.equal(applyProposal(vault, draftRes.proposals![0]!).ok, true);
  const draftRel = draftRes.proposals![0]!.path!;

  const layoutRes = await engine.wechatLayout({ vaultRoot: vault, draftRel });
  assert.equal(layoutRes.ok, true);

  const copyRes = await engine.wechatCopyHtml({ vaultRoot: vault, draftRel });
  assert.equal(copyRes.ok, true);
  assert.equal(copyRes.skill, 'wechatCopyHtml');
  assert.ok(typeof copyRes.html === 'string' && copyRes.html.includes('<section'));
  assert.ok(copyRes.layoutPath && copyRes.layoutPath.startsWith('90-附件/公众号/layout/'));
  // clipboard is Electron-only — we assert the resolve path + html payload here

  const pubRes = await engine.wechatPublish({
    vaultRoot: vault,
    draftRel,
    publishedAt: '2026-10-17',
  });
  assert.equal(pubRes.ok, true);
  assert.equal(pubRes.skill, 'wechatPublish');
  assert.ok(pubRes.proposals && pubRes.proposals.length === 2);
  assert.equal(pubRes.proposals[0]!.kind, 'edit');
  assert.equal(pubRes.proposals[1]!.kind, 'move');
  assert.match(String(pubRes.proposals[0]!.content), /wechat_status: published/);
  assert.ok(String(pubRes.proposals[1]!.to).startsWith('05-归档/公众号/'));
  // not on disk until Apply
  assert.equal(fs.existsSync(path.join(vault, ...String(pubRes.proposals[1]!.to).split('/'))), false);
  assert.equal(applyProposal(vault, pubRes.proposals[0]!).ok, true);
  assert.equal(applyProposal(vault, pubRes.proposals[1]!).ok, true);
  const archived = pubRes.proposals[1]!.to!;
  assert.equal(fs.existsSync(path.join(vault, ...archived.split('/'))), true);
  assert.equal(fs.existsSync(path.join(vault, ...draftRel.split('/'))), false);
  const archivedBody = fs.readFileSync(path.join(vault, ...archived.split('/')), 'utf8');
  assert.match(archivedBody, /wechat_status: published/);
  assert.match(archivedBody, /published_at: 2026-10-17/);

  const previewRes = await engine.wechatPreview({ vaultRoot: vault, draftRel });
  // draft moved — preview from old draftRel should fail
  assert.equal(previewRes.ok, false);
  const previewOk = await engine.wechatPreview({
    vaultRoot: vault,
    layoutRel: layoutRes.layoutPath,
  });
  assert.equal(previewOk.ok, true);
  assert.ok(previewOk.layoutAbs);
});
