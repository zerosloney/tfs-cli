'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS_ROOT = path.join(__dirname, '..', 'assets');
const TFS_SECTION_MARKER = '<!-- forge:tfs-rules -->';

/**
 * 注入根文档（AGENTS.md / CLAUDE.md）
 *
 * 三态逻辑（用 marker 幂等去重）：
 * - 文档不存在 → 整个复制源文件
 * - 存在但无 marker → 追加源文件中 marker 之间的段落
 * - 存在且已有 marker → 跳过；force=true 时正则替换 marker 之间内容
 *
 * @param {string} targetDir
 * @param {object} agentEntry  registry 中 agent 的元数据（用 docFile / docSource）
 * @param {boolean} force
 * @returns {boolean} 是否实际写入了文件
 */
function injectDoc(targetDir, agentEntry, force = false) {
  const sourcePath = path.join(ASSETS_ROOT, agentEntry.docSource);
  const destPath = path.join(targetDir, agentEntry.docFile);

  if (!fs.existsSync(sourcePath)) {
    console.warn(`[forge] ⚠️  源文档不存在: ${sourcePath}，跳过 ${agentEntry.docFile}`);
    return false;
  }

  const sourceContent = fs.readFileSync(sourcePath, 'utf-8');

  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, sourceContent, 'utf-8');
    console.log(`[forge] ✅ ${agentEntry.docFile} 已创建: ${destPath}`);
    return true;
  }

  const existing = fs.readFileSync(destPath, 'utf-8');
  const hasMarker = existing.includes(TFS_SECTION_MARKER);

  if (!hasMarker) {
    const section = extractMarkerSection(sourceContent);
    const sep = existing.endsWith('\n') ? '\n' : '\n\n';
    fs.appendFileSync(destPath, sep + section + '\n', 'utf-8');
    console.log(`[forge] ✅ ${agentEntry.docFile} 已追加 TFS 规则: ${destPath}`);
    return true;
  }

  // 已有 marker
  if (!force) {
    console.log(`[forge] ⏭️  ${agentEntry.docFile} 已包含 TFS 规则，跳过 (--force 覆盖)`);
    return false;
  }

  const section = extractMarkerSection(sourceContent);
  const replaced = replaceBetweenMarkers(existing, TFS_SECTION_MARKER, section);
  fs.writeFileSync(destPath, replaced, 'utf-8');
  console.log(`[forge] ✅ ${agentEntry.docFile} TFS 规则已更新: ${destPath}`);
  return true;
}

/**
 * 从源文档中抽取两个 marker 之间的段落（含 marker 本身）
 * 若源文档结构异常（只有一个 marker），返回源文档去掉首行标题之后的全部内容
 */
function extractMarkerSection(source) {
  const first = source.indexOf(TFS_SECTION_MARKER);
  if (first === -1) return source;
  const last = source.lastIndexOf(TFS_SECTION_MARKER);
  if (last === first) {
    // 单 marker：取 marker 及其之后内容
    return source.slice(first).replace(/\s+$/, '');
  }
  return source.slice(first, last + TFS_SECTION_MARKER.length);
}

/**
 * 替换两个 marker 之间的内容（含 marker 本身）
 * - 正常两 marker：精确替换，无空行累积
 * - 单 marker（文件被人为破坏）：视为损坏，整体重建为 marker 之前内容 + newContent
 * - 无 marker：直接追加
 */
function replaceBetweenMarkers(text, marker, newContent) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}[\\s\\S]*?${escaped}`);
  if (re.test(text)) {
    return text.replace(re, newContent.trim());
  }
  if (text.includes(marker)) {
    const beforeMarker = text.slice(0, text.indexOf(marker)).replace(/\s+$/, '');
    return beforeMarker + '\n' + newContent;
  }
  return text + '\n' + newContent;
}

module.exports = { injectDoc, TFS_SECTION_MARKER, replaceBetweenMarkers };
