'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { findFirstUnderStar, detect } = require('../src/tf-detect');

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


test("detect: 通过 mock spawnSync 与 fs.existsSync 模拟 vswhere 探测", () => {
  const fs = require("fs");
  const originalExistsSync = fs.existsSync;
  
  fs.existsSync = (p) => {
    if (p.includes("vswhere.exe")) return true;
    if (p.includes("MySpecialVS") && p.endsWith("tf.exe")) return true;
    return false;
  };

  const mockSpawnSync = (cmd, args) => {
    if (cmd === "where" && args[0] === "vswhere.exe") {
      return {
        status: 0,
        stdout: "C:\\MockPath\\vswhere.exe\n"
      };
    }
    if (cmd === "C:\\MockPath\\vswhere.exe") {
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            installationPath: "D:\\MySpecialVS"
          }
        ])
      };
    }
    return { status: 1 };
  };

  try {
    const list = detect({ spawnSync: mockSpawnSync });
    assert.strictEqual(list, path.join("D:\\MySpecialVS", "Common7", "IDE", "CommonExtensions", "Microsoft", "TeamFoundation", "Team Explorer", "tf.exe"));
  } finally {
    fs.existsSync = originalExistsSync;
  }
});
