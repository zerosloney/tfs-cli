'use strict';

const { toWindows } = require('../path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');

/**
 * tfs-cli status [path]
 *
 * tf status 输出形如：
 *   $/<workspace>:
 *   <file>  <change-type>  <owner>
 *
 * 解析为结构化的 pending 数组，便于 AI 直接读取。
 */

function parseStatus(stdout) {
  if (!stdout) return [];
  const lines = stdout.split(/\r?\n/);
  const pending = [];
  // 跳过分隔行（"===="或全角"----"）
  const itemStart = { '+': 'add', '*': 'edit', '-': 'delete', '!': 'conflict', '~': 'rename' };
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line || /^[\s=]+$/.test(line) || /未变更|Nothing|no changes|unchanged/i.test(line)) continue;
    // 两栏空格分隔：file  change  lock-status
    const m = line.match(/^(.+?)\s{2,}(\S+)(?:\s+(.+))?$/);
    if (!m) continue;
    const [, file, changeRaw, ownerRaw] = m;
    const changeType = itemStart[changeRaw.charAt(0)] || changeRaw;
    pending.push({
      file: file.trim(),
      change: changeType,
      owner: ownerRaw ? ownerRaw.trim() : null
    });
  }
  return pending;
}

async function status(opts, ctx) {
  const target = opts.inputPath ? toWindows(opts.inputPath) : '.';
  const r = await ctx.executor.run(['status', target, '/recursive'], { includeServer: false });
  if (!r.ok) {
    return {
      response: fail('status', 'AUTH_FAILED', '查看待定更改失败', {
        path: target,
        details: { stderr: r.stderr.trim(), exitCode: r.exitCode },
        meta: { tf_exit: r.exitCode, duration_ms: r.durationMs }
      }),
      exitCode: 1
    };
  }
  const pending = parseStatus(r.stdout);
  return {
    response: ok('status', {
      path: target,
      data: { target, pending, count: pending.length },
      meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
      startMs: ctx.startMs
    }),
    exitCode: 0
  };
}

module.exports = { status, parseStatus };
