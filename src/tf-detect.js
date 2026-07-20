'use strict';

const fs = require('fs');
const path = require('path');
const { CliError, ERROR_CODES } = require('./errors');

/**
 * tf.exe 自动探测。
 *
 * 搜索顺序（与旧 tf_helper.sh 保持兼容）：
 *   1. Visual Studio 2022 Team Explorer
 *   2. Visual Studio 2019 Team Explorer
 *   3. Visual Studio 2017 Team Explorer
 *   4. 系统 PATH 中的 tf.exe（通过 `where tf.exe`）
 *   5. Standalone Team Explorer 2022
 *
 * @param {object} [opts]
 * @param {Function} [opts.spawnSync]  默认 child_process.spawnSync；测试可注入
 * @returns {string} tf.exe 绝对路径
 * @throws {CliError} TF_NOT_FOUND
 */

function detect({ spawnSync } = {}) {
  const candidates = [];

  // 1-3. VS Team Explorer（路径含一个 * 通配 VS 版本下的 Edition 目录）
  const globs = [
    'C:/Program Files/Microsoft Visual Studio/2022/*/Common7/IDE/CommonExtensions/Microsoft/TeamFoundation/Team Explorer/tf.exe',
    'C:/Program Files (x86)/Microsoft Visual Studio/2019/*/Common7/IDE/CommonExtensions/Microsoft/TeamFoundation/Team Explorer/tf.exe',
    'C:/Program Files (x86)/Microsoft Visual Studio/2017/*/Common7/IDE/CommonExtensions/Microsoft/TeamFoundation/Team Explorer/tf.exe'
  ];
  for (const g of globs) {
    const found = findFirstUnderStar(g);
    if (found) candidates.push(found);
  }

  // 4. PATH 中的 tf.exe
  const pathTf = whereTf(spawnSync);
  if (pathTf) candidates.push(pathTf);

  // 5. Standalone Team Explorer 2022
  const standalone =
    'C:\\Program Files\\Microsoft Visual Studio Team Explorer 2022\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\tf.exe';
  if (fs.existsSync(standalone)) candidates.push(standalone);

  if (candidates.length > 0) return candidates[0];

  throw new CliError(
    ERROR_CODES.TF_NOT_FOUND,
    '未找到 tf.exe。请安装 Visual Studio Team Explorer 或将 tf.exe 加入 PATH。',
    {
      searched: [
        'VS 2022 Team Explorer',
        'VS 2019 Team Explorer',
        'VS 2017 Team Explorer',
        'PATH (where tf.exe)',
        'Standalone Team Explorer 2022'
      ]
    }
  );
}

/**
 * 在类 glob 路径中找到第一个存在的文件。
 * 路径里允许出现恰好一个 *（代表一个目录层级）。
 *
 * @param {string} pattern  例如：'C:/Program Files/Microsoft Visual Studio/2022/<...>/.../tf.exe'
 * @returns {string|null}  实际存在的全路径，或 null
 */
function findFirstUnderStar(pattern) {
  const starIdx = pattern.indexOf('*');
  if (starIdx < 0) {
    const normalized = pattern.replace(/\//g, '\\');
    return fs.existsSync(normalized) ? normalized : null;
  }
  const prefix = pattern.slice(0, starIdx).replace(/\//g, '\\');
  const suffix = pattern.slice(starIdx + 1).replace(/\//g, '\\').replace(/^\\/, '');
  const baseDir = prefix.replace(/\\$/, '');
  if (!fs.existsSync(baseDir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch (e) {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const candidate = path.join(baseDir, e.name, suffix);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 用 `where tf.exe` 找 PATH 里的 tf.exe。
 *
 * @param {Function} [spawnSync]
 * @returns {string|null}
 */
function whereTf(spawnSync) {
  spawnSync = spawnSync || require('child_process').spawnSync;
  try {
    const r = spawnSync('where', ['tf.exe'], { windowsHide: true, encoding: 'utf-8' });
    if (r.status === 0 && r.stdout) {
      const first = r.stdout.split(/\r?\n/)[0].trim();
      if (first && fs.existsSync(first)) return first;
    }
  } catch (e) {
    // 忽略
  }
  return null;
}

module.exports = { detect, findFirstUnderStar, whereTf };
