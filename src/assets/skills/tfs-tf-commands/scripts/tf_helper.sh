#!/bin/bash
# TFS tf.exe helper script for Git Bash
# Reads config from tfs-config.json, auto-detects tf.exe path,
# wraps common tf commands with credential injection.

set -euo pipefail

# --- 禁用 MSYS/Git Bash 对 /foo 形式参数的自动路径转换 ---
# tf.exe 的参数大量以 / 开头（/server: /login: /noprompt /collection: /recursive），
# MSYS 会把它们误判为 Unix 路径并转换成 C:/Program Files/Git/... 导致 tf.exe 解析失败。
# 文件路径由脚本自身的 to_windows_path() 显式处理，无需 MSYS 介入。
# 注意：仅设 MSYS_NO_PATHCONV（关闭 /c->C: 转换），不用 MSYS2_ARG_CONV_EXCL='*'，
# 否则连 python 调用里 argv 形式的 /c/.../cred_helper.py 也不会被转换，Windows Python 无法识别。
export MSYS_NO_PATHCONV=1

# --- 路径转换函数（提前到顶部，被下面多处调用） ---
# /c/path -> C:\path
to_windows_path() {
  local p="$1"
  if [[ "$p" =~ ^/([a-zA-Z])/ ]]; then
    local drive=$(echo "${BASH_REMATCH[1]}" | tr '[:lower:]' '[:upper:]')
    local rest="${p:3}"
    rest="${rest//\//\\}"
    echo "${drive}:\\${rest}"
  else
    echo "$p"
  fi
}

# --- Locate config ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_PATH="${TFS_CONFIG_PATH:-$SKILL_DIR/assets/tfs-config.json}"

if [ ! -f "$CONFIG_PATH" ]; then
  echo "ERROR: TFS config not found at: $CONFIG_PATH" >&2
  echo "Please fill in assets/tfs-config.json with your TFS server, username, password." >&2
  exit 1
fi

# --- 把 CONFIG_PATH 转成 Windows 路径，避免 Python open() 无法解析 /c/ 风格路径 ---
# Git Bash 的 MSYS 仅对"独立 argv 参数"做路径转换，嵌入在 -c 字符串中的 /c/ 路径不会被转换，
# 而 Windows Python 的 open() 不识别 /c/ 格式。这里统一提前转换。
CONFIG_PATH_WIN=$(to_windows_path "$CONFIG_PATH")
# Python 脚本路径也需要 Windows 格式（MSYS_NO_PATHCONV=1 后 argv 不再自动转换 /c/ 路径）
SCRIPT_DIR_WIN=$(to_windows_path "$SCRIPT_DIR")

# --- Parse JSON config (no jq dependency, use python fallback) ---
parse_json() {
  local key="$1"
  python -c "
import json, sys
with open(r'$CONFIG_PATH_WIN', encoding='utf-8-sig') as f:
    data = json.load(f)
val = data.get('$key', '')
print(val if val else '')
" 2>/dev/null
}

# --- 自动迁移明文密码到系统凭证库 ---
# 若配置文件中残留明文 password，先搬到凭证库再删除明文
python "$SCRIPT_DIR_WIN/cred_helper.py" migrate "$CONFIG_PATH_WIN" >&2 || {
  echo "ERROR: 凭证库迁移失败，请检查 cred_helper.py 输出" >&2
  exit 1
}

TFS_SERVER=$(parse_json "server")
TFS_USERNAME=$(parse_json "username")
TFS_DOMAIN=$(parse_json "domain")

if [ -z "$TFS_USERNAME" ]; then
  echo "ERROR: username is empty in tfs-config.json" >&2
  echo "Please fill in assets/tfs-config.json." >&2
  exit 1
fi

# --- 从系统凭证库读取密码（不在配置文件中存明文） ---
TFS_PASSWORD=$(python "$SCRIPT_DIR_WIN/cred_helper.py" get "$TFS_USERNAME" 2>/dev/null) || {
  echo "ERROR: 未能在系统凭证库中读取 TFS 密码。" >&2
  echo "请运行: python \"$SCRIPT_DIR_WIN/cred_helper.py\" set \"$TFS_USERNAME\"" >&2
  echo "（随后输入密码），或参考 SKILL.md「首次配置」。" >&2
  exit 1
}
# 透传给 cred_helper.py 的错误信息
if [ -z "$TFS_PASSWORD" ]; then
  python "$SCRIPT_DIR_WIN/cred_helper.py" get "$TFS_USERNAME" >&2 || true
  exit 1
fi

# --- Auto-detect tf.exe ---
find_tf_exe() {
  local candidates=()

  # 1. Visual Studio 2022
  for d in "/c/Program Files/Microsoft Visual Studio/2022/"*/; do
    local p="${d}Common7/IDE/CommonExtensions/Microsoft/TeamFoundation/Team Explorer/tf.exe"
    [ -f "$p" ] && candidates+=("$p") && break
  done

  # 2. Visual Studio 2019
  for d in "/c/Program Files (x86)/Microsoft Visual Studio/2019/"*/; do
    local p="${d}Common7/IDE/CommonExtensions/Microsoft/TeamFoundation/Team Explorer/tf.exe"
    [ -f "$p" ] && candidates+=("$p") && break
  done

  # 3. Visual Studio 2017
  for d in "/c/Program Files (x86)/Microsoft Visual Studio/2017/"*/; do
    local p="${d}Common7/IDE/CommonExtensions/Microsoft/TeamFoundation/Team Explorer/tf.exe"
    [ -f "$p" ] && candidates+=("$p") && break
  done

  # 4. PATH lookup
  local path_tf=$(which tf.exe 2>/dev/null || true)
  [ -n "$path_tf" ] && candidates+=("$path_tf")

  # 5. Standalone Team Explorer 2022
  local te="/c/Program Files/Microsoft Visual Studio Team Explorer 2022/Common7/IDE/CommonExtensions/Microsoft/TeamFoundation/Team Explorer/tf.exe"
  [ -f "$te" ] && candidates+=("$te")

  if [ ${#candidates[@]} -gt 0 ]; then
    echo "${candidates[0]}"
    return 0
  fi
  return 1
}

TF_EXE_RAW=$(find_tf_exe) || {
  echo "ERROR: tf.exe not found. Searched:" >&2
  echo "  - VS 2022 Team Explorer" >&2
  echo "  - VS 2019 Team Explorer" >&2
  echo "  - VS 2017 Team Explorer" >&2
  echo "  - PATH" >&2
  echo "Please install Visual Studio with Team Explorer component," >&2
  echo "or add tf.exe to your PATH." >&2
  exit 1
}

# tf.exe 是 Windows 程序，需要 Windows 路径；MSYS_NO_PATHCONV=1 后 /c/ 不会自动转换，显式转一下
TF_EXE=$(to_windows_path "$TF_EXE_RAW")
echo "[TFS] Using tf.exe: $TF_EXE" >&2

# --- Build login argument ---
if [ -n "$TFS_DOMAIN" ]; then
  LOGIN_ARG="/login:${TFS_DOMAIN}\\${TFS_USERNAME},${TFS_PASSWORD}"
else
  LOGIN_ARG="/login:${TFS_USERNAME},${TFS_PASSWORD}"
fi

SERVER_ARG="/server:${TFS_SERVER}"

# --- Usage ---
usage() {
  echo "Usage: tf_helper.sh <action> [path] [options...]"
  echo ""
  echo "Actions:"
  echo "  checkout      - Check out a single file"
  echo "  undo          - Undo checkout of a file"
  echo "  checkout-dir  - Check out a directory (recursive)"
  echo "  add           - Add a file or directory to source control (recursive)"
  echo "  getlatest     - Get latest version (path optional, defaults to .)"
  echo "  history       - Show history of a path. Supports options below."
  echo "  status        - Show pending changes (path optional, defaults to .)"
  echo "  diff          - Diff working copy vs TFS latest (path optional, defaults to .)"
  echo "  test          - Test connection (verify auth + collection reachable)"
  echo ""
  echo "History options:"
  echo "  --today              History for today only"
  echo "  --since <date>       History from date to now, e.g. 2026-07-01"
  echo "  --range <range>      Version range, e.g. D2026-07-01~D2026-07-07"
  echo "  --recursive, -r      Recurse into subdirectories"
  echo "  --user <name>        Filter by user"
  echo "  --mine               Filter to current user ($TFS_USERNAME)"
  echo "  --limit <N>          Max results (default: 10, ignored with --today/--range/--since)"
  echo ""
  echo "Examples:"
  echo "  ./tf_helper.sh checkout /c/Projects/MyApp/Program.cs"
  echo "  ./tf_helper.sh undo /c/Projects/MyApp/Program.cs"
  echo "  ./tf_helper.sh checkout-dir /c/Projects/MyApp/src"
  echo "  ./tf_helper.sh add /c/Projects/MyApp/src/NewFile.cs"
  echo "  ./tf_helper.sh add /c/Projects/MyApp/src/NewFolder"
  echo "  ./tf_helper.sh getlatest /c/Projects/MyApp"
  echo "  ./tf_helper.sh history /c/Projects/MyApp"
  echo "  ./tf_helper.sh history /c/Projects/MyApp --today"
  echo "  ./tf_helper.sh history /c/Projects/MyApp --since 2026-07-01 --recursive"
  echo "  ./tf_helper.sh history --mine --today --limit 20"
  echo "  ./tf_helper.sh status /c/Projects/MyApp"
  echo "  ./tf_helper.sh status"
  echo "  ./tf_helper.sh diff /c/path/to/file.cs"
  echo "  ./tf_helper.sh diff /c/path/to/project"
  exit 1
}

# --- Parse args: action + optional flags + path ---
ACTION="${1:-}"
shift 2>/dev/null || true

# Flag defaults for history
HIST_RECURSIVE=""
HIST_VERSION_RANGE=""
HIST_USER=""
HIST_LIMIT=""
PATH_ARG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --recursive|-r)
      HIST_RECURSIVE="/recursive"
      ;;
    --today)
      TODAY=$(date +%Y-%m-%d)
      HIST_VERSION_RANGE="D${TODAY}~D${TODAY}"
      ;;
    --range)
      shift
      HIST_VERSION_RANGE="$1"
      # Auto-add D prefix if missing (allow D2026-07-07 or 2026-07-07)
      if [[ "$HIST_VERSION_RANGE" != D* ]]; then
        # Split on ~ and prefix each with D
        HIST_VERSION_RANGE=$(echo "$HIST_VERSION_RANGE" | sed 's/\([^~]*\)/D\1/g')
      fi
      ;;
    --since)
      shift
      TODAY=$(date +%Y-%m-%d)
      SINCE_VAL="$1"
      HIST_VERSION_RANGE="${SINCE_VAL}~D${TODAY}"
      if [[ "$SINCE_VAL" != D* ]]; then
        HIST_VERSION_RANGE="D${SINCE_VAL}~D${TODAY}"
      fi
      ;;
    --user)
      shift
      HIST_USER="/user:$1"
      ;;
    --mine)
      HIST_USER="/user:${TFS_USERNAME}"
      ;;
    --limit)
      shift
      HIST_LIMIT="/stopafter:$1"
      ;;
    --help|-h)
      usage
      ;;
    --*)
      echo "ERROR: Unknown option $1" >&2
      exit 1
      ;;
    *)
      # First non-flag arg is the path
      if [ -z "$PATH_ARG" ]; then
        PATH_ARG="$1"
      else
        echo "ERROR: Unexpected extra argument '$1'" >&2
        exit 1
      fi
      ;;
  esac
  shift
done

if [ -z "$ACTION" ]; then
  usage
fi

# Treat a leading -- flag (--help only) as global, not an action
if [[ "$ACTION" == --* ]]; then
  case "$ACTION" in
    --help|-h) usage ;;
    *) echo "ERROR: Unknown global option '$ACTION'. Use --help for usage." >&2; exit 1 ;;
  esac
fi

# --- Execute action ---
case "$ACTION" in
  checkout)
    [ -z "$PATH_ARG" ] && echo "ERROR: checkout requires a path argument" >&2 && exit 1
    WIN_PATH=$(to_windows_path "$PATH_ARG")
    echo "[TFS] Checking out file: $WIN_PATH" >&2
    # 本地工作区下 tf checkout 不接受 /server:（会报"无法识别的命令选项 server"），
    # 仅在本地工作区命令中省略 SERVER_ARG；login 仍需传入以认证。
    "$TF_EXE" checkout "$WIN_PATH" "$LOGIN_ARG" /noprompt
    ;;

  undo)
    [ -z "$PATH_ARG" ] && echo "ERROR: undo requires a path argument" >&2 && exit 1
    WIN_PATH=$(to_windows_path "$PATH_ARG")
    echo "[TFS] Undoing checkout: $WIN_PATH" >&2
    # 同 checkout：本地工作区下省略 /server:
    "$TF_EXE" undo "$WIN_PATH" "$LOGIN_ARG" /noprompt
    ;;

  checkout-dir)
    [ -z "$PATH_ARG" ] && echo "ERROR: checkout-dir requires a path argument" >&2 && exit 1
    WIN_PATH=$(to_windows_path "$PATH_ARG")
    echo "[TFS] Checking out directory (recursive): $WIN_PATH" >&2
    "$TF_EXE" checkout "$WIN_PATH" /recursive "$LOGIN_ARG" /noprompt
    ;;

  add)
    [ -z "$PATH_ARG" ] && echo "ERROR: add requires a path argument" >&2 && exit 1
    WIN_PATH=$(to_windows_path "$PATH_ARG")
    echo "[TFS] Adding to source control: $WIN_PATH" >&2
    "$TF_EXE" add "$WIN_PATH" /recursive "$LOGIN_ARG" /noprompt
    ;;

  getlatest)
    TARGET_PATH="."
    if [ -n "$PATH_ARG" ]; then
      TARGET_PATH=$(to_windows_path "$PATH_ARG")
    fi
    echo "[TFS] Getting latest: $TARGET_PATH" >&2
    "$TF_EXE" get "$TARGET_PATH" /recursive "$SERVER_ARG" "$LOGIN_ARG" /noprompt
    ;;

  history)
    TARGET_PATH="."
    if [ -n "$PATH_ARG" ]; then
      TARGET_PATH=$(to_windows_path "$PATH_ARG")
    fi
    WIN_PATH="$TARGET_PATH"
    # Build extra args
    HIST_VERSION_ARG=""
    if [ -n "$HIST_VERSION_RANGE" ]; then
      HIST_VERSION_ARG="/version:${HIST_VERSION_RANGE}"
    fi
    # Default limit: 10 when no version range; no limit when range is specified
    if [ -z "$HIST_LIMIT" ] && [ -z "$HIST_VERSION_RANGE" ]; then
      HIST_LIMIT="/stopafter:10"
    fi
    HISTORY_TTL="${TFS_HISTORY_TTL:-300}"
    # Cache only when no flags modify the query (version range / user / recursive change the result shape)
    USE_CACHE=false
    if [ -z "$HIST_VERSION_RANGE" ] && [ -z "$HIST_USER" ] && [ -z "$HIST_RECURSIVE" ] && [ "${TFS_NO_CACHE:-0}" != "1" ] && [ "${TFS_HISTORY_REFRESH:-0}" != "1" ]; then
      USE_CACHE=true
    fi
    if $USE_CACHE; then
      CACHED=$(python "$SCRIPT_DIR_WIN/cache_helper.py" get "$WIN_PATH" "$HISTORY_TTL" 2>/dev/null) || CACHED=""
      if [ -n "$CACHED" ]; then
        echo "[TFS] History for: $WIN_PATH (cached, ttl=${HISTORY_TTL}s)" >&2
        printf '%s\n' "$CACHED"
        exit 0
      fi
    fi
    echo "[TFS] History for: $WIN_PATH${HIST_VERSION_RANGE:+ (range: $HIST_VERSION_RANGE)}${HIST_USER:+ (user: $HIST_USER)}" >&2
    TMP_OUT=$(mktemp) || { echo "ERROR: Cannot create temp file" >&2; exit 1; }
    trap 'rm -f "$TMP_OUT"' EXIT INT TERM
    set +e
    "$TF_EXE" history "$WIN_PATH" $HIST_RECURSIVE $HIST_VERSION_ARG $HIST_USER $HIST_LIMIT "$SERVER_ARG" "$LOGIN_ARG" /noprompt /format:detailed | tee "$TMP_OUT"
    HIST_EXIT=${PIPESTATUS[0]}
    set -e
    if [ "$HIST_EXIT" -eq 0 ] && $USE_CACHE; then
      python "$SCRIPT_DIR_WIN/cache_helper.py" set "$WIN_PATH" < "$TMP_OUT" 2>/dev/null || true
    fi
    rm -f "$TMP_OUT"
    exit $HIST_EXIT
    ;;

  status)
    TARGET_PATH="."
    if [ -n "$PATH_ARG" ]; then
      TARGET_PATH=$(to_windows_path "$PATH_ARG")
    fi
    echo "[TFS] Pending changes: $TARGET_PATH" >&2
    # 本地工作区下 tf status 不接受 /server:（会输出"正在忽略 /server 选项"警告），省略之
    "$TF_EXE" status "$TARGET_PATH" /recursive "$LOGIN_ARG" /noprompt
    ;;

  diff)
    # diff 当前工作区 vs TFS 最新版本（unified diff 格式，AI 场景便于解析）
    # 路径可选，默认当前目录（递归）
    TARGET_PATH="."
    if [ -n "$PATH_ARG" ]; then
      TARGET_PATH=$(to_windows_path "$PATH_ARG")
    fi
    echo "[TFS] Diff vs TFS latest: $TARGET_PATH" >&2
    # diff 输出可能很长，不走 history 那种缓存（必须新鲜）
    # 本地工作区下不需要 /server:（避免警告）；/format:unified 输出标准 unified diff
    "$TF_EXE" diff "$TARGET_PATH" /recursive "$LOGIN_ARG" /noprompt /format:unified
    ;;

  test)
    # 连接测试：用 tf workspaces 验证认证 + 集合连通，不依赖本地工作区映射
    # 退出码 0 = 认证通过；非 0 = 认证失败 / 网络不通
    echo "[TFS] 测试连接（验证认证 + 集合连通性）..." >&2
    COLLECTION_ARG="/collection:${TFS_SERVER}"
    # 关闭 set -e 以捕获 tf.exe 的非零退出码（否则脚本会提前退出，跳过下方提示）
    set +e
    "$TF_EXE" workspaces "$COLLECTION_ARG" "$LOGIN_ARG" /noprompt
    TEST_EXIT=$?
    set -e
    if [ $TEST_EXIT -eq 0 ]; then
      echo "[TFS] ✅ 连接测试通过：认证成功，集合可达。" >&2
    else
      echo "[TFS] ❌ 连接测试失败（exit=$TEST_EXIT）。请检查凭证、用户名、domain 及服务器地址。" >&2
    fi
    exit $TEST_EXIT
    ;;

  *)
    echo "ERROR: Unknown action '$ACTION'" >&2
    usage
    ;;
esac

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo "[TFS] Command exited with code: $EXIT_CODE" >&2
fi
exit $EXIT_CODE
