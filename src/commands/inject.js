'use strict';

const fs = require('fs');
const path = require('path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');

/**
 * tfs-cli inject — 把 tfs-cli 的规则片段写到项目里。
 *
 * 行为：
 *   1. AGENTS.md（或 --target 指定的 <root>/AGENTS.md）
 *      - 不存在 → 创建并写入 RULES_SNIPPET + 头/尾
 *      - 存在但无 marker → 追加 RULES_SNIPPET
 *      - 有 marker → 替换 marker 之间的内容（--force 时强制）
 *   2. 独立文件（CLAUDE.md / QWEN.md / GEMINI.md / .clinerules）
 *      - 同上 marker 逻辑
 *   3. 独立目录规则文件（.trae/rules/tfs-command.md / .codebuddy/rules/tfs-command.md / .cursor/rules/tfs-command.mdc）
 *      - 不存在 → 创建（写入完整 RULES_FILE + H1）
 *      - 存在 → 整文件替换
 *
 * 参数：
 *   --target <dir>   目标项目目录（默认 cwd）
 *   --agent <name>   opencode|claude|trae|codebuddy|kilo|qoder|zcode|omp|qwen|gemini|cline|cursor|all
 *   --force          即使未带 --force 也强制覆盖已有 marker 内容
 *   --dry-run        只打印计划，不写文件
 */

const MARKER_START = '<!-- tfs-cli:rules:start -->';
const MARKER_END = '<!-- tfs-cli:rules:end -->';
// 单一源文件：内容以 H2 起步（嵌入 AGENTS.md 不破坏宿主标题层级）；
// 独立文件场景（trae/codebuddy）在顶部动态加 H1。
const RULES_FILE = path.join(__dirname, '..', '..', 'assets', 'RULES.md');
const RULES_H1 = '# TFS 工作区管理\n\n';

// AGENTS.md 共享组（opencode/kilo/qoder/zcode/omp 共用同一文件，自动检测时归并为 'opencode'）
const AGENTS_MD_AGENTS = ['opencode', 'kilo', 'qoder', 'zcode', 'omp'];

// 独立文件 agent（每个写自己的专属文件，使用 marker 替换逻辑）
const FILE_AGENTS = ['claude', 'qwen', 'gemini', 'cline'];

// 独立目录规则文件 agent（整文件写入，不共用 marker）
const DIR_RULE_AGENTS = ['trae', 'codebuddy', 'cursor'];

// all 展开时每个实际目标只展开一次
const ALL_KNOWN_AGENTS = [...AGENTS_MD_AGENTS, ...FILE_AGENTS, ...DIR_RULE_AGENTS];
const ALL_TARGET_AGENTS = ['opencode', ...FILE_AGENTS, ...DIR_RULE_AGENTS];

function readIfExists(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

function writeFileEnsuringDir(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function applyMarker(originalBody, snippet, force) {
  if (!originalBody) {
    // 首次创建：主动用 marker 包裹，便于下次 inject 识别替换
    return { mode: 'create', body: `${MARKER_START}\n${snippet}\n${MARKER_END}\n` };
  }
  if (originalBody.includes(MARKER_START) && originalBody.includes(MARKER_END)) {
    const re = new RegExp(`${escapeRe(MARKER_START)}[\\s\\S]*?${escapeRe(MARKER_END)}`, 'm');
    if (!re.test(originalBody)) {
      // 防御 — 上面已确认同时存在
      return { mode: 'append', body: originalBody + '\n' + snippet };
    }
    return {
      mode: 'marker-replaced',
      body: originalBody.replace(re, `${MARKER_START}\n${snippet}\n${MARKER_END}`)
    };
  }
  // 无 marker：强制覆盖 → 替换全文；否则追加
  if (force) return { mode: 'force-overwrite', body: snippet };
  return {
    mode: 'append',
    body: originalBody + '\n\n' + MARKER_START + '\n' + snippet + '\n' + MARKER_END + '\n'
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectAgents(targetDir) {
  const found = new Set();
  // AGENTS.md 系列 agent（kilo/qoder/opencode/zcode/omp）共用同一文件，归并为 'opencode'
  const hasAgentsMd =
    fs.existsSync(path.join(targetDir, 'AGENTS.md')) ||
    AGENTS_MD_AGENTS.some((a) => fs.existsSync(path.join(targetDir, '.' + a)));
  if (hasAgentsMd) found.add('opencode');
  if (fs.existsSync(path.join(targetDir, '.trae'))) found.add('trae');
  if (fs.existsSync(path.join(targetDir, '.codebuddy'))) found.add('codebuddy');
  if (fs.existsSync(path.join(targetDir, '.claude'))) found.add('claude');
  if (fs.existsSync(path.join(targetDir, '.qwen'))) found.add('qwen');
  if (fs.existsSync(path.join(targetDir, '.gemini'))) found.add('gemini');
  if (fs.existsSync(path.join(targetDir, '.cline'))) found.add('cline');
  if (fs.existsSync(path.join(targetDir, '.cursor'))) found.add('cursor');
  return Array.from(found);
}

async function inject(opts = {}) {
  const startMs = Date.now();
  const targetDir = path.resolve(opts.target || process.cwd());
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new CliError(ERROR_CODES.INVALID_ARGS, `--target 不是有效目录: ${targetDir}`);
  }
  const force = !!opts.force;
  const dryRun = !!opts.dryRun;
  const explicitAgent = opts.agent ? (Array.isArray(opts.agent) ? opts.agent : [opts.agent]) : null;

  // 校验并展开 --agent 参数
  let agents;
  if (explicitAgent) {
    const raw = explicitAgent.flatMap((a) => a.split(',').map((s) => s.trim().toLowerCase())).filter(Boolean);
    // 检查未知值
    for (const a of raw) {
      if (a !== 'all' && !ALL_KNOWN_AGENTS.includes(a)) {
        throw new CliError(
          ERROR_CODES.INVALID_ARGS,
          `未知的 --agent 值: "${a}"。可用: ${ALL_KNOWN_AGENTS.join(', ')} 或 all`,
          { unknown: a, known: ALL_KNOWN_AGENTS }
        );
      }
    }
    // 展开 all
    if (raw.includes('all')) {
      agents = ALL_TARGET_AGENTS;
    } else {
      // 去重
      agents = [...new Set(raw)];
    }
  } else {
    agents = detectAgents(targetDir).length > 0
      ? detectAgents(targetDir)
      : ['opencode']; // 默认
  }

  const rules = readIfExists(RULES_FILE);
  if (!rules) throw new CliError(ERROR_CODES.INTERNAL_ERROR, '内置规则模板缺失');

  const written = [];
  const plan = [];

  // 对每个 agent 写对应文件
  for (const a of agents) {
    let target;
    let body;
    let mode;

    if (AGENTS_MD_AGENTS.includes(a)) {
      // AGENTS.md 共享组（marker 替换）
      target = path.join(targetDir, 'AGENTS.md');
      const original = readIfExists(target);
      const r = applyMarker(original, rules, force);
      body = r.body;
      mode = r.mode;
    } else if (FILE_AGENTS.includes(a)) {
      // 独立文件（marker 替换）
      const fileNames = { claude: 'CLAUDE.md', qwen: 'QWEN.md', gemini: 'GEMINI.md', cline: '.clinerules' };
      target = path.join(targetDir, fileNames[a]);
      const original = readIfExists(target);
      const r = applyMarker(original, rules, force);
      body = r.body;
      mode = r.mode;
    } else if (a === 'trae') {
      target = path.join(targetDir, '.trae', 'rules', 'tfs-command.md');
      body = RULES_H1 + rules;
      mode = fs.existsSync(target) ? 'overwrite' : 'create';
    } else if (a === 'codebuddy') {
      target = path.join(targetDir, '.codebuddy', 'rules', 'tfs-command.md');
      body = RULES_H1 + rules;
      mode = fs.existsSync(target) ? 'overwrite' : 'create';
    } else if (a === 'cursor') {
      target = path.join(targetDir, '.cursor', 'rules', 'tfs-command.mdc');
      body = RULES_H1 + rules;
      mode = fs.existsSync(target) ? 'overwrite' : 'create';
    } else {
      continue;
    }

    if (!dryRun) writeFileEnsuringDir(target, body);
    plan.push({ agent: a, target, mode });
    written.push({ agent: a, target, mode: dryRun ? `${mode} (dry-run)` : mode });
  }

  return {
    response: ok('inject', {
      path: targetDir,
      data: { targetDir, written, plan, dryRun },
      startMs
    }),
    exitCode: 0
  };
}

module.exports = { inject, MARKER_START, MARKER_END };
