# Knowledge Vault browser clipper (Chrome + Edge)

Select text on a page → optional annotation → save a Markdown note into the configured vault’s **`01-收件箱/`**.

## Install (unpacked / developer mode)

**Chrome**

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → choose this folder: `apps/clipper/extension`

**Edge**

1. Open `edge://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → `apps/clipper/extension`

Not published to the store in this change.

## One-time vault picker

1. Open the extension **Options** (or the popup’s “选择知识库” link)
2. Click **选择 Vault 根目录** and pick the vault folder that contains `01-收件箱`
3. Grant read/write when prompted

No accounts, no cloud. The directory handle is stored in IndexedDB inside the extension.

## Clip

- Toolbar icon → popup shows current selection → optional annotation → **保存到收件箱**
- Or right-click selection → **Clip to Knowledge Vault 收件箱**

## Transport (AC5)

**File System Access API** + IndexedDB-persisted `FileSystemDirectoryHandle` for the vault root.

| Option | Works with desktop closed? | Tradeoff |
| --- | --- | --- |
| **File System Access API (chosen)** | Yes — writes go straight to disk | Chrome/Edge only; OS may re-prompt permission after browser updates; user must pick vault once |
| Native messaging host | Yes (if host installed) | Extra native binary + registry; heavier install |
| Local HTTP in desktop app | **No** | Simple while app is open; clips queue/fail when closed |
| Drop folder / downloads | Partial | Easy to misconfigure path; weaker “only 01-收件箱” guarantee |

Clips are **not** lost when Knowledge Vault Desktop is closed: the extension never talks to the Electron app.

## Frontmatter contract

```yaml
source_url, page_title, clipped_at (with TZ offset), quote, annotation, tags: [clip]
```

Body: Markdown blockquote of the quote, then the annotation. Filename: `YYYY-MM-DD-{sanitized-title}.md` with `-2`, `-3`, … on collision (never overwrite).

Authoritative format/write tests live in `@kvd/clipper` (`packages/clipper`).
