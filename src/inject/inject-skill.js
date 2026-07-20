'use strict';

const fs = require('fs');
const path = require('path');
const { copyTree } = require('./copy-tree');

const ASSETS_ROOT = path.join(__dirname, '..', 'assets');
const SKILL_SRC = path.join(ASSETS_ROOT, 'skills', 'tfs-tf-commands');

// 跳过源仓库的开发用真实凭证文件（含内网 IP + 真实用户名），仅复制 example 模板
const SKIP_FILES = ['assets/tfs-config.json'];
// 把 example 重命名为正式 tfs-config.json
const RENAME = { 'assets/tfs-config.example.json': 'assets/tfs-config.json' };

/**
 * 把 assets/skills/tfs-tf-commands/ 整体复制到目标 agent 的技能目录
 *
 * - 跳过 assets/tfs-config.json（真实凭证）
 * - 把 assets/tfs-config.example.json 重命名为 tfs-config.json 写入
 *
 * @param {string} targetDir   目标项目根目录
 * @param {object} agentEntry  registry 中该 agent 的元数据
 * @param {boolean} force      覆盖已存在的文件
 * @returns {string[]}         写入的文件绝对路径列表
 */
function injectSkill(targetDir, agentEntry, force = false) {
  const destDir = path.join(targetDir, agentEntry.skillDir);
  // 若目标 SKILL.md 已存在且未 --force，整体跳过
  const destSkillMd = path.join(destDir, 'SKILL.md');
  if (fs.existsSync(destSkillMd) && !force) {
    console.log(`[forge] ⏭️  ${destDir} 已存在，跳过技能注入 (--force 覆盖)`);
    return [];
  }

  const written = copyTree(SKILL_SRC, destDir, {
    skipFiles: SKIP_FILES,
    rename: RENAME,
    force
  });

  if (written.length === 0) {
    console.log(`[forge] ⏭️  ${destDir} 技能文件已存在且未 --force，未写入`);
  } else {
    console.log(`[forge] ✅ 技能注入: ${destDir} (${written.length} 个文件)`);
  }
  return written;
}

module.exports = { injectSkill, ASSETS_ROOT, SKILL_SRC };
