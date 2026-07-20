<!-- tfs-cli:rules:start -->

## TFS 工作区（自动规则，AI 必读）

本工作区是 TFS（Team Foundation Server）版本控制工作区。**任何对源码文件的写入操作都必须先通过 tfs-cli 签出**，否则 TFS 标记为只读，写入会失败。

### 编辑前流程（强制）

1. **调用 `tfs-cli edit <path>`**（不是 `checkout`！）—— 这个命令会自动判断文件是否已被签出，并检测冲突。
2. 检查返回的 `ok` 字段：
   - `ok: true, data.alreadyCheckedOut` 或 `justCheckedOut` → 可以编辑
   - `ok: false, error.code = "CONFLICT"` → **停止编辑**，向用户报告 `details.owner` 字段（签出者用户名）
3. 编辑完调用 `tfs-cli diff <path>` 查看效果，等用户确认后再签入

### 调用约定

- 所有 tfs-cli 命令的 stdout 都是 JSON 对象；解析 `ok` / `error.code` 而非文本
- 子命令列表：`init` / `config` / `checkout` / `undo` / `edit` / `add` / `getlatest` / `status` / `diff` / `history` / `test` / `inject`
- 配置通过 `tfs-cli init` 全局设置（`~/.config/tfs-cli/config.json` + Windows 凭证库）
- 路径：自动接受 `C:\foo\bar.cs` 或 Git Bash 风格 `/c/foo/bar.cs`

### 不要做的事

- **不要直接调 `tf.exe`** —— 凭证注入和错误码都在 tfs-cli 里做了封装
- **不要自动签入（checkin）** —— 签入必须由用户人工确认
- **不要用 `Write` 工具覆盖未签出的 TFS 文件** —— 先 `tfs-cli edit`

<!-- tfs-cli:rules:end -->
