'use strict';

const { load, tryLoad, save, build, CONFIG_PATH, extractCollection } = require('../config');
// CONFIG_PATH / CONFIG_DIR 在 config.js 里是 getter 函数，访问时需调用。
const credentials = require('../credentials');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES } = require('../errors');

/**
 * tfs-cli config — 配置管理。
 *
 * 子命令：
 *   config show              打印当前配置（JSON）
 *   config set <key> <val>   修改单个字段（不修改凭证）
 *   config reset             删除 config + 凭证
 *
 * key 可选：server / domain / workspace / collection
 * 修改 username 或密码请重新运行 init。
 */

function show() {
  const startMs = Date.now();
  try {
    const cfg = load();
    return {
      response: ok('config', {
        path: CONFIG_PATH(),
        data: {
          operation: 'show',
          config: { ...cfg, password: undefined },
          configPath: CONFIG_PATH()
        },
        startMs
      }),
      exitCode: 0
    };
  } catch (e) {
    if (e instanceof CliError) {
      return {
        response: fail('config', e.code, e.message, { details: e.details, startMs }),
        exitCode: e.exitCode
      };
    }
    throw e;
  }
}

const SETTABLE_KEYS = ['server', 'domain', 'workspace', 'collection'];

function setKey(key, value) {
  const startMs = Date.now();
  try {
    if (!SETTABLE_KEYS.includes(key)) {
      if (key === 'username') {
        throw new CliError(
          ERROR_CODES.INVALID_ARGS,
          '不允许通过 config set 修改 username，否则凭证引用会失效。请使用: tfs-cli init 重新初始化（会重写配置 + 凭证）'
        );
      }
      throw new CliError(
        ERROR_CODES.INVALID_ARGS,
        `不可设置的字段: ${key}。可用: ${SETTABLE_KEYS.join(', ')}（修改密码请用 tfs-cli init 或 config reset）`
      );
    }
    const cfg = load();
    cfg[key] = value;
    if (key === 'server') {
      const c = extractCollection(value);
      if (c) cfg.collection = c;
    }
    save(cfg);
    return {
      response: ok('config', {
        path: null,
        data: { operation: 'set', key, value, configPath: CONFIG_PATH() },
        startMs
      }),
      exitCode: 0
    };
  } catch (e) {
    if (e instanceof CliError) {
      return {
        response: fail('config', e.code, e.message, { details: e.details, startMs }),
        exitCode: e.exitCode
      };
    }
    throw e;
  }
}

function reset() {
  const startMs = Date.now();
  try {
    const cfg = tryLoad();
    if (cfg && cfg.username) {
      const deleted = credentials.deletePassword(cfg.username);
      if (!deleted) {
        // 凭证删除失败且凭证仍存在时，返回 INTERNAL_ERROR，保留 config
        const stillExists = credentials.hasPassword(cfg.username);
        if (stillExists) {
          return {
            response: fail('config', ERROR_CODES.INTERNAL_ERROR, '凭证删除失败，已保留配置文件和凭证', {
              details: {
                username: cfg.username,
                hint: `请手动通过「控制面板 → 凭据管理器」删除 tfs-cli:${cfg.username}`
              },
              startMs
            }),
            exitCode: 1
          };
        }
        // 凭证本就不存在时允许继续删除 config
      }
    }
    // 删除 config 文件
    const fs = require('fs');
    if (fs.existsSync(CONFIG_PATH())) fs.unlinkSync(CONFIG_PATH());
    return {
      response: ok('config', {
        path: null,
        data: { operation: 'reset', removed: { config: true, password: !!(cfg && cfg.username) } },
        startMs
      }),
      exitCode: 0
    };
  } catch (e) {
    if (e instanceof CliError) {
      return {
        response: fail('config', e.code, e.message, { details: e.details, startMs }),
        exitCode: e.exitCode
      };
    }
    throw e;
  }
}

module.exports = { show, set: setKey, reset, SETTABLE_KEYS };
