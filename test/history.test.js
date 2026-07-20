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

function makeCtx({ stdout = '', exitCode = 0, server } = {}) {
  const srv = server || 'http://h:8080/tfs/ASS';
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
      config: { server: srv, username: 'alice', domain: '', collection: 'ASS' },
      password: 's',
      tfPath: 'tf.exe',
      executor: new TfExecutor({
        tfPath: 'tf.exe', username: 'alice', password: 's', server: srv, spawnFn
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

  // 第二次调用（相同 server/username → 缓存 key 一致）
  const { ctx: ctx2, calls: c2 } = makeCtx({ stdout });
  firstCalls.push(c2);
  const r2 = await history({ inputPath: 'C:\\Foo.cs' }, ctx2);
  assert.equal(r2.response.ok, true);
  assert.equal(r2.response.meta.cache_hit, true);
  // 缓存命中 → 不调 tf.exe
  assert.equal(c2.length, 0);
});

test('history: 不同 server 不共享缓存', async () => {
  const stdout = 'Changeset: 1\nUser: alice\nDate: 2026-07-07\nComment: a\n';
  const { ctx, calls: c1 } = makeCtx({ stdout });
  await history({ inputPath: 'C:\\Foo.cs' }, ctx);
  // 不同 server
  const { ctx: ctx2, calls: c2 } = makeCtx({ stdout, server: 'http://other:8080/tfs/OTHER' });
  const r2 = await history({ inputPath: 'C:\\Foo.cs' }, ctx2);
  assert.equal(r2.response.meta.cache_hit, false);
  assert.equal(c2.length, 1, '不同 server 不应命中缓存');
});

test('history: 显式 --limit 跳过缓存', async () => {
  const stdout = 'Changeset: 1\nUser: alice\nDate: 2026-07-07\nComment: a\n';
  const { ctx, calls: c1 } = makeCtx({ stdout });
  await history({ inputPath: 'C:\\Foo.cs', limit: 5 }, ctx);
  // 带 limit 的查询不应写缓存；第二次同限也应不命中
  const { ctx: ctx2, calls: c2 } = makeCtx({ stdout });
  const r2 = await history({ inputPath: 'C:\\Foo.cs', limit: 5 }, ctx2);
  assert.equal(r2.response.meta.cache_hit, false);
  assert.equal(c2.length, 1, '显式 limit 查询跳过缓存');
});

test('history: 默认 limit 10（无 version range 时）', async () => {
  const { ctx, calls } = makeCtx({ stdout: '' });
  await history({ inputPath: 'C:\\Foo.cs' }, ctx);
  assert.ok(calls[0].args.includes('/stopafter:10'), '默认应加 /stopafter:10');
});

test('history: --range 正确规范化两端并使用 /collection', async () => {
  const { ctx, calls } = makeCtx({ stdout: '' });
  await history({ inputPath: 'C:\\Foo.cs', range: '2026-01-01~2026-01-31' }, ctx);
  assert.ok(calls[0].args.includes('/version:D2026-01-01~D2026-01-31'));
  assert.ok(calls[0].args.includes('/collection:http://h:8080/tfs/ASS'));
  assert.ok(!calls[0].args.some((a) => a.startsWith('/server:')));
  assert.ok(!calls[0].args.some((a) => a.startsWith('/stopafter:')), '有 range 时不加默认 /stopafter');
});

test('history: --limit 0 拒绝', async () => {
  await assert.rejects(
    () => history({ inputPath: 'C:\\Foo.cs', limit: 0 }, makeCtx().ctx),
    (e) => e.code === 'INVALID_ARGS'
  );
});

test('history: --limit 负数拒绝', async () => {
  await assert.rejects(
    () => history({ inputPath: 'C:\\Foo.cs', limit: -5 }, makeCtx().ctx),
    (e) => e.code === 'INVALID_ARGS'
  );
});

test('history: --range 拒绝非法日期格式', async () => {
  await assert.rejects(
    () => history({ inputPath: 'C:\\Foo.cs', range: 'abc~def' }, makeCtx().ctx),
    (e) => e.code === 'INVALID_ARGS'
  );
});

test('history: --range 拒绝无效日期（如 2026-13-01）', async () => {
  await assert.rejects(
    () => history({ inputPath: 'C:\\Foo.cs', range: 'D2026-13-01~D2026-01-31' }, makeCtx().ctx),
    (e) => e.code === 'INVALID_ARGS'
  );
});

test('history: --range 拒绝起始日期晚于结束日期', async () => {
  await assert.rejects(
    () => history({ inputPath: 'C:\\Foo.cs', range: 'D2026-06-01~D2026-01-01' }, makeCtx().ctx),
    (e) => e.code === 'INVALID_ARGS'
  );
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
