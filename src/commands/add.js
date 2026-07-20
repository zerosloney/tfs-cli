'use strict';

const { toWindows } = require('../path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');

async function add(opts, ctx) {
  const win = toWindows(opts.inputPath);
  if (!win) throw new CliError(ERROR_CODES.INVALID_ARGS, '缺少 path 参数');

  const r = await ctx.executor.run(['add', win, '/recursive'], { includeServer: false });
  if (!r.ok) {
    return {
      response: fail('add', 'PATH_NOT_IN_WORKSPACE', '加入源代码管理失败', {
        path: win,
        details: { stderr: r.stderr.trim(), exitCode: r.exitCode },
        meta: { tf_exit: r.exitCode, duration_ms: r.durationMs }
      }),
      exitCode: 1
    };
  }
  return {
    response: ok('add', {
      path: win,
      data: { status: 'added', recursive: true },
      meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
      startMs: ctx.startMs
    }),
    exitCode: 0
  };
}

module.exports = { add };
