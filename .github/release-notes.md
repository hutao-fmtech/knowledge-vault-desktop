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
