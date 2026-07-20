'use strict';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfgMod = require('../src/config');
const credMod = require('../src/credentials');
const { init } = require('../src/commands/init');

let tmpDir;
let customConfigPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-cli-init-'));
  customConfigPath = path.join(tmpDir, 'config.json');
  cfgMod.setConfigPath(customConfigPath);
});

after(() => cfgMod.resetConfigPath());

test('init: 缺 url/username/password 时报错且不写文件', async () => {
  const r = await init({});
  assert.equal(r.response.ok, false);
  // 不应写入 config
  assert.equal(fs.existsSync(customConfigPath), false);
});

test('init: 全非交互模式（命令行 + mock credentials）', async () => {
  // mock credentials.setPassword 防止真写 Windows 凭证库
  let setFor = null;
  const orig = credMod.setPassword;
  credMod.setPassword = async (u, p) => { setFor = { u, p }; };
  try {
    const r = await init({
      url: 'http://h:8080/tfs/ASS',
      username: 'alice',
      password: 'secret'
    });
    assert.equal(r.response.ok, true);
    assert.deepEqual(setFor, { u: 'alice', p: 'secret' });
    assert.equal(fs.existsSync(customConfigPath), true);
    const cfg = cfgMod.load();
    assert.equal(cfg.server, 'http://h:8080/tfs/ASS');
    assert.equal(cfg.username, 'alice');
    assert.equal(cfg.collection, 'ASS');
    assert.equal(cfg.password_ref, 'system-keyring:tfs-cli:alice');
  } finally {
    credMod.setPassword = orig;
  }
});
