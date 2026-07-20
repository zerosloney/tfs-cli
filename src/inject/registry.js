'use strict';

/**
 * Agent 工具元数据表 —— 单一真源
 *
 * 每个条目描述一种 AI Agent 工具的目录约定：
 * - skillDir: 技能目录的相对路径（相对目标项目根），技能包整体复制到这里
 * - docFile:   根文档文件名（目标项目根目录下）
 * - docSource: assets 中对应的源文档文件名
 * - hasRules:  是否使用独立的 rules 目录（true 时复制 assets/rules/ 到 rulesDir）
 * - rulesDir:  rules 目录相对路径（仅 hasRules=true 时使用）
 *
 * Agent 分类（按目录约定）：
 * - OpenCode 类：.opencode / .kilo / .qoder  → 根文档 AGENTS.md
 * - Claude 类：  .claude                     → 根文档 CLAUDE.md
 * - Trae 类：    .trae / .codebuddy          → 根文档 AGENTS.md，额外有 rules 目录
 */
const AGENTS = {
  opencode: {
    skillDir: '.opencode/skills/tfs-tf-commands',
    docFile: 'AGENTS.md',
    docSource: 'AGENTS.md',
    hasRules: false
  },
  kilo: {
    skillDir: '.kilo/skills/tfs-tf-commands',
    docFile: 'AGENTS.md',
    docSource: 'AGENTS.md',
    hasRules: false
  },
  qoder: {
    skillDir: '.qoder/skills/tfs-tf-commands',
    docFile: 'AGENTS.md',
    docSource: 'AGENTS.md',
    hasRules: false
  },
  claude: {
    skillDir: '.claude/skills/tfs-tf-commands',
    docFile: 'CLAUDE.md',
    docSource: 'CLAUDE.md',
    hasRules: false
  },
  trae: {
    skillDir: '.trae/skills/tfs-tf-commands',
    rulesDir: '.trae/rules',
    docFile: 'AGENTS.md',
    docSource: 'AGENTS.md',
    hasRules: true
  },
  codebuddy: {
    skillDir: '.codebuddy/skills/tfs-tf-commands',
    rulesDir: '.codebuddy/rules',
    docFile: 'AGENTS.md',
    docSource: 'AGENTS.md',
    hasRules: true
  }
};

const VALID_AGENT_NAMES = Object.keys(AGENTS);

/**
 * 解析 --agents 参数
 * @param {string} input  'all' 或逗号分隔的 agent 名（如 'opencode,trae'）
 * @returns {string[]}    展开后的 agent 名数组
 * @throws {Error}        含非法值时抛错
 */
function parseAgents(input) {
  if (!input || input === 'all') return [...VALID_AGENT_NAMES];
  const parsed = input
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  const invalid = parsed.filter((a) => !VALID_AGENT_NAMES.includes(a));
  if (invalid.length) {
    throw new Error(
      `不支持的 Agent 工具: ${invalid.join(', ')}（可选值: all, ${VALID_AGENT_NAMES.join(', ')}）`
    );
  }
  // 去重
  return [...new Set(parsed)];
}

module.exports = { AGENTS, VALID_AGENT_NAMES, parseAgents };
