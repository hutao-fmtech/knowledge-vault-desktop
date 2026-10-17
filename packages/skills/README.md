# @kvd/skills

kvd-skills: default-mode ask / sortInbox / makeCard flows as a Cordis service.

Mounted from `apps/desktop/cordis.yml`.

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/skills` | `./src/index.ts` → `./lib/index.js` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- `@deepseek-ai/cordis`
- `@deepseek-ai/dsh-credentials`
- `@deepseek-ai/dsh-llm`
- `@deepseek-ai/schemastery`
- `@kvd/proposals`
- `@kvd/shared`
- `@kvd/skills-core`

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/skills test   # node:test, files under test/
```

## WeChat OA (W1 + W2 + W3)

Default-mode sort/card refuse notes under the 公众号 pipeline (`@kvd/shared/wechat-oa`). Advanced persona cites vault-relative OA paths only — no dual-write to `/workspace/content-team`.

**W2 writing commands** (Cordis `kvdSkills`):

| Method | Input | Output |
| --- | --- | --- |
| `wechatDraft` | Brief under `briefs/` | proposal → `drafts/`（无 `【待补】`） |
| `wechatTitles` | draft under `drafts/` | proposal → `review/*-titles.md` |
| `wechatLayout` | draft under `drafts/` | **local tool** writes `90-附件/公众号/layout/{slug}/index.html`（不经 Apply） |
| `wechatCopyHtml` | draft or layout path | pasteable HTML payload（桌面端写入系统剪贴板；无微信登录） |
| `wechatPublish` | draft under `drafts/` | **proposal → Apply**：frontmatter 标记已发布 + move 到 `05-归档/公众号/` |
| `wechatPreview` | draft or layout path | 本地打开 layout HTML 预览 |

Retargeted skill prompts live under `skills/wechat/` (article / titles / layout / pipeline).
No WeChat login, no auto-publish / mass-send, no dual-write to content-team.

