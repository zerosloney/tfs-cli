'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CliError, ERROR_CODES, ERROR_EXIT_CODES } = require('../src/errors');

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
    'TF_NOT_FOUND', 'CONFIG_MISSING', 'CREDENTIAL_MISSING', 'INVALID_ARGS'
  ]) {
    assert.ok(ERROR_CODES[k], `${k} 应存在`);
  }
});

test('ERROR_EXIT_CODES: CONFLICT 对应 2', () => {
  assert.equal(ERROR_EXIT_CODES[ERROR_CODES.CONFLICT], 2);
});
