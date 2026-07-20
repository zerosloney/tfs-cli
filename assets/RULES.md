## TFS 工作区规则

本工作区是 TFS（Team Foundation Server）版本控制工作区。**任何对源码文件的写入操作都必须先通过 `tfs-cli` 签出**，否则 TFS 标记为只读，写入会失败。

### 编辑前流程（强制）

1. **调用 `tfs-cli edit <path>`**（不是 `checkout`！）—— 自动判断文件是否已被签出，并检测冲突。
2. 检查返回的 `ok` 字段：
   - `ok: true, data.alreadyCheckedOut` 或 `justCheckedOut` → 可以编辑
   - `ok: false, error.code = "CONFLICT"` → **停止编辑**，向用户报告 `details.owner`（签出者用户名）
3. 编辑完调用 `tfs-cli diff <path>` 查看效果，等用户确认后再签入

### tfs-cli 子命令

| 命令 | 用途 |
|------|------|
| `tfs-cli init` | 初始化全局配置（URL/用户名/密码） |
| `tfs-cli config show \| set <key> <val> \| reset` | 配置管理 |
| `tfs-cli checkout <path>` | 签出文件 |
| `tfs-cli undo <path>` | 撤销签出 |
| `tfs-cli edit <path>` | **编辑前自动签出 + 冲突检测**（推荐） |
| `tfs-cli add <path>` | 加入源代码管理（递归） |
| `tfs-cli getlatest [path]` | 获取最新 |
| `tfs-cli status [path]` | 待定更改 |
| `tfs-cli diff [path]` | unified diff |
| `tfs-cli history [path] [--today --since --range --user --mine --limit --recursive]` | 历史 |
| `tfs-cli test` | 测试连接 |
| `tfs-cli inject [--target DIR]` | 把本规则写入项目 AGENTS.md / rules/ |

### 调用约定

- 所有命令 stdout 都是 **JSON 对象**——解析 `ok` / `error.code` 而非文本
- 配置通过 `tfs-cli init` 全局设置（`~/.config/tfs-cli/config.json` + Windows 凭证库）
- 路径：接受 `C:\foo\bar.cs` 或 Git Bash 风格 `/c/foo/bar.cs`

### 不要做的事

- **不要直接调 `tf.exe`**——凭证注入和错误码都在 tfs-cli 里做了封装
- **不要自动签入（checkin）**——签入必须由用户人工确认
- **不要用 `Write` 工具覆盖未签出的 TFS 文件**——先 `tfs-cli edit`
