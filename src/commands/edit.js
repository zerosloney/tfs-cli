'use strict';

const fs = require('fs');
const { toWindows } = require('../path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');
const { extractOwner, sameUser } = require('../executor');

/**
 * checkout 失败时，tf.exe 对"项不存在于工作区 / 无访问权限"的 stderr 特征。
 * 命中此特征 + 文件磁盘存在 → 判定为"新文件尚未加入源代码管理"，
 * 返回 PATH_NOT_IN_WORKSPACE 并提示运行 `tfs-cli add`。
 * 否则维持 AUTH_FAILED（真凭证/网络/工作区映射问题）。
 * （intentional-simple: 字符串匹配 tf.exe 中/英 stderr；升级路径是让 tf.exe
 * 输出结构化错误码后再改判据。）
 */
const NOT_IN_SOURCE_CONTROL = /未能找到项|没有访问.*权限|no items? (?:could be )?found|not (?:currently )?(?:mapped|found) in (?:your )?workspace/i;

/**
 * 合成当前用户身份标识：如果 config 有 domain，用 DOMAIN\username 格式。
 * 这样 sameUser 比较时能正确区分 CONTOSO\alice 和 OTHERDOMAIN\alice。
 */
function currentIdentity(config) {
  if (config.domain) {
    return config.domain.toUpperCase() + '\\' + config.username;
  }
  return config.username;
}

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

  const currentUser = currentIdentity(ctx.config);

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
    if (ownerRetry && !sameUser(ownerRetry, currentUser)) {
      return {
        response: fail('edit', ERROR_CODES.CONFLICT, `文件已被 ${ownerRetry} 签出（无法签出）`, {
          path: win,
          details: { owner: ownerRetry, currentUser: currentUser, stderr: ckRes.stderr.trim() },
          meta: { tf_exit: ckRes.exitCode, duration_ms: ckRes.durationMs },
          startMs: ctx.startMs
        }),
        exitCode: 2
      };
    }
    if (ownerRetry && sameUser(ownerRetry, currentUser)) {
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
    // checkout 失败、status 也无 owner：判一次是不是"新文件尚未加入源代码管理"。
    // 文件磁盘存在 + tf 报"找不到项/无权限"→ 引导调用方先 tfs-cli add；
    // 否则才是真的凭证过期/网络/工作区映射问题 → AUTH_FAILED。
    const stderrText = ckRes.stderr.trim();
    if (fs.existsSync(win) && NOT_IN_SOURCE_CONTROL.test(stderrText)) {
      return {
        response: fail(
          'edit',
          ERROR_CODES.PATH_NOT_IN_WORKSPACE,
          '文件不在源代码管理中（新文件）— 请先运行 tfs-cli add 将其加入源代码管理，再编辑',
          {
            path: win,
            details: {
              hint: 'tfs-cli add <path>',
              stderr: stderrText,
              exitCode: ckRes.exitCode
            },
            meta: { tf_exit: ckRes.exitCode, duration_ms: ckRes.durationMs },
            startMs: ctx.startMs
          }
        ),
        exitCode: 1
      };
    }
    return {
      response: fail('edit', ERROR_CODES.AUTH_FAILED, '签出失败（不在工作区、凭证过期或网络问题）', {
        path: win,
        details: { stderr: stderrText, exitCode: ckRes.exitCode },
        meta: { tf_exit: ckRes.exitCode, duration_ms: ckRes.durationMs },
        startMs: ctx.startMs
      }),
      exitCode: 1
    };
  }

  // 步骤 3/4: 已签出
  if (sameUser(owner, currentUser)) {
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
    response: fail('edit', ERROR_CODES.CONFLICT, `文件已被 ${owner} 签出，无法编辑`, {
      path: win,
      details: { owner, currentUser: currentUser },
      meta: { tf_exit: statusRes.exitCode, duration_ms: statusRes.durationMs },
      startMs: ctx.startMs
    }),
    exitCode: 2
  };
}

module.exports = { edit };
