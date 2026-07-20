'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { TfExecutor, extractOwner, sameUser } = require('../src/executor');
const { CliError } = require('../src/errors');

/**
 * 构造一个 fake child_process 对象：
 *   stdout.on('data') / stderr.on('data') / on('close') / on('error')
 * 手动 emit 数据然后 close。
 */
class FakeChild extends EventEmitter {
  constructor(stdout = '', stderr = '', exitCode = 0) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this._stdoutBuf = stdout;
    this._stderrBuf = stderr;
    this._exitCode = exitCode;
  }
  emitAll() {
    if (this._stdoutBuf) this.stdout.emit('data', Buffer.from(this._stdoutBuf, 'utf-8'));
    if (this._stderrBuf) this.stderr.emit('data', Buffer.from(this._stderrBuf, 'utf-8'));
    this.emit('close', this._exitCode);
  }
}

function spawnFnFor({ stdout = '', stderr = '', exitCode = 0 } = {}) {
  return () => {
    const child = new FakeChild(stdout, stderr, exitCode);
    setImmediate(() => child.emitAll());
    return child;
  };
}

test('TfExecutor: 构造缺参数报错', () => {
  assert.throws(() => new TfExecutor({ tfPath: 'tf.exe' }), (e) => e instanceof CliError);
  assert.throws(() => new TfExecutor({ tfPath: 'tf.exe', username: 'a' }), (e) => e instanceof CliError);
});

test('TfExecutor: 构造 login arg 拼接', () => {
  const exec = new TfExecutor({
    tfPath: 'tf.exe',
    username: 'alice',
    password: 'secret',
    spawnFn: () => { throw new Error('should not call'); }
  });
  assert.equal(exec._loginArg(), '/login:alice,secret');
});

test('TfExecutor: 带 domain 时 login 拼接 DOMAIN\\user', () => {
  const exec = new TfExecutor({
    tfPath: 'tf.exe',
    username: 'alice',
    password: 'secret',
    domain: 'CONTOSO',
    spawnFn: () => { throw new Error('should not call'); }
  });
  assert.equal(exec._loginArg(), '/login:CONTOSO\\alice,secret');
});

test('TfExecutor.run: 拼 login + noprompt + server arg', async () => {
  let capturedArgs = null;
  const fakeRun = (cmd, args) => {
    capturedArgs = args;
    return new FakeChild('', '', 0);
  };
  // 把 emit 排队，让 promise 解析
  fakeRun.withFake = () => {
    const child = new FakeChild('', '', 0);
    setImmediate(() => child.emitAll());
    return child;
  };
  const exec = new TfExecutor({
    tfPath: 'tf.exe',
    username: 'alice',
    password: 'secret',
    server: 'http://h:8080/tfs/ASS',
    spawnFn: (cmd, args) => {
      capturedArgs = args;
      const c = new FakeChild('', '', 0);
      setImmediate(() => c.emitAll());
      return c;
    }
  });
  const r = await exec.run(['checkout', 'C:\\foo.cs'], { includeServer: false });
  assert.equal(r.ok, true);
  assert.ok(capturedArgs.includes('/login:alice,secret'));
  assert.ok(capturedArgs.includes('/noprompt'));
  assert.ok(!capturedArgs.some((a) => a.startsWith('/server:')), 'includeServer=false 时不应包含 /server:');
});

test('TfExecutor.run: includeServer=true 时附加 /server:', async () => {
  let capturedArgs = null;
  const exec = new TfExecutor({
    tfPath: 'tf.exe',
    username: 'a',
    password: 's',
    server: 'http://h:8080/tfs/ASS',
    spawnFn: (cmd, args) => {
      capturedArgs = args;
      const c = new FakeChild('', '', 0);
      setImmediate(() => c.emitAll());
      return c;
    }
  });
  await exec.run(['status', '.']);
  assert.ok(capturedArgs.includes('/server:http://h:8080/tfs/ASS'));
});

test('TfExecutor.run: 退出码非 0 → ok=false', async () => {
  const exec = new TfExecutor({
    tfPath: 'tf.exe',
    username: 'a',
    password: 's',
    spawnFn: () => {
      const c = new FakeChild('', 'ERROR: locked', 1);
      setImmediate(() => c.emitAll());
      return c;
    }
  });
  const r = await exec.run(['checkout', 'C:\\foo.cs']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /locked/);
});

test('extractOwner: 英文格式', () => {
  assert.equal(extractOwner('  User: bob\n  Date: 2026-07-07'), 'bob');
});

test('extractOwner: 中文格式（中文 tf.exe 用「用户:」）', () => {
  assert.equal(extractOwner('  用户: 张三\n  日期: 2026-07-07'), '张三');
});

test('extractOwner: 含 DOMAIN\\user', () => {
  assert.equal(extractOwner('User: CONTOSO\\alice'), 'CONTOSO\\alice');
});

test('extractOwner: 无 owner 返回 null', () => {
  assert.equal(extractOwner('No lock here\n=========\nNothing changed'), null);
});

test('sameUser: 忽略 domain/@ 大小写', () => {
  assert.equal(sameUser('CONTOSO\\alice', 'alice'), true);
  assert.equal(sameUser('Alice@contoso.com', 'alice'), true);
  assert.equal(sameUser('Alice', 'alice@contoso.com'), true);
  assert.equal(sameUser('alice', 'bob'), false);
  assert.equal(sameUser('', 'alice'), false);
  assert.equal(sameUser('alice', null), false);
});
