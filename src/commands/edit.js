'use strict';

const { toWindows } = require('../path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES, ERROR_EXIT_CODES } = require('../errors');
const { extractOwner, sameUser } = require('../executor');

/**
 * tfs-cli edit <path> — 编辑前自动签出 + 冲突检测。
 *
 * 退出码：
 *   0 = 可以编辑（已签出或新签出成功）
 *   2 = 文件被他人签出（错误码 CONFLICT）
 *   1 = 其它错误（路径问题、tf.exe 不可用等）
 *
 * 逻辑（与旧 tfs-edit.sh 对齐）：
 *   1. 查 status → 提取 owner 字段
 *   2. 无 owner → 尝试 checkout；失败则再查一次 status 兜底
 *   3. 有 owner 且是当前用户 → 已签出，直接成功
 *   4. 有 owner 但不是当前用户 → exit 2, CONFLICT
 */

async function edit(opts, ctx) {
  const win = toWindows(opts.inputPath);
  if (!win) throw new CliError(ERROR_CODES.INVALID_ARGS, '缺少 path 参数');

  // 步骤 1: 查 status
  let statusRes = await ctx.executor.run(['status', win], { includeServer: false });
  let owner = extractOwner(statusRes.stdout);

  if (!owner) {
    // 步骤 2: 尝试 checkout
    const ckRes = await ctx.executor.run(['checkout', win], { includeServer: false });
    if (ckRes.ok) {
      return {
        response: ok('edit', {
          path: win,
          data: { alreadyCheckedOut: false, justCheckedOut: true, owner: null },
          meta: { tf_exit: ckRes.exitCode, duration_ms: ckRes.durationMs },
          startMs: ctx.startMs
        }),
        exitCode: 0
      };
    }
    // checkout 失败 → 兜底再查一次 status
    const retry = await ctx.executor.run(['status', win], { includeServer: false });
    const ownerRetry = extractOwner(retry.stdout);
    if (ownerRetry && !sameUser(ownerRetry, ctx.config.username)) {
      return {
        response: fail('edit', 'CONFLICT', `文件已被 ${ownerRetry} 签出（无法签出）`, {
          path: win,
          details: { owner: ownerRetry, currentUser: ctx.config.username, stderr: ckRes.stderr.trim() },
          meta: { tf_exit: ckRes.exitCode, duration_ms: ckRes.durationMs }
        }),
        exitCode: 2
      };
    }
    if (ownerRetry && sameUser(ownerRetry, ctx.config.username)) {
      // 当前用户已签出，但 checkout 仍失败（工作区映射或网络问题）
      return {
        response: ok('edit', {
          path: win,
          data: {
            alreadyCheckedOut: true,
            justCheckedOut: false,
            owner: ownerRetry,
            warning: 'checkout 失败但 status 显示已被当前用户签出'
          },
          meta: { tf_exit: ckRes.exitCode, duration_ms: ckRes.durationMs },
          startMs: ctx.startMs
        }),
        exitCode: 0
      };
    }
    return {
      response: fail('edit', 'AUTH_FAILED', '签出失败（不在工作区、凭证过期或网络问题）', {
        path: win,
        details: { stderr: ckRes.stderr.trim(), exitCode: ckRes.exitCode },
        meta: { tf_exit: ckRes.exitCode, duration_ms: ckRes.durationMs }
      }),
      exitCode: 1
    };
  }

  // 步骤 3/4: 已签出
  if (sameUser(owner, ctx.config.username)) {
    return {
      response: ok('edit', {
        path: win,
        data: { alreadyCheckedOut: true, justCheckedOut: false, owner },
        meta: { tf_exit: statusRes.exitCode, duration_ms: statusRes.durationMs },
        startMs: ctx.startMs
      }),
      exitCode: 0
    };
  }
  return {
    response: fail('edit', 'CONFLICT', `文件已被 ${owner} 签出，无法编辑`, {
      path: win,
      details: { owner, currentUser: ctx.config.username },
      meta: { tf_exit: statusRes.exitCode, duration_ms: statusRes.durationMs }
    }),
    exitCode: 2
  };
}

module.exports = { edit };
