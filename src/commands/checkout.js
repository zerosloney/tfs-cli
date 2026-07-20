'use strict';

const { toWindows } = require('../path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');

/**
 * tfs-cli checkout <path> — 签出文件
 */
async function checkout(opts, ctx) {
  const win = toWindows(opts.inputPath);
  if (!win) throw new CliError(ERROR_CODES.INVALID_ARGS, '缺少 path 参数');

  // checkout 在工作区下不需要 /server: — 显式关掉
  const r = await ctx.executor.run(['checkout', win], { includeServer: false });
  if (!r.ok) {
    return {
      response: fail('checkout', ERROR_CODES.AUTH_FAILED, classify(r.stderr) || '签出失败', {
        path: win,
        details: { stderr: r.stderr.trim(), exitCode: r.exitCode },
        meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
        startMs: ctx.startMs
      }),
      exitCode: 1
    };
  }
  return {
    response: ok('checkout', {
      path: win,
      data: { status: 'checked_out' },
      meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
      startMs: ctx.startMs
    }),
    exitCode: 0
  };
}

function classify(stderr) {
  // 只抽取关键信息（清掉 tf.exe 输出里的装饰文本）
  if (!stderr) return '签出失败';
  const lines = stderr.split(/\r?\n/).filter((l) => l.trim());
  for (const line of lines) {
    if (/签出|checkout|lock|locked/i.test(line)) return line.trim();
  }
  return lines[0] ? lines[0].trim() : '签出失败';
}

module.exports = { checkout };
