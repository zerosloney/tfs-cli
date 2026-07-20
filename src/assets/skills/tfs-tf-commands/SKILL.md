---
name: tfs-tf-commands
description: |
  TFS 版本控制操作技能。通过 tf.exe 命令行工具执行 TFS 源代码管理操作。
  触发场景：签出文件、撤销签出、签出目录、新增文件到源代码管理、获取最新版本、查看历史记录、查看待定更改、查看差异、测试连接。
  触发词：签出、撤销签出、checkout、undo、签出目录、新增文件、加入源代码管理、tf add、add、获取最新、get latest、查看历史、history、查看待定更改、status、查看差异、diff、对比、TFS、tf 命令、源代码管理、测试连接、TFS 连接。
  前置条件：需在 assets/tfs-config.json 中配置 TFS 服务器地址、账号；密码保存到系统凭证库。
---

# TFS tf.exe 版本控制操作

## 执行方式

提供两套脚本，功能完全一致，按终端环境选用：

- **PowerShell**：`scripts/tf_helper.ps1 -Action <操作> -Path <路径>`
- **Git Bash**：`scripts/tf_helper.sh <操作> [路径]`

`{SKILLS_DIR}` 表示技能安装根目录，文档中的绝对路径示例均使用该占位符。

Git Bash 脚本会自动将 `/c/path` 风格的路径转换为 `C:\path` 格式传给 tf.exe，同时也接受 Windows 原生路径。

支持的操作：`checkout` / `undo` / `checkout-dir` / `add` / `getlatest` / `history` / `status` / `diff` / `test`。

各操作的详细命令、参数和对应 tf 原始命令见 `references/tf_commands.md`。

### 自动签出（开发编辑前调用）

编辑 TFS workspace 中的文件前**必须**先调 `scripts/tfs-edit.sh <路径>`，否则文件是只读的，直接写会失败。

```bash
# 自动签出 + 冲突检测（推荐）
./scripts/tfs-edit.sh /c/MyProject/src/Program.cs
```

`tfs-edit.sh` 自动处理：
- 文件未被签出 → 签出，返回 0
- 文件已被本工作区签出 → 不做重复操作，返回 0
- 文件被**别人签出** → 提示签出者信息（精确到 `DOMAIN\user`），返回 1，**停止编辑**并告知用户

冲突检测基于 `tf status` 输出里的 owner 字段（中文 tf.exe 输出"用户:"、英文输出"User:"，双关键字匹配），不依赖错误消息文本，因此**中英文 Windows / TFS 都能可靠工作**。

## 核心工作流

### 阶段 0：配置检查（每次执行前）

1. 读取 `assets/tfs-config.json`
2. 如果文件不存在或 `username` 为空 → **必须提示用户填写**，不得跳过
3. 如果存在旧版明文 `password` 字段 → **自动迁移**到系统凭证库，删除明文，写入 `password_ref`
4. 从系统凭证库读取密码；若凭证库无密码 → 提示用户运行 `cred_helper.py set`，流程结束
5. 凭证就绪 → 进入阶段 1

配置/凭证的完整流程见 `references/credential_setup.md`。

### 阶段 1：执行操作

根据用户意图选择操作并执行。脚本会自动探测 tf.exe、注入凭证、转换路径。

**编辑文件前自动签出**：如果用户要求修改文件，在调用 `Edit` / `Write` 工具之前，先用 `tfs-edit.sh` 签出目标文件：

```bash
./scripts/tfs-edit.sh /c/项目路径/文件.cs
```

- 退出码 0 → 继续编辑
- 退出码 1 → 文件被他人签出，**立即停止**，向用户报告签出者信息，等待用户处理
- 退出码 2 → 脚本出错，检查 tf_helper.sh 是否存在或 tf.exe 是否可用

**改完用 diff 看效果**：AI 编辑文件后调 `tf_helper.sh diff <路径>` 看工作区 vs TFS 最新版本的差异（unified diff 格式），便于人审/AI 复核改动再决定签入。

### 连接测试（test）

用于验证认证是否通过，不依赖本地工作区映射。**首次配置后必跑一次**：

```bash
# Git Bash
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh test
```
```powershell
# PowerShell
& "{SKILLS_DIR}\tfs-tf-commands\scripts\tf_helper.ps1" -Action test
```

退出码 0 = 通过（认证成功，集合可达）；非 0 = 失败（见 `references/troubleshooting.md`）。

## tf.exe 自动探测

两个脚本都内置自动探测逻辑，按以下顺序查找 tf.exe：

1. Visual Studio 2022 Team Explorer
2. Visual Studio 2019 Team Explorer
3. Visual Studio 2017 Team Explorer
4. 系统 PATH 中的 tf.exe
5. 独立安装的 Team Explorer 2022

如果探测失败，提示用户安装 Visual Studio Team Explorer 组件或将 tf.exe 加入 PATH。

## 意图路由（自然语言 → 操作）

| 用户表达 | 操作 |
|----------|------|
| "签出/checkout 这个文件"、"我要改这个文件" | `checkout` |
| "撤销签出/undo"、"这个文件改错了不要了" | `undo` |
| "签出整个目录"、"checkout 目录" | `checkout-dir` |
| "新增文件/add"、"加入源代码管理"、"把这个目录加到 TFS" | `add` |
| "获取最新/get latest"、"拉取最新" | `getlatest` |
| "查看历史/history"、"这个文件的修改记录" | `history` |
| "待定更改/状态"、"我改了哪些文件" | `status` |
| "查看差异/diff"、"这个文件改了什么"、"对比下我改的" | `diff` |
| "测试连接"、"验证 TFS 凭证"、"TFS 连得上吗" | `test` |
| 用户要求修改/编辑文件的场景（开发、改 Bug 等） | **先** `tfs-edit.sh` **再**编辑

## 执行注意事项

1. **编码处理**：PowerShell 脚本内置 UTF-8 编码设置；Git Bash 脚本原生 UTF-8，无需额外处理
2. **凭证安全**：密码**不**存入配置文件，而是保存到系统凭证库（Windows 凭据管理器 / `cmdkey`，target=`tfs-tf-commands:<用户名>`）。脚本运行时从凭证库读取并注入 `/login` 参数，不出现在命令行历史中。旧版明文 `password` 会被自动迁移
3. **路径格式**：PowerShell 版使用 Windows 绝对路径（如 `C:\Projects\MyApp\Program.cs`）；Git Bash 版同时接受 `/c/Projects/MyApp/Program.cs` 和 `C:\Projects\MyApp\Program.cs`，内部自动转换
4. **错误处理**：两个脚本都检查退出码，非零退出码会提示
5. **noprompt 模式**：所有命令默认使用 `/noprompt`，避免弹出 GUI 窗口阻塞执行
6. **脚本选择**：PowerShell 终端用 `tf_helper.ps1`，Git Bash 终端用 `tf_helper.sh`，功能完全一致
7. **history 缓存**：`history` 默认启用 5 分钟 TTL 缓存（减少重复查同一文件的 TFS 往返），`status` / `diff` 不缓存（必须反映当前最新状态）。强制刷新用 `TFS_HISTORY_REFRESH=1`，完全禁用用 `TFS_NO_CACHE=1`，自定义 TTL 用 `TFS_HISTORY_TTL=<秒>`。详见 `references/tf_commands.md`「history 缓存」

## 使用流程

1. 检查 `assets/tfs-config.json` 是否已配置 username（密码在凭证库）
2. 如果未配置 → 提示用户填写（见 `references/credential_setup.md`）
3. 首次配置后 → 跑一次 `test` 验证连接
4. 根据终端环境选择 `tf_helper.ps1` 或 `tf_helper.sh` 执行
5. 检查输出，如有错误按 `references/troubleshooting.md` 分析原因并反馈

## 配置文件结构

`assets/tfs-config.json`：

```json
{
  "server": "http://<tfs-server>/tfs/<collection>",
  "username": "<用户输入>",
  "password_ref": "system-keyring:tfs-tf-commands:<用户名>",
  "domain": "",
  "workspace": "",
  "collection": "ASS"
}
```

**说明**：`password_ref` 是凭证库引用，密码本身存在 Windows 凭据管理器（target=`tfs-tf-commands:<用户名>`），不在配置文件中。

## 运行时文件

`用户目录` 指当前系统登录用户的 home 目录（如 Windows 的 `%USERPROFILE%`）。

| 文件 | 用途 |
|------|------|
| `用户目录/.tfs_tf_cache.json` | history 输出缓存（按文件路径分组，TTL 默认 300 秒） |

## 文件清单

| 文件 | 用途 |
|------|------|
| `scripts/tf_helper.ps1` | PowerShell 版 tf 命令封装（含凭证读取、自动迁移、tf.exe 探测、history 缓存） |
| `scripts/tf_helper.sh` | Git Bash 版 tf 命令封装（功能同上） |
| `scripts/tfs-edit.sh` | 编辑文件前自动签出 + 冲突检测（别人签出时报告签出者） |
| `scripts/cred_helper.py` | 凭证库助手：`get/set/delete/migrate`，密码存系统凭证库 |
| `scripts/cache_helper.py` | history 输出缓存助手：`get/set/clear/path`，TTL 默认 300 秒 |
| `references/tf_commands.md` | 9 个操作的详细命令、参数、tf 原始命令对照 |
| `references/credential_setup.md` | 凭证配置/迁移/重置完整流程 |
| `references/troubleshooting.md` | 常见问题排查、退出码说明 |
| `assets/tfs-config.json` | TFS 连接配置（server/username/domain，不含密码） |
