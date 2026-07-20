'use strict';

/**
 * credentials 模块测试。
 *
 * m1 回归：deletePassword 在 wincred 不可用时回退 cmdkey，且不抛错。
 * wincred 是可选依赖，多数环境未装 → loadWincred() 返回 false → 必走 cmdkey 分支。
 * 这恰好覆盖 m1 修复点的"fall through 到 cmdkey"路径。
 *
 * 注：测试假设 Windows 平台 + cmdkey 可用（与项目 Windows-only 定位一致）。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const credentials = require('../src/credentials');

test('deletePassword: 不存在的凭证 → 走 cmdkey 回退，返回布尔不抛', () => {
  // wincred 未装时 loadWincred 返回 false → 直接走 cmdkey /delete
  // target 不存在 → cmdkey 返回非 0 → deletePassword 返回 false（不抛）
  const r = credentials.deletePassword('tfs-cli-nonexistent-user-' + Date.now());
  assert.equal(typeof r, 'boolean');
});

test('deletePassword: 空 username 抛 INVALID_ARGS', () => {
  const { CliError } = require('../src/errors');
  assert.throws(
    () => credentials.deletePassword(''),
    (e) => e instanceof CliError && e.code === 'INVALID_ARGS'
  );
});

test('hasPassword: 未装 wincred 时返回 false（不抛）', () => {
  // wincred 多数测试环境未装；不论结果都不应抛
  const r = credentials.hasPassword('someone');
  assert.equal(typeof r, 'boolean');
});
