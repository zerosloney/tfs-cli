'use strict';

const path = require('path');
const { copyTree } = require('./copy-tree');

const ASSETS_ROOT = path.join(__dirname, '..', 'assets');
const RULES_SRC = path.join(ASSETS_ROOT, 'rules');

/**
 * 把 assets/rules/ 整体复制到目标 agent 的 rules 目录
 * 仅对 hasRules=true 的 agent（trae / codebuddy）生效
 *
 * @param {string} targetDir
 * @param {object} agentEntry
 * @param {boolean} force
 * @returns {string[]} 写入的文件绝对路径列表（agent 不支持 rules 时返回空数组）
 */
function injectRules(targetDir, agentEntry, force = false) {
  if (!agentEntry.hasRules || !agentEntry.rulesDir) return [];

  const destDir = path.join(targetDir, agentEntry.rulesDir);
  const written = copyTree(RULES_SRC, destDir, { force });

  if (written.length === 0) {
    console.log(`[forge] ⏭️  ${destDir} 已存在且未 --force，未写入`);
  } else {
    console.log(`[forge] ✅ 规则注入: ${destDir} (${written.length} 个文件)`);
  }
  return written;
}

module.exports = { injectRules, RULES_SRC };
