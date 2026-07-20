'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ok, fail, format, formatText } = require('../src/formatters/output');

test('ok: 构造成功响应', () => {
  const startMs = Date.now() - 100;
  const r = ok('checkout', { path: 'C:\\Foo.cs', data: { status: 'ok' }, startMs });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'checkout');
  assert.equal(r.path, 'C:\\Foo.cs');
  assert.equal(r.error, null);
  assert.ok(r.meta.duration_ms >= 0);
});

test('fail: 构造失败响应', () => {
  const r = fail('checkout', 'CONFLICT', '被他人签出', {
    path: 'C:\\Foo.cs',
    details: { owner: 'bob' },
    meta: { tf_exit: 1, duration_ms: 50 }
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'CONFLICT');
  assert.equal(r.error.message, '被他人签出');
  assert.equal(r.meta.tf_exit, 1);
});

test('format JSON 默认: 可解析回原对象', () => {
  const r = ok('init', { data: { server: 'http://h:8080' } });
  const text = format(r);
  assert.ok(text.includes('"ok": true'));
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(r))); // 结构等价
});

test('format --text: 失败响应用人类句子', () => {
  const r = fail('checkout', 'AUTH_FAILED', '签出失败', { path: 'C:\\foo.cs' });
  const out = format(r, { text: true });
  assert.match(out, /FAILED/);
  assert.match(out, /C:\\foo\.cs/);
});

test('format --text: 成功响应 action-specific', () => {
  const r = ok('edit', { path: 'C:\\x.cs', data: { alreadyCheckedOut: true } });
  const out = format(r, { text: true });
  assert.match(out, /already checked out/);
});
