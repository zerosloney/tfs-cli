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

test('config set: 改 username 被拒绝（防止凭证引用失效）', async () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const r = await cfgCmd.set('username', 'bob');
  assert.equal(r.response.ok, false);
  assert.equal(r.response.error.code, 'INVALID_ARGS');
  assert.match(r.response.error.message, /tfs-cli init/);
  // 配置不应被修改
  const loaded = cfgMod.load();
  assert.equal(loaded.username, 'alice');
});

test('config set: 不可设置的 key 报错', async () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const r = await cfgCmd.set('password_ref', 'plain-pwd');
  assert.equal(r.response.ok, false);
});

// ────────── config reset ──────────

test('config reset: 删除失败且凭证仍存在时保留配置', async () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const credMod = require('../src/credentials');
  const originalDelete = credMod.deletePassword;
  const originalHas = credMod.hasPassword;
  credMod.deletePassword = () => false;
  credMod.hasPassword = () => true;
  try {
    const r = await cfgCmd.reset();
    assert.equal(r.response.ok, false);
    assert.equal(r.response.error.code, 'INTERNAL_ERROR');
    assert.ok(cfgMod.tryLoad(), '删除凭证失败时必须保留配置');
  } finally {
    credMod.deletePassword = originalDelete;
    credMod.hasPassword = originalHas;
  }
});

test('config reset: 凭证本就不存在时仍可删除配置', async () => {
  cfgMod.save(cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' }));
  const credMod = require('../src/credentials');
  const originalDelete = credMod.deletePassword;
  const originalHas = credMod.hasPassword;
  credMod.deletePassword = () => false;
  credMod.hasPassword = () => false;
  try {
    const r = await cfgCmd.reset();
    assert.equal(r.response.ok, true);
    assert.equal(cfgMod.tryLoad(), null);
  } finally {
    credMod.deletePassword = originalDelete;
    credMod.hasPassword = originalHas;
  }
});
