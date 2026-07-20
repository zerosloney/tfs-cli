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

test('inject: trae 独立文件含 H1 + 命令表格，opencode 嵌入不含 H1', async () => {
  // 同一源文件，两种场景的标题层级应不同
  fs.mkdirSync(path.join(tmpDir, '.trae'));
  await inject({ target: tmpDir, agent: ['trae', 'opencode'] });

  const traeContent = fs.readFileSync(path.join(tmpDir, '.trae', 'rules', 'tfs-command.md'), 'utf-8');
  const opencodeContent = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf-8');

  // trae 独立文件：H1 + H2
  assert.ok(traeContent.startsWith('# TFS 工作区管理'), 'trae 应以 H1 开头');
  assert.ok(traeContent.includes('## TFS 工作区规则'), 'trae 应含 H2 主体');
  assert.ok(traeContent.includes('| 命令 |'), 'trae 应含命令表格');

  // opencode 嵌入：只有 H2，不含 H1（避免破坏 AGENTS.md 标题层级）
  assert.ok(!opencodeContent.includes('# TFS 工作区管理'), 'AGENTS.md 不应含独立 H1');
  assert.ok(opencodeContent.includes('## TFS 工作区规则'), 'AGENTS.md 应含 H2 主体');
  assert.ok(opencodeContent.includes('| 命令 |'), 'AGENTS.md 也应含命令表格（单源共享）');

  // 核心"不要做的事"两处都有一字不差
  const core = '不要直接调 `tf.exe`';
  assert.ok(traeContent.includes(core) && opencodeContent.includes(core), '核心规则两处一致');
});

test('inject: claude 写 CLAUDE.md 而非 AGENTS.md', async () => {
  await inject({ target: tmpDir, agent: ['claude'] });
  assert.ok(fs.existsSync(path.join(tmpDir, 'CLAUDE.md')));
  assert.ok(!fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
});

test('inject: --agent kilo/qoder/zcode/omp 显式传入时写 AGENTS.md', async () => {
  for (const a of ['kilo', 'qoder', 'zcode', 'omp']) {
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-cli-agent-'));
    await inject({ target: sub, agent: [a] });
    assert.ok(fs.existsSync(path.join(sub, 'AGENTS.md')), `${a} 应写 AGENTS.md`);
  }
});

test('inject: 自动检测 .kilo / .qoder / .opencode → 归并 opencode 写 AGENTS.md', async () => {
  for (const dir of ['.kilo', '.qoder', '.opencode', '.zcode', '.omp']) {
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-cli-detect-'));
    fs.mkdirSync(path.join(sub, dir));
    const r = await inject({ target: sub });
    assert.equal(r.response.ok, true);
    assert.ok(fs.existsSync(path.join(sub, 'AGENTS.md')), `检测到 ${dir} 应写 AGENTS.md`);
  }
});

test('inject: qwen 写 QWEN.md', async () => {
  await inject({ target: tmpDir, agent: ['qwen'] });
  assert.ok(fs.existsSync(path.join(tmpDir, 'QWEN.md')));
  const content = fs.readFileSync(path.join(tmpDir, 'QWEN.md'), 'utf-8');
  assert.ok(content.includes(MARKER_START));
  assert.ok(content.includes('TFS'));
});

test('inject: gemini 写 GEMINI.md', async () => {
  await inject({ target: tmpDir, agent: ['gemini'] });
  assert.ok(fs.existsSync(path.join(tmpDir, 'GEMINI.md')));
});

test('inject: cline 写 .clinerules', async () => {
  await inject({ target: tmpDir, agent: ['cline'] });
  assert.ok(fs.existsSync(path.join(tmpDir, '.clinerules')));
});

test('inject: cursor 写 .cursor/rules/tfs-command.mdc', async () => {
  await inject({ target: tmpDir, agent: ['cursor'] });
  const target = path.join(tmpDir, '.cursor', 'rules', 'tfs-command.mdc');
  assert.ok(fs.existsSync(target));
  const content = fs.readFileSync(target, 'utf-8');
  assert.ok(content.startsWith('# TFS 工作区管理'), 'cursor 独立文件应以 H1 开头');
  assert.ok(content.includes('## TFS 工作区规则'), '应含 H2 主体');
});

test('inject: 自动检测 .qwen / .gemini / .cline / .cursor', async () => {
  const agents = ['.qwen', '.gemini', '.cline', '.cursor'];
  const expectedFiles = ['QWEN.md', 'GEMINI.md', '.clinerules', '.cursor/rules/tfs-command.mdc'];
  for (let i = 0; i < agents.length; i++) {
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-cli-detect-'));
    fs.mkdirSync(path.join(sub, agents[i]));
    const r = await inject({ target: sub });
    assert.equal(r.response.ok, true);
    assert.ok(fs.existsSync(path.join(sub, expectedFiles[i])), `检测到 ${agents[i]} 应写 ${expectedFiles[i]}`);
  }
});

test('inject: --dry-run 不写文件', async () => {
  const r = await inject({ target: tmpDir, agent: ['opencode'], dryRun: true });
  assert.equal(r.response.ok, true);
  assert.ok(!fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
});

test('inject: 未知 --agent 值返回 INVALID_ARGS', async () => {
  let caught = false;
  try {
    await inject({ target: tmpDir, agent: ['bogus'] });
  } catch (e) {
    caught = true;
    assert.equal(e.code, 'INVALID_ARGS');
  }
  assert.equal(caught, true);
});

test('inject: --agent all 每个实际目标只写一次', async () => {
  const r = await inject({ target: tmpDir, agent: ['all'] });
  assert.equal(r.response.ok, true);
  assert.deepEqual(
    r.response.data.written.map((w) => w.agent),
    ['opencode', 'claude', 'qwen', 'gemini', 'cline', 'trae', 'codebuddy', 'cursor']
  );
  assert.ok(fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'QWEN.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'GEMINI.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, '.clinerules')));
  assert.ok(fs.existsSync(path.join(tmpDir, '.trae', 'rules', 'tfs-command.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, '.codebuddy', 'rules', 'tfs-command.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, '.cursor', 'rules', 'tfs-command.mdc')));
});

test('inject: --agent 重复参数去重', async () => {
  const r = await inject({ target: tmpDir, agent: ['opencode', 'opencode', 'claude'] });
  assert.equal(r.response.ok, true);
  const written = r.response.data.written;
  const opencodes = written.filter((w) => w.agent === 'opencode');
  assert.equal(opencodes.length, 1, '重复 agent 应去重');
});
