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

## WeChat OA (W1 + W2)

Default-mode sort/card refuse notes under the 公众号 pipeline (`@kvd/shared/wechat-oa`). Advanced persona cites vault-relative OA paths only — no dual-write to `/workspace/content-team`.

**W2 writing commands** (Cordis `kvdSkills`):

| Method | Input | Output |
| --- | --- | --- |
| `wechatDraft` | Brief under `briefs/` | proposal → `drafts/`（无 `【待补】`） |
| `wechatTitles` | draft under `drafts/` | proposal → `review/*-titles.md` |
| `wechatLayout` | draft under `drafts/` | **local tool** writes `90-附件/公众号/layout/{slug}/index.html`（不经 Apply） |

Retargeted skill prompts live under `skills/wechat/` (article / titles / layout / pipeline).

