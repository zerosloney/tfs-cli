'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_COLLECTION = 'ASS';
const COLLECTION_RE = /\/tfs\/([^/?#]+)/i;

/**
 * 从 TFS 服务器 URL 提取 collection 名
 * http://host:8080/tfs/ASS  →  ASS
 * 无匹配时返回 undefined（调用方用默认值兜底）
 */
function extractCollection(url) {
  if (!url) return undefined;
  const m = url.match(COLLECTION_RE);
  return m ? m[1] : undefined;
}

/**
 * 注入 tfs-config.json 并（可选）把密码写入系统凭证库
 *
 * - 命令行参数语义：传了 username 就强制覆盖目标 tfs-config.json（不受 --force 影响）
 * - 密码永不落盘到 tfs-config.json，只保留 password_ref 占位
 * - 若传入 password：spawn cred_helper.py set <username>，stdin 喂密码
 *   失败时打印 warning，不中断主流程
 *
 * @param {string}  targetDir
 * @param {object}  agentEntry
 * @param {object}  params
 * @param {string} [params.url]       TFS 服务器 URL
 * @param {string} [params.username]  TFS 用户名（必填，缺失则整体跳过）
 * @param {string} [params.password]  TFS 密码（可选，仅写入凭证库）
 * @returns {boolean} 是否实际写入了 tfs-config.json
 */
function injectConfig(targetDir, agentEntry, params = {}) {
  const { url, username, password } = params;
  if (!username) return false;

  const configPath = path.join(targetDir, agentEntry.skillDir, 'assets', 'tfs-config.json');
  const server = url || '';
  const collection = extractCollection(url) || DEFAULT_COLLECTION;

  const config = {
    server,
    username,
    password_ref: `system-keyring:tfs-tf-commands:${username}`,
    domain: '',
    workspace: '',
    collection
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log(`[forge] ✅ tfs-config.json 已写入: ${configPath}`);

  if (password) {
    writeCredential(targetDir, agentEntry, username, password);
  }
  return true;
}

/**
 * 调用技能内 scripts/cred_helper.py 把密码写入系统凭证库
 * - 使用同步 spawn，等待完成后再返回，避免 fire-and-forget 竞态
 * - 优先 python，回退 py，全部失败才 warn 不中断
 */
function writeCredential(targetDir, agentEntry, username, password) {
  const helper = path.join(targetDir, agentEntry.skillDir, 'scripts', 'cred_helper.py');
  if (!fs.existsSync(helper)) {
    console.warn(
      `[forge] ⚠️  cred_helper.py 未找到（${helper}）。请手动写入凭证：见 SKILL.md「首次配置」`
    );
    return;
  }

  const pyCmd = ['python', 'py'];
  let lastErr = '';

  for (const cmd of pyCmd) {
    const child = spawn(cmd, [helper, 'set', username], {
      windowsHide: true
    });
    child.stdin.write(password + '\n');
    child.stdin.end();
    const { status, stderr: err } = child;
    lastErr = err ? err.toString() : '';
    if (status === 0) {
      console.log(`[forge] ✅ 凭证已写入系统凭证库 (user=${username})`);
      return;
    }
    // null = 命令不存在（非 PATH 问题），直接 break
    if (status === null) break;
  }

  console.warn(
    `[forge] ⚠️  写入凭证库失败。请手动运行：python "${helper}" set "${username}"（密码从 stdin 读取）`
  );
}

module.exports = { injectConfig, extractCollection, DEFAULT_COLLECTION };
