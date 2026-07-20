'use strict';

/**
 * tfs-cli 统一错误类型与错误码定义。
 *
 * 所有命令的失败路径都通过 throw new CliError(...) 抛出，
 * bin/tfs-cli.js 捕获后转成 JSON 结构（默认）或人类文本（--text）。
 *
 * 退出码约定：
 *   0 = 成功
 *   1 = 通用错误（凭证/网络/tf.exe 失败等）
 *   2 = 文件冲突（edit 子命令下文件被他人签出）
 *   3 = 配置缺失（需要 tfs-cli init）
 *   4 = tf.exe 未找到
 *
 * 退出码来源：CliError 构造时传入的 exitCode（默认 1），edit 的 CONFLICT 显式传 2。
 */

class CliError extends Error {
  /**
   * @param {string} code     见本文件 ERROR_CODES
   * @param {string} message  人类可读描述
   * @param {object} [details] 额外上下文（写入 JSON data 字段）
   * @param {number} [exitCode] 退出码（默认 1）
   */
  constructor(code, message, details = null, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

const ERROR_CODES = Object.freeze({
  AUTH_FAILED: 'AUTH_FAILED',
  PATH_NOT_IN_WORKSPACE: 'PATH_NOT_IN_WORKSPACE',
  CONFLICT: 'CONFLICT',
  TF_NOT_FOUND: 'TF_NOT_FOUND',
  CONFIG_MISSING: 'CONFIG_MISSING',
  CREDENTIAL_MISSING: 'CREDENTIAL_MISSING',
  CONFIG_INVALID: 'CONFIG_INVALID',
  INVALID_ARGS: 'INVALID_ARGS',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
});

module.exports = { CliError, ERROR_CODES };
