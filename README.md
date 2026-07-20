# tfs-cli

TFS (`tf.exe`) 命令行包装工具，专门为 **AI Agent + 人类** 协作场景设计：

- **结构化 JSON 输出**（默认）：AI 直接 `JSON.parse` 取字段
- **自动签出 + 冲突检测**：`tfs-cli edit <path>` 一条命令搞定编辑前握手
- **全局配置 + 凭证库管理**：密码入 Windows 凭据管理器，不落盘
- **跨平台路径归一**：接受 `C:\foo\bar.cs` 或 Git Bash 风格 `/c/foo/bar.cs`

> 替代旧版 `forge-tfs`（v1.0.2 已弃用）。新代码全部用这套。

## 安装

```bash
# 全局安装
npm install -g @master0071/tfs-cli

# 或源码直跑
git clone <repo> && cd tfs-cli && npm install
node bin/tfs-cli.js --help
```

> Windows only：`tf.exe` 仅在 Windows 平台存在。

## 快速开始

```bash
# 1. 初始化全局配置（写入 ~/.config/tfs-cli/config.json + 凭证库）
tfs-cli init -U http://tfs:8080/tfs/ASS -u alice
# 之后会提示输入密码（注意：输入可见，请避免在公共环境使用）

# 或全非交互（适合自动化）
TFS_PASSWORD=secret tfs-cli init -U http://tfs:8080/tfs/ASS -u alice

# 2. 测试连接（init 后必跑）
tfs-cli test

# 3. 注入 AI Agent 规则（写到项目 AGENTS.md / .trae/rules/...）
cd /path/to/your/project
tfs-cli inject

# 4. AI 编辑文件前必须先 edit
tfs-cli edit src/Program.cs
# exit 0 → 可以编辑；exit 2 → 被他人签出，停止编辑
```

## 命令清单

| 命令 | 用途 |
|------|------|
| `tfs-cli init [-U URL] [-u USER] [-p PWD]` | 初始化配置 + 凭证库 |
| `tfs-cli config show \| set <key> <val> \| reset` | 配置管理 |
| `tfs-cli checkout <path>` | 签出文件 |
| `tfs-cli undo <path>` | 撤销签出 |
| `tfs-cli edit <path>` | **编辑前自动签出 + 冲突检测** |
| `tfs-cli add <path>` | 加入源代码管理（递归） |
| `tfs-cli getlatest [path]` | 获取最新版本 |
| `tfs-cli status [path]` | 待定更改 |
| `tfs-cli diff [path]` | unified diff（人类/AI 都可直接读） |
| `tfs-cli history [path] [flags]` | 历史记录（带 5 分钟缓存） |
| `tfs-cli test` | 测试连接 |
| `tfs-cli inject [--target DIR]` | 写入 AI Agent 规则到项目 |

`history` flags：`--today` / `--since <YYYY-MM-DD>` / `--range Dxxx~Dxxx` / `--user <name>` / `--mine` / `--limit <N>` / `-r` `--recursive`

## 输出格式

**所有命令 stdout 都是 JSON**——默认 **compact**（省 token），AI 直接 `JSON.parse` 取字段。加 `--pretty` 输出带缩进的 JSON（人类调试用）。

成功响应（compact 默认）：
```json
{"ok":true,"action":"checkout","path":"C:\\Projects\\MyApp\\Program.cs","data":{"status":"checked_out"},"error":null,"meta":{"tf_exit":0,"duration_ms":235}}
```

`--pretty` 输出（人类调试）：
```json
{
  "ok": true,
  "action": "checkout",
  "path": "C:\\Projects\\MyApp\\Program.cs",
  "data": { "status": "checked_out" },
  "error": null,
  "meta": { "tf_exit": 0, "duration_ms": 235 }
}
```

失败响应：
```json
{
  "ok": false,
  "action": "edit",
  "path": "C:\\Projects\\MyApp\\Program.cs",
  "data": null,
  "error": {
    "code": "CONFLICT",
    "message": "文件已被 charlie 签出，无法编辑",
    "details": { "owner": "charlie", "currentUser": "alice" }
  },
  "meta": { "tf_exit": 0, "duration_ms": 187 }
}
```

错误码（解析 `error.code` 字段）：

| code | 含义 |
|------|------|
| `AUTH_FAILED` | 凭证错误 / 服务器不可达 |
| `PATH_NOT_IN_WORKSPACE` | 路径不在 TFS 工作区映射 |
| `CONFLICT` | 文件被他人签出（仅 `edit` 命令 exit 2） |
| `TF_NOT_FOUND` | tf.exe 未安装 |
| `CONFIG_MISSING` | 需要先 `tfs-cli init` |
| `CREDENTIAL_MISSING` | 凭证库里没有该用户密码 |
| `INVALID_ARGS` | 命令行参数缺失或非法 |

加 `--text` flag 切换人类可读模式（管道脚本/手动排查时用）：

```bash
tfs-cli --text status
# → [tfs-cli] ✓ status: . (0 changes)
```

## 退出码

| code | 含义 |
|------|------|
| 0 | 成功 |
| 1 | 通用错误 |
| 2 | 文件被他人签出（仅 `edit`） |
| 3 | 配置缺失 |
| 4 | tf.exe 未找到 |

## 配置文件 & 凭证

- 配置：`~/.config/tfs-cli/config.json`（按 schema_v1）

  ```json
  {
    "version": 1,
    "server": "http://host:8080/tfs/ASS",
    "username": "alice",
    "domain": "",
    "workspace": "",
    "collection": "ASS",
    "password_ref": "system-keyring:tfs-cli:alice"
  }
  ```

- 凭证：Windows 凭据管理器，target = `tfs-cli:<username>`，通过 `cmdkey` 写入/删除，`powershell + CredReadW` 读取（Windows 内置能力，无需额外依赖）。

### Config set 说明

`config set` 可修改 `server` / `domain` / `workspace` / `collection` 四项。
**不允许修改 `username`**——修改 username 会导致凭证引用失效。如需修改 username，请使用 `tfs-cli init` 重新初始化。

### 密码限制

`tf.exe` 的 `/login:user,password` 参数按第一个逗号分割且不支持转义，因此密码**不能包含逗号或分号**——含此类字符的密码会在构造 `TfExecutor` 时被拒绝（`INVALID_ARGS`），避免静默鉴权失败。

## AI Agent 集成

`tfs-cli inject` 会把规则片段写入项目：

| 项目文件 | 适用 |
|---------|------|
| `AGENTS.md` | opencode / kilo / qoder |
| `CLAUDE.md` | claude-code |
| `.trae/rules/tfs-command.md` | trae |
| `.codebuddy/rules/tfs-command.md` | codebuddy |

注入逻辑：
- 文件不存在 → 创建
- 已存在但无 marker → 追加（marker = `<!-- tfs-cli:rules:start/end -->`）
- 已存在 marker → 替换 marker 间内容（强制覆盖加 `--force`）

注入后的 AGENTS.md 规则片段告诉 AI：

> **编辑任何源码文件前必须先 `tfs-cli edit <path>`**。  
> 检查返回的 `ok` 字段；如果是 `false` 且 `error.code == "CONFLICT"`，立即停止编辑并报告签出者。

## 开发

```bash
# 跑测试
npm test

# 设计：依赖 tf.exe 而非重新实现
# 我们的价值在于：把 tf.exe 的输出转化为稳定 JSON + 凭证/路径处理 + 错误码抽象
```

## License

MIT
