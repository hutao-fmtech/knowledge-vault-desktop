'use strict';

const fs = require('fs');
const path = require('path');
const { searchVault, listInboxNotes } = require('./search');
const { proposeCreate, proposeMove } = require('./proposals');

/**
 * Model-only Agent engine (default mode).
 * Live calls go through DeepSeek's OpenAI-compatible HTTP API.
 * `@deepseek-ai/dsh` is pinned for the advanced-mode PR; this default path
 * never loads bash/pwsh/fs/web/webhook tool packages (AC-11 default).
 */

const SYSTEM = `你是 Knowledge Vault 的助手。只根据提供的笔记片段回答。
回答时用相对路径引用出处，例如 \`01-收件箱/foo.md\`。
不要输出工具调用，不要要求执行命令。若信息不足就直说。`;

function pickParaDest(text) {
  const t = (text || '').toLowerCase();
  if (/归档|archive|done|完成|过去/.test(t)) return '05-归档';
  if (/项目|project|deadline|里程碑/.test(t)) return '02-项目/个人项目';
  if (/资源|书|链接|参考|教程/.test(t)) return '04-资源';
  return '03-领域';
}

function cardType(text) {
  if (/方法|how|流程|步骤/.test(text || '')) return '方法卡片';
  if (/观点|认为|认为|主张/.test(text || '')) return '观点卡片';
  if (/索引|目录|moc/.test(text || '')) return '索引卡片';
  return '概念卡片';
}

function slugify(title) {
  return String(title || 'card')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '')
    .slice(0, 40) || 'card';
}

async function callDeepSeek({ apiKey, messages }) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Offline / mocked engine — no network, no key. Used by AC-7 smoke and UI demos.
 */
function createMockEngine() {
  return {
    id: 'mock',
    async ask({ vaultRoot, question }) {
      const { hits } = searchVault(vaultRoot, question, 5);
      if (!hits.length) {
        return {
          ok: true,
          answer: '（模拟）库里没有找到相关笔记。',
          citations: [],
          proposals: [],
        };
      }
      const citations = hits.map((h) => h.path);
      return {
        ok: true,
        answer: `（模拟）根据 ${citations[0]}：「${hits[0].snippet}」\n\n出处：${citations.map((c) => '`' + c + '`').join(', ')}`,
        citations,
        proposals: [],
      };
    },
    async sortInbox({ vaultRoot, noteRel }) {
      const abs = path.join(vaultRoot, noteRel);
      if (!fs.existsSync(abs)) return { ok: false, error: `笔记不存在：${noteRel}` };
      const text = fs.readFileSync(abs, 'utf8');
      const destDir = pickParaDest(text);
      const base = path.basename(noteRel);
      const to = `${destDir}/${base}`;
      const moved = proposeMove(vaultRoot, noteRel, to, `归类到 ${destDir}`);
      if (!moved.ok) return moved;
      return {
        ok: true,
        answer: `（模拟）建议将 \`${noteRel}\` 移到 \`${to}\`。确认 Apply 后才会落盘。`,
        citations: [noteRel],
        proposals: [moved.proposal],
      };
    },
    async makeCard({ vaultRoot, noteRel }) {
      const abs = path.join(vaultRoot, noteRel);
      if (!fs.existsSync(abs)) return { ok: false, error: `笔记不存在：${noteRel}` };
      const text = fs.readFileSync(abs, 'utf8');
      const title = text.split('\n').find((l) => l.trim())?.replace(/^#\s*/, '').trim() || path.basename(noteRel, '.md');
      const type = cardType(text);
      const rel = `10-卡片盒/${type}/${slugify(title)}.md`;
      const body = `---\nsource: ${noteRel}\n---\n\n# ${title}\n\n${text.trim().slice(0, 1200)}\n`;
      const created = proposeCreate(vaultRoot, rel, body, `生成卡片 ${rel}`);
      if (!created.ok) return created;
      return {
        ok: true,
        answer: `（模拟）将在 \`${rel}\` 新建卡片。确认 Apply 后才会落盘。`,
        citations: [noteRel],
        proposals: [created.proposal],
      };
    },
  };
}

function createDeepSeekEngine(getApiKey) {
  return {
    id: 'deepseek-model-only',
    async ask({ vaultRoot, question }) {
      const apiKey = getApiKey();
      if (!apiKey) return { ok: false, error: '未配置 API key', needKey: true };
      const { hits } = searchVault(vaultRoot, question, 6);
      const context = hits.map((h) => `### ${h.path}\n${h.snippet}`).join('\n\n') || '(无命中片段)';
      const answer = await callDeepSeek({
        apiKey,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `问题：${question}\n\n笔记片段：\n${context}\n\n请回答并列出出处路径。`,
          },
        ],
      });
      return { ok: true, answer, citations: hits.map((h) => h.path), proposals: [] };
    },
    async sortInbox({ vaultRoot, noteRel }) {
      const apiKey = getApiKey();
      const abs = path.join(vaultRoot, noteRel);
      if (!fs.existsSync(abs)) return { ok: false, error: `笔记不存在：${noteRel}` };
      const text = fs.readFileSync(abs, 'utf8');
      let destDir = pickParaDest(text);
      let reason = '基于关键词启发式';
      if (apiKey) {
        try {
          const reply = await callDeepSeek({
            apiKey,
            messages: [
              {
                role: 'system',
                content: '从 PARA 中选一个目录：02-项目、03-领域、04-资源、05-归档。只输出目录名与一行理由。',
              },
              { role: 'user', content: text.slice(0, 3000) },
            ],
          });
          const m = reply.match(/0[2-5]-[\u4e00-\u9fffA-Za-z]+/);
          if (m) destDir = m[0];
          reason = reply.slice(0, 200);
        } catch {
          /* fall back to heuristic */
        }
      }
      if (destDir === '02-项目') destDir = '02-项目/个人项目';
      const to = `${destDir}/${path.basename(noteRel)}`;
      const moved = proposeMove(vaultRoot, noteRel, to, `归类到 ${destDir}`);
      if (!moved.ok) return moved;
      return {
        ok: true,
        answer: `建议移动到 \`${to}\`。${reason}\n确认 Apply 后才会落盘。`,
        citations: [noteRel],
        proposals: [moved.proposal],
        needKey: !apiKey,
      };
    },
    async makeCard({ vaultRoot, noteRel }) {
      const abs = path.join(vaultRoot, noteRel);
      if (!fs.existsSync(abs)) return { ok: false, error: `笔记不存在：${noteRel}` };
      const text = fs.readFileSync(abs, 'utf8');
      const title = text.split('\n').find((l) => l.trim())?.replace(/^#\s*/, '').trim() || path.basename(noteRel, '.md');
      const type = cardType(text);
      const rel = `10-卡片盒/${type}/${slugify(title)}.md`;
      const body = `---\nsource: ${noteRel}\n---\n\n# ${title}\n\n${text.trim().slice(0, 2000)}\n`;
      const created = proposeCreate(vaultRoot, rel, body, `生成卡片 ${rel}`);
      if (!created.ok) return created;
      return {
        ok: true,
        answer: `将新建卡片 \`${rel}\`。确认 Apply 后才会落盘。`,
        citations: [noteRel],
        proposals: [created.proposal],
      };
    },
  };
}

module.exports = {
  createMockEngine,
  createDeepSeekEngine,
  listInboxNotes,
  searchVault,
};
