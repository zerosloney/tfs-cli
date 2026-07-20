'use strict';

const path = require('path');
const { AGENTS, parseAgents } = require('../inject/registry');
const { injectSkill } = require('../inject/inject-skill');
const { injectConfig } = require('../inject/inject-config');
const { injectRules } = require('../inject/inject-rules');
const { injectDoc } = require('../inject/inject-doc');

/**
 * forge init 命令 — 向目标项目注入 TFS 技能和规则
 *
 * 注入顺序（对每个 agent）：
 *   1. 技能目录（除非 --rules-only / --agents-md-only）
 *      → 若传 -u：紧接着覆盖 tfs-config.json + 写凭证库
 *   2. rules 目录（仅 hasRules=true 的 agent，除非 --skill-only / --agents-md-only）
 *   3. 根文档（除非 --skill-only / --rules-only）
 */
function initCommand(options) {
  const targetDir = path.resolve(options.dir || process.cwd());
  let agents;
  try {
    agents = parseAgents(options.agents);
  } catch (e) {
    console.error(`[forge] ❌ ${e.message}`);
    process.exit(1);
  }
  const force = !!options.force;

  const isSkillOnly = !!options.skillOnly;
  const isRulesOnly = !!options.rulesOnly;
  const isAgentsMdOnly = !!options.agentsMdOnly;

  // 互斥校验：最多只能指定一个 *-only
  const onlyFlags = [isSkillOnly, isRulesOnly, isAgentsMdOnly].filter(Boolean).length;
  if (onlyFlags > 1) {
    console.error(
      '[forge] ❌ --skill-only / --rules-only / --agents-md-only 互斥，只能指定其中一个'
    );
    process.exit(1);
  }

  // 命令行凭证参数（可选，环境变量作为回退来源）
  const url = options.url || process.env.TFS_URL || '';
  const username = options.username || process.env.TFS_USERNAME || '';
  const password = options.password || process.env.TFS_PASSWORD || '';

  console.log(`\n  🔧 forge init — 注入 TFS 技能和规则`);
  console.log(`  📂 目标目录: ${targetDir}`);
  console.log(`  🤖 Agent 工具: ${agents.join(', ')}`);
  if (username) {
    console.log(`  🔑 用户名: ${username}`);
    if (url) console.log(`  🌐 服务器: ${url}`);
    if (password) console.log(`  🛡️  密码: 将写入系统凭证库（不落盘）`);
  }
  console.log('');

  // --rules-only 模式下未注入技能目录，-u/-p 无法落地到 tfs-config.json
  if (isRulesOnly && (username || password)) {
    console.warn(
      `[forge] ⚠️  当前为 --rules-only 模式，未注入技能目录，-u/-p 将被忽略；trae/codebuddy 本身也无根文档注入`
    );
  }

  for (const name of agents) {
    const entry = AGENTS[name];
    console.log(`\n── ${name} ──────────────────────`);

    // 1. 技能
    if (!isRulesOnly && !isAgentsMdOnly) {
      injectSkill(targetDir, entry, force);
      // 命令行凭证：传了 username 就强制覆盖（无论 --force）
      if (username) {
        injectConfig(targetDir, entry, { url, username, password });
      }
    }

    // 2. rules（仅 hasRules）
    if (!isSkillOnly && !isAgentsMdOnly) {
      injectRules(targetDir, entry, force);
    }

    // 3. 根文档（仅 hasDoc=true 的 agent）
    if (!isSkillOnly && !isRulesOnly && entry.hasDoc !== false) {
      injectDoc(targetDir, entry, force);
    }
  }

  console.log(`\n  ✅ forge init 完成\n`);
}

module.exports = { initCommand };
