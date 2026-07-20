'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { inject, MARKER_START, MARKER_END } = require('../src/commands/inject');
const { toWindows } = require('../src/path');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-cli-inject-'));
});

test('inject: 不存在的目录报错', async () => {
  let caught = false;
  try {
    await inject({ target: 'Z:/nonexistent/dir/xyz-12345' });
  } catch (e) {
    caught = true;
    assert.equal(e.code, 'INVALID_ARGS');
  }
  assert.equal(caught, true);
});

test('inject: 默认 agent 写 AGENTS.md', async () => {
  const r = await inject({ target: tmpDir, agent: ['opencode'] });
  assert.equal(r.response.ok, true);
  const written = path.join(tmpDir, 'AGENTS.md');
  assert.ok(fs.existsSync(written));
  const content = fs.readFileSync(written, 'utf-8');
  assert.match(content, /TFS/);
  assert.ok(content.includes(MARKER_START));
  assert.ok(content.includes(MARKER_END));
});

test('inject: 已存在 marker 时替换中间内容', async () => {
  const target = path.join(tmpDir, 'AGENTS.md');
  fs.writeFileSync(target, 'HEADER\n' + MARKER_START + '\nOLD RULES\n' + MARKER_END + '\nFOOTER\n', 'utf-8');
  await inject({ target: tmpDir, agent: ['opencode'], force: true });
  const content = fs.readFileSync(target, 'utf-8');
  assert.ok(content.includes('OLD RULES') === false, 'OLD RULES 被替换');
  assert.ok(content.includes('HEADER'), 'HEADER 保留');
  assert.ok(content.includes('FOOTER'), 'FOOTER 保留');
});

test('inject: trae 写 .trae/rules/tfs-command.md', async () => {
  fs.mkdirSync(path.join(tmpDir, '.trae'));
  await inject({ target: tmpDir, agent: ['trae'] });
  const written = path.join(tmpDir, '.trae', 'rules', 'tfs-command.md');
  assert.ok(fs.existsSync(written));
  const content = fs.readFileSync(written, 'utf-8');
  assert.match(content, /TFS 工作区管理/);
});

test('inject: claude 写 CLAUDE.md 而非 AGENTS.md', async () => {
  await inject({ target: tmpDir, agent: ['claude'] });
  assert.ok(fs.existsSync(path.join(tmpDir, 'CLAUDE.md')));
  assert.ok(!fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
});

test('inject: --dry-run 不写文件', async () => {
  const r = await inject({ target: tmpDir, agent: ['opencode'], dryRun: true });
  assert.equal(r.response.ok, true);
  assert.ok(!fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
});
