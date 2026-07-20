# forge-tfs

把 **TFS 版本控制技能**（`tf.exe` 封装 + 凭证管理 + 文档）注入到 AI Agent 工具目录的 CLI 脚手架，让 OpenCode、Trae、Claude 等工具具备 TFS 工作区自动签出能力。

## 快速开始

```bash
# 安装
npm install -g

# 查看支持的 Agent 工具
forge list-agents

# 首次配置（注入所有 Agent + 写入凭证）
forge init -d <目标项目> -a all --url http://tfs:8080/tfs/ASS -u alice -p secret

# 已有项目追加注入
forge init -d <目标项目> -a opencode,trae

# 仅注入技能（不碰规则和根文档）
forge init -d <目标项目> --skill-only
```

## 注入矩阵

| Agent | 根文档 | 技能目录 | rules 目录 |
|-------|--------|---------|-----------|
| opencode | AGENTS.md | .opencode/skills/tfs-tf-commands | — |
| kilo | AGENTS.md | .kilo/skills/tfs-tf-commands | — |
| qoder | AGENTS.md | .qoder/skills/tfs-tf-commands | — |
| claude | CLAUDE.md | .claude/skills/tfs-tf-commands | — |
| trae | — | .trae/skills/tfs-tf-commands | .trae/rules |
| codebuddy | — | .codebuddy/skills/tfs-tf-commands | .codebuddy/rules |

## 命令行参数

| 参数 | 说明 |
|------|------|
| `-d, --dir <path>` | 目标项目目录（默认当前目录） |
| `-a, --agents <list>` | 目标 Agent（`all` 或逗号分隔，如 `opencode,trae`） |
| `--url <server-url>` | TFS 服务器 URL（如 `http://tfs:8080/tfs/ASS`），传入即覆盖配置 |
| `-u, --username <name>` | TFS 用户名，传入即覆盖配置 |
| `-p, --password <pwd>` | TFS 密码，写入系统凭证库，不落盘 |
| `-f, --force` | 覆盖已存在的文件 |
| `--skill-only` | 仅注入技能目录 |
| `--rules-only` | 仅注入 rules 目录（仅 trae/codebuddy 生效） |
| `--agents-md-only` | 仅注入根文档 |

### 凭证安全

**密码永不落盘**。`-p` 传入的密码通过 `cred_helper.py` 写入 Windows 凭据管理器，`tfs-config.json` 只存占位符引用：

```json
"password_ref": "system-keyring:tfs-tf-commands:<username>"
```

为避免密码泄露进 shell 历史，推荐用环境变量：

```bash
set TFS_PASSWORD=secret
forge init -d . -u alice --url http://tfs:8080/tfs/ASS
```

优先级：**命令行参数 > 环境变量**。

## 注入产物

每个 Agent 注入后得到：

```
<目标项目>/
├── AGENTS.md                   # opencode/kilo/qoder（根文档，含签出规则）
├── CLAUDE.md                   # claude 专用
├── .trae/rules/                # 仅 trae/codebuddy
│   └── tfs-command.md
└── .<agent>/skills/tfs-tf-commands/
    ├── SKILL.md
    ├── scripts/
    │   ├── tf_helper.sh        # 签出/历史/状态封装
    │   ├── cred_helper.py      # 凭证库读写（Windows）
    │   └── tf_*.py             # tf.exe 调用封装
    ├── references/
    │   ├── checkout-ref.md
    │   ├── history-ref.md
    │   └── status-ref.md
    └── assets/
        └── tfs-config.json     # 从 example 复制，已脱敏（server=""）
```

## 开发

```bash
# 跑测试
npm test

# 添加新 Agent 支持
# 编辑 src/inject/registry.js 的 AGENTS 表，加一行即可
```

## License

MIT
