#!/bin/bash
# tfs-edit.sh — 编辑前自动签出 TFS 文件，含冲突检测。
# 兼容中英文 tf.exe —— 用 status 输出里的 owner 字段（User / 用户）判断签出状态，
# 不依赖 tf.exe 错误消息的文本（中文 tf.exe 的"已被签出"匹配不到英文关键字）。
#
# 调用方（WorkBuddy 或其他工具）在任何编辑操作前调此脚本，
# 它会先查文件状态，如果被他人签出则提示签出者信息等待用户介入。
#
# 退出码：
#   0 = 可以编辑（已签出、已被本工作区签出、或签出成功）
#   1 = 别人已签出，无法继续（脚本会输出签出者信息）
#   2 = 其他错误（路径不可用、tf.exe 找不到等）
#
# 用法：
#   ./tfs-edit.sh <文件路径>
#
# 批量：
#   find /c/MyProject/src -name "*.cs" -exec ./tfs-edit.sh {} \;

set -euo pipefail

FILE="${1:-}"
[ -z "$FILE" ] && echo "ERROR: 用法: tfs-edit.sh <文件路径>" >&2 && exit 2
FILE="${FILE%/}"

if [ ! -f "$FILE" ] && [ ! -d "$FILE" ]; then
  echo "ERROR: 路径不存在: $FILE" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_HELPER="$SCRIPT_DIR/tf_helper.sh"

if [ ! -f "$TF_HELPER" ]; then
  echo "ERROR: tf_helper.sh 未找到 (期望路径: $TF_HELPER)" >&2
  exit 2
fi

# --- 工具函数：把 /c/path 风格的路径转成 C:\path（仅在需要时给 python 用） ---
to_windows_path() {
  local p="$1"
  if [[ "$p" =~ ^/([a-zA-Z])/ ]]; then
    local drive=$(echo "${BASH_REMATCH[1]}" | tr '[:lower:]' '[:upper:]')
    local rest="${p:3}"
    echo "${drive}:${rest//\//\\}"
  else
    echo "$p"
  fi
}

# --- 工具函数：从 tf status 输出里抽取 owner 字段 ---
# tf.exe 中英文输出字段名不同：
#   英文："User: DOMAIN\foo" / "User: foo"
#   中文："用户: DOMAIN\foo" / "用户: foo"
# 统一用 (User|用户) 正则匹配，不依赖错误消息文本
extract_owner() {
  printf '%s\n' "$1" | \
    grep -E "^[[:space:]]*(User|用户)[[:space:]]*:" | \
    head -1 | \
    sed -E 's/^[[:space:]]*(User|用户)[[:space:]]*:[[:space:]]*//' | \
    tr -d '\r'
}

# --- 工具函数：读当前用户名（从 tfs-config.json 的 username 字段） ---
# 用于和 owner 比对，判断是不是本工作区签出的
read_current_user() {
  local config_path="${TFS_CONFIG_PATH:-$SCRIPT_DIR/../assets/tfs-config.json}"
  local config_win
  config_win=$(to_windows_path "$config_path" 2>/dev/null || echo "$config_path")
  python -c "
import json, sys
try:
    with open(r'''$config_win''', encoding='utf-8-sig') as f:
        d = json.load(f)
    print(d.get('username', '') or '')
except Exception:
    pass
" 2>/dev/null
}

# --- 工具函数：比较两个用户名是否等价 ---
# Windows 用户可能是 "DOMAIN\user"、"user"、"user@domain.tld" 等
# 取最右段、去掉 @domain 兜底、大小写不敏感比较
# 注意：current_user 为空时返回 1（不匹配），调用方需自行处理
same_user() {
  local a="$1" b="$2"
  [ -z "$a" ] || [ -z "$b" ] && return 1
  local short_a="${a##*\\}"
  local short_b="${b##*\\}"
  short_a="${short_a%%@*}"
  short_b="${short_b%%@*}"
  if [ "${short_a,,}" = "${short_b,,}" ]; then
    return 0
  fi
  return 1
}

CURRENT_USER=$(read_current_user)
if [ -z "$CURRENT_USER" ]; then
  echo "[TFS-EDIT] ⚠️  无法读取当前用户名（tfs-config.json 缺失或 username 为空），owner 比对将跳过" >&2
fi

# --- 步骤 1：先查 status 看文件当前是否被签出 ---
echo "[TFS-EDIT] 查询文件状态: $FILE" >&2
set +e
STATUS_OUTPUT=$("$TF_HELPER" status "$FILE" 2>&1)
STATUS_EXIT=$?
set -e

OWNER=$(extract_owner "$STATUS_OUTPUT")

# --- 步骤 2：基于 owner 做决策 ---
if [ -n "$OWNER" ]; then
  if [ -n "$CURRENT_USER" ] && same_user "$OWNER" "$CURRENT_USER"; then
    echo "[TFS-EDIT] ✅ 文件已被当前用户（$CURRENT_USER）签出，可以编辑" >&2
    exit 0
  fi
  # 被他人签出，或 current_user 为空无法比对
  echo "[TFS-EDIT] ❌ 文件被他人签出: $OWNER" >&2
  echo "" >&2
  echo "解决方式:" >&2
  echo "  1. 联系签出者（$OWNER）签入或搁置变更" >&2
  echo "  2. 如果确定要强制签出，手动运行:" >&2
  echo "     \"$TF_HELPER\" undo \"$FILE\" && \"$TF_HELPER\" checkout \"$FILE\"" >&2
  exit 1
fi

# --- 步骤 3：未拿到 owner（文件未被签出 / 不在工作区 / status 失败）→ 尝试 checkout ---
echo "[TFS-EDIT] 签出: $FILE" >&2
set +e
CHECKOUT_OUTPUT=$("$TF_HELPER" checkout "$FILE" 2>&1)
CHECKOUT_EXIT=$?
set -e

if [ "$CHECKOUT_EXIT" -eq 0 ]; then
  printf '%s\n' "$CHECKOUT_OUTPUT"
  echo "[TFS-EDIT] ✅ 可以编辑: $FILE" >&2
  exit 0
fi

# --- 步骤 4：checkout 失败 —— 兜底再查一次 status 找原因 ---
printf '%s\n' "$CHECKOUT_OUTPUT" >&2
echo "[TFS-EDIT] ❌ 签出失败（exit=$CHECKOUT_EXIT）" >&2

set +e
RETRY_STATUS=$("$TF_HELPER" status "$FILE" 2>&1)
set -e
RETRY_OWNER=$(extract_owner "$RETRY_STATUS")
if [ -n "$RETRY_OWNER" ]; then
  if [ -z "$CURRENT_USER" ]; then
    echo "" >&2
    echo "（兜底检测）文件已被签出（owner=$RETRY_OWNER），无法读取当前用户名比对" >&2
  elif same_user "$RETRY_OWNER" "$CURRENT_USER"; then
    echo "" >&2
    echo "（兜底检测）文件已被当前用户签出，但 checkout 仍失败 —— 可能是工作区映射问题" >&2
  else
    echo "" >&2
    echo "（兜底检测）文件已被 $RETRY_OWNER 签出" >&2
    exit 1
  fi
fi

# 其他错误（不在工作区、凭证过期、网络等）
echo "" >&2
echo "可能原因:" >&2
echo "  - 文件不在 TFS 工作区映射中" >&2
echo "  - 凭证已过期（重新配置：python scripts/cred_helper.py set <用户名>）" >&2
echo "  - TFS 服务器不可达" >&2
exit 1
