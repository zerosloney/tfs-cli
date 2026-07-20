'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CliError, ERROR_CODES } = require('../src/errors');

test('CliError: 携带 code/message/details/exitCode', () => {
  const e = new CliError(ERROR_CODES.CONFLICT, '文件被签出', { owner: 'bob' }, 2);
  assert.equal(e.code, ERROR_CODES.CONFLICT);
  assert.equal(e.message, '文件被签出');
  assert.deepEqual(e.details, { owner: 'bob' });
  assert.equal(e.exitCode, 2);
  assert.ok(e instanceof Error);
});

test('ERROR_CODES: 关键字段都在', () => {
  for (const k of [
    'AUTH_FAILED', 'PATH_NOT_IN_WORKSPACE', 'CONFLICT',
    'TF_NOT_FOUND', 'CONFIG_MISSING', 'CREDENTIAL_MISSING',
    'CONFIG_INVALID', 'INVALID_ARGS', 'INTERNAL_ERROR'
  ]) {
    assert.ok(ERROR_CODES[k], `${k} 应存在`);
  }
});

test('CliError: 默认退出码按错误码映射', () => {
  assert.equal(new CliError(ERROR_CODES.CONFIG_MISSING, '缺配置').exitCode, 3);
  assert.equal(new CliError(ERROR_CODES.TF_NOT_FOUND, '缺 tf').exitCode, 4);
  assert.equal(new CliError(ERROR_CODES.CONFLICT, '冲突').exitCode, 2);
  assert.equal(new CliError(ERROR_CODES.INVALID_ARGS, '参数错').exitCode, 1);
});

test('CliError: 显式 exitCode 优先于默认映射', () => {
  assert.equal(new CliError(ERROR_CODES.CONFIG_MISSING, '缺配置', null, 9).exitCode, 9);
});
