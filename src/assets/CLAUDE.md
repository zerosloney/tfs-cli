# CLAUDE.md — forge 项目规则


<!-- forge:tfs-rules -->
本工作区为 TFS 工作区。修改任何源码文件前，**必须**先签出文件。

### 技能配置

TFS 连接配置（服务器地址、用户名）在技能的 `assets/tfs-config.json` 中：
```
skill://tfs-tf-commands/assets/tfs-config.json
```
密码通过系统凭证库管理（Windows 凭据管理器），不存储在配置文件中。

### 签出文件

技能脚本位于 `skill://tfs-tf-commands/scripts/`，通过 `bash` 调用：

```bash
# 签出单个文件（推荐方式）
bash "skill://tfs-tf-commands/scripts/tf_helper.sh" checkout "MES/02.Pipe/xxx.cs"
```

> **注意：** Windows 上 `.sh` 脚本不能直接启动，必须通过 `bash` 解释器运行。

退出码检查：
- 0 → 签出成功，继续编辑
- 1 → 文件被他人签出，停止并报告签出者信息（也可用 `tf status` 查看）
- 2 → tf.exe 不可用，手动签出后再继续

### 查看历史 / 状态

```bash
bash "skill://tfs-tf-commands/scripts/tf_helper.sh" history <路径>    # 最后编辑者
bash "skill://tfs-tf-commands/scripts/tf_helper.sh" status           # 待定更改
```

### 提交规则

**禁止自动签入（Check-in）**。所有签入操作必须由用户显式确认后方可执行。
<!-- forge:tfs-rules -->
