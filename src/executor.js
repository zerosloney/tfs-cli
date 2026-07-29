'use strict';

const { spawn } = require('child_process');
const { CliError, ERROR_CODES } = require('./errors');

/**
 * tf.exe 调用封装。
 *
 * 通过依赖注入 spawnFn 让测试可注入 fake bin。
 * 默认用 child_process.spawn 真调 tf.exe。
 *
 * 所有方法返回 { ok, exitCode, stdout, stderr, durationMs }。
 * 解析 tf.exe 输出（特别是 owner 字段等）由调用方处理。
 */

class TfExecutor {
  /**
   * @param {object} opts
   * @param {string} opts.tfPath  tf.exe 绝对路径
   * @param {string} opts.username
   * @param {string} opts.password
   * @param {string} [opts.domain]
   * @param {string} [opts.server]  TFS 服务器 URL（带 /tfs/<collection> 后缀）
   * @param {Function} [opts.spawnFn] 默认 child_process.spawn；测试可注入
   */
  constructor({ tfPath, username, password, domain = '', server = '', spawnFn }) {
    if (!tfPath) throw new CliError(ERROR_CODES.TF_NOT_FOUND, 'tfPath 不能为空');
    if (!username) throw new CliError(ERROR_CODES.CREDENTIAL_MISSING, 'username 不能为空');
    if (!password) throw new CliError(ERROR_CODES.CREDENTIAL_MISSING, 'password 不能为空');
    // intentional-simple: tf.exe 的 /login:user,password 按第一个逗号分割且不支持转义。
    // 含逗号的密码会被 tf.exe 静默截断 → 鉴权失败但原因难定位。
    // 在信任边界上显式拒绝，避免静默错误。升级路径：改用环境变量或 stdin 传递凭证。
    if (/[,;]/.test(password)) {
      throw new CliError(
        ERROR_CODES.INVALID_ARGS,
        '密码不能包含逗号或分号（tf.exe /login 参数不支持转义，会导致鉴权静默失败）',
        { hint: '请修改 TFS 密码；该限制源于 tf.exe 命令行本身，无法通过环境变量绕过' }
      );
    }
    this.tfPath = tfPath;
    this.username = username;
    this.password = password;
    this.domain = domain;
    this.server = server;
    this.spawnFn = spawnFn || spawn;
  }

  _loginArg() {
    if (this.domain) {
      return `/login:${this.domain}\\${this.username},${this.password}`;
    }
    return `/login:${this.username},${this.password}`;
  }

  _serverArg() {
    return this.server ? `/server:${this.server}` : null;
  }

  /**
   * 通用执行：返回原始 stdout/stderr/exitCode/durationMs。
   *
   * @param {string[]} tfArgs   tf.exe 的命令行参数（不含 /login /server 等）
   * @param {object} [opts]
   * @param {boolean} [opts.includeServer]  是否附加 /server:...（默认 false — 不自动加）
   * @param {boolean} [opts.noprompt]      是否附加 /noprompt（默认 true）
   * @returns {Promise<{ok:boolean, exitCode:number|null, stdout:string, stderr:string, durationMs:number}>}
   */
  async run(tfArgs, { includeServer = false, noprompt = true } = {}) {
    const args = [...tfArgs];
    if (includeServer && this._serverArg()) args.push(this._serverArg());
    args.push(this._loginArg());
    if (noprompt) args.push('/noprompt');

    const start = Date.now();
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let child;
      try {
        child = this.spawnFn(this.tfPath, args, { windowsHide: true });
      } catch (e) {
        resolve({
          ok: false,
          exitCode: null,
          stdout: '',
          stderr: 'spawn failed: ' + e.message,
          durationMs: Date.now() - start
        });
        return;
      }
      child.stdout.on('data', (d) => (stdout += d.toString('utf-8')));
      child.stderr.on('data', (d) => (stderr += d.toString('utf-8')));
      child.on('error', (e) => {
        resolve({
          ok: false,
          exitCode: null,
          stdout,
          stderr: stderr + '\nspawn error: ' + e.message,
          durationMs: Date.now() - start
        });
      });
      child.on('close', (code) => {
        const durationMs = Date.now() - start;
        resolve({
          ok: code === 0,
          exitCode: code,
          stdout,
          stderr,
          durationMs
        });
      });
    });
  }
}

/**
 * 把 tf status / tf history 的多行输出拆成条目。
 * 简化解析，只识别主要字段，不强求完美。
 */

/**
 * 从 status 输出提取 owner（兼容中英文 tf.exe）。
 * tf.exe 中英文输出字段名不同：
 *   英文："User: DOMAIN\foo"
 *   中文："用户: DOMAIN\foo"
 *
 * @param {string} output
 * @returns {string|null} owner（含 DOMAIN\ 前缀）或 null
 */
function extractOwner(output) {
  if (!output) return null;
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(?:User|用户)\s*:\s*(.+?)\s*$/);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * 比较两个用户名是否实质相同。
 *
 * 规则（按优先级）：
 *   1. 两侧都有 domain（DOMAIN\user）或都有 UPN domain（user@domain.com）→ 必须比较 domain：
 *      - 忽略大小写后 domain+local-part 都相等才视为相同
 *   2. 一侧有 domain/UPN，另一侧无 → 降级只比较 local-part（忽略大小写）
 *   3. 两侧都无 domain → 直接比较 local-part（忽略大小写）
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameUser(a, b) {
  if (!a || !b) return false;
  const parse = (s) => {
    let domain = '';
    let local = s;
    // DOMAIN\user
    const bs = s.indexOf('\\');
    if (bs >= 0) {
      domain = s.slice(0, bs).toLowerCase();
      local = s.slice(bs + 1);
    }
    // user@domain.com
    const at = local.indexOf('@');
    if (at >= 0) {
      const upnDomain = local.slice(at + 1).toLowerCase();
      local = local.slice(0, at);
      if (!domain) domain = upnDomain;
      // 如果已有 domain（DOMAIN\user@domain），UPN domain 用于补充比较
      // 但此时应该与另一个参的 domain 比较
    }
    return { domain: domain.toLowerCase(), local: local.toLowerCase() };
  };
  const pa = parse(a);
  const pb = parse(b);
  // 两侧都有 domain → 必须比较 domain
  if (pa.domain && pb.domain) {
    return pa.domain === pb.domain && pa.local === pb.local;
  }
  // 一侧有 domain，另一侧无 → 降级只比较 local-part
  return pa.local === pb.local;
}

module.exports = { TfExecutor, extractOwner, sameUser };
