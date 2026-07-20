# 常见问题排查

## tf.exe not found
**现象**：`tf.exe not found. Searched: ...`

**原因**：未安装 Visual Studio Team Explorer 组件，或 tf.exe 不在 PATH。

**解决**：
- 安装 Visual Studio 并勾选 Team Explorer 组件，或
- 单独安装 Team Explorer 2022，或
- 将 tf.exe 所在目录加入系统 PATH

tf.exe 自动探测顺序见 SKILL.md「tf.exe 自动探测」。

## Login failed / 认证失败
**现象**：tf 命令返回登录失败、连接测试（`test` action）退出码非 0。

**排查步骤**：
1. 确认系统凭证库中已保存密码：
   ```bash
   python scripts/cred_helper.py get "<用户名>"
   ```
   若报「未找到 TFS 密码」→ 需先写入：`python scripts/cred_helper.py set "<用户名>"`
2. 检查 `assets/tfs-config.json` 中的 `username` 和 `domain` 是否正确
3. 若密码已变更，按 `references/credential_setup.md`「重置密码」重写
4. 重新运行 `test` 验证

## Path not found / 没有工作文件夹映射
**现象**：`没有 ... 的工作文件夹映射`、`Path not found`。

**原因**：传入的本地路径不在 TFS 工作区映射范围内，或路径不存在。

**解决**：
- 确认路径在 TFS 映射的工作区中（不是任意本地路径）
- 用 `tf workspaces` 查看当前工作区映射
- `status` / `getlatest` 在非映射目录下会报此错，需在映射目录内执行

## 连接测试失败（test action）
**现象**：`[TFS] ❌ 连接测试失败`。

**可能原因**：
- 凭证错误 → 见「Login failed」
- 网络不通 → 确认能访问 `http://<tfs-server>/tfs/<collection>`
- 服务器地址错误 → 检查 `tfs-config.json` 的 `server` 字段

## Access denied
**现象**：tf 命令返回权限不足。

**解决**：确认账号对目标项目/路径有足够权限（可能需要 Project Administrators 或 Contributor 角色）。

## Git Bash 路径转换不生效
**现象**：传入 `/c/path` 格式路径报错。

**解决**：Git Bash 脚本同时接受两种格式，可改用 Windows 原生路径：
```bash
{SKILLS_DIR}/tfs-tf-commands/scripts/tf_helper.sh checkout "C:\Projects\MyApp\Program.cs"
```

## 输出乱码
**现象**：中文输出乱码。

**解决**：
- PowerShell 版脚本内置 UTF-8 编码设置，正常无需处理
- 若仍乱码，确认终端代码页为 65001（UTF-8）：`chcp 65001`
- Git Bash 版原生 UTF-8，无需额外处理

## 退出码说明

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 脚本内部错误（配置缺失、凭证缺失、tf.exe 未找到等） |
| 100 | tf.exe 执行返回的错误码（具体含义见 tf 命令文档，常见为路径/认证问题） |

`test` action 的退出码直接反映认证结果：0 = 通过，非 0 = 失败。
