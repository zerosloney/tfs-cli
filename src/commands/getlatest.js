'use strict';

const { toWindows } = require('../path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');

async function getlatest(opts, ctx) {
  const target = opts.inputPath ? toWindows(opts.inputPath) : '.';
  const r = await ctx.executor.run(['get', target, '/recursive']);
  if (!r.ok) {
    return {
      response: fail('getlatest', ERROR_CODES.AUTH_FAILED, '获取最新失败', {
        path: target,
        details: { stderr: r.stderr.trim(), exitCode: r.exitCode },
        meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
        startMs: ctx.startMs
      }),
      exitCode: 1
    };
  }
  return {
    response: ok('getlatest', {
      path: target,
      data: { target, updated: true },
      meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
      startMs: ctx.startMs
    }),
    exitCode: 0
  };
}

module.exports = { getlatest };
