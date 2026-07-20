# tfs-cli

TFS (`tf.exe`) 命令行包装工具，为 **AI Agent + 人类** 协作场景设计。

```bash
# 安装
npm install -g @master0071/tfs-cli

# 初始化配置
tfs-cli init -U http://your-tfs:8080/tfs/YOUR_COLLECTION -u <username>
TFS_PASSWORD=<password> tfs-cli init -U http://your-tfs:8080/tfs/YOUR_COLLECTION -u <username>

# 编辑前自动签出
tfs-cli edit src/Program.cs

# 注入 AI Agent 规则
tfs-cli inject --trae --claude
```

## 命令

| 命令 | 用途 |
|------|------|
| `init` | 初始化配置 |
| `edit <path>` | 自动签出 + 冲突检测 |
| `checkout / undo / add / getlatest / status / diff / history [path]` | 签出/撤销/添加/更新/状态/差异/历史 |
| `test` | 测试连接 |
| `inject` | 注入规则到项目 |
| `config show\|set\|reset` | 配置管理 |

输出：默认 **compact JSON**，加 `--text` 切换人类可读。

## 配置

- 文件：`~/.config/tfs-cli/config.json`（server/username/domain/workspace/collection）
- 凭证：Windows 凭据管理器，密码不落盘
- `config set` 可改 `server`/`domain`/`workspace`/`collection`，**不可改 username**
- 密码**不能含逗号或分号**（`tf.exe /login` 不支持转义）

## AI Agent 注入

```bash
tfs-cli inject --trae --claude --cursor --cline --qwen --gemini # 指定 agent
tfs-cli inject -a all                                            # 全部
tfs-cli inject                                                    # 自动检测
```

| 文件 | 适用 |
|------|------|
| `AGENTS.md` | opencode / kilo / qoder / zcode / omp |
| `CLAUDE.md` / `QWEN.md` / `GEMINI.md` / `.clinerules` | claude / qwen / gemini / cline |
| `.trae/rules/tfs-command.md` / `.codebuddy/rules/tfs-command.md` / `.cursor/rules/tfs-command.mdc` | trae / codebuddy / cursor |