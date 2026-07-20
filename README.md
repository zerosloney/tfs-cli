# tfs-cli

TFS (`tf.exe`) 命令行包装工具，为 **AI Agent + 人类** 协作场景设计。

```bash
# 安装
npm install -g @master0071/tfs-cli

# 初始化
tfs-cli init -U http://tfs:8080/tfs/ASS -u alice
TFS_PASSWORD=secret tfs-cli init -U http://tfs:8080/tfs/ASS -u alice   # 非交互

# 编辑前自动签出 + 冲突检测
tfs-cli edit src/Program.cs   # exit 0 → 可编辑；exit 2 → 被他人签出

# 注入 AI Agent 规则
tfs-cli inject                  # 自动检测 agent
tfs-cli inject --trae --claude  # 指定 agent
```

## 命令

| 命令 | 用途 |
|------|------|
| `init` | 初始化配置 + 凭证库 |
| `config show\|set\|reset` | 配置管理 |
| `checkout <path>` | 签出文件 |
| `undo <path>` | 撤销签出 |
| `edit <path>` | 编辑前自动签出 + 冲突检测 |
| `add <path>` | 加入源代码管理 |
| `getlatest [path]` | 获取最新版本 |
| `status [path]` | 待定更改 |
| `diff [path]` | 差异对比 |
| `history [path]` | 历史记录（缓存 5 分钟） |
| `test` | 测试连接 |
| `inject` | 写入 AI Agent 规则 |

`history` flags：`--today` / `--since <date>` / `--range Dx~Dy` / `--user` / `--mine` / `--limit <N>` / `-r`

## 输出

所有命令默认输出 **compact JSON**（AI 直接 `JSON.parse`），加 `--text` 切换人类可读。

```json
{"ok":true,"action":"checkout","path":"C:\\Projects\\Program.cs","data":{"status":"checked_out"},"error":null,"meta":{"tf_exit":0,"duration_ms":235}}
```

失败时 `error.code` 字段：

| code | 含义 | 退出码 |
|------|------|--------|
| `CONFLICT` | 文件被他人签出（`edit`） | 2 |
| `CONFIG_MISSING` | 需先 `tfs-cli init` | 3 |
| `TF_NOT_FOUND` | tf.exe 未安装 | 4 |
| `AUTH_FAILED` / `PATH_NOT_IN_WORKSPACE` / `CREDENTIAL_MISSING` / `INVALID_ARGS` / `INTERNAL_ERROR` | 通用错误 | 1 |

## 配置与凭证

- **配置**：`~/.config/tfs-cli/config.json`，存 server/username/domain/workspace/collection
- **凭证**：Windows 凭据管理器（`cmdkey` + PowerShell `CredReadW`），密码不落盘
- `config set` 可改 `server`/`domain`/`workspace`/`collection`，**不可改 username**（防凭证引用失效）
- 密码**不能含逗号或分号**（`tf.exe /login` 不支持转义）

## AI Agent 集成

`tfs-cli inject` 把规则写入项目（`--trae` `--claude` `--opencode` `--codebuddy` `--kilo` `--qoder` `--zcode` `--omp` `--qwen` `--gemini` `--cline` `--cursor` 或 `-a all`）：

| 文件 | 适用 |
|------|------|
| `AGENTS.md` | opencode / kilo / qoder / zcode / omp |
| `CLAUDE.md` | claude-code |
| `QWEN.md` | qwen |
| `GEMINI.md` | gemini |
| `.clinerules` | cline |
| `.trae/rules/tfs-command.md` | trae |
| `.codebuddy/rules/tfs-command.md` | codebuddy |
| `.cursor/rules/tfs-command.mdc` | cursor |

注入逻辑：不存在→创建，有 marker→替换，无 marker→追加（`--force` 强制覆盖）。