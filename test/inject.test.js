'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { AGENTS } = require('../src/inject/registry');
const { injectSkill } = require('../src/inject/inject-skill');
const { injectRules } = require('../src/inject/inject-rules');
const { injectDoc, replaceBetweenMarkers, TFS_SECTION_MARKER } = require('../src/inject/inject-doc');
const { injectConfig, extractCollection } = require('../src/inject/inject-config');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forge-inject-'));
}

// 真实仓库内网 IP / 用户名，断言它们不应出现在注入产物中
const FORBIDDEN_IP = '101.101.118.123';
const FORBIDDEN_USER = 'daichen';

// ---------------------------------------------------------------------------
// inject-skill
// ---------------------------------------------------------------------------

test('injectSkill: 复制完整技能包（SKILL.md + scripts + references + assets）', () => {
  const dir = mkTmp();
  const entry = AGENTS.opencode;
  const written = injectSkill(dir, entry, false);

  const skillDir = path.join(dir, entry.skillDir);
  const expected = [
    'SKILL.md',
    'scripts/tf_helper.sh',
    'scripts/tf_helper.ps1',
    'scripts/tfs-edit.sh',
    'scripts/cred_helper.py',
    'scripts/cache_helper.py',
    'references/tf_commands.md',
    'references/credential_setup.md',
    'references/troubleshooting.md',
    'assets/tfs-config.json' // 从 example 重命名而来
  ];
  for (const rel of expected) {
    assert.ok(fs.existsSync(path.join(skillDir, rel)), `应存在 ${rel}`);
  }
  assert.ok(written.length >= expected.length, `写入文件数应 >= ${expected.length}`);
});

test('injectSkill: 不泄露真实凭证（IP/用户名）', () => {
  const dir = mkTmp();
  injectSkill(dir, AGENTS.opencode, false);

  const cfgPath = path.join(dir, AGENTS.opencode.skillDir, 'assets', 'tfs-config.json');
  const cfg = fs.readFileSync(cfgPath, 'utf-8');
  assert.doesNotMatch(cfg, new RegExp(FORBIDDEN_IP), '不应含真实内网 IP');
  assert.doesNotMatch(cfg, new RegExp(FORBIDDEN_USER), '不应含真实用户名');
});

test('injectSkill: 已存在 SKILL.md 时默认跳过', () => {
  const dir = mkTmp();
  injectSkill(dir, AGENTS.opencode, false);
  // 第二次未带 force，应跳过（返回空）
  const written = injectSkill(dir, AGENTS.opencode, false);
  assert.equal(written.length, 0);
});

test('injectSkill: --force 覆盖已存在技能', () => {
  const dir = mkTmp();
  injectSkill(dir, AGENTS.opencode, false);
  // 篡改 SKILL.md，确认 force 会重新复制
  const skillMd = path.join(dir, AGENTS.opencode.skillDir, 'SKILL.md');
  fs.writeFileSync(skillMd, 'TAMPERED', 'utf-8');

  injectSkill(dir, AGENTS.opencode, true);
  const after = fs.readFileSync(skillMd, 'utf-8');
  assert.notEqual(after, 'TAMPERED');
  assert.match(after, /tfs-tf-commands/);
});

// ---------------------------------------------------------------------------
// inject-rules
// ---------------------------------------------------------------------------

test('injectRules: hasRules=false 直接返回空数组', () => {
  const dir = mkTmp();
  const written = injectRules(dir, AGENTS.opencode, false);
  assert.deepEqual(written, []);
  assert.ok(!fs.existsSync(path.join(dir, '.opencode', 'rules')));
});

test('injectRules: hasRules=true 复制到 rulesDir', () => {
  const dir = mkTmp();
  injectRules(dir, AGENTS.trae, false);
  const ruleFile = path.join(dir, AGENTS.trae.rulesDir, 'tfs-command.md');
  assert.ok(fs.existsSync(ruleFile), 'trae rules 文件应存在');
});

test('injectRules: codebuddy 也复制 rules', () => {
  const dir = mkTmp();
  injectRules(dir, AGENTS.codebuddy, false);
  assert.ok(
    fs.existsSync(path.join(dir, AGENTS.codebuddy.rulesDir, 'tfs-command.md')),
    'codebuddy rules 应存在'
  );
});

// ---------------------------------------------------------------------------
// inject-doc
// ---------------------------------------------------------------------------

test('injectDoc: 文档不存在 → 创建', () => {
  const dir = mkTmp();
  injectDoc(dir, AGENTS.opencode, false);
  const doc = path.join(dir, 'AGENTS.md');
  assert.ok(fs.existsSync(doc));
  const content = fs.readFileSync(doc, 'utf-8');
  assert.match(content, /<!-- forge:tfs-rules -->/);
});

test('injectDoc: claude 用 CLAUDE.md 作为根文档', () => {
  const dir = mkTmp();
  injectDoc(dir, AGENTS.claude, false);
  const claude = path.join(dir, 'CLAUDE.md');
  assert.ok(fs.existsSync(claude), 'CLAUDE.md 应被创建');
  assert.ok(!fs.existsSync(path.join(dir, 'AGENTS.md')), 'claude agent 不应创建 AGENTS.md');
});

test('injectDoc: 存在但无 marker → 追加（marker 数恰好 2）', () => {
  const dir = mkTmp();
  const doc = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(doc, '# 项目原有规则\n\n用户自己的内容。\n', 'utf-8');

  injectDoc(dir, AGENTS.opencode, false);
  const after = fs.readFileSync(doc, 'utf-8');
  const markerCount = (after.match(new RegExp(TFS_SECTION_MARKER, 'g')) || []).length;
  assert.equal(markerCount, 2, '追加后应恰好有 2 个 marker');
  assert.match(after, /用户自己的内容/);
});

test('injectDoc: 存在且有 marker → 默认跳过', () => {
  const dir = mkTmp();
  const doc = path.join(dir, 'AGENTS.md');
  injectDoc(dir, AGENTS.opencode, false); // 首次创建
  const original = fs.readFileSync(doc, 'utf-8');

  // 在 marker 区域外添加用户内容
  fs.appendFileSync(doc, '\n# 用户后加的内容\n', 'utf-8');
  const beforeSecond = fs.readFileSync(doc, 'utf-8');

  injectDoc(dir, AGENTS.opencode, false); // 应跳过
  const after = fs.readFileSync(doc, 'utf-8');
  assert.equal(after, beforeSecond, '跳过时文件不应变化');
  assert.notEqual(after, original);
});

test('injectDoc: --force 多次重写不累积空行（marker 数稳定）', () => {
  const dir = mkTmp();
  injectDoc(dir, AGENTS.opencode, false);
  const firstLen = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8').length;

  for (let i = 0; i < 3; i++) {
    injectDoc(dir, AGENTS.opencode, true);
  }
  const after = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
  const markerCount = (after.match(new RegExp(TFS_SECTION_MARKER, 'g')) || []).length;
  assert.equal(markerCount, 2, 'marker 数应稳定为 2');
  assert.ok(after.length < firstLen + 20, `多次 force 不应累积 (first=${firstLen}, after=${after.length})`);
});

// ---------------------------------------------------------------------------
// replaceBetweenMarkers 单元（孤立 marker 容错）
// ---------------------------------------------------------------------------

test('replaceBetweenMarkers: 单 marker 视为损坏，重建为 marker 之前 + newContent', () => {
  const text = `# project\n\nsome content\n${TFS_SECTION_MARKER}\nleftover\n`;
  const replaced = replaceBetweenMarkers(text, TFS_SECTION_MARKER, 'NEWSECTION');
  const markerCount = (replaced.match(new RegExp(TFS_SECTION_MARKER, 'g')) || []).length;
  assert.ok(markerCount <= 2, `单 marker 不应导致累积 (实际=${markerCount})`);
  assert.match(replaced, /some content/);
  assert.match(replaced, /NEWSECTION/);
});

// ---------------------------------------------------------------------------
// inject-config
// ---------------------------------------------------------------------------

test('extractCollection: 从 url 末段提取', () => {
  assert.equal(extractCollection('http://h:8080/tfs/ASS'), 'ASS');
  assert.equal(extractCollection('http://h:8080/tfs/MES'), 'MES');
  assert.equal(extractCollection('http://h:8080/tfs/ASS/extra'), 'ASS');
  assert.equal(extractCollection('http://h:8080/no-tfs-here'), undefined);
  assert.equal(extractCollection(''), undefined);
});

test('injectConfig: 传 username 强制覆盖 tfs-config.json', () => {
  const dir = mkTmp();
  injectSkill(dir, AGENTS.claude, false);

  // 先看一眼 example 默认值
  const cfgPath = path.join(dir, AGENTS.claude.skillDir, 'assets', 'tfs-config.json');
  const before = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  assert.equal(before.username, '', '注入后默认 username 应为空');

  injectConfig(dir, AGENTS.claude, {
    url: 'http://h:8080/tfs/MES',
    username: 'alice'
    // 不传 password，避免依赖凭证库
  });

  const after = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  assert.equal(after.username, 'alice');
  assert.equal(after.server, 'http://h:8080/tfs/MES');
  assert.equal(after.collection, 'MES');
  assert.equal(
    after.password_ref,
    'system-keyring:tfs-tf-commands:alice',
    'password_ref 应按约定生成'
  );
  assert.equal(after.password, undefined, '明文 password 字段不应存在');
});

test('injectConfig: 无 username 时整体跳过', () => {
  const dir = mkTmp();
  injectSkill(dir, AGENTS.opencode, false);
  const cfgPath = path.join(dir, AGENTS.opencode.skillDir, 'assets', 'tfs-config.json');
  const before = fs.readFileSync(cfgPath, 'utf-8');

  const wrote = injectConfig(dir, AGENTS.opencode, { url: 'http://h/tfs/X' });
  assert.equal(wrote, false);
  assert.equal(fs.readFileSync(cfgPath, 'utf-8'), before, '无 username 不应改文件');
});

test('injectConfig: 无 url 时 collection 回退默认值', () => {
  const dir = mkTmp();
  injectSkill(dir, AGENTS.opencode, false);
  injectConfig(dir, AGENTS.opencode, { username: 'bob' });
  const cfgPath = path.join(dir, AGENTS.opencode.skillDir, 'assets', 'tfs-config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  assert.equal(cfg.collection, 'ASS', '无 url 时 collection 回退到 ASS');
  assert.equal(cfg.server, '');
});
