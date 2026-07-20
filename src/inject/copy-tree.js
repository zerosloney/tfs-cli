'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 递归复制目录树
 *
 * @param {string}  srcDir      源目录（绝对路径）
 * @param {string}  destDir     目标目录（绝对路径）
 * @param {object}  [options]
 * @param {string[]}[options.skipFiles]  相对 srcDir 的相对路径数组，命中则跳过
 * @param {Object}  [options.rename]     { '相对/源名': '相对/目标名' } 复制时重命名
 * @param {boolean} [options.force]      目标文件已存在时是否覆盖，默认 false（跳过）
 * @returns {string[]} 已写入的目标文件绝对路径列表
 */
function copyTree(srcDir, destDir, options = {}) {
  const { skipFiles = [], rename = {}, force = false } = options;
  const skipSet = new Set(skipFiles.map((p) => p.replace(/\\/g, '/')));
  const written = [];

  if (!fs.existsSync(srcDir)) {
    return written;
  }

  _walk(srcDir, destDir, '', { skipSet, rename, force, written });
  return written;
}

function _walk(srcRoot, destRoot, relDir, ctx) {
  const srcDir = path.join(srcRoot, relDir);
  const destDir = path.join(destRoot, relDir);

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
    const normRel = relPath.replace(/\\/g, '/');

    // 重命名映射：源相对路径命中则整体替换为新相对路径
    let destRelPath = relPath;
    if (Object.prototype.hasOwnProperty.call(ctx.rename, normRel)) {
      destRelPath = ctx.rename[normRel];
    }

    const srcFullPath = path.join(srcRoot, relPath);
    const destFullPath = path.join(destRoot, destRelPath);

    if (entry.isDirectory()) {
      _walk(srcRoot, destRoot, relPath, ctx);
      continue;
    }

    if (ctx.skipSet.has(normRel)) continue;

    if (fs.existsSync(destFullPath) && !ctx.force) {
      continue;
    }

    fs.mkdirSync(path.dirname(destFullPath), { recursive: true });
    fs.copyFileSync(srcFullPath, destFullPath);
    ctx.written.push(destFullPath);
  }
}

module.exports = { copyTree };
