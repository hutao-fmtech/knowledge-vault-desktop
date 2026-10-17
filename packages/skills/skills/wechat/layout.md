---
name: 工程公众号排版
description: >-
  use this when turning a Markdown or plain-text WeChat article into WeChat
  Official Account paste-ready HTML with a local preview and copy button
---
# 工程公众号排版

把已定稿文章转成可粘贴进微信公众号编辑器的 HTML，并生成本地预览页。


## Vault 落点（W2）

| 产物 | vault 路径 |
|---|---|
| Brief | `10-卡片盒/公众号/briefs/` |
| 成稿 | `10-卡片盒/公众号/drafts/` |
| 标题 / 审校 | `10-卡片盒/公众号/review/` |
| 排版 HTML | `90-附件/公众号/layout/`（**仅桌面本地工具写入**；模型不得直写 `90-附件/`） |

禁止双写 `/workspace/content-team`。笔记改动走 proposal → Apply。成品**禁止** `【待补】`；缺材料改为公开可核验事实或标明「假设」。


## 约束

- **不改写内容**：只做排版层调整（标题层级、过长分段、列表/表格样式）
- 复制进公众号的片段必须用 **inline style**
- 禁止：外链 CSS、脚本、网页字体、CSS 变量、交互控件（复制目标内）
- 预览区 `max-width: 677px`

## 流程

1. 若用户未贴正文，先要正文与标题。
2. 风格未指定时，工程/教程默认 `OpenAI`（白底、克制、文档感）；观点/复盘可用 `Claude`（暖白、编辑感）。
3. 在工作区生成：

```text
90-附件/公众号/layout/{slug}/
└── index.html

由桌面端本地工具写入；不要通过 vault_propose_change 写入 `90-附件/`。
```

4. `index.html` 含：
   - 顶栏 +「复制到公众号」按钮
   - 复制成功状态提示
   - 居中预览
   - Clipboard API 同时写 `text/html` + `text/plain`；失败则选中节点 `execCommand('copy')`
5. 复制载荷 = **文章内层 HTML**，不含顶栏 chrome。
6. 用本地静态方式打开或起简单 HTTP 服务预览；能截图则确认视觉，否则报告文件路径。

## HTML 块建议

- `h1` 标题，`h2`/`h3` 小节
- `p`、`blockquote`、`pre`/`code`（代码用等宽、浅灰底）
- 对比用简单 `table`
- 圆角 ≤ 8px

## 完成后告诉用户

1. 预览文件路径
2. 如何点「复制到公众号」再粘贴到后台
3. 提醒：图片需另行上传；封面用 2.35:1，且分享时只保中央约 1:1 安全区
