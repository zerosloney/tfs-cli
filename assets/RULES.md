## TFS 工作区规则

本工作区使用 TFS 版本控制，源码文件默认只读。**编辑前必须先 `tfs-cli edit`**，否则写入会失败。

### 编辑流程

1. `tfs-cli edit <path>` — 自动签出 + 冲突检测
2. 解析 JSON 输出：
   - `ok: true` → 可以编辑
   - `ok: false, error.code = "CONFLICT"` → **停止**，报告 `details.owner`
   - `ok: false, error.code = "PATH_NOT_IN_WORKSPACE"` → **新文件**，先 `tfs-cli add <path>` 加入源代码管理，再 `tfs-cli edit <path>`
   - 本地新增文件（磁盘上新建、不在 TFS 工作区） → **无需签出**，直接编辑
3. 编辑后用 `tfs-cli diff <path>` 查看变更

### 常用命令

| 命令 | 用途 |
|------|------|
| `edit <path>` | 编辑前自动签出 + 冲突检测（**必用**） |
| `add <path>` | 新文件加入源代码管理（编辑磁盘上不存在于 TFS 的新文件前必用） |
| `checkout <path>` | 签出文件（edit 的底层命令，除非 edit 失败否则不用） |
| `diff [path]` | 差异对比 |
| `status [path]` | 待定更改 |
| `getlatest [path]` | 获取最新版本 |

### add 新文件时同步签出项目文件

`tfs-cli add <新文件>` 成功后，**必须签出当前项目文件**（`.csproj` / `.vcxproj` / `.vcxitems`）。

原因：新文件仅纳入源代码管理不够 — 项目文件也需修改以包含新文件引用。项目文件未签出 → 新文件不在项目中 → 编译失败。

流程：
1. `tfs-cli add <新文件>` — 纳入源代码管理（新文件自动签出，可直接编辑，**无需再 `tfs-cli edit`**）
2. 定位所属项目文件（同目录或上级目录）
3. `tfs-cli edit <项目文件>` — 签出项目文件
4. 在项目文件中加新文件引用（如 `<Compile Include="新文件.cs" />`）

### 禁止事项

- **不要直接调 `tf.exe`** — 凭证和错误码已封装在 tfs-cli
- **不要自动签入（checkin）** — 签入必须用户确认
- **不要用 `Write` 覆盖未签出文件** — 先 `tfs-cli edit`
- 所有命令输出 JSON，解析 `ok`/`error.code` 即可
