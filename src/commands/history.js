'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ok, fail } = require('../formatters/output');
const { CliError, ERROR_CODES, ERROR_EXIT_CODES } = require('../errors');
const { canonicalize } = require('../path');

/**
 * tfs-cli history [path] [flags]
 *
 * flags:
 *   --today              当天历史
 *   --since YYYY-MM-DD   从指定日期到今天
 *   --range Dxx~Dyy      版本范围（允许省略 D 前缀）
 *   --recursive, -r      递归
 *   --user <name>        按用户筛选
 *   --mine               仅当前用户
 *   --limit <N>          最多 N 条（默认 10；带 version 时不限制）
 *
 * 缓存：默认开启 5 分钟 TTL，按规范化路径做 key。
 * 当 flags 改变查询形状时（--today/--since/--range/--user/--recursive）跳过缓存。
 *
 * 环境变量：
 *   TFS_HISTORY_TTL=<秒>     自定义 TTL（默认 300）
 *   TFS_NO_CACHE=1           完全禁用缓存
 *   TFS_HISTORY_REFRESH=1    强制刷新（重写缓存）
 */

const CACHE_PATH = path.join(os.homedir(), '.tfs_cli_history_cache.json');
const DEFAULT_TTL = 300;

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch (e) {
    return {};
  }
}
function saveCache(c) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(c, null, 2), 'utf-8');
  } catch (e) {
    // 忽略 — 缓存失败不影响主流程
  }
}

function getTtl() {
  const env = process.env.TFS_HISTORY_TTL;
  if (env && /^\d+$/.test(env)) return parseInt(env, 10);
  return DEFAULT_TTL;
}

function todayD() {
  const d = new Date();
  return (
    'D' +
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function buildRange(from, to) {
  const toD = to ? (to.startsWith('D') ? to : 'D' + to) : todayD();
  const fromD = from.startsWith('D') ? from : 'D' + from;
  return fromD + '~' + toD;
}

/**
 * @param {object} opts
 * @param {string} [opts.inputPath]
 * @param {boolean} [opts.today]
 * @param {string} [opts.since]
 * @param {string} [opts.range]
 * @param {boolean} [opts.recursive]
 * @param {string} [opts.user]
 * @param {boolean} [opts.mine]
 * @param {number|string} [opts.limit]
 * @param {object} ctx
 */
async function history(opts, ctx) {
  const targetRaw = opts.inputPath || '.';
  const win = opts.inputPath ? require('../path').toWindows(opts.inputPath) : '.';
  const cacheKey = canonicalize(win);

  // 构造 tf 参数
  const args = ['history', win, '/format:detailed'];
  if (opts.recursive) args.push('/recursive');

  let versionRange = null;
  if (opts.today) versionRange = todayD() + '~' + todayD();
  else if (opts.since) versionRange = buildRange(opts.since, null);
  else if (opts.range) versionRange = buildRange(opts.range, '');

  if (versionRange) args.push('/version:' + versionRange);

  if (opts.mine) args.push('/user:' + ctx.config.username);
  else if (opts.user) args.push('/user:' + opts.user);

  // limit：仅在不带 version 时生效
  const limit = opts.limit != null ? parseInt(String(opts.limit), 10) : null;
  if (limit && Number.isFinite(limit) && !versionRange) args.push('/stopafter:' + limit);
  else if (limit && Number.isFinite(limit) && versionRange) args.push('/stopafter:' + limit);

  const queryShape = !!versionRange || !!opts.user || !!opts.mine || !!opts.recursive;
  const ttl = getTtl();
  const useCache = process.env.TFS_NO_CACHE !== '1' && !queryShape;
  const refresh = process.env.TFS_HISTORY_REFRESH === '1';

  if (useCache && !refresh) {
    const cache = loadCache();
    const entry = cache[cacheKey];
    if (entry && Date.now() - (entry.ts || 0) <= ttl * 1000) {
      return {
        response: ok('history', {
          path: win,
          data: {
            target: win,
            entries: parseHistoryEntries(entry.output),
            count: 0,
            raw: entry.output
          },
          meta: { tf_exit: 0, cache_hit: true, duration_ms: 0 },
          startMs: ctx.startMs
        }),
        exitCode: 0
      };
    }
  }

  const r = await ctx.executor.run(args);
  if (!r.ok) {
    return {
      response: fail('history', 'AUTH_FAILED', '查看历史失败', {
        path: win,
        details: { stderr: r.stderr.trim(), exitCode: r.exitCode },
        meta: { tf_exit: r.exitCode, cache_hit: false, duration_ms: r.durationMs }
      }),
      exitCode: 1
    };
  }

  if (useCache) {
    const cache = loadCache();
    cache[cacheKey] = { ts: Date.now(), output: r.stdout };
    saveCache(cache);
  }

  const entries = parseHistoryEntries(r.stdout);
  return {
    response: ok('history', {
      path: win,
      data: {
        target: win,
        entries,
        count: entries.length,
        raw: r.stdout
      },
      meta: { tf_exit: r.exitCode, cache_hit: false, duration_ms: r.durationMs },
      startMs: ctx.startMs
    }),
    exitCode: 0
  };
}

/**
 * 把 tf history 的详细输出解析为条目。
 * tf.exe 输出格式因版本差异较大，做宽松解析，主要字段：changeset / user / date / comment。
 *
 * @param {string} stdout
 * @returns {Array<{changeset:string, user:string|null, date:string|null, comment:string}>}
 */
function parseHistoryEntries(stdout) {
  if (!stdout) return [];
  // tf /format:detailed 的常见格式：
  //   Changeset: 12345  User: alice  Date: 2026-07-07
  //   Comment:   foo bar
  //   ---------
  //   ...
  const lines = stdout.split(/\r?\n/);
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const cs = line.match(/^\s*(?:Changeset|变更集)\s*[:：]\s*(\S+)/i);
    if (cs) {
      if (cur) entries.push(cur);
      cur = { changeset: cs[1], user: null, date: null, comment: '' };
      continue;
    }
    if (!cur) continue;
    const u = line.match(/^\s*(?:User|用户)\s*[:：]\s*(.+?)\s*$/i);
    if (u) {
      cur.user = u[1].trim();
      continue;
    }
    const d = line.match(/^\s*(?:Date|日期)\s*[:：]\s*(.+?)\s*$/i);
    if (d) {
      cur.date = d[1].trim();
      continue;
    }
    const c = line.match(/^\s*(?:Comment|注释)\s*[:：]\s*(.*)$/i);
    if (c) {
      cur.comment = (cur.comment ? cur.comment + '\n' : '') + c[1];
      continue;
    }
    // 其它行归入 comment（多行）
    if (cur && line.trim() && !/^[-\s=]+$/.test(line)) {
      cur.comment += (cur.comment ? '\n' : '') + line.trim();
    }
  }
  if (cur) entries.push(cur);
  return entries.map((e) => ({ ...e, comment: e.comment.trim() }));
}

module.exports = { history, parseHistoryEntries };
