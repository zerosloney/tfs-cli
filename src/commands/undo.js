'use strict';

const { toWindows } = require('../path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');

async function undo(opts, ctx) {
  const win = toWindows(opts.inputPath);
  if (!win) throw new CliError(ERROR_CODES.INVALID_ARGS, '缺少 path 参数');

  const r = await ctx.executor.run(['undo', win], { includeServer: false });
  if (!r.ok) {
    return {
      response: fail('undo', ERROR_CODES.AUTH_FAILED, '撤销签出失败', {
        path: win,
        details: { stderr: r.stderr.trim(), exitCode: r.exitCode },
        meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
        startMs: ctx.startMs
      }),
      exitCode: 1
    };
  }
  return {
    response: ok('undo', {
      path: win,
      data: { status: 'undo' },
      meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
      startMs: ctx.startMs
    }),
    exitCode: 0
  };
}

module.exports = { undo };
