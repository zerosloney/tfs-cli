'use strict';

const { ok, fail } = require('../formatters/output');

/**
 * tfs-cli test — 测试连接。
 *
 * 用 tf workspaces <collection> 验证认证 + 集合可达。
 * 不依赖本地工作区映射，因此 init 后第一次必跑。
 */
async function testConnection(_opts, ctx) {
  const collectionArg = '/collection:' + ctx.config.server;
  const r = await ctx.executor.run(['workspaces', collectionArg]);
  if (!r.ok) {
    return {
      response: fail('test', 'AUTH_FAILED', '连接测试失败（凭证、用户名或服务器不可达）', {
        path: null,
        details: { stderr: r.stderr.trim(), exitCode: r.exitCode, stdout: r.stdout.trim().slice(0, 500) },
        meta: { tf_exit: r.exitCode, duration_ms: r.durationMs }
      }),
      exitCode: 1
    };
  }
  return {
    response: ok('test', {
      path: null,
      data: {
        server: ctx.config.server,
        username: ctx.config.username,
        collection: ctx.config.collection,
        reachable: true
      },
      meta: { tf_exit: r.exitCode, duration_ms: r.durationMs },
      startMs: ctx.startMs
    }),
    exitCode: 0
  };
}

module.exports = { testConnection };
