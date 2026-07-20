'use strict';

const { load } = require('../config');
const credentials = require('../credentials');
const { detect } = require('../tf-detect');
const { TfExecutor } = require('../executor');
const { fail } = require('../formatters/output');
const { CliError } = require('../errors');

/**
 * 命令处理共享样板：
 *   - 加载配置
 *   - 从凭证库拿密码
 *   - 探测 tf.exe 路径
 *   - 构造 TfExecutor
 *
 * 返回 { response, exitCode }，不调 process.exit —— 让上层统一处理。
 *
 * @template T
 * @param {Function} fn   async (ctx) => {response, exitCode}
 * @returns {Promise<{response:object, exitCode:number}>}
 */
async function withExecutor(fn) {
  const startMs = Date.now();
  let ctx;
  try {
    const config = load();
    const password = credentials.getPassword(config.username);
    const tfPath = detect();
    ctx = {
      config,
      password,
      tfPath,
      executor: new TfExecutor({
        tfPath,
        username: config.username,
        password,
        domain: config.domain,
        server: config.server
      }),
      startMs
    };
  } catch (e) {
    if (e instanceof CliError) {
      return {
        response: fail('preflight', e.code, e.message, { details: e.details, startMs }),
        exitCode: e.exitCode || 1
      };
    }
    throw e;
  }

  try {
    return await fn(ctx);
  } catch (e) {
    if (e instanceof CliError) {
      return {
        response: fail('command', e.code, e.message, { details: e.details, startMs }),
        exitCode: e.exitCode || 1
      };
    }
    throw e;
  }
}

module.exports = { withExecutor };
