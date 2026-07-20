'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CliError, ERROR_CODES } = require('./errors');

/**
 * 全局配置文件管理。
 *
 * 路径：~/.config/tfs-cli/config.json（Linux/macOS 标准）
 *       %USERPROFILE%\.config\tfs-cli\config.json（Windows 环境变量）
 *
 * schema:
 * {
 *   version: 1,
 *   server: "http://host:8080/tfs/ASS",
 *   username: "alice",
 *   domain: "" | "DOMAIN",
 *   workspace: "" | "WORKSPACE_NAME",
 *   collection: "ASS",
 *   password_ref: "system-keyring:tfs-cli:alice"
 * }
 *
 * 密码不入此文件，存系统凭证库（详见 credentials.js）。
 */

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'tfs-cli');
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_CONFIG_DIR, 'config.json');
const SCHEMA_VERSION = 1;

// 允许注入（测试或高级用户覆盖默认路径）
let CONFIG_DIR = DEFAULT_CONFIG_DIR;
let CONFIG_PATH = DEFAULT_CONFIG_PATH;

function setConfigPath(p) {
  CONFIG_PATH = p;
  CONFIG_DIR = path.dirname(p);
  resetConfigPath._active = true;
  return CONFIG_PATH;
}
function resetConfigPath() {
  CONFIG_PATH = DEFAULT_CONFIG_PATH;
  CONFIG_DIR = DEFAULT_CONFIG_DIR;
  resetConfigPath._active = false;
}

function ensureDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function load() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new CliError(
      ERROR_CODES.CONFIG_MISSING,
      `未找到配置文件 ${CONFIG_PATH}。请先运行: tfs-cli init`,
      { configPath: CONFIG_PATH }
    );
  }
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  } catch (e) {
    throw new CliError(
      ERROR_CODES.CONFIG_INVALID,
      `无法读取配置文件: ${e.message}`,
      { configPath: CONFIG_PATH }
    );
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new CliError(
      ERROR_CODES.CONFIG_INVALID,
      `配置文件 JSON 解析失败: ${e.message}`,
      { configPath: CONFIG_PATH }
    );
  }
  validate(data);
  return data;
}

/**
 * 与 load() 相同但不抛 CONFIG_MISSING：返回 null。
 * 用于"有没有都无所谓"的场景（例如 config reset）。
 */
function tryLoad() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    throw new CliError(
      ERROR_CODES.CONFIG_INVALID,
      `配置文件 JSON 解析失败: ${e.message}`,
      { configPath: CONFIG_PATH }
    );
  }
}

function save(data) {
  validate(data);
  ensureDir();
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, CONFIG_PATH);
}

function validate(data) {
  if (!data || typeof data !== 'object') {
    throw new CliError(ERROR_CODES.CONFIG_INVALID, 'config 必须为 JSON 对象');
  }
  if (data.version !== SCHEMA_VERSION) {
    throw new CliError(
      ERROR_CODES.CONFIG_INVALID,
      `不支持的 config version: ${data.version}（期望 ${SCHEMA_VERSION}）`
    );
  }
  if (!data.server || typeof data.server !== 'string') {
    throw new CliError(ERROR_CODES.CONFIG_INVALID, 'server 字段缺失或类型错误');
  }
  if (!data.username || typeof data.username !== 'string') {
    throw new CliError(ERROR_CODES.CONFIG_INVALID, 'username 字段缺失或类型错误');
  }
  // domain/workspace/collection 可为空，类型为 string
  for (const k of ['domain', 'workspace', 'collection']) {
    if (data[k] !== undefined && typeof data[k] !== 'string') {
      throw new CliError(ERROR_CODES.CONFIG_INVALID, `${k} 字段类型必须为 string`);
    }
  }
}

function build({ server, username, domain = '', workspace = '', collection = '' }) {
  const coll = collection || extractCollection(server) || '';
  return {
    version: SCHEMA_VERSION,
    server,
    username,
    domain,
    workspace,
    collection: coll,
    password_ref: `system-keyring:tfs-cli:${username}`
  };
}

const COLLECTION_RE = /\/tfs\/([^/?#]+)/i;

function extractCollection(serverUrl) {
  if (!serverUrl) return null;
  const m = serverUrl.match(COLLECTION_RE);
  return m ? m[1] : null;
}

module.exports = {
  CONFIG_DIR: () => CONFIG_DIR,
  CONFIG_PATH: () => CONFIG_PATH,
  CONFIG_DIR_DEFAULT: DEFAULT_CONFIG_DIR,
  CONFIG_PATH_DEFAULT: DEFAULT_CONFIG_PATH,
  SCHEMA_VERSION,
  load,
  tryLoad,
  save,
  validate,
  build,
  extractCollection,
  setConfigPath,
  resetConfigPath
};
