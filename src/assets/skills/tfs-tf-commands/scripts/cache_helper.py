#!/usr/bin/env python3
"""history 输出缓存助手。

只缓存 tfs-tf-commands 的 history action 结果。status 不缓存（反映本地
实时状态，缓存易过期）。用 TTL 控制失效，默认 300 秒（5 分钟）。

缓存文件：用户目录/tfs_tf_cache.json
结构：
{
  "history": {
    "<规范化后的文件路径>": {
      "cached_at": 1719900000.0,   # epoch 秒
      "output": "<tf history 的 stdout 文本>"
    }
  }
}

子命令：
  get <path> [ttl_seconds]
      命中 → 把缓存的 stdout 输出到 stdout，退出码 0
      未命中/过期 → 什么都不输出，退出码 1
  set <path>
      从 stdin 读取 tf history 的 stdout，写入缓存，退出码 0
  clear [<path>]
      无参数 → 清空整个缓存；有参数 → 只删该路径的条目
  path
      打印缓存文件的绝对路径（供调试/手动清理）
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

DEFAULT_TTL = 300  # 5 分钟


def cache_file() -> Path:
    return Path.home() / ".tfs_tf_cache.json"


def normalize(p: str) -> str:
    """规范化路径作为缓存 key：绝对路径 + 统一小写 + 统一斜杠。"""
    # 转 absolute（不要求存在）
    abs_p = str(Path(p).expanduser().resolve(strict=False))
    # 统一为小写 + 正斜杠，避免 C:\x 和 c:/x 分裂成两个 key
    return abs_p.lower().replace("\\", "/")


def load() -> dict:
    f = cache_file()
    if not f.is_file():
        return {"history": {}}
    try:
        data = json.loads(f.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, OSError):
        return {"history": {}}
    data.setdefault("history", {})
    return data


def save(data: dict) -> None:
    f = cache_file()
    f.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cmd_get(args: list[str]) -> int:
    if not args:
        die("用法: cache_helper.py get <path> [ttl_seconds]")
    key = normalize(args[0])
    ttl = DEFAULT_TTL
    if len(args) >= 2:
        try:
            ttl = int(args[1])
        except ValueError:
            die(f"ttl_seconds 必须是整数，收到: {args[1]}")
    data = load()
    entry = data["history"].get(key)
    if not entry:
        return 1  # 未命中
    cached_at = entry.get("cached_at", 0)
    if time.time() - cached_at > ttl:
        return 1  # 过期
    output = entry.get("output", "")
    sys.stdout.write(output)
    if not output.endswith("\n"):
        sys.stdout.write("\n")
    return 0


def cmd_set(args: list[str]) -> int:
    if not args:
        die("用法: cache_helper.py set <path>（tf history 输出从 stdin 读取）")
    key = normalize(args[0])
    output = sys.stdin.read()
    data = load()
    data["history"][key] = {"cached_at": time.time(), "output": output}
    save(data)
    return 0


def cmd_clear(args: list[str]) -> int:
    data = load()
    if args:
        key = normalize(args[0])
        data["history"].pop(key, None)
        save(data)
        print(f"已清除 history 缓存：{args[0]}")
    else:
        data["history"] = {}
        save(data)
        print("已清空全部 history 缓存")
    return 0


def cmd_path(_args: list[str]) -> int:
    print(cache_file())
    return 0


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(2)


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    cmd, rest = args[0], args[1:]
    table = {
        "get": cmd_get,
        "set": cmd_set,
        "clear": cmd_clear,
        "path": cmd_path,
    }
    handler = table.get(cmd)
    if not handler:
        die(f"未知子命令: {cmd}\n\n{__doc__}")
    return handler(rest)


if __name__ == "__main__":
    sys.exit(main())
