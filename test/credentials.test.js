'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const credentials = require('../src/credentials');
const { CliError } = require('../src/errors');

function fakeSpawnSync(result = {}) {
  return () => ({ status: 0, stdout: '', stderr: '', error: undefined, ...result });
}

function fakeSpawn(exitCode = 0) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', exitCode));
    return child;
  };
}

test('target: 拼接正确', () => {
  assert.equal(credentials.target('alice'), 'tfs-cli:alice');
});

test('setPassword: 通过注入的 cmdkey spawn 写入', async () => {
  let call;
  const spawn = (command, args, opts) => {
    call = { command, args, opts };
    return fakeSpawn(0)();
  };

  await credentials.setPassword('alice', 'secret', { spawn });
  assert.equal(call.command, 'cmdkey');
  assert.deepEqual(call.args, ['/generic:tfs-cli:alice', '/user:alice', '/pass:secret']);
});

test('setPassword: cmdkey 失败返回 INTERNAL_ERROR', async () => {
  await assert.rejects(
    () => credentials.setPassword('alice', 'secret', { spawn: fakeSpawn(1) }),
    (e) => e instanceof CliError && e.code === 'INTERNAL_ERROR'
  );
});

test('getPassword: PowerShell -File 执行并解码 Unicode 密码', () => {
  const password = '密 码!';
  let call;
  const spawnSync = (command, args, opts) => {
    call = { command, args, opts };
    return {
      status: 0,
      stdout: 'FOUND:' + Buffer.from(password, 'utf-8').toString('base64'),
      stderr: ''
    };
  };

  assert.equal(credentials.getPassword('alice', { spawnSync }), password);
  assert.equal(call.command, 'powershell.exe');
  assert.equal(call.args[0], '-NoProfile');
  assert.equal(call.args[1], '-NonInteractive');
  assert.equal(call.args[2], '-File');
  assert.match(call.args[3], /tfs-cli-cred-.*\.ps1$/);
  assert.equal(call.opts.env.TFS_CLI_CRED_TARGET, 'tfs-cli:alice');
  assert.ok(!call.args.join(' ').includes('alice'), 'target 不应进入 PowerShell 命令行');
});

test('getPassword: 凭证不存在返回 CREDENTIAL_MISSING', () => {
  assert.throws(
    () => credentials.getPassword('alice', {
      spawnSync: fakeSpawnSync({ status: 2, stdout: 'NOT_FOUND' })
    }),
    (e) => e instanceof CliError && e.code === 'CREDENTIAL_MISSING'
  );
});

test('getPassword: PowerShell 失败返回 INTERNAL_ERROR', () => {
  assert.throws(
    () => credentials.getPassword('alice', {
      spawnSync: fakeSpawnSync({ status: 1, stderr: 'denied' })
    }),
    (e) => e instanceof CliError && e.code === 'INTERNAL_ERROR'
  );
});

test('hasPassword: 使用 CredReadW 结果判断', () => {
  assert.equal(credentials.hasPassword('alice', {
    spawnSync: fakeSpawnSync({ stdout: 'FOUND:c2VjcmV0' })
  }), true);
  assert.equal(credentials.hasPassword('alice', {
    spawnSync: fakeSpawnSync({ status: 2, stdout: 'NOT_FOUND' })
  }), false);
});

test('hasPassword: 无法检查时不伪装成不存在', () => {
  assert.throws(
    () => credentials.hasPassword('alice', {
      spawnSync: fakeSpawnSync({ status: 1, stderr: 'PowerShell unavailable' })
    }),
    (e) => e instanceof CliError && e.code === 'INTERNAL_ERROR'
  );
});

test('deletePassword: 根据 cmdkey 退出码返回布尔值', () => {
  assert.equal(credentials.deletePassword('alice', {
    spawnSync: fakeSpawnSync({ status: 0 })
  }), true);
  assert.equal(credentials.deletePassword('alice', {
    spawnSync: fakeSpawnSync({ status: 1 })
  }), false);
});

test('credentials: 空 username 抛 INVALID_ARGS', () => {
  assert.throws(
    () => credentials.deletePassword(''),
    (e) => e instanceof CliError && e.code === 'INVALID_ARGS'
  );
});
