## TFS 工作区规则

本工作区使用 TFS 版本控制，源码文件默认只读。**编辑前必须先 `tfs-cli edit`**，否则写入会失败。

### 编辑流程

1. `tfs-cli edit <path>` — 自动签出 + 冲突检测
2. 解析 JSON 输出：
   - `ok: true` → 可以编辑
   - `ok: false, error.code = "CONFLICT"` → **停止**，报告 `details.owner`
3. 编辑后用 `tfs-cli diff <path>` 查看变更

### 常用命令

| 命令 | 用途 |
|------|------|
| `edit <path>` | 编辑前自动签出 + 冲突检测（**必用**） |
| `checkout <path>` | 签出文件（edit 的底层命令，除非 edit 失败否则不用） |
| `diff [path]` | 差异对比 |
| `status [path]` | 待定更改 |
| `getlatest [path]` | 获取最新版本 |

### 不要做的事

- **不要直接调 `tf.exe`** — 凭证和错误码已封装在 tfs-cli
- **不要自动签入（checkin）** — 签入必须由用户确认
- **不要用 `Write` 工具覆盖未签出的文件** — 先 `tfs-cli edit`
- 所有命令输出 JSON，解析 `ok`/`error.code` 字段即可
