'use strict';

/**
 * Windows / Unix 路径规范化。
 *
 * tfs-cli 主要跑在 Windows + Git Bash 环境，需要处理三类输入：
 *   1. 纯 Windows 路径：C:\Projects\foo.cs
 *   2. MSYS/Git Bash 风格：/c/Projects/foo.cs
 *   3. 相对路径：./foo.cs 或 foo.cs 或 ../foo.cs
 *   4. UNC 路径：\\server\share\foo.cs
 *
 * 输出统一为 Windows 原生绝对路径（带反斜杠），因为 tf.exe 是 Windows 程序。
 * 相对路径按 process.cwd() 解析。优先使用 path.win32 标准库。
 *
 * @example
 *   toWindows('/c/Projects/foo.cs') // -> 'C:\\Projects\\foo.cs'
 *   toWindows('C:\\Foo\\bar.cs')    // -> 'C:\\Foo\\bar.cs'
 *   toWindows('./bar.cs')           // -> 'C:\\Users\\<user>\\bar.cs'
 *   toWindows('..\\foo.cs')         // -> 'C:\\Users\\foo.cs'
 */

const path = require('path');
const win32 = path.win32;

/**
 * 把任意路径转成 Windows 原生绝对路径。
 *
 * @param {string} input      输入路径
 * @param {string} [cwd]      相对路径解析的当前目录（默认 process.cwd()）
 * @returns {string} Windows 反斜杠绝对路径
 */
function toWindows(input, cwd) {
  if (!input || typeof input !== 'string') {
    return '';
  }
  let p = input.trim();
  if (!p) return '';

  // UNC 路径：\\server\share\...
  if (p.startsWith('\\\\') || p.startsWith('//')) {
    return win32.normalize(p.replace(/\//g, '\\'));
  }

  // MSYS 风格 /c/foo → C:\foo
  const msysMatch = p.match(/^\/([a-zA-Z])(\/|$)/);
  if (msysMatch) {
    const drive = msysMatch[1].toUpperCase();
    const rest = p.slice(2).replace(/\//g, '\\');
    return win32.normalize(`${drive}:${rest || '\\'}`);
  }

  // 纯 Windows 绝对路径：C:\... 或 C:/...
  if (/^[a-zA-Z]:[\\/]/.test(p)) {
    return win32.normalize(p.replace(/\//g, '\\'));
  }

  // 相对路径：拼到 cwd 后用 win32.resolve 规范化
  let base = cwd || process.cwd();
  const baseMsys = base.match(/^\/([a-zA-Z])(\/|$)/);
  if (baseMsys) {
    const rest = base.slice(2).replace(/\//g, '\\');
    base = `${baseMsys[1].toUpperCase()}:${rest || '\\'}`;
  }
  return win32.resolve(base, p.replace(/\//g, '\\'));
}

/**
 * 把任意路径转成正斜杠相对风格（用于缓存 key 等），
 * 跨平台唯一标识同一文件。
 *
 * @param {string} input
 * @returns {string} 绝对路径，反斜杠转成正斜杠，小写
 */
function canonicalize(input) {
  const win = toWindows(input);
  if (!win) return '';
  return win.replace(/\\/g, '/').toLowerCase();
}

/**
 * 拼接 Windows 路径段。
 *
 * 规则：
 *   - `/` 与 `\` 都视为分隔符，最终统一为 `\`
 *   - 折叠连续 `\`
 *   - 去掉首/尾 `\`
 *   - 用 win32.resolve 处理 .. 等相对段（但避免将 /xx 视为绝对路径）
 *
 * @param {...string} parts
 * @returns {string}
 */
function joinWindows(...parts) {
  const filtered = parts.filter(Boolean);
  if (filtered.length === 0) return '';
  // 将正斜杠统一为反斜杠，然后用 win32.join 拼接（不把 / 开头的段视为绝对路径）
  const normalized = filtered.map((s) => s.replace(/\//g, '\\'));
  const joined = win32.join(...normalized);
  return joined.replace(/\//g, '\\');
}

module.exports = { toWindows, canonicalize, joinWindows };
