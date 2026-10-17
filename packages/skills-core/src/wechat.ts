/**
 * WeChat OA writing helpers (W2): prompts retargeted to vault paths, mock draft/titles,
 * and paste-ready layout HTML. Pure — no filesystem, no Cordis.
 */
/** Shared red line: finished drafts must not contain this marker. */
export const PENDING_MARKER = '【待补】';

function slugify(title: unknown): string {
  return (
    String(title || 'card')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fff-]+/g, '')
      .slice(0, 40) || 'card'
  );
}


export const WECHAT_ARTICLE_SYSTEM = `你是 Knowledge Vault 的公众号写作助手（工程/AI/开发者向）。
输入输出一律使用 vault 相对路径：Brief 在 10-卡片盒/公众号/briefs/，成稿写到 10-卡片盒/公众号/drafts/，审校/标题到 10-卡片盒/公众号/review/。
不要读写 /workspace/content-team（只读归档，禁止双写）。不要直写 00-系统/ 或 90-附件/。
笔记改动只能通过拟改动（propose），由用户 Apply 后落盘。

核心原则：
1. 人定骨架，AI 填肉；信息增益优先；去 AI 腔。
2. 成品禁止出现「【待补】」或「请你补一段亲身经历」类占位；缺一手材料时改写为公开可核验事实，或明确标注「假设」。
3. 标题留给标题技能；正文不要假装标题已定。
4. 输出 Markdown 正文；有边界/反面；专有名词保留英文原名。`;

export const WECHAT_TITLES_SYSTEM = `你是 Knowledge Vault 的公众号标题助手。
成稿来自 10-卡片盒/公众号/drafts/；标题候选写到 10-卡片盒/公众号/review/。
不要读写 /workspace/content-team。标题必须被正文兑现；禁用无依据的「刚刚/首个/独家/颠覆」。
输出候选表（标题/方法/评分/风险/场景）并推荐信息流款与专栏款。`;

export const WECHAT_LAYOUT_SYSTEM = `你是 Knowledge Vault 的公众号排版助手。
把已定稿 Markdown 转成可粘贴进微信公众号编辑器的 HTML 预览。
排版产物由桌面端本地工具写入 90-附件/公众号/layout/，你不得通过拟改动直写 90-附件/。
不改写内容；复制载荷用 inline style；预览 max-width:677px。`;

export const WECHAT_PIPELINE_SYSTEM = `端到端公众号流水线（vault 内）：Brief → 成稿 → 标题 → 排版预览。
路径：briefs/drafts/review 在 10-卡片盒/公众号/；layout 在 90-附件/公众号/layout/（仅本地工具写入）。
禁止自动发布、禁止微信后台登录、禁止 dual-write content-team。成品无【待补】。`;

export function hasPendingMarker(text: unknown): boolean {
  return String(text || '').includes(PENDING_MARKER);
}

/** First non-empty heading or line from a brief/draft. */
export function extractNoteTitle(text: unknown, fallback = 'untitled'): string {
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    return t.replace(/^#+\s*/, '').trim() || fallback;
  }
  return fallback;
}

/**
 * Deterministic offline draft from a Brief — complete article, never 【待补】.
 */
export function mockDraftFromBrief(briefText: unknown): string {
  const title = extractNoteTitle(briefText, '工程实践笔记').replaceAll(PENDING_MARKER, '').trim() || '工程实践笔记';
  const brief = String(briefText || '').trim();
  const topicLine = (
    brief
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('---') && l.length > 8) || title
  )
    .replaceAll(PENDING_MARKER, '')
    .trim() || title;

  return `# ${title}

> 来源 Brief（vault）：10-卡片盒/公众号/briefs/ · 模拟成稿，无占位待补段

## 开头

${topicLine.slice(0, 120)}。以下按公开可核验材料展开，不要求读者补写亲身经历。

## 背景

工程团队在 Agent / CI / 协作工具上的变化，往往先体现在合并频率、评审成本和可复现流程上。本篇只陈述可核对的做法与边界。

## 核心做法

1. **先钉输入输出路径**：Brief、成稿、审校意见落在 \`10-卡片盒/公众号/\`，排版 HTML 由桌面本地工具写入 \`90-附件/公众号/layout/\`，模型不直写附件区。
2. **拟改动再 Apply**：草稿与标题笔记走 proposal → Apply；避免静默覆盖。
3. **缺材料就换角度**：没有一手数字时，写公开事实或标明「假设」，绝不留待补占位。

## 边界

- 不自动登录微信后台，不群发。
- 不双写 \`/workspace/content-team\`（只读归档）。
- 不碰 \`.obsidian/\`、\`00-系统/\`。

## 收束

确认 Brief → Apply 成稿 → 出标题 → 本地工具生成 layout 预览。复制 HTML 到公众号后台仍由人完成。

---

一句话主题：${title}

建议配图点：流水线路线图；Brief/drafts/layout 目录对照表。
`;
}

/**
 * Deterministic title candidates from a draft.
 */
export function mockTitlesFromDraft(draftText: unknown): string {
  const title = extractNoteTitle(draftText, '工程实践');
  const short = title.slice(0, 28);
  return `# 标题候选 · ${short}

| 标题 | 方法 | 评分 | 风险 | 适合场景 |
|---|---|---|---|---|
| ${short}：我们实际怎么落地 | 实体锚定 | 8 | 低 | 信息流 |
| 别在没边界时上 Agent 流水线 | 边界警告 | 7 | 中 | 专栏 |
| 从 Brief 到可粘贴 HTML 的最小闭环 | 任务结果 | 8 | 低 | 信息流 |
| 假设你只有公开材料，这篇怎么写完 | 反差转折 | 7 | 低 | 专栏 |
| ${short}（克制版） | 信任/专栏 | 7 | 低 | 专栏 |
| A/B：锐利版 vs 克制版 | A/B 对 | 7 | 低 | 测试 |

## 推荐

- **信息流点击款**：\`${short}：我们实际怎么落地\`；\`从 Brief 到可粘贴 HTML 的最小闭环\`
- **信任/专栏款**：\`${short}（克制版）\`；\`别在没边界时上 Agent 流水线\`
- **A/B 测试对**：锐利版 vs 克制版

改写建议：把口语里的「搞完了」收成「落盘 / Apply」，更像工程号本人。
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineFormat(s: string): string {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, '<code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.92em;background:#f3f4f6;padding:1px 4px;border-radius:4px;">$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:600;color:#0d0d0d;">$1</strong>');
  return t;
}

/**
 * Minimal Markdown → WeChat paste-ready HTML (OpenAI-like crisp style) + preview chrome.
 */
export function renderWechatLayoutHtml(opts: {
  title: string;
  markdown: string;
  style?: 'OpenAI' | 'Claude';
}): string {
  const title = String(opts.title || '未命名').trim() || '未命名';
  const md = String(opts.markdown || '');
  const warm = opts.style === 'Claude';
  const bg = warm ? '#faf8f5' : '#ffffff';
  const pageBg = warm ? '#f3efe8' : '#f6f7f8';
  const accent = warm ? '#c96442' : '#10a37f';
  const bodyColor = warm ? '#3d3929' : '#1f2328';

  const blocks: string[] = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let skippedH1 = false;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    if (trimmed === '---') {
      i += 1;
      continue;
    }
    if (trimmed.startsWith('```')) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      blocks.push(
        `<pre style="margin:0 0 16px;padding:12px;background:#f3f4f6;border-radius:6px;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.5;color:#1f2328;"><code>${escapeHtml(code.join('\n'))}</code></pre>`,
      );
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      blocks.push(
        `<h3 style="margin:24px 0 10px;font-size:17px;line-height:1.4;font-weight:600;color:#0d0d0d;">${inlineFormat(trimmed.replace(/^###\s+/, ''))}</h3>`,
      );
      i += 1;
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      blocks.push(
        `<h2 style="margin:32px 0 14px;padding-bottom:8px;border-bottom:1px solid #e5e7eb;font-size:20px;line-height:1.4;font-weight:600;color:#0d0d0d;">${inlineFormat(trimmed.replace(/^##\s+/, ''))}</h2>`,
      );
      i += 1;
      continue;
    }
    if (/^#\s+/.test(trimmed)) {
      if (!skippedH1) {
        skippedH1 = true;
        i += 1;
        continue;
      }
      blocks.push(
        `<h2 style="margin:32px 0 14px;padding-bottom:8px;border-bottom:1px solid #e5e7eb;font-size:20px;line-height:1.4;font-weight:600;color:#0d0d0d;">${inlineFormat(trimmed.replace(/^#\s+/, ''))}</h2>`,
      );
      i += 1;
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test((lines[i] ?? '').trim())) {
        q.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        `<blockquote style="margin:0 0 16px;padding:8px 14px;border-left:3px solid ${accent};color:#6b7280;font-size:15px;line-height:1.7;">${inlineFormat(q.join(' '))}</blockquote>`,
      );
      continue;
    }
    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      const ordered = /^\d+\.\s+/.test(trimmed);
      while (i < lines.length) {
        const t = (lines[i] ?? '').trim();
        if (!/^[-*]\s+/.test(t) && !/^\d+\.\s+/.test(t)) break;
        items.push(t.replace(/^([-*]|\d+\.)\s+/, ''));
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      const lis = items
        .map(
          (it) =>
            `<li style="margin:0 0 8px;font-size:16px;line-height:1.8;color:${bodyColor};letter-spacing:0.3px;">${inlineFormat(it)}</li>`,
        )
        .join('');
      blocks.push(`<${tag} style="margin:0 0 16px;padding-left:22px;">${lis}</${tag}>`);
      continue;
    }
    if (trimmed.startsWith('|') && trimmed.includes('|')) {
      // skip GFM tables lightly as paragraphs
      const row = trimmed
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (row.every((c) => /^:?-+:?$/.test(c))) {
        i += 1;
        continue;
      }
      blocks.push(
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:${bodyColor};letter-spacing:0.3px;">${inlineFormat(row.join(' · '))}</p>`,
      );
      i += 1;
      continue;
    }
    const para: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const n = (lines[i] ?? '').trim();
      if (!n || n.startsWith('#') || n.startsWith('>') || n.startsWith('```') || n.startsWith('|') || /^[-*]\s+/.test(n) || /^\d+\.\s+/.test(n) || n === '---') break;
      para.push(n);
      i += 1;
    }
    blocks.push(
      `<p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:${bodyColor};letter-spacing:0.3px;">${inlineFormat(para.join(''))}</p>`,
    );
  }

  const articleInner = `<section style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif;max-width:677px;margin:0 auto;padding:8px 4px;background:${bg};">
<h1 style="margin:0 0 24px;font-size:24px;line-height:1.4;font-weight:700;color:#0d0d0d;">${escapeHtml(title)}</h1>
${blocks.join('\n')}
</section>`;

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:${pageBg};">
<div style="position:sticky;top:0;z-index:9;background:#fff;border-bottom:1px solid #e5e7eb;padding:10px 16px;display:flex;gap:12px;align-items:center;font-family:sans-serif;">
<button id="copyBtn" style="background:${accent};color:#fff;border:0;border-radius:6px;padding:8px 16px;font-size:14px;cursor:pointer;">复制到公众号</button><span id="status" style="font-size:13px;color:${accent};"></span></div>
<div style="max-width:677px;margin:24px auto;background:${bg};padding:24px 16px;border-radius:8px;">
<div id="article">
${articleInner}
</div></div>
<script>
const s=document.getElementById('status'),a=document.getElementById('article');
function ok(m){s.style.color='${accent}';s.textContent=m;}
function fb(){const r=document.createRange();r.selectNodeContents(a);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);const d=document.execCommand('copy');sel.removeAllRanges();d?ok('已复制（兼容模式），去公众号编辑器粘贴即可'):(s.style.color='#d14',s.textContent='复制失败，请手动全选文章复制');}
document.getElementById('copyBtn').onclick=async()=>{const h=a.innerHTML,t=a.innerText;
try{await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([h],{type:'text/html'}),'text/plain':new Blob([t],{type:'text/plain'})})]);ok('已复制，去公众号编辑器粘贴即可');}catch(e){fb();}};
</script></body></html>`;
}

export function layoutRelForSlug(slug: string): string {
  const safe = slugify(slug) || 'article';
  return `90-附件/公众号/layout/${safe}/index.html`;
}

export function draftRelForSlug(slug: string): string {
  const safe = slugify(slug) || 'article';
  return `10-卡片盒/公众号/drafts/${safe}.md`;
}

export function titlesRelForSlug(slug: string): string {
  const safe = slugify(slug) || 'article';
  return `10-卡片盒/公众号/review/${safe}-titles.md`;
}
