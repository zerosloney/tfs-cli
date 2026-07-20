'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { toWindows, canonicalize, joinWindows } = require('../src/path');

test('toWindows: MSYS 风格 /c/foo → C:\\foo', () => {
  assert.equal(toWindows('/c/Projects/Program.cs'), 'C:\\Projects\\Program.cs');
});

test('toWindows: MSYS 风格 /c/Projects/中文/Program.cs', () => {
  assert.equal(
    toWindows('/c/Projects/中文/Program.cs'),
    'C:\\Projects\\中文\\Program.cs'
  );
});

test('toWindows: 原生 Windows 路径直通', () => {
  assert.equal(toWindows('C:\\Foo\\Bar.cs'), 'C:\\Foo\\Bar.cs');
});

test('toWindows: 正斜杠转反斜杠', () => {
  assert.equal(toWindows('C:/Foo/Bar.cs'), 'C:\\Foo\\Bar.cs');
});

test('toWindows: 相对路径 ./bar 拼接到 cwd', () => {
  assert.equal(toWindows('./Bar.cs', 'C:\\Root'), 'C:\\Root\\Bar.cs');
});

test('toWindows: 空输入返回空', () => {
  assert.equal(toWindows(''), '');
  assert.equal(toWindows(null), '');
});

test('canonicalize: 跨平台唯一标识', () => {
  assert.equal(canonicalize('C:\\Foo\\bar.cs'), 'c:/foo/bar.cs');
  assert.equal(canonicalize('/c/Foo/Bar.cs'), 'c:/foo/bar.cs');
  assert.equal(canonicalize('c:/FOO/bar.cs'), 'c:/foo/bar.cs');
});

test('joinWindows: 拼接多段并清理分隔符', () => {
  assert.equal(joinWindows('C:\\Foo\\', '/Bar/', 'Baz.cs'), 'C:\\Foo\\Bar\\Baz.cs');
  assert.equal(joinWindows('a\\\\b', 'c\\\\d'), 'a\\b\\c\\d');
});
