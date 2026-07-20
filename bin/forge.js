#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const pkg = require('../package.json');
const { initCommand } = require('../src/commands/init');
const { VALID_AGENT_NAMES } = require('../src/inject/registry');

program
  .name('forge-tfs')
  .description('AI Agent 工具脚手架 — 注入 TFS 技能和规则到项目')
  .version(pkg.version);

program
  .command('init')
  .description('向项目注入 TFS 版本控制技能和规则')
  .option('-d, --dir <path>', '目标项目目录', process.cwd())
  .option(
    '-a, --agents <agents>',
    `目标 Agent 工具 (comma-separated: ${VALID_AGENT_NAMES.join(',')} 或 all)`,
    'all'
  )
  .option('-U, --url <server-url>', 'TFS 服务器 URL（如 http://host:8080/tfs/ASS），可选')
  .option('-u, --username <name>', 'TFS 用户名（可选，传入即覆盖 tfs-config.json）')
  .option(
    '-p, --password <pwd>',
    'TFS 密码（可选，写入系统凭证库，不落盘；建议用 TFS_PASSWORD 环境变量避免命令行历史泄露）'
  )
  .option('-f, --force', '覆盖已存在的文件', false)
  .option('--skill-only', '仅注入技能目录')
  .option('--rules-only', '仅注入 rules 目录（仅 trae/codebuddy 生效）')
  .option('--agents-md-only', '仅注入根文档（AGENTS.md / CLAUDE.md）')
  .action(initCommand);

program
  .command('list-agents')
  .description('列出支持的 Agent 工具及其注入路径')
  .action(() => {
    console.log(`
  forge — 支持的 Agent 工具:

  ┌──────────────┬──────────┬──────────────────────────────────┬─────────────┐
  │ Agent        │ 根文档   │ 技能目录                         │ rules 目录  │
  ├──────────────┼──────────┼──────────────────────────────────┼─────────────┤
  │ opencode     │ AGENTS   │ .opencode/skills/tfs-tf-commands │ —           │
  │ kilo         │ AGENTS   │ .kilo/skills/tfs-tf-commands     │ —           │
  │ qoder        │ AGENTS   │ .qoder/skills/tfs-tf-commands    │ —           │
  │ claude       │ CLAUDE   │ .claude/skills/tfs-tf-commands   │ —           │
  │ trae         │ —        │ .trae/skills/tfs-tf-commands     │ .trae/rules │
  │ codebuddy    │ —        │ .codebuddy/skills/tfs-tf-commands│ .codebuddy/rules │
  └──────────────┴──────────┴──────────────────────────────────┴─────────────┘

  凭证：-u/-p/--url 传入即覆盖 tfs-config.json；密码写系统凭证库，不落盘。
    `);
  });

program.parse(process.argv);
