'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfgMod = require('../src/config');
let tmpDir;
let customConfigPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-cli-cfg-show-'));
  customConfigPath = path.join(tmpDir, 'config.json');
  cfgMod.setConfigPath(customConfigPath);
});

after(() => cfgMod.resetConfigPath());

// ────────── config show ──────────

const cfgCmd = require('../src/commands/config');

test('config show: 无配置抛 CONFIG_MISSING', async () => {
  const r = await cfgCmd.show();
  assert.equal(r.response.ok, false);
  assert.equal(r.response.error.code, 'CONFIG_MISSING');
});

test('config show: 有配置时返回', async () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const r = await cfgCmd.show();
  assert.equal(r.response.ok, true);
  assert.equal(r.response.data.config.server, 'http://h:8080/tfs/ASS');
});

// ────────── config set ──────────

test('config set: 改 server 自动重推 collection', async () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const r = await cfgCmd.set('server', 'http://h:8080/tfs/MES');
  assert.equal(r.response.ok, true);
  const loaded = cfgMod.load();
  assert.equal(loaded.collection, 'MES');
});

test('config set: 改 username 同步 password_ref', async () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const r = await cfgCmd.set('username', 'bob');
  assert.equal(r.response.ok, true);
  const loaded = cfgMod.load();
  assert.equal(loaded.password_ref, 'system-keyring:tfs-cli:bob');
});

test('config set: 不可设置的 key 报错', async () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const r = await cfgCmd.set('password_ref', 'plain-pwd');
  assert.equal(r.response.ok, false);
});

// ────────── config reset ──────────

test('config reset: 删除配置文件 + 调用 credentials.delete', async () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  // mock credentials.deletePassword — 我们不真实跑
  const credMod = require('../src/credentials');
  let deletedFor = null;
  const orig = credMod.deletePassword;
  credMod.deletePassword = (u) => { deletedFor = u; return true; };
  try {
    const r = await cfgCmd.reset();
    assert.equal(r.response.ok, true);
    assert.equal(deletedFor, 'alice');
    assert.equal(cfgMod.tryLoad(), null);
  } finally {
    credMod.deletePassword = orig;
  }
});
