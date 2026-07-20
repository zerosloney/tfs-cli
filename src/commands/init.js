'use strict';

const readline = require('readline');
const { save, build, CONFIG_PATH } = require('../config');
const credentials = require('../credentials');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');

/**
 * tfs-cli init — 初始化全局配置 + 凭证库。
 *
 * 支持三种模式：
 *   1. 全交互：tfs-cli init
 *      依次提示输入 server URL / username / password（密码不回显）
 *   2. 半交互：tfs-cli init -u alice --url http://...
 *      命令行给了什么用什么，缺的字段回退到交互
 *   3. 完全非交互：tfs-cli init -u alice --url http://... -p secret
 *      适合脚本和 AI Agent 自动化
 */

/**
 * 用 readline 提示输入。
 *
 * @param {readline.Interface} rl
 * @param {string} prompt
 * @param {string} [defaultValue]
 * @returns {Promise<string>}
 */
function ask(rl, prompt, defaultValue = '') {
  return new Promise((resolve) => {
    const show = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `;
    rl.question(show, (answer) => {
      resolve((answer || '').trim() || defaultValue);
    });
  });
}

/**
 * 读取密码（不回显）。
 * Windows 下用 readline 没有原生"不回显"API，
 * 退化为普通输入，但提示用户。其它平台可在此处扩展。
 *
 * @param {readline.Interface} rl
 * @returns {Promise<string>}
 */
function askPassword(rl) {
  return new Promise((resolve) => {
    rl.question('Password (input visible — avoid shell history!): ', (answer) => {
      resolve((answer || '').trim());
    });
  });
}

/**
 * 命令入口。
 *
 * @param {object} [opts]
 * @param {string} [opts.url]
 * @param {string} [opts.username]
 * @param {string} [opts.password]
 * @returns {Promise<{response:object, exitCode:number}>}
 */
async function init(opts = {}) {
  const startMs = Date.now();
  try {
    let { url, username, password } = opts;
    const missing = [];
    if (!url) missing.push('--url / TFS_URL');
    if (!username) missing.push('--username / TFS_USERNAME');
    if (!password) missing.push('--password / TFS_PASSWORD');

    if (missing.length > 0) {
      // 非交互场景（缺任一项 且 stdin 不是 TTY）→ 直接报错退出
      if (!process.stdin.isTTY) {
        throw new CliError(
          ERROR_CODES.INVALID_ARGS,
          `缺少必要参数: ${missing.join(', ')}。在非交互模式下必须显式传入。`,
          { missing }
        );
      }
      // 交互式：逐项询问补全
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        if (!url) url = await ask(rl, 'TFS server URL (e.g. http://host:8080/tfs/ASS)');
        if (!username) username = await ask(rl, 'Username');
        if (!password) password = await askPassword(rl);
      } finally {
        rl.close();
      }
    }

    if (!url) {
      throw new CliError(ERROR_CODES.INVALID_ARGS, '缺少 server URL');
    }
    if (!username) {
      throw new CliError(ERROR_CODES.INVALID_ARGS, '缺少 username');
    }
    if (!password) {
      throw new CliError(ERROR_CODES.INVALID_ARGS, '缺少 password（可用 -p 或环境变量 TFS_PASSWORD）');
    }

    // 写入凭证库
    await credentials.setPassword(username, password);

    // 写入配置
    const cfg = build({ server: url, username, domain: opts.domain || '', workspace: opts.workspace || '' });
    save(cfg);

    return {
      response: ok('init', {
        path: null,
        data: {
          configPath: CONFIG_PATH(),
          server: cfg.server,
          username: cfg.username,
          collection: cfg.collection,
          passwordRef: cfg.password_ref
        },
        startMs
      }),
      exitCode: 0
    };
  } catch (e) {
    if (e instanceof CliError) {
      return {
        response: fail('init', e.code, e.message, { details: e.details, startMs }),
        exitCode: e.exitCode
      };
    }
    throw e;
  }
}

module.exports = { init, ask, askPassword };
