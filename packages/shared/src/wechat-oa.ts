/**
 * WeChat Official Account (公众号) vault paths — scope §2 adapted to this
 * vault's PARA numbering (04-资源 / 05-归档, not scope's 20-资源 / 40-归档).
 * Writing skills and agents must use these vault-relative paths; never
 * `/workspace/content-team` (read-only archive, no dual-write).
 */
export const WECHAT_OA = {
  voice: '00-系统/公众号/voice.md',
  intel: '01-收件箱/公众号线索',
  briefs: '10-卡片盒/公众号/briefs',
  drafts: '10-卡片盒/公众号/drafts',
  review: '10-卡片盒/公众号/review',
  layout: '90-附件/公众号/layout',
  published: '05-归档/公众号',
  analytics: '04-资源/公众号/analytics',
  /** Parent of briefs/drafts/review */
  zettelRoot: '10-卡片盒/公众号',
} as const;

export type WechatOaKey = keyof typeof WECHAT_OA;

/** Dirs/files that must exist after create-vault (W1 §4). */
export const WECHAT_OA_REQUIRED_RELS: readonly string[] = [
  WECHAT_OA.voice,
  WECHAT_OA.intel,
  WECHAT_OA.briefs,
  WECHAT_OA.drafts,
  WECHAT_OA.review,
  WECHAT_OA.layout,
  WECHAT_OA.published,
  WECHAT_OA.analytics,
];

const PIPELINE_ROOTS: readonly string[] = [
  WECHAT_OA.zettelRoot,
  WECHAT_OA.intel,
  WECHAT_OA.layout,
  WECHAT_OA.published,
  WECHAT_OA.analytics,
  '00-系统/公众号',
  '04-资源/公众号',
  '90-附件/公众号',
];

/**
 * Paths the default-mode sort/card flows must not treat as generic inbox
 * (avoids ask/sort dismantling the 公众号 subtree).
 */
export function isWechatOaPipelineRel(relPath: unknown): boolean {
  const rel = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!rel) return false;
  return PIPELINE_ROOTS.some((r) => rel === r || rel.startsWith(r + '/'));
}
