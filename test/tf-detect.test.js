'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { findFirstUnderStar } = require('../src/tf-detect');

test('findFirstUnderStar: 无 * 路径且存在', () => {
  // 使用动态路径而非硬编码绝对路径
  const commanderMain = require.resolve('commander');
  const dir = path.dirname(commanderMain);
  const found = findFirstUnderStar(dir.replace(/\\/g, '/') + '/index.js');
  assert.ok(found, '应找到 commander/index.js');
  assert.match(found, /commander[\\]index\.js$/i);
});

test('findFirstUnderStar: 无 * 路径但不存在', () => {
  const tmpDir = require('os').tmpdir();
  assert.equal(findFirstUnderStar(tmpDir.replace(/\\/g, '/') + '/does-not-exist-12345.foo'), null);
});

test('findFirstUnderStar: 含 * 且 prefix 不存在', () => {
  assert.equal(
    findFirstUnderStar('Z:/nonexistent-prefix-12345/*/Common7/.../tf.exe'),
    null
  );
});
