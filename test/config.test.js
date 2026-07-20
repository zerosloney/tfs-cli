'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfgMod = require('../src/config');
const { CliError } = require('../src/errors');

let tmpDir;
let customConfigPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-cli-cfg-'));
  customConfigPath = path.join(tmpDir, 'tfs-cli-config.json');
  cfgMod.setConfigPath(customConfigPath);
});

after(() => {
  cfgMod.resetConfigPath();
});

test('build: 推导 collection', () => {
  const c = cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' });
  assert.equal(c.version, 1);
  assert.equal(c.collection, 'ASS');
  assert.equal(c.username, 'alice');
  assert.equal(c.password_ref, 'system-keyring:tfs-cli:alice');
});

test('build: collection 显式传入优先', () => {
  const c = cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice', collection: 'OVERRIDE' });
  assert.equal(c.collection, 'OVERRIDE');
});

test('validate: 缺 server 报错', () => {
  assert.throws(() => cfgMod.validate({ version: 1, server: '', username: 'a' }), CliError);
});

test('validate: 缺 username 报错', () => {
  assert.throws(() => cfgMod.validate({ version: 1, server: 'http://x', username: '' }), CliError);
});

test('validate: 错误 version 报错', () => {
  assert.throws(() => cfgMod.validate({ version: 999, server: 'http://x', username: 'a' }), CliError);
});

test('save + load: roundtrip', () => {
  const c = cfgMod.build({ server: 'http://h:8080/tfs/ASS', username: 'alice' });
  cfgMod.save(c);
  const loaded = cfgMod.load();
  assert.equal(loaded.server, 'http://h:8080/tfs/ASS');
  assert.equal(loaded.username, 'alice');
  assert.equal(loaded.collection, 'ASS');
});

test('load: 文件不存在抛 CONFIG_MISSING', () => {
  assert.throws(() => cfgMod.load(), (e) => e.code === 'CONFIG_MISSING');
});

test('load: JSON 损坏抛 CONFIG_INVALID', () => {
  fs.writeFileSync(customConfigPath, '{not-json}', 'utf-8');
  assert.throws(() => cfgMod.load(), (e) => e.code === 'CONFIG_INVALID');
});

test('tryLoad: 文件不存在返回 null', () => {
  assert.equal(cfgMod.tryLoad(), null);
});

test('extractCollection: 从 URL 末段提取', () => {
  assert.equal(cfgMod.extractCollection('http://h:8080/tfs/ASS'), 'ASS');
  assert.equal(cfgMod.extractCollection('http://h:8080/tfs/MES/sub'), 'MES');
  assert.equal(cfgMod.extractCollection(''), null);
});
