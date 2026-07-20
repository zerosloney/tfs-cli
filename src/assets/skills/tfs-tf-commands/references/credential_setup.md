# 凭证配置完整流程

`{SKILLS_DIR}` 表示技能安装根目录，文档中的绝对路径示例均使用该占位符。

## 配置文件

`assets/tfs-config.json`：

```json
{
  "server": "http://<tfs-server>/tfs/<collection>",
  "username": "你的TFS用户名",
  "password_ref": "",
  "domain": "",
  "workspace": "",
  "collection": "ASS"
}
```

字段说明：
- `server`：TFS 服务器完整 URL（已预填）
- `username`：TFS 登录用户名（必填，明文存在配置文件）
- `password_ref`：密码引用，格式 `system-keyring:tfs-tf-commands:<用户名>`。**密码本身不写入此文件**，由首次配置流程自动填充
- `domain`：如果使用域账号，填域名；否则留空
- `workspace`：TFS 工作区名（可选，tf 命令通常自动识别）
- `collection`：TFS 项目集合名（已预填为 ASS）

⚠️ **不要在配置文件里手填明文密码**。密码统一保存到系统凭证库（Windows 凭据管理器）。

## 首次配置（保存密码到凭证库）

填好 `username` 后，密码通过凭证库助手写入（二选一）：

### Git Bash
```bash
python {SKILLS_DIR}/tfs-tf-commands/scripts/cred_helper.py set "<用户名>"
# 然后在 stdin 输入密码并回车（密码不会回显到命令历史）
```

### PowerShell（无需 python，原生实现）
```powershell
$pw = Read-Host -AsSecureString "请输入 TFS 密码"
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
$plain | python "{SKILLS_DIR}\tfs-tf-commands\scripts\cred_helper.py" set "<用户名>"
```

写入后密码存储在 Windows 凭据管理器，target = `tfs-tf-commands:<用户名>`。脚本运行时自动读取。

### 配置后立即测试连接（推荐）

首次配置完成后，跑一次连接测试验证认证是否通过：
```bash
# Git Bash
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh test
```
```powershell
# PowerShell
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action test
```
退出码 0 = 通过；非 0 = 凭证/网络有问题，按下方「重置密码」重来。

## 兼容旧版明文配置（自动迁移）

如果配置文件中残留旧版明文 `password` 字段，脚本**首次运行时自动迁移**：
1. 把明文密码写入系统凭证库
2. 写入 `password_ref`，删除 `password` 字段
3. 写回配置文件

迁移是一次性的、幂等的，无需用户介入。

## 重置密码

密码变更后需重新写入凭证库（配置文件无需改动）：

### Git Bash
```bash
# 先删旧密码（可选，set 会覆盖）
python {SKILLS_DIR}/tfs-tf-commands/scripts/cred_helper.py delete "<用户名>"
# 写入新密码
python {SKILLS_DIR}/tfs-tf-commands/scripts/cred_helper.py set "<用户名>"
```

### PowerShell
```powershell
$pw = Read-Host -AsSecureString "请输入新 TFS 密码"
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
$plain | python "{SKILLS_DIR}\tfs-tf-commands\scripts\cred_helper.py" set "<用户名>"
```

## 凭证库助手命令清单

`scripts/cred_helper.py` 子命令：

| 子命令 | 用途 |
|--------|------|
| `get <用户名>` | 从系统凭证库读取密码，输出到 stdout |
| `set <用户名>` | 从 stdin 读取密码并写入系统凭证库 |
| `delete <用户名>` | 删除系统凭证库中的密码 |
| `migrate <配置文件路径>` | 把配置中的明文 password 迁移到凭证库，删除明文 |

底层实现：Windows 用 `cmdkey`（写）+ `CredReadW`（读，ctypes/Add-Type）；其他平台退回 `keyring` 包。Service 名独立为 `tfs-tf-commands`，不与其它技能的凭证耦合。
