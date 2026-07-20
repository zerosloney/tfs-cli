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
 * - spawn 失败或非零退出时只打印 warning，不抛错
 */
function writeCredential(targetDir, agentEntry, username, password) {
  const helper = path.join(targetDir, agentEntry.skillDir, 'scripts', 'cred_helper.py');
  if (!fs.existsSync(helper)) {
    console.warn(
      `[forge] ⚠️  cred_helper.py 未找到（${helper}）。请手动写入凭证：见 SKILL.md「首次配置」`
    );
    return;
  }

  // Windows 上 python 命令可能是 python 或 py；优先 python，回退 py
  const child = spawn('python', [helper, 'set', username], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });

  child.on('error', () => {
    // python 不在 PATH：尝试 py 启动器
    const fallback = spawn('py', [helper, 'set', username], {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true
    });
    let fbErr = '';
    fallback.stderr.on('data', (d) => {
      fbErr += d.toString();
    });
    fallback.on('error', () => {
      console.warn(
        `[forge] ⚠️  无法调用 python。请手动写入凭证：python "${helper}" set "${username}"`
      );
    });
    fallback.on('exit', (code) => {
      if (code === 0) {
        console.log(`[forge] ✅ 凭证已写入系统凭证库 (user=${username})`);
      } else {
        console.warn(
          `[forge] ⚠️  写入凭证库失败 (py exit=${code}): ${fbErr.trim()}。请手动: py "${helper}" set "${username}"`
        );
      }
    });
    try {
      fallback.stdin.end(password);
    } catch (_) {
      /* ignore */
    }
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`[forge] ✅ 凭证已写入系统凭证库 (user=${username})`);
    } else {
      console.warn(
        `[forge] ⚠️  写入凭证库失败 (python exit=${code}): ${stderr.trim()}。请手动: python "${helper}" set "${username}"`
      );
    }
  });

  try {
    child.stdin.end(password);
  } catch (_) {
    /* ignore */
  }
}

module.exports = { injectConfig, extractCollection, DEFAULT_COLLECTION };
