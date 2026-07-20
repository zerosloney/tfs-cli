'use strict';

const { toWindows } = require('../path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');

async function diff(opts, ctx) {
  const target = opts.inputPath ? toWindows(opts.inputPath) : '.';
  const r = await ctx.executor.run(['diff', target, '/recursive', '/format:unified'], { includeServer: false });
  // tf diff 返回 0 = 有差异 或 无差异；非 0 通常是路径问题
  if (!r.ok) {
    return {
      response: fail('diff', 'AUTH_FAILED', '查看差异失败', {
        path: target,
        details: { stderr: r.stderr.trim(), exitCode: r.exitCode },
        meta: { tf_exit: r.exitCode, duration_ms: r.durationMs }
      }),
      exitCode: 1
    };
  }
  return {
    response: ok('diff', {
      path: target,
      data: { target, unified: r.stdout },
      meta: { tf_exit: r.exitCode, duration_ms: r.durationMs, stdout_bytes: r.stdout.length },
      startMs: ctx.startMs
    }),
    exitCode: 0
  };
}

module.exports = { diff };
