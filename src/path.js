'use strict';

/**
 * Windows / Unix 路径规范化。
 *
 * tfs-cli 主要跑在 Windows + Git Bash 环境，需要处理三类输入：
 *   1. 纯 Windows 路径：C:\Projects\foo.cs
 *   2. MSYS/Git Bash 风格：/c/Projects/foo.cs
 *   3. 相对路径：./foo.cs 或 foo.cs
 *
 * 输出统一为 Windows 原生绝对路径（带反斜杠），因为 tf.exe 是 Windows 程序。
 *
 * @example
 *   toWindows('/c/Projects/foo.cs') // -> 'C:\\Projects\\foo.cs'
 *   toWindows('C:\\Foo\\bar.cs')    // -> 'C:\\Foo\\bar.cs'
 *   toWindows('./bar.cs', 'C:\\Root') // -> 'C:\\Root\\bar.cs'
 */

/**
 * 把任意路径转成 Windows 原生绝对路径。
 *
 * @param {string} input      输入路径
 * @param {string} [cwd='C:\\']  相对路径解析的当前目录（默认 C:\）
 * @returns {string} Windows 反斜杠绝对路径
 */
function toWindows(input, cwd) {
  if (!input || typeof input !== 'string') {
    return '';
  }
  let p = input.trim();

  // MSYS 风格 /c/foo → C:\foo
  const msysMatch = p.match(/^\/([a-zA-Z])(\/.*)?$/);
  if (msysMatch) {
    const drive = msysMatch[1].toUpperCase();
    const rest = (msysMatch[2] || '').replace(/\//g, '\\');
    return `${drive}:${rest}`;
  }

  // 纯 Windows：C:\... 或 C:/...
  if (/^[a-zA-Z]:[\\/]/.test(p)) {
    return p.replace(/\//g, '\\');
  }

  // 相对路径：拼到 cwd
  const base = cwd || 'C:\\';
  if (p === '.' || p === '') return base.replace(/[\\/]+$/, '') || 'C:\\';
  return joinWindows(base, p);
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
 *   - 去掉首段 `./` 或 `..\`
 *
 * @param {...string} parts
 * @returns {string}
 */
function joinWindows(...parts) {
  return parts
    .filter(Boolean)
    .map((s) => s.replace(/\//g, '\\'))
    .map((s) => s.replace(/^(?:\\|\.\.|\.\\)+/, ''))
    .map((s) => s.replace(/\\+/g, '\\'))
    .map((s) => s.replace(/\\+$/g, ''))
    .filter((s) => s.length > 0)
    .join('\\');
}

module.exports = { toWindows, canonicalize, joinWindows };
