'use strict';

const fs = require('fs');
const path = require('path');
const { toWindows } = require('../path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');

/**
 * 过滤 unified diff，只保留变更行及可配置的上下文行数。
 *
 * @param {string} unified
 * @param {number} maxCtx  上下文行数（0 = 仅变更行，不含上下文）
 * @returns {string}
 */
function filterUnifiedDiff(unified, maxCtx) {
  if (maxCtx === undefined || maxCtx === null) return unified;
  if (maxCtx < 0) throw new CliError(ERROR_CODES.INVALID_ARGS, `--lines 必须为非负整数，收到: ${maxCtx}`);

  const lines = unified.split(/\r?\n/);
  const out = [];
  let ctxBudget = 0; // 每个 hunk 内变更行后的上下文预算

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const first = line.charAt(0);

    // hunk 头 / 文件头：无条件保留，重置上下文预算
    if (/^(---|\+\+\+|@@)/.test(line)) {
      out.push(line);
      ctxBudget = 0;
      continue;
    }

    if (first === '+' || first === '-') {
      // 变更行：保留，并重置上下文预算
      out.push(line);
      ctxBudget = maxCtx;
    } else if (first === ' ' && ctxBudget > 0) {
      // 上下文行：在预算内保留，每消费一行减一
      out.push(line);
      ctxBudget--;
    }
    // 空行和 diff 元数据行（index / time 等）直接跳过
  }

  return out.join('\n');
}

async function diff(opts, ctx) {
  const target = opts.inputPath ? toWindows(opts.inputPath) : '.';
  const args = ['diff', target];
  if (opts.recursive !== false) args.push('/recursive');
  args.push('/format:unified');

  const r = await ctx.executor.run(args, { includeServer: false });
  // tf diff 返回 0 = 有差异 或 无差异；非 0 通常是路径问题
  if (!r.ok) {
    return {
      response: fail('diff', ERROR_CODES.AUTH_FAILED, '查看差异失败', {
        path: target,
        details: { stderr: r.stderr.trim(), exitCode: r.exitCode },
        meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
        startMs: ctx.startMs
      }),
      exitCode: 1
    };
  }

  const hasOutput = opts.output != null && opts.output !== '';
  const hasLines = opts.lines != null && opts.lines !== '';

  let unified = r.stdout;
  let linesValue = null;

  if (hasLines) {
    const n = parseInt(String(opts.lines), 10);
    if (!Number.isFinite(n) || n < 0 || String(n) !== String(opts.lines).trim()) {
      throw new CliError(ERROR_CODES.INVALID_ARGS, `--lines 必须为非负整数，收到: ${opts.lines}`);
    }
    unified = filterUnifiedDiff(unified, n);
    linesValue = n;
  }

  const data = { target };
  if (hasOutput) {
    const outPath = toWindows(opts.output);
    try {
      fs.writeFileSync(outPath, unified, 'utf-8');
    } catch (e) {
      throw new CliError(ERROR_CODES.INTERNAL_ERROR, `写入差异文件失败: ${e.message}`, { path: outPath });
    }
    data.output = outPath;
    data.bytes = Buffer.byteLength(unified, 'utf-8');
    if (linesValue !== null) data.lines = linesValue;
  } else {
    data.unified = unified;
    if (linesValue !== null) data.lines = linesValue;
  }

  return {
    response: ok('diff', {
      path: target,
      data,
      meta: { tf_exit: r.exitCode, duration_ms: r.durationMs, stdout_bytes: r.stdout.length },
      startMs: ctx.startMs
    }),
    exitCode: 0
  };
}

module.exports = { diff, filterUnifiedDiff };
