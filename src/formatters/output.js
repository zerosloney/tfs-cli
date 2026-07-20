'use strict';

/**
 * 输出格式化器。
 *
 * 两条命令通道：
 *   - JSON（默认）：永远输出一份结构化对象，AI 直接 parse
 *   - TEXT（--text）：人类可读的短句摘要
 *
 * 命令处理器只需要构造 Response 对象并调用 emit()，
 * 退出码由命令根据 ok 字段自行决定（见 bin/tfs-cli.js）。
 *
 * Response 字段（与 SKILL.md / README 里描述对齐）：
 *   ok         bool
 *   action     string — 当前子命令名
 *   path       string | null
 *   data       object | null — 命令特定数据
 *   error      { code, message, details } | null
 *   meta       { duration_ms, tf_exit, cache_hit, ... }
 */

/**
 * 构造成功响应。
 *
 * @param {string} action
 * @param {object} [opts]
 * @param {string|null} [opts.path]
 * @param {object} [opts.data]
 * @param {object} [opts.meta]
 * @param {number} [opts.startMs]
 * @returns {object}
 */
function ok(action, { path = null, data = null, meta = {}, startMs = Date.now() } = {}) {
  return {
    ok: true,
    action,
    path,
    data,
    error: null,
    meta: { ...meta, duration_ms: Date.now() - startMs }
  };
}

/**
 * 构造失败响应。
 *
 * @param {string} action
 * @param {string} code
 * @param {string} message
 * @param {object} [opts]
 * @param {string|null} [opts.path]
 * @param {object|null} [opts.details]
 * @param {object} [opts.meta]
 * @param {number} [opts.startMs]
 * @returns {object}
 */
function fail(action, code, message, { path = null, details = null, meta = {}, startMs = Date.now() } = {}) {
  return {
    ok: false,
    action,
    path,
    data: null,
    error: { code, message, details },
    meta: { ...meta, duration_ms: Date.now() - startMs }
  };
}

/**
 * 序列化为字符串。
 *
 * @param {object} response
 * @param {object} [opts]
 * @param {boolean} [opts.text=false]
 * @returns {string}
 */
function format(response, { text = false } = {}) {
  if (!text) {
    return JSON.stringify(response, null, 2);
  }
  return formatText(response);
}

/**
 * 人类可读摘要。故意极简——只取 ok/action/error.code/path，
 * 详细数据请用 JSON 通道。
 *
 * @param {object} r
 * @returns {string}
 */
function formatText(r) {
  if (!r.ok) {
    const where = r.path ? `: ${r.path}` : '';
    return `[tfs-cli] ${r.action} FAILED (${r.error.code})${where} — ${r.error.message}`;
  }
  const where = r.path ? `: ${r.path}` : '';
  switch (r.action) {
    case 'checkout':
      return `[tfs-cli] ✓ checked out${where}`;
    case 'undo':
      return `[tfs-cli] ✓ undo${where}`;
    case 'edit':
      return r.data && r.data.alreadyCheckedOut
        ? `[tfs-cli] ✓ already checked out by current user${where}`
        : `[tfs-cli] ✓ ready to edit${where}`;
    case 'add':
      return `[tfs-cli] ✓ added (pending)${where}`;
    case 'getlatest':
      return r.data && r.data.target ? `[tfs-cli] ✓ updated: ${r.data.target}` : `[tfs-cli] ✓ updated`;
    case 'history':
      return `[tfs-cli] ✓ history${where}${r.meta.cache_hit ? ' (cached)' : ''}`;
    case 'status':
      if (r.data && Array.isArray(r.data.pending) && r.data.pending.length === 0) {
        return `[tfs-cli] ✓ no pending changes${where}`;
      }
      return `[tfs-cli] ✓ status${where} (${r.data && r.data.pending ? r.data.pending.length : 0} changes)`;
    case 'diff':
      return `[tfs-cli] ✓ diff${where}`;
    case 'test':
      return r.data && r.data.reachable
        ? `[tfs-cli] ✓ connection OK (collection: ${r.data.collection})`
        : `[tfs-cli] ✓ test passed`;
    case 'init':
      return `[tfs-cli] ✓ config written: ${r.data && r.data.configPath}`;
    case 'config':
      return `[tfs-cli] ✓ config ${r.data && r.data.operation}${r.data && r.data.key ? ` ${r.data.key}` : ''}`;
    case 'inject':
      return `[tfs-cli] ✓ injected ${r.data && r.data.written ? r.data.written.length : 0} file(s)`;
    default:
      return `[tfs-cli] ✓ ${r.action}${where}`;
  }
}

module.exports = { ok, fail, format, formatText };
