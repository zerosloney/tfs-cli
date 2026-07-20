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
 *   2. .trae/rules/tfs-command.md（如 .trae/ 已存在）
 *      - 不存在 → 创建（写入完整 RULES_FILE）
 *      - 存在 → 整文件替换
 *   3. .codebuddy/rules/tfs-command.md（如 .codebuddy/ 已存在）
 *   4. CLAUDE.md（仅 --agent claude 时）
 *
 * 参数：
 *   --target <dir>   目标项目目录（默认 cwd）
 *   --agent <name>   opencode|claude|trae|codebuddy|all（默认 all：自动检测存在的目录）
 *   --force          即使未带 --force 也强制覆盖已有 marker 内容
 *   --dry-run        只打印计划，不写文件
 */

const MARKER_START = '<!-- tfs-cli:rules:start -->';
const MARKER_END = '<!-- tfs-cli:rules:end -->';
const RULES_SNIPPET_FILE = path.join(__dirname, '..', '..', 'assets', 'AGENTS_RULES.md');
const RULES_FULL_FILE = path.join(__dirname, '..', '..', 'assets', 'RULES_FILE.md');

function readIfExists(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

function writeFileEnsuringDir(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function applyMarker(originalBody, snippet, force) {
  if (!originalBody) return { mode: 'create', body: snippet };
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
  if (fs.existsSync(path.join(targetDir, 'AGENTS.md')) || fs.existsSync(path.join(targetDir, '.opencode')) ||
      fs.existsSync(path.join(targetDir, '.kilo')) || fs.existsSync(path.join(targetDir, '.qoder'))) {
    found.add('opencode');
  }
  if (fs.existsSync(path.join(targetDir, '.trae'))) found.add('trae');
  if (fs.existsSync(path.join(targetDir, '.codebuddy'))) found.add('codebuddy');
  if (fs.existsSync(path.join(targetDir, '.claude'))) found.add('claude');
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

  const agents = explicitAgent
    ? explicitAgent
    : detectAgents(targetDir).length > 0
      ? detectAgents(targetDir)
      : ['opencode']; // 默认

  const snippet = readIfExists(RULES_SNIPPET_FILE) || '';
  const fullFile = readIfExists(RULES_FULL_FILE) || snippet;
  if (!snippet) throw new CliError(ERROR_CODES.INTERNAL_ERROR, '内置规则模板缺失');

  const written = [];
  const plan = [];

  // 对每个 agent 写对应文件
  for (const a of agents) {
    let target;
    let body;
    if (a === 'claude') {
      target = path.join(targetDir, 'CLAUDE.md');
      const original = readIfExists(target);
      const r = applyMarker(original, snippet, force);
      body = r.body;
      plan.push({ agent: a, target, mode: r.mode });
    } else if (a === 'opencode' || a === 'kilo' || a === 'qoder') {
      target = path.join(targetDir, 'AGENTS.md');
      const original = readIfExists(target);
      const r = applyMarker(original, snippet, force);
      body = r.body;
      plan.push({ agent: a, target, mode: r.mode });
    } else if (a === 'trae') {
      target = path.join(targetDir, '.trae', 'rules', 'tfs-command.md');
      body = fullFile;
      plan.push({ agent: a, target, mode: fs.existsSync(target) ? 'overwrite' : 'create' });
    } else if (a === 'codebuddy') {
      target = path.join(targetDir, '.codebuddy', 'rules', 'tfs-command.md');
      body = fullFile;
      plan.push({ agent: a, target, mode: fs.existsSync(target) ? 'overwrite' : 'create' });
    } else {
      continue;
    }

    if (!dryRun) writeFileEnsuringDir(target, body);
    written.push({ agent: a, target, mode: dryRun ? `${plan[plan.length - 1].mode} (dry-run)` : plan[plan.length - 1].mode });
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
