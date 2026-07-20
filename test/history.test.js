'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { TfExecutor } = require('../src/executor');
const { history, parseHistoryEntries } = require('../src/commands/history');

const CACHE_PATH = path.join(os.homedir(), '.tfs_cli_history_cache.json');

function makeCtx({ stdout = '', exitCode = 0 } = {}) {
  const calls = [];
  const spawnFn = (tfPath, args) => {
    calls.push({ tfPath, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout, 'utf-8'));
      child.emit('close', exitCode);
    });
    return child;
  };
  return {
    ctx: {
      config: { server: 'http://h:8080/tfs/ASS', username: 'alice', domain: '', collection: 'ASS' },
      password: 's',
      tfPath: 'tf.exe',
      executor: new TfExecutor({
        tfPath: 'tf.exe', username: 'alice', password: 's', server: 'http://h:8080/tfs/ASS', spawnFn
      }),
      startMs: Date.now()
    },
    calls
  };
}

beforeEach(() => {
  if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
});
afterEach(() => {
  if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
});

test('history: 单行 detailed 格式解析', () => {
  // tf /format:detailed 的常见格式：每个 changeset 字段各占一行
  const stdout =
    'Changeset: 12345\n' +
    'User: alice\n' +
    'Date: 2026-07-07 10:00\n' +
    'Comment: foo\n' +
    '-----\n' +
    'Changeset: 12340\n' +
    'User: bob\n' +
    'Date: 2026-07-06\n' +
    'Comment: bar\n';
  const entries = parseHistoryEntries(stdout);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].changeset, '12345');
  assert.equal(entries[0].user, 'alice');
  assert.equal(entries[1].changeset, '12340');
});

test('history: 中文 tf.exe 的「用户」「注释」字段名', () => {
  const stdout =
    '变更集: 1\n用户: 张三\n日期: 2026-07-07\n注释: 你好\n';
  const entries = parseHistoryEntries(stdout);
  assert.equal(entries[0].user, '张三');
  assert.equal(entries[0].comment, '你好');
});

test('history: 第二次命中 5 分钟缓存', async () => {
  const stdout = 'Changeset: 1\nUser: alice\nDate: 2026-07-07\nComment: a\n';
  const firstCalls = [];

  // 第一次调用
  const { ctx, calls: c1 } = makeCtx({ stdout });
  firstCalls.push(c1);
  const r1 = await history({ inputPath: 'C:\\Foo.cs' }, ctx);
  assert.equal(r1.response.ok, true);
  assert.equal(r1.response.meta.cache_hit, false);
  assert.equal(c1.length, 1);

  // 第二次调用
  const { ctx: ctx2, calls: c2 } = makeCtx({ stdout });
  firstCalls.push(c2);
  const r2 = await history({ inputPath: 'C:\\Foo.cs' }, ctx2);
  assert.equal(r2.response.ok, true);
  assert.equal(r2.response.meta.cache_hit, true);
  // 缓存命中 → 不调 tf.exe
  assert.equal(c2.length, 0);
});

test('history: --today → 添加 /version:Dxxxx~Dxxxx', async () => {
  const { ctx, calls } = makeCtx({ stdout: '' });
  await history({ inputPath: 'C:\\Foo.cs', today: true }, ctx);
  const versionArg = calls[0].args.find((a) => a.startsWith('/version:'));
  assert.ok(versionArg, '应包含 /version:');
  assert.match(versionArg, /^\/version:D\d{4}-\d{2}-\d{2}~D\d{4}-\d{2}-\d{2}$/);
});

test('history: --since 7 days ago → 跳过缓存（query 形状变了）', async () => {
  const { ctx, calls } = makeCtx({ stdout: '' });
  await history({ inputPath: 'C:\\Foo.cs', since: '2026-07-01' }, ctx);
  assert.ok(calls[0].args.some((a) => a.startsWith('/version:D2026-07-01~D')));
});

test('history: --user → /user:<name>', async () => {
  const { ctx, calls } = makeCtx({ stdout: '' });
  await history({ inputPath: 'C:\\Foo.cs', user: 'bob' }, ctx);
  assert.ok(calls[0].args.includes('/user:bob'));
});

test('history: --mine → /user:<current>', async () => {
  const { ctx, calls } = makeCtx({ stdout: '' });
  await history({ inputPath: 'C:\\Foo.cs', mine: true }, ctx);
  assert.ok(calls[0].args.includes('/user:alice'));
});
