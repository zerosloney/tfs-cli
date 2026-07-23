'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { TfExecutor } = require('../src/executor');

function makeSpawn({ stdout = '', stderr = '', exitCode = 0 } = {}) {
  const calls = [];
  const spawnFn = (cmd, args) => {
    calls.push({ cmd, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout, 'utf-8'));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr, 'utf-8'));
      child.emit('close', exitCode);
    });
    return child;
  };
  return { spawnFn, calls };
}

function makeCtx({ stdout = '', stderr = '', exitCode = 0, server = 'http://h:8080/tfs/ASS' } = {}) {
  const { spawnFn, calls } = makeSpawn({ stdout, stderr, exitCode });
  const config = { server, username: 'alice', domain: '', collection: 'ASS' };
  return {
    ctx: {
      config,
      password: 'secret',
      tfPath: 'tf.exe',
      executor: new TfExecutor({
        tfPath: 'tf.exe',
        username: config.username,
        password: 'secret',
        domain: config.domain,
        server: config.server,
        spawnFn
      }),
      startMs: Date.now()
    },
    calls
  };
}

// ────────── checkout ──────────

test('checkout: 成功', async () => {
  const { checkout } = require('../src/commands/checkout');
  const { ctx, calls } = makeCtx({ stdout: 'OK', exitCode: 0 });
  const r = await checkout({ inputPath: 'C:\\Foo\\Bar.cs' }, ctx);
  assert.equal(r.response.ok, true);
  assert.equal(r.exitCode, 0);
  assert.deepEqual(calls[0].args.slice(0, 3), ['checkout', 'C:\\Foo\\Bar.cs', '/login:alice,secret']);
  assert.ok(!calls[0].args.includes('/server:'), 'checkout 不应包含 /server:');
});

test('checkout: tf 失败 → ok=false', async () => {
  const { checkout } = require('../src/commands/checkout');
  const { ctx } = makeCtx({ stderr: 'unable to lock', exitCode: 1 });
  const r = await checkout({ inputPath: 'C:\\Bar.cs' }, ctx);
  assert.equal(r.response.ok, false);
  assert.equal(r.exitCode, 1);
});

test('checkout: MSYS 路径自动转 Windows', async () => {
  const { checkout } = require('../src/commands/checkout');
  const { ctx, calls } = makeCtx();
  await checkout({ inputPath: '/c/Foo/Bar.cs' }, ctx);
  assert.equal(calls[0].args[1], 'C:\\Foo\\Bar.cs');
});

// ────────── undo ──────────

test('undo: 调用 tf undo', async () => {
  const { undo } = require('../src/commands/undo');
  const { ctx, calls } = makeCtx();
  await undo({ inputPath: 'C:\\Bar.cs' }, ctx);
  assert.equal(calls[0].args[0], 'undo');
  assert.equal(calls[0].args[1], 'C:\\Bar.cs');
});

// ────────── edit (核心：冲突检测) ──────────

const { edit } = require('../src/commands/edit');

/**
 * 用两次 spawn 模拟：第一次 status（带 owner），第二次 checkout（不应该被调用），
 * 期待返回 CONFLICT。
 */
function makeEditCtx({ statusStdout, checkoutStdout = '', checkoutExit = 0, domain = '' }) {
  const calls = [];
  let i = 0;
  const spawnFn = (cmd, args) => {
    calls.push({ cmd, args });
    const stdout = i === 0 ? statusStdout : checkoutStdout;
    const exitCode = i === 0 ? 0 : checkoutExit;
    i++;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout, 'utf-8'));
      child.emit('close', exitCode);
    });
    return child;
  };
  const config = { server: 'http://h:8080/tfs/ASS', username: 'alice', domain, collection: 'ASS' };
  const ctx = {
    config,
    password: 'secret',
    tfPath: 'tf.exe',
    executor: new TfExecutor({
      tfPath: 'tf.exe',
      username: 'alice',
      password: 'secret',
      domain,
      server: 'http://h:8080/tfs/ASS',
      spawnFn
    }),
    startMs: Date.now()
  };
  return { ctx, calls };
}

test('edit: 文件未被签出 → 自动 checkout', async () => {
  const { ctx, calls } = makeEditCtx({ statusStdout: '' });
  const r = await edit({ inputPath: 'C:\\Foo.cs' }, ctx);
  assert.equal(r.response.ok, true);
  assert.equal(r.exitCode, 0);
  assert.equal(r.response.data.justCheckedOut, true);
  assert.equal(calls[1].args[0], 'checkout');
});

test('edit: 文件已被本用户签出 → alreadyCheckedOut=true，不调 checkout', async () => {
  const { ctx, calls } = makeEditCtx({
    statusStdout: '  File: C:\\Foo.cs\n  Change: edit\n  User: alice\n'
  });
  const r = await edit({ inputPath: 'C:\\Foo.cs' }, ctx);
  assert.equal(r.response.ok, true);
  assert.equal(r.response.data.alreadyCheckedOut, true);
  assert.equal(calls.length, 1, '不应触发 checkout');
});

test('edit: 被他人签出 → CONFLICT, exit 2', async () => {
  const { ctx } = makeEditCtx({
    statusStdout: '  File: C:\\Foo.cs\n  Change: edit\n  User: bob\n'
  });
  const r = await edit({ inputPath: 'C:\\Foo.cs' }, ctx);
  assert.equal(r.response.ok, false);
  assert.equal(r.response.error.code, 'CONFLICT');
  assert.equal(r.exitCode, 2);
  assert.equal(r.response.error.details.owner, 'bob');
});

test('edit: 跨域同名用户仍判定为 CONFLICT', async () => {
  const { ctx } = makeEditCtx({
    domain: 'CONTOSO',
    statusStdout: '  User: OTHERDOMAIN\\alice\n'
  });
  const r = await edit({ inputPath: 'C:\\Foo.cs' }, ctx);
  assert.equal(r.response.ok, false);
  assert.equal(r.response.error.code, 'CONFLICT');
  assert.equal(r.exitCode, 2);
  assert.equal(r.response.error.details.currentUser, 'CONTOSO\\alice');
});

test('edit: checkout 失败但重查发现被人签出 → CONFLICT', async () => {
  // 调用序：status(空) → checkout(失败) → status retry(charlie)
  const calls = [];
  let i = 0;
  const statuses = ['', '', '  User: charlie\n'];
  const spawnFn = (tfPath, args) => {
    calls.push({ tfPath, args });
    const stdout = statuses[i] || '';
    const isCheckout = args[0] === 'checkout';
    const exitCode = isCheckout ? 1 : 0;
    i++;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout, 'utf-8'));
      if (isCheckout) child.stderr.emit('data', Buffer.from('cannot lock', 'utf-8'));
      child.emit('close', exitCode);
    });
    return child;
  };
  const ctx = {
    config: { server: 'http://h', username: 'alice', domain: '', collection: 'ASS' },
    password: 's',
    tfPath: 'tf.exe',
    executor: new TfExecutor({
      tfPath: 'tf.exe', username: 'alice', password: 's', spawnFn
    }),
    startMs: Date.now()
  };
  const r = await edit({ inputPath: 'C:\\Foo.cs' }, ctx);
  assert.equal(r.response.ok, false);
  assert.equal(r.response.error.code, 'CONFLICT');
  assert.equal(r.exitCode, 2);
  assert.equal(r.response.error.details.owner, 'charlie');
});

test('edit: 新文件（磁盘存在但不在源代码管理）→ PATH_NOT_IN_WORKSPACE + hint', async () => {
  // 用真实临时文件让 fs.existsSync 为真，否则 edit 的新文件分支判据不成立
  const tmpFile = path.join(os.tmpdir(), `tfs-cli-edit-new-${process.pid}-${Date.now()}.sql`);
  fs.writeFileSync(tmpFile, '-- pending\n');
  try {
    const calls = [];
    let i = 0;
    // 调用序：status(空) → checkout(失败,stderr 命中"未能找到项") → status retry(空)
    const spawnFn = (tfPath, args) => {
      calls.push({ tfPath, args });
      const isCheckout = args[0] === 'checkout';
      i++;
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => {
        if (isCheckout) {
          child.stderr.emit('data', Buffer.from('在你的工作区中未能找到项 ' + tmpFile, 'utf-8'));
        }
        child.emit('close', isCheckout ? 1 : 0);
      });
      return child;
    };
    const ctx = {
      config: { server: 'http://h', username: 'alice', domain: '', collection: 'ASS' },
      password: 's', tfPath: 'tf.exe',
      executor: new TfExecutor({ tfPath: 'tf.exe', username: 'alice', password: 's', spawnFn }),
      startMs: Date.now()
    };
    const r = await edit({ inputPath: tmpFile }, ctx);
    assert.equal(r.response.ok, false);
    assert.equal(r.response.error.code, 'PATH_NOT_IN_WORKSPACE', '应识别为新文件而非 AUTH_FAILED');
    assert.equal(r.exitCode, 1);
    assert.equal(r.response.error.details.hint, 'tfs-cli add <path>');
    assert.equal(r.response.path, tmpFile);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('edit: checkout 失败但文件磁盘不存在 → 仍是 AUTH_FAILED（不是新文件分支）', async () => {
  // 文件磁盘不存在 → 不应进入新文件分支，维持 AUTH_FAILED
  const calls = [];
  const spawnFn = (tfPath, args) => {
    calls.push({ tfPath, args });
    const isCheckout = args[0] === 'checkout';
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (isCheckout) {
        child.stderr.emit('data', Buffer.from('在你的工作区中未能找到项', 'utf-8'));
      }
      child.emit('close', isCheckout ? 1 : 0);
    });
    return child;
  };
  const ctx = {
    config: { server: 'http://h', username: 'alice', domain: '', collection: 'ASS' },
    password: 's', tfPath: 'tf.exe',
    executor: new TfExecutor({ tfPath: 'tf.exe', username: 'alice', password: 's', spawnFn }),
    startMs: Date.now()
  };
  const r = await edit({ inputPath: 'C:\\Definitely\\Missing\\File.cs' }, ctx);
  assert.equal(r.response.ok, false);
  assert.equal(r.response.error.code, 'AUTH_FAILED', '磁盘不存在的文件不应判为新文件');
});

// ────────── add ──────────

test('add: 成功 → 带 /recursive', async () => {
  const { add } = require('../src/commands/add');
  const { ctx, calls } = makeCtx({ stdout: 'OK', exitCode: 0 });
  const r = await add({ inputPath: 'C:\\Foo\\New.cs' }, ctx);
  assert.equal(r.response.ok, true);
  assert.equal(r.exitCode, 0);
  assert.equal(r.response.data.status, 'added');
  assert.ok(calls[0].args.includes('/recursive'), 'add 应带 /recursive');
  assert.deepEqual(calls[0].args.slice(0, 2), ['add', 'C:\\Foo\\New.cs']);
  assert.ok(!calls[0].args.some((a) => a.startsWith('/server:')), 'add 不应包含 /server:');
});

test('add: tf 失败 → PATH_NOT_IN_WORKSPACE', async () => {
  const { add } = require('../src/commands/add');
  const { ctx } = makeCtx({ stderr: 'no items found', exitCode: 1 });
  const r = await add({ inputPath: 'C:\\Foo\\New.cs' }, ctx);
  assert.equal(r.response.ok, false);
  assert.equal(r.response.error.code, 'PATH_NOT_IN_WORKSPACE');
  assert.equal(r.exitCode, 1);
});

// ────────── status (parsing) ──────────

test('status: 解析 + 加 2 个空格分隔的列为 entry', async () => {
  const { status } = require('../src/commands/status');
  const sample =
    '$/MyWorkspace:\n' +
    'C:\\Projects\\Foo.cs  edit  alice\n' +
    'C:\\Projects\\New.cs  add   \n' +
    '====\n' +
    'No changes\n';
  const { ctx } = makeCtx({ stdout: sample });
  const r = await status({ inputPath: '.' }, ctx);
  assert.equal(r.response.ok, true);
  assert.equal(r.response.data.pending.length, 2);
  assert.equal(r.response.data.pending[0].file, 'C:\\Projects\\Foo.cs');
  assert.equal(r.response.data.pending[0].owner, 'alice');
  assert.equal(r.response.data.pending[0].change, 'edit');
});

test('status: 无 pending 改动 → count=0, ok=true', async () => {
  const { status } = require('../src/commands/status');
  const { ctx } = makeCtx({ stdout: 'There are no pending changes.\n=========\n' });
  const r = await status({ inputPath: '.' }, ctx);
  assert.equal(r.response.ok, true);
  assert.equal(r.response.data.count, 0);
  assert.equal(r.response.data.pending.length, 0);
});

// ────────── getlatest ──────────

test('getlatest: 默认路径为 .', async () => {
  const { getlatest } = require('../src/commands/getlatest');
  const { ctx, calls } = makeCtx();
  await getlatest({}, ctx);
  assert.equal(calls[0].args[1], '.');
  assert.ok(calls[0].args.includes('/recursive'));
  assert.ok(!calls[0].args.some((a) => a.startsWith('/server:')), 'getlatest 不应包含 /server:');
});

test('getlatest: 指定路径转 Windows 后传入', async () => {
  const { getlatest } = require('../src/commands/getlatest');
  const { ctx, calls } = makeCtx();
  await getlatest({ inputPath: '/c/Projects' }, ctx);
  assert.equal(calls[0].args[1], 'C:\\Projects');
});

// ────────── diff ──────────

test('diff: 调用 /format:unified', async () => {
  const { diff } = require('../src/commands/diff');
  const { ctx, calls } = makeCtx({ stdout: '--- a/foo.cs\n+++ b/foo.cs\n@@ -1 +1 @@\n-x\n+y\n' });
  const r = await diff({}, ctx);
  assert.equal(r.response.ok, true);
  assert.match(r.response.data.unified, /--- a\/foo\.cs/);
  assert.ok(calls[0].args.includes('/format:unified'));
});

// ────────── test connection ──────────

test('test: workspaces 成功 → reachable=true', async () => {
  const { testConnection } = require('../src/commands/test-connection');
  const { ctx, calls } = makeCtx({ stdout: 'Workspace1  alice  COMPUTER\nWorkspace2  bob    COMPUTER\n' });
  const r = await testConnection({}, ctx);
  assert.equal(r.response.ok, true);
  assert.equal(r.response.data.reachable, true);
  // collection arg 应该是 /collection:http://h:8080/tfs/ASS
  assert.ok(calls[0].args.includes('/collection:http://h:8080/tfs/ASS'));
  assert.ok(!calls[0].args.some((a) => a.startsWith('/server:')), 'workspaces 不应包含 /server:');
});

test('test: workspaces 失败 → AUTH_FAILED', async () => {
  const { testConnection } = require('../src/commands/test-connection');
  const { ctx } = makeCtx({ stderr: 'TF30063: unauthorized', exitCode: 1 });
  const r = await testConnection({}, ctx);
  assert.equal(r.response.ok, false);
  assert.equal(r.response.error.code, 'AUTH_FAILED');
});

// ────────── J1 回归：失败响应 duration_ms 不再恒为 0 ──────────

test('J1: 失败响应的 meta.duration_ms 反映真实耗时（不再恒为 0）', async () => {
  // 用 fake spawn 模拟耗时：startMs 早于 fail() 调用时刻 → duration_ms > 0
  const { checkout } = require('../src/commands/checkout');
  const startMs = Date.now() - 100; // 模拟命令已运行 100ms
  const calls = [];
  const slowSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('locked', 'utf-8'));
      child.emit('close', 1);
    });
    return child;
  };
  const ctx = {
    config: { server: 'http://h', username: 'alice', domain: '', collection: 'ASS' },
    password: 's', tfPath: 'tf.exe',
    executor: new (require('../src/executor').TfExecutor)({
      tfPath: 'tf.exe', username: 'alice', password: 's', spawnFn: slowSpawn
    }),
    startMs
  };
  const r = await checkout({ inputPath: 'C:\\Foo.cs' }, ctx);
  assert.equal(r.response.ok, false);
  assert.ok(
    r.response.meta.duration_ms >= 50,
    `duration_ms 应反映真实耗时（≥50ms），实际 ${r.response.meta.duration_ms}（修复前恒为 0）`
  );
});
