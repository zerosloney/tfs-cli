# tf 命令参考

两套脚本功能完全一致，按终端环境选用：

- **PowerShell**：`scripts/tf_helper.ps1 -Action <操作> -Path <路径>`
- **Git Bash**：`scripts/tf_helper.sh <操作> [路径]`

Git Bash 脚本会自动将 `/c/path` 风格的路径转换为 `C:\path` 格式传给 tf.exe，同时也接受 Windows 原生路径。

`{SKILLS_DIR}` 表示技能安装根目录，文档中的绝对路径示例均使用该占位符。

## 1. 签出文件

PowerShell：
```powershell
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action checkout -Path "C:\path\to\file.cs"
```

Git Bash：
```bash
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh checkout /c/path/to/file.cs
```

对应 tf 原始命令：
```
tf checkout "C:\path\to\file.cs" /server:http://<tfs-server>/tfs/<collection> /login:用户名,密码 /noprompt
```

## 2. 撤销签出

PowerShell：
```powershell
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action undo -Path "C:\path\to\file.cs"
```

Git Bash：
```bash
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh undo /c/path/to/file.cs
```

对应 tf 原始命令：
```
tf undo "C:\path\to\file.cs" /server:http://<tfs-server>/tfs/<collection> /login:用户名,密码 /noprompt
```

## 3. 签出目录（递归）

PowerShell：
```powershell
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action checkout-dir -Path "C:\path\to\directory"
```

Git Bash：
```bash
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh checkout-dir /c/path/to/directory
```

对应 tf 原始命令：
```
tf checkout "C:\path\to\directory" /recursive /server:http://<tfs-server>/tfs/<collection> /login:用户名,密码 /noprompt
```

## 4. 新增文件到源代码管理

`add` 会把本地新文件或目录加入 TFS 待定更改，后续仍需人工审查并签入。

PowerShell：
```powershell
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action add -Path "C:\path\to\new-file.cs"
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action add -Path "C:\path\to\new-directory"
```

Git Bash：
```bash
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh add /c/path/to/new-file.cs
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh add /c/path/to/new-directory
```

对应 tf 原始命令：
```
tf add "C:\path\to\new-file.cs" /recursive /login:用户名,密码 /noprompt
```

说明：
- 路径必须位于已映射的 TFS 工作区内
- 对目录使用递归新增，目录下文件会一起进入待定更改
- `add` 只产生待定更改，不会自动签入

## 5. 获取最新版本

PowerShell：
```powershell
# 获取指定路径的最新版本
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action getlatest -Path "C:\path\to\project"

# 获取当前目录最新版本
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action getlatest
```

Git Bash：
```bash
# 获取指定路径的最新版本
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh getlatest /c/path/to/project

# 获取当前目录最新版本
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh getlatest
```

对应 tf 原始命令：
```
tf get "C:\path\to\project" /recursive /server:http://<tfs-server>/tfs/<collection> /login:用户名,密码 /noprompt
```

## 6. 查看历史记录

PowerShell：
```powershell
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action history -Path "C:\path\to\file.cs"
```

Git Bash：
```bash
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh history /c/path/to/file.cs
```

对应 tf 原始命令：
```
tf history "C:\path\to\file.cs" /server:http://<tfs-server>/tfs/<collection> /login:用户名,密码 /noprompt /format:detailed
```

### history 高级选项

`history` 支持以下增强选项（PowerShell 和 Git Bash 对等，仅参数风格不同：PS 用 `-FlagName`，Bash 用 `--flag-name`）：

| 选项 | PS 参数 | Bash 参数 | 说明 |
|------|---------|-----------|------|
| 仅今天 | `-Today` | `--today` | 当天历史 |
| 从某日起 | `-Since 2026-07-01` | `--since 2026-07-01` | 指定日期到现在 |
| 版本范围 | `-Range D2026-07-01~D2026-07-07` | `--range D2026-07-01~D2026-07-07` | 自定义版本范围 |
| 递归 | `-Recursive` | `--recursive, -r` | 递归子目录 |
| 按用户 | `-User 戴晨` | `--user 戴晨` | 按用户筛选 |
| 仅自己 | `-Mine` | `--mine` | 当前用户 |
| 限量 | `-Limit 20` | `--limit 20` | 最多返回 N 条 |

默认返回最近 10 条。当指定 `-Today`/`-Since`/`-Range` 时，不限制数量（返回全部匹配）。

PowerShell 组合示例：
```powershell
# 我今天签入了哪些文件
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action history -Path . -Mine -Today -Recursive

# 某用户最近 20 条变更
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action history -Path . -User 戴晨 -Limit 20

# 指定日期范围
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action history -Path . -Range D2026-07-01~D2026-07-07 -Recursive
```

Git Bash 组合示例：
```bash
# 我今天签入了哪些文件
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh history . --mine --today --recursive

# 某用户最近 20 条变更
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh history . --user 戴晨 --limit 20

# 指定日期范围
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh history . --range D2026-07-01~D2026-07-07 --recursive
```

### history 缓存

`history` 默认启用 **5 分钟 TTL 缓存**（同一文件 5 分钟内重复查询直接返回缓存，减少 TFS 往返）。
当使用了 `--today`/`--since`/`--range`/`--user`/`--recursive` 等筛选参数时，自动跳过缓存（每次查询 TFS 最新结果）。

| 需求 | 环境变量 | 说明 |
|------|---------|------|
| 强制刷新（跳过缓存） | `TFS_HISTORY_REFRESH=1` | 重新查 TFS 并更新缓存 |
| 完全禁用缓存 | `TFS_NO_CACHE=1` | 不读不写缓存 |
| 自定义 TTL（秒） | `TFS_HISTORY_TTL=600` | 默认 300 秒 |

示例：
```bash
# Git Bash 强制刷新
TFS_HISTORY_REFRESH=1 {SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh history /c/path/file.cs
```
```powershell
# PowerShell 强制刷新
$env:TFS_HISTORY_REFRESH='1'; & "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action history -Path "C:\path\file.cs"
```

缓存文件：`用户目录/tfs_tf_cache.json`。手动清理：
```bash
python scripts/cache_helper.py clear              # 清空全部
python scripts/cache_helper.py clear "<文件路径>"  # 清除单条
python scripts/cache_helper.py path               # 查看缓存文件位置
```

说明：缓存按规范化的文件路径建 key（绝对路径 + 小写 + 正斜杠），PS 和 Bash 共享同一缓存文件。tf.exe 非零退出时**不写**缓存。

## 7. 查看待定更改

PowerShell：
```powershell
# 查看指定路径的待定更改
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action status -Path "C:\path\to\project"

# 查看当前目录的待定更改
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action status
```

Git Bash：
```bash
# 查看指定路径的待定更改
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh status /c/path/to/project

# 查看当前目录的待定更改
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh status
```

对应 tf 原始命令：
```
tf status "C:\path\to\project" /recursive /server:http://<tfs-server>/tfs/<collection> /login:用户名,密码 /noprompt
```

## 8. 查看差异

diff 显示工作区文件 vs TFS 最新版本的差异（unified diff 格式）。**AI 编辑文件后必须用 diff 看改动**，便于人审/AI 复核再决定签入。

**不缓存**（diff 输出可能很大，且必须反映当前最新状态；缓存容易过期误导）。

PowerShell：
```powershell
# 查看指定文件/目录的差异
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action diff -Path "C:\path\to\file.cs"

# 查看当前目录所有差异（递归）
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action diff
```

Git Bash：
```bash
# 查看指定文件/目录的差异
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh diff /c/path/to/file.cs

# 查看当前目录所有差异（递归）
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh diff
```

对应 tf 原始命令：
```
tf diff "C:\path\to\file.cs" /recursive /login:用户名,密码 /noprompt /format:unified
```

说明：
- 默认 `format:unified` 输出标准 unified diff（便于 AI/工具解析，含 `@@ ... @@` hunk 头）
- 不传路径默认当前目录（递归）
- 工作区下无需 `/server:`（避免警告）
- 退出码：0 = 有差异 / 无差异都算正常；非 0 = 路径不在工作区、凭证失效等

典型用法：AI 改完文件后调用 diff 看效果——

```bash
# 1. 签出
./scripts/tfs-edit.sh /c/Projects/MyApp/Program.cs
# 2. 编辑（Edit/Write 工具）
# 3. 看改动
./scripts/tf_helper.sh diff /c/Projects/MyApp/Program.cs
# 4. 用户审过后手工签入
```

## 9. 测试连接

PowerShell：
```powershell
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action test
```

Git Bash：
```bash
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh test
```

对应 tf 原始命令：
```
tf workspaces /collection:http://<tfs-server>/tfs/<collection> /login:用户名,密码 /noprompt
```

说明：`test` 用 `tf workspaces` 验证认证 + 集合连通，不依赖本地工作区映射。退出码 0 = 通过。

## 10. 直接调用 tf.exe

部分场景（如自定义版本范围、组合多个参数）可能需要直接调用 `tf.exe`。`cred_helper.py` 可从系统凭证库获取密码：

```bash
# 获取密码（返回字符串，不含换行）
python scripts/cred_helper.py get <用户名>

# 直接调用 tf.exe
tf.exe history "C:\path\to\project" /recursive /version:D2026-07-01~D2026-07-07 /user:<用户名> /login:<用户名>,密码 /noprompt /format:detailed
```

**说明：**
- 密码从凭证库读取后作为 `/login:用户名,密码` 参数直接传入 tf.exe
- 工作区命令（`checkout`/`undo`/`add`/`status`/`diff`）省略 `/server:`（本地工作区不需要）
- 非工作区命令（`history`/`workspaces`）需要 `/server:` 或 `/collection:`
- 禁用 MSYS 路径转换：`export MSYS_NO_PATHCONV=1`（防止 `/server:` → `C:/...` 转换）
