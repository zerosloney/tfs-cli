'use strict';

const fs = require('fs');
const { toWindows } = require('../path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');

/**
 * tf add 在文件已是 pending add / 已入库时报"没有文件匹配"，此时 add 幂等成功。
 * 命中此特征 + 文件磁盘存在 → 视为已纳入源代码管理，避免误报 PATH_NOT_IN_WORKSPACE
 * 进而与 edit 的"请先运行 add"提示形成循环。
 * （intentional-simple: 字符串匹配 tf.exe 中/英 stderr；升级路径是 tf.exe 输出结构化错误码。）
 */
const ALREADY_TRACKED = /没有文件匹配|没有要添加的项|no (?:files?|items?) (?:to add|matched)|already (?:in source control|added|tracked)/i;

async function add(opts, ctx) {
  const win = toWindows(opts.inputPath);
  if (!win) throw new CliError(ERROR_CODES.INVALID_ARGS, '缺少 path 参数');

  const r = await ctx.executor.run(['add', win, '/recursive'], { includeServer: false });
  if (!r.ok) {
    if (fs.existsSync(win) && ALREADY_TRACKED.test(r.stderr)) {
      return {
        response: ok('add', {
          path: win,
          data: { status: 'already-tracked', recursive: true },
          meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
          startMs: ctx.startMs
        }),
        exitCode: 0
      };
    }
    return {
      response: fail('add', ERROR_CODES.PATH_NOT_IN_WORKSPACE, '加入源代码管理失败', {
        path: win,
        details: { stderr: r.stderr.trim(), exitCode: r.exitCode },
        meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
        startMs: ctx.startMs
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
