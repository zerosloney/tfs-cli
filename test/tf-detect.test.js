'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findFirstUnderStar } = require('../src/tf-detect');

test('findFirstUnderStar: 无 * 路径且存在', () => {
  // 真实文件：本项目的 node_modules/commander/package.json
  const found = findFirstUnderStar('E:/Demo/forge/forge-tfs/node_modules/commander/package.json');
  assert.match(found, /commander[\\]package\.json$/);
});

test('findFirstUnderStar: 无 * 路径但不存在', () => {
  assert.equal(findFirstUnderStar('E:/Demo/forge/forge-tfs/does-not-exist.foo'), null);
});

test('findFirstUnderStar: 含 * 且 prefix 不存在', () => {
  assert.equal(
    findFirstUnderStar('Z:/nonexistent-prefix-12345/*/Common7/.../tf.exe'),
    null
  );
});
