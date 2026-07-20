'use strict';

/**
 * CLI 集成测试 —— 走 main(argv) → commander → makeRunner 完整路径。
 *
 * 单元测试只调 handler 函数（checkout(opts, ctx) 等），绕过了 makeRunner，
 * 因此 C1 类（参数错位）和 M1 类（双重包装）集成层 bug 测不到。本文件补这个缺口。
 *
 * 用 setConfigPath + 注入 fake TfExecutor + mock credentials/detect 来隔离外部依赖。
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfgMod = require('../src/config');

// history 缓存文件在用户家目录，必须每个测试前后清理，避免污染真实 CLI 环境
const CACHE_PATH = path.join(os.homedir(), '.tfs_cli_history_cache.json');

let tmpDir;
let cfgPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-cli-int-'));
  cfgPath = path.join(tmpDir, 'config.json');
  cfgMod.setConfigPath(cfgPath);
  if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
});

afterEach(() => {
  cfgMod.resetConfigPath();
  if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
});

/**
 * 捕获 main(argv) 的 stdout 输出并解析为 JSON。
 * makeRunner 末尾会 process.exit，所以包在子进程里跑。
 * mockScript 可选：在 main 之前注入的 mock 代码（字符串），用于 mock tf-detect/executor。
 */
function runCli(argv, mockScript = '') {
  const { execFileSync } = require('child_process');
  const launcher = path.join(tmpDir, '_launcher.js');
  const projectRoot = process.cwd().replace(/\\/g, '/');
  fs.writeFileSync(
    launcher,
    `require('${projectRoot}/src/config').setConfigPath(${JSON.stringify(cfgPath)});\n` +
    `require('${projectRoot}/src/credentials').setPassword = async () => {};\n` +
    `require('${projectRoot}/src/credentials').getPassword = () => 'mock-password';\n` +
    `require('${projectRoot}/src/credentials').deletePassword = () => true;\n` +
    mockScript +
    `require('${projectRoot}/src/index').main(${JSON.stringify(argv)});\n`
  );
  let stdout = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(process.execPath, [launcher], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    stdout = e.stdout || '';
    exitCode = e.status ?? 1;
  }
  return { stdout, exitCode };
}

// ────────── C1: config set 参数传递 ──────────

test('CLI: config set <key> <value> 正确写入（C1 回归）', () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const { stdout, exitCode } = runCli(['node', 'tfs-cli', 'config', 'set', 'server', 'http://h:8080/tfs/MES']);
  assert.equal(exitCode, 0);
  const r = JSON.parse(stdout);
  assert.equal(r.ok, true);
  assert.equal(r.data.operation, 'set');
  assert.equal(r.data.key, 'server');
  assert.equal(r.data.value, 'http://h:8080/tfs/MES');
  // 实际写入：collection 应被自动重推
  assert.equal(cfgMod.load().server, 'http://h:8080/tfs/MES');
  assert.equal(cfgMod.load().collection, 'MES');
});

test('CLI: config set 不可设置的 key 报错且不崩溃', () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const { stdout, exitCode } = runCli(['node', 'tfs-cli', 'config', 'set', 'bogus', 'x']);
  const r = JSON.parse(stdout);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'INVALID_ARGS');
  assert.ok(exitCode !== 0);
});

test('CLI: config show 走完整路径', () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const { stdout } = runCli(['node', 'tfs-cli', 'config', 'show']);
  const r = JSON.parse(stdout);
  assert.equal(r.ok, true);
  assert.equal(r.data.config.server, 'http://h:8080/tfs/ASS');
});

test('CLI: 默认输出 compact JSON（单行无缩进）', () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const { stdout } = runCli(['node', 'tfs-cli', 'config', 'show']);
  // 去掉末尾换行后应为单行（makeRunner 总在末尾加 \n）
  const body = stdout.replace(/\n$/, '');
  assert.ok(!body.includes('\n'), 'compact 应为单行');
  assert.ok(body.includes('"ok":true'), '键值间无空格');
});

test('CLI: --pretty 输出带缩进的 JSON', () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const { stdout } = runCli(['node', 'tfs-cli', '--pretty', 'config', 'show']);
  assert.ok(stdout.includes('\n'), 'pretty 应多行');
  assert.ok(stdout.includes('"ok": true'), '键值间有空格');
  // 仍是合法 JSON
  const r = JSON.parse(stdout);
  assert.equal(r.ok, true);
});

test('CLI: --text 输出人类可读短句', () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const { stdout } = runCli(['node', 'tfs-cli', '--text', 'config', 'show']);
  assert.ok(!stdout.startsWith('{'), '不应是 JSON');
  assert.match(stdout, /\[tfs-cli\]/);
});

test('CLI: inject 收集重复 --agent 参数', () => {
  const { stdout, exitCode } = runCli([
    'node', 'tfs-cli', 'inject', '--dry-run', '--target', tmpDir,
    '--agent', 'claude', '--agent', 'trae'
  ]);
  assert.equal(exitCode, 0);
  const r = JSON.parse(stdout);
  assert.deepEqual(r.data.written.map((w) => w.agent), ['claude', 'trae']);
});

test('CLI: inject 快捷 --trae flag 等同于 -a trae', () => {
  const { stdout, exitCode } = runCli([
    'node', 'tfs-cli', 'inject', '--dry-run', '--target', tmpDir, '--trae'
  ]);
  assert.equal(exitCode, 0);
  const r = JSON.parse(stdout);
  assert.deepEqual(r.data.written.map((w) => w.agent), ['trae']);
});

test('CLI: inject 快捷 flag 与 -a 可混用并去重', () => {
  // --trae + -a claude + -a trae → claude, trae（去重）
  const { stdout, exitCode } = runCli([
    'node', 'tfs-cli', 'inject', '--dry-run', '--target', tmpDir,
    '--trae', '-a', 'claude', '-a', 'trae'
  ]);
  assert.equal(exitCode, 0);
  const r = JSON.parse(stdout);
  assert.deepEqual(r.data.written.map((w) => w.agent), ['claude', 'trae']);
});

test('CLI: 异步非 CliError 输出结构化 INTERNAL_ERROR', () => {
  const projectRoot = process.cwd().replace(/\\/g, '/');
  const mockScript =
    `require('${projectRoot}/src/commands/inject').inject = async () => { throw new Error('disk failure'); };\n`;
  const { stdout, exitCode } = runCli(
    ['node', 'tfs-cli', 'inject', '--dry-run', '--target', tmpDir],
    mockScript
  );
  assert.equal(exitCode, 1);
  const r = JSON.parse(stdout);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'INTERNAL_ERROR');
  assert.match(r.error.message, /disk failure/);
});

test('CLI: CONFIG_MISSING 使用退出码 3', () => {
  const { stdout, exitCode } = runCli(['node', 'tfs-cli', 'config', 'show']);
  assert.equal(exitCode, 3);
  assert.equal(JSON.parse(stdout).error.code, 'CONFIG_MISSING');
});

test('CLI: TF_NOT_FOUND 使用退出码 4', () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const projectRoot = process.cwd().replace(/\\/g, '/');
  const mockScript =
    `const { CliError, ERROR_CODES } = require('${projectRoot}/src/errors');\n` +
    `require('${projectRoot}/src/tf-detect').detect = () => { throw new CliError(ERROR_CODES.TF_NOT_FOUND, 'missing tf'); };\n`;
  const { stdout, exitCode } = runCli(
    ['node', 'tfs-cli', 'checkout', 'C:\\Foo.cs'],
    mockScript
  );
  assert.equal(exitCode, 4);
  assert.equal(JSON.parse(stdout).error.code, 'TF_NOT_FOUND');
});

// ────────── M1: history 不再双重 withExecutor ──────────

test('CLI: history 命令不重复调用 preflight（M1 回归）', () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  // mock 写在子进程里：detect 计数 + TfExecutor.run 返回空成功
  // 计数写入临时文件，父进程读取断言
  const counterFile = path.join(tmpDir, 'detect_count.txt');
  const mockScript =
    `process.env.TFS_NO_CACHE = '1';\n` +
    `const tfDetect = require('${process.cwd().replace(/\\/g, '/')}/src/tf-detect');\n` +
    `let n = 0;\n` +
    `tfDetect.detect = () => { n++; return 'mock-tf.exe'; };\n` +
    `const TfExecutor = require('${process.cwd().replace(/\\/g, '/')}/src/executor').TfExecutor;\n` +
    `TfExecutor.prototype.run = async () => ({ ok: true, exitCode: 0, stdout: '', stderr: '', durationMs: 1 });\n` +
    `process.on('exit', () => require('fs').writeFileSync(${JSON.stringify(counterFile)}, String(n)));\n`;
  const { stdout, exitCode } = runCli(['node', 'tfs-cli', 'history', 'C:\\Foo.cs'], mockScript);
  const r = JSON.parse(stdout);
  assert.equal(exitCode, 0);
  assert.equal(r.ok, true);
  const detectCalls = parseInt(fs.readFileSync(counterFile, 'utf-8'), 10);
  assert.equal(detectCalls, 1, 'detect 应只调 1 次（修复前是 2 次）');
});

// ────────── M2: history 缓存命中 count 正确 ──────────

test('CLI: history 缓存命中时 count 与 entries.length 一致（M2 回归）', async () => {
  const { history } = require('../src/commands/history');
  const stdout = 'Changeset: 1\nUser: alice\nDate: 2026-07-07\nComment: a\n';
  const { EventEmitter } = require('events');
  const { TfExecutor } = require('../src/executor');
  const fakeSpawn = () => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    setImmediate(() => {
      c.stdout.emit('data', Buffer.from(stdout, 'utf-8'));
      c.emit('close', 0);
    });
    return c;
  };
  const makeCtx = () => ({
    config: { server: 'http://h', username: 'alice', domain: '', collection: 'ASS' },
    password: 's', tfPath: 'tf.exe',
    executor: new TfExecutor({ tfPath: 'tf.exe', username: 'alice', password: 's', spawnFn: fakeSpawn }),
    startMs: Date.now()
  });

  // 第一次：写缓存（缓存清理由 beforeEach/afterEach 统一负责）
  await history({ inputPath: 'C:\\Foo.cs' }, makeCtx());
  // 第二次：命中缓存
  const r2 = await history({ inputPath: 'C:\\Foo.cs' }, makeCtx());
  assert.equal(r2.response.meta.cache_hit, true);
  assert.equal(r2.response.data.count, r2.response.data.entries.length, 'count 应等于 entries 数');
  assert.ok(r2.response.data.count > 0, '应有条目');
});

// ────────── M3: limit 与 /version 同时存在也生效 ──────────

test('CLI: history --range + --limit 同时存在 → /stopafter 仍被加上（M3 回归）', async () => {
  const { history } = require('../src/commands/history');
  let capturedArgs = null;
  const { EventEmitter } = require('events');
  const { TfExecutor } = require('../src/executor');
  const fakeSpawn = (cmd, args) => {
    capturedArgs = args;
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    setImmediate(() => c.emit('close', 0));
    return c;
  };
  const ctx = {
    config: { server: 'http://h', username: 'alice', domain: '', collection: 'ASS' },
    password: 's', tfPath: 'tf.exe',
    executor: new TfExecutor({ tfPath: 'tf.exe', username: 'alice', password: 's', spawnFn: fakeSpawn }),
    startMs: Date.now()
  };
  // --range 的查询形状跳过缓存，不写缓存文件；清理由 afterEach 兜底
  await history({ inputPath: 'C:\\Foo.cs', range: 'D2026-01-01~D2026-01-02', limit: 5 }, ctx);
  assert.ok(capturedArgs.some((a) => a.startsWith('/stopafter:5')), '应同时含 /stopafter:5');
  assert.ok(capturedArgs.some((a) => a.startsWith('/version:')), '应含 /version:');
});
