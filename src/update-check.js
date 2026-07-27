'use strict';

/**
 * 轻量更新检查 —— 零新依赖，非阻塞，每天最多一次。
 *
 * 从 npm registry 获取最新版本，与当前版本比较，
 * 有新版本时在 stderr 打印提示。
 * 所有失败路径静默忽略（不干扰 CLI 主流程）。
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PKG_NAME = '@master0071/tfs-cli';
const REGISTRY_URL = `https://registry.npmjs.org/${PKG_NAME}/latest`;

const CACHE_DIR = path.join(os.homedir(), '.config', 'tfs-cli');
const CACHE_FILE = path.join(CACHE_DIR, 'update-check.json');

/** 缓存有效期：24 小时 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * 简单的 semver 解析：只支持 major.minor.patch，不处理 pre-release。
 */
function parseVersion(v) {
  const parts = (v || '').split('.').map(Number);
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}

/**
 * 判断 latest 是否严格大于 current（仅比较 major.minor.patch）。
 */
function isNewer(latest, current) {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  return (
    l.major > c.major ||
    (l.major === c.major && l.minor > c.minor) ||
    (l.major === c.major && l.minor === c.minor && l.patch > c.patch)
  );
}

/**
 * 判断是否应该发起网络请求（缓存过期或不存在）。
 */
function shouldCheck() {
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return Date.now() - cached.checkedAt > CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

/**
 * 写入缓存（静默失败）。
 */
function saveCache(version) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ version, checkedAt: Date.now() }),
      'utf8'
    );
  } catch { /* ignore */ }
}

/**
 * 发起更新检查。
 *
 * @param {string} currentVersion  当前版本号（来自 package.json）
 */
function checkUpdate(currentVersion) {
  if (!shouldCheck()) return;

  const req = https.get(REGISTRY_URL, { timeout: 3000 }, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        const latest = data.version;
        if (latest && isNewer(latest, currentVersion)) {
          console.error(
            `\n\u26a0  \u66f4\u65b0\u53ef\u7528: ${PKG_NAME} ${currentVersion} \u2192 ${latest}\n` +
            `  \u8fd0\u884c: npm install -g ${PKG_NAME}@latest\n`
          );
        }
        saveCache(latest || currentVersion);
      } catch { /* ignore parse errors */ }
    });
  });
  req.on('error', () => { /* silent fail */ });
  req.end();
}

module.exports = { checkUpdate };