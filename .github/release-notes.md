## Knowledge Vault v0.3.1（预发布 / pre-release）

### 变更
- **W2 公众号写作**（#27）：Brief → 成稿 → 标题 → 排版 HTML，全部落在 vault 路径（`10-卡片盒/公众号/` + `90-附件/公众号/layout/`）；复用已改指 vault 的 writing skills；**不**自动登录/发布微信。
- **W3 发布辅助**（#28）：
  - **一键复制 layout HTML**：从 `90-附件/公众号/layout/` 解析并写入系统剪贴板（可粘贴进公众号后台）。
  - **标记已发布**：经 proposal → Apply 更新 frontmatter（`wechat_status` / `published_at`）并归档到 `05-归档/公众号/`（非静默 fs 移动）。
  - **本地预览**：用系统默认方式打开本地 layout HTML。

### 待真机验证 / 已知限制
- 无微信自动登录 / 自动群发（刻意不做）。
- Mac / Win 真机高级档检查仍待验证；#20（Windows）仍为已知限制。

### English (brief)
- W2 WeChat OA writing (#27): Brief → draft → titles → layout into vault paths; no WeChat auto-login/publish.
- W3 publish-assist (#28): one-click copy layout HTML to clipboard; mark published → archive under `05-归档/公众号` via proposal→Apply; optional local preview.
- Hard no: WeChat credentials / auto mass-send.
- Pending: Mac/Win real-machine advanced checks; #20 remains a known Windows limit.

CI: version 0.3.1; tag/GitHub Release deferred until after merge (涛 / Quill).


## Knowledge Vault v0.3.0（预发布 / pre-release）

### 变更
- **W1 公众号 PARA 子树落库**（#24）：新建 vault 时写入完整公众号目录（voice / 线索 / briefs·drafts·review / layout / 归档 / analytics）。
- **侧栏 Briefs / 成稿**：Agent 侧栏可列出并打开 `10-卡片盒/公众号/` 下 Briefs 与成稿。
- **Path guards**：模型不可直接写入 `00-系统/` 或 `90-附件/`（layout 仍走桌面工具）。
- **Skills 改指 vault 路径**：公众号相关 skills / persona 仅使用 vault 相对路径，不再 dual-write `/workspace/content-team`；默认档 sort/card 拒绝对 OA 流水线笔记动手。

### 待真机验证 / 已知限制
- Mac / Win 真机高级档检查仍待验证（与 v0.2.4 相同）。
- #20（Windows）仍为已知限制。

### English (brief)
- W1 WeChat OA PARA subtree on vault create (#24).
- Sidebar lists/opens Briefs & 成稿 under `10-卡片盒/公众号/`.
- Path guards block model direct-write to `00-系统/` and `90-附件/`.
- Skills use vault-relative OA paths only (no content-team dual-write).
- Pending: Mac/Win real-machine advanced checks; #20 remains a known Windows limit.

CI: version 0.3.0; tag/GitHub Release deferred until after merge (涛).


## Knowledge Vault v0.2.4（预发布 / pre-release）

### 变更
- **修复打包缺依赖**：electron-builder 25 不会把 peerDependencies 打进 app.asar，导致 `dsh-session` 等包声明的 `@deepseek-ai/dsh-scope` 等 22 个包在安装包里静默缺失；v0.2.3 Mac 真机上每条高级任务约 2 秒失败（#22）。
- **apps/desktop 显式精确钉死**所有可达的 `@deepseek-ai/*`（dsh-* 均为 `0.2.0-rc.2`，AC-8 不变）。
- **pack-smoke 加强**：在打包后的 asar 内导入全部可达模块（缺或落到 asar 外即失败），并离线 mock 跑一次高级任务直至审批弹窗，Deny 后不执行。

### 待真机验证
- Mac 上重测高级档检查 2（审批完整命令 + Approve/Deny）与 3（只读沙箱 / 提案→Apply）。
- #20（Windows）仍为已知限制。

### English (brief)
- Fix missing `@deepseek-ai/dsh-scope` (and 21 other peer deps) in the packaged asar (#22).
- Stricter pack-smoke: asar import check + offline advanced task through approval/deny.
- Pending: Mac retest of advanced checks 2 and 3; #20 remains a known Windows limit.

CI: pack-smoke asserts asar packages + advanced approval path; version 0.2.4.


## Knowledge Vault v0.2.3（预发布 / pre-release）

### 变更
- **目录结构对齐 dsh-orb monorepo**：`apps/desktop` + `packages/*`（@kvd/*），插件组合统一由 `apps/desktop/cordis.yml` 声明（#16）。
- **全面切换到 TypeScript**：严格模式，根目录 `tsc -b` 项目引用；测试迁移到 vitest；CI 增加 any-gate（每个 `any` / ts 指令都必须写理由；当前为 0）；Electron 加载并打包编译产物（#17）。
- **Windows 高级档改用 PowerShell 代替 bash**（`dsh-pwsh-sandbox` + `dsh-tool-pwsh`），修复 #18：原先 Windows 上沙箱 bash 返回 `Bash/E_ACCESSDENIED`，无法读取 vault。macOS/Linux 仍用 bash。审批弹窗显示完整命令，只读沙箱、越权（escalation）一律拒绝等安全约束不变（#19）。
- 修复 R1 重构引入、未发布的回归：打包后应用自身窗口的 IPC 被判为远程（v0.2.2 不受影响）。

### 待真机验证（#20）
- 只装了 Windows PowerShell 5.1（没有 pwsh 7）时，中文输出可能乱码。
- PowerShell 审批标签（“PowerShell 命令”）在 Windows 界面上的实际显示。

### English (brief)
- Repo aligned with the dsh-orb monorepo layout (apps/desktop + packages/*, cordis.yml).
- Full switch to TypeScript (tsc -b, vitest, any-gate).
- Windows advanced mode uses PowerShell instead of bash (fixes #18).
- Pending real-machine verification (#20): Chinese output with only Windows PowerShell 5.1; how the PowerShell approval label looks in the UI.

CI: four-platform launch smoke passed (win32-x64, linux-x64, darwin-arm64, darwin-x64 under Rosetta), version 0.2.3.
