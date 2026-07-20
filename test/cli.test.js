'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const FORGE_BIN = path.resolve(__dirname, '..', 'bin', 'forge.js');

function runForge(args, options = {}) {
  return spawnSync(process.execPath, [FORGE_BIN, ...args], {
    encoding: 'utf-8',
    ...options
  });
}

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cli-'));
}

test('--help 退出码 0', () => {
  const r = runForge(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /init/);
});

test('list-agents 退出码 0 且列出全部 6 个 agent', () => {
  const r = runForge(['list-agents']);
  assert.equal(r.status, 0);
  for (const a of ['opencode', 'kilo', 'qoder', 'claude', 'trae', 'codebuddy']) {
    assert.match(r.stdout, new RegExp(a), `list-agents 应包含 ${a}`);
  }
});

test('parseAgents 非法值报错并退出码 1', () => {
  const dir = mkTmpDir();
  const r = runForge(['init', '-d', dir, '-a', 'foo']);
  assert.equal(r.status, 1, '非法 agent 应退出码 1');
  assert.match(r.stderr || r.stdout, /不支持的 Agent 工具/, '应有明确错误信息');
});

test('互斥 *-only 选项叠加报错', () => {
  const dir = mkTmpDir();
  const r = runForge(['init', '-d', dir, '--skill-only', '--rules-only']);
  assert.equal(r.status, 1, '互斥 only 叠加应退出码 1');
  assert.match(r.stderr || r.stdout, /互斥/);
});

test('init -a all 注入全部 6 个 agent 目录 + 2 个根文档', () => {
  const dir = mkTmpDir();
  const r = runForge(['init', '-d', dir, '-a', 'all']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);

  const skillDirs = [
    '.opencode/skills/tfs-tf-commands/SKILL.md',
    '.kilo/skills/tfs-tf-commands/SKILL.md',
    '.qoder/skills/tfs-tf-commands/SKILL.md',
    '.claude/skills/tfs-tf-commands/SKILL.md',
    '.trae/skills/tfs-tf-commands/SKILL.md',
    '.codebuddy/skills/tfs-tf-commands/SKILL.md'
  ];
  for (const rel of skillDirs) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `应生成 ${rel}`);
  }

  // 两个根文档
  assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')), 'AGENTS.md 应生成');
  assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')), 'CLAUDE.md 应生成');

  // 仅 trae/codebuddy 有 rules
  assert.ok(fs.existsSync(path.join(dir, '.trae/rules/tfs-command.md')), 'trae rules 应生成');
  assert.ok(
    fs.existsSync(path.join(dir, '.codebuddy/rules/tfs-command.md')),
    'codebuddy rules 应生成'
  );
  assert.ok(!fs.existsSync(path.join(dir, '.opencode/rules')), 'opencode 不应有 rules');
});

test('init -a claude 只注入 claude，不创建其他 agent 目录', () => {
  const dir = mkTmpDir();
  const r = runForge(['init', '-d', dir, '-a', 'claude']);
  assert.equal(r.status, 0);

  assert.ok(fs.existsSync(path.join(dir, '.claude/skills/tfs-tf-commands/SKILL.md')));
  assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
  // claude agent 不应创建 AGENTS.md
  assert.ok(!fs.existsSync(path.join(dir, 'AGENTS.md')));
  assert.ok(!fs.existsSync(path.join(dir, '.opencode')));
});

test('init 传入 -u/-p/--url 不落盘明文密码', () => {
  const dir = mkTmpDir();
  // 只传用户名和 url，避免实际触发凭证库写入（cred_helper 调用是 fire-and-forget）
  const r = runForge([
    'init',
    '-d',
    dir,
    '-a',
    'opencode',
    '--url',
    'http://h:8080/tfs/MES',
    '-u',
    'alice'
  ]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);

  const cfgPath = path.join(dir, '.opencode/skills/tfs-tf-commands/assets/tfs-config.json');
  assert.ok(fs.existsSync(cfgPath));
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  assert.equal(cfg.username, 'alice');
  assert.equal(cfg.server, 'http://h:8080/tfs/MES');
  assert.equal(cfg.collection, 'MES');
  assert.equal(cfg.password, undefined, 'tfs-config.json 不应含明文 password');
});

test('init 不再生成 forge.config.json（旧 saveConfig 已废弃）', () => {
  const dir = mkTmpDir();
  runForge(['init', '-d', dir, '-a', 'opencode', '--skill-only']);
  assert.ok(!fs.existsSync(path.join(dir, 'forge.config.json')), '不应再生成 forge.config.json');
});

test('init 默认不覆盖已存在技能（不带 --force）', () => {
  const dir = mkTmpDir();
  runForge(['init', '-d', dir, '-a', 'opencode']);
  const skillMd = path.join(dir, '.opencode/skills/tfs-tf-commands/SKILL.md');
  fs.writeFileSync(skillMd, 'TAMPERED', 'utf-8');

  runForge(['init', '-d', dir, '-a', 'opencode']);
  assert.equal(fs.readFileSync(skillMd, 'utf-8'), 'TAMPERED', '未带 --force 时不应覆盖');

  runForge(['init', '-d', dir, '-a', 'opencode', '--force']);
  const after = fs.readFileSync(skillMd, 'utf-8');
  assert.notEqual(after, 'TAMPERED', '--force 后应被覆盖');
});
