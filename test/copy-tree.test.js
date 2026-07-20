'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { copyTree } = require('../src/inject/copy-tree');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forge-copy-'));
}

function writeFile(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

test('递归复制所有文件', () => {
  const src = mkTmp();
  const dest = mkTmp();
  writeFile(src, 'a.txt', 'A');
  writeFile(src, 'sub/b.txt', 'B');
  writeFile(src, 'sub/deep/c.txt', 'C');

  const written = copyTree(src, dest, {});
  assert.equal(written.length, 3);
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf-8'), 'A');
  assert.equal(fs.readFileSync(path.join(dest, 'sub/b.txt'), 'utf-8'), 'B');
  assert.equal(fs.readFileSync(path.join(dest, 'sub/deep/c.txt'), 'utf-8'), 'C');
});

test('skipFiles 命中跳过', () => {
  const src = mkTmp();
  const dest = mkTmp();
  writeFile(src, 'keep.txt', 'K');
  writeFile(src, 'skip.txt', 'S');

  const written = copyTree(src, dest, { skipFiles: ['skip.txt'] });
  assert.equal(written.length, 1);
  assert.ok(fs.existsSync(path.join(dest, 'keep.txt')));
  assert.ok(!fs.existsSync(path.join(dest, 'skip.txt')));
});

test('skipFiles 支持子目录相对路径', () => {
  const src = mkTmp();
  const dest = mkTmp();
  writeFile(src, 'assets/tfs-config.json', 'SECRET');
  writeFile(src, 'assets/tfs-config.example.json', 'TPL');

  const written = copyTree(src, dest, {
    skipFiles: ['assets/tfs-config.json'],
    rename: { 'assets/tfs-config.example.json': 'assets/tfs-config.json' }
  });
  assert.equal(written.length, 1);
  // 重命名后：example → tfs-config.json，且原真实 tfs-config.json 被跳过
  assert.equal(fs.readFileSync(path.join(dest, 'assets/tfs-config.json'), 'utf-8'), 'TPL');
});

test('force=false 目标已存在则跳过', () => {
  const src = mkTmp();
  const dest = mkTmp();
  writeFile(src, 'a.txt', 'NEW');
  writeFile(dest, 'a.txt', 'EXISTING');

  copyTree(src, dest, { force: false });
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf-8'), 'EXISTING');
});

test('force=true 覆盖已存在目标', () => {
  const src = mkTmp();
  const dest = mkTmp();
  writeFile(src, 'a.txt', 'NEW');
  writeFile(dest, 'a.txt', 'EXISTING');

  copyTree(src, dest, { force: true });
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf-8'), 'NEW');
});

test('源目录不存在返回空数组', () => {
  const dest = mkTmp();
  const written = copyTree(path.join(dest, 'no-such'), dest, {});
  assert.deepEqual(written, []);
});
