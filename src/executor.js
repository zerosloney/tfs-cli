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
        { hint: '请修改 TFS 密码或使用环境变量 TFS_PASSWORD 配合无逗号密码' }
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
   * @param {boolean} [opts.includeServer]  是否附加 /server:...（默认 true）
   * @param {boolean} [opts.noprompt]      是否附加 /noprompt（默认 true）
   * @returns {Promise<{ok:boolean, exitCode:number|null, stdout:string, stderr:string, durationMs:number}>}
   */
  async run(tfArgs, { includeServer = true, noprompt = true } = {}) {
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
 * 比较两个用户名是否实质相同（忽略 domain/@domain 大小写）。
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameUser(a, b) {
  if (!a || !b) return false;
  const norm = (s) => s.split('\\').pop().split('@')[0].toLowerCase();
  return norm(a) === norm(b);
}

module.exports = { TfExecutor, extractOwner, sameUser };
