#!/usr/bin/env python3
"""凭证库助手 — Windows 用 cmdkey/CredReadW，其他平台用 keyring 包。

与 tfs-query 技能同源的凭证读写算法，但使用独立的 service 名
`tfs-tf-commands`，避免与其它技能的凭证相互覆盖。

子命令：
  get <username>            从系统凭证库读取密码，输出到 stdout
  set <username>            从 stdin 读取密码并写入系统凭证库
  delete <username>         删除系统凭证库中的密码
  migrate <config_path>     读取配置中的明文 password，迁移到凭证库后
                            写入 password_ref 并删除明文密码
"""
from __future__ import annotations

import ctypes
import json
import platform
import re
import subprocess
import sys
from pathlib import Path

KEYRING_SERVICE = "tfs-tf-commands"


def credential_target(username: str) -> str:
    return f"{KEYRING_SERVICE}:{username}"


# --------------------------------------------------------------------------- #
# 写入
# --------------------------------------------------------------------------- #
def save_password(username: str, password: str) -> None:
    if not password:
        die("密码不能为空")
    system = platform.system().lower()
    if system == "windows":
        target = credential_target(username)
        subprocess.run(
            ["cmdkey", f"/generic:{target}", f"/user:{username}", f"/pass:{password}"],
            check=True,
            capture_output=True,
            text=True,
        )
        return
    try:
        import keyring  # type: ignore
    except ImportError as exc:
        die("系统凭证库不可用：请安装 keyring，或在 Windows 上运行以使用 cmdkey")
    keyring.set_password(KEYRING_SERVICE, username, password)


# --------------------------------------------------------------------------- #
# 读取
# --------------------------------------------------------------------------- #
class _CREDENTIAL(ctypes.Structure):
    _fields_ = [
        ("Flags", ctypes.c_uint32),
        ("Type", ctypes.c_uint32),
        ("TargetName", ctypes.c_wchar_p),
        ("Comment", ctypes.c_wchar_p),
        ("LastWritten", ctypes.c_uint64),
        ("CredentialBlobSize", ctypes.c_uint32),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", ctypes.c_uint32),
        ("AttributeCount", ctypes.c_uint32),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", ctypes.c_wchar_p),
        ("UserName", ctypes.c_wchar_p),
    ]


def _read_windows_credential(target: str) -> str | None:
    advapi32 = ctypes.windll.advapi32  # type: ignore[attr-defined]
    cred_ptr = ctypes.POINTER(_CREDENTIAL)()
    # CRED_TYPE_GENERIC = 1
    if not advapi32.CredReadW(target, 1, 0, ctypes.byref(cred_ptr)):
        return None
    try:
        cred = cred_ptr.contents
        raw = ctypes.string_at(cred.CredentialBlob, cred.CredentialBlobSize)
        for encoding in ("utf-16-le", "utf-8"):
            try:
                return raw.decode(encoding).rstrip("\x00")
            except UnicodeDecodeError:
                continue
        return None
    finally:
        advapi32.CredFree(cred_ptr)


def load_password(username: str) -> str:
    system = platform.system().lower()
    if system == "windows":
        password = _read_windows_credential(credential_target(username))
        if not password:
            die("系统凭证库中未找到 TFS 密码，请先运行配置：见 SKILL.md「首次配置」")
        return password
    try:
        import keyring  # type: ignore
    except ImportError as exc:
        die("系统凭证库不可用：请安装 keyring，或在 Windows 上运行以使用 cmdkey")
    password = keyring.get_password(KEYRING_SERVICE, username)
    if not password:
        die("系统凭证库中未找到 TFS 密码，请先运行配置：见 SKILL.md「首次配置」")
    return password


# --------------------------------------------------------------------------- #
# 删除
# --------------------------------------------------------------------------- #
def delete_password(username: str) -> None:
    system = platform.system().lower()
    if system == "windows":
        subprocess.run(
            ["cmdkey", f"/delete:{credential_target(username)}"],
            check=False,
            capture_output=True,
            text=True,
        )
        return
    try:
        import keyring  # type: ignore
    except ImportError:
        return
    try:
        keyring.delete_password(KEYRING_SERVICE, username)
    except Exception:
        return


# --------------------------------------------------------------------------- #
# 迁移：把配置文件里的明文密码搬到凭证库
# --------------------------------------------------------------------------- #
def migrate(config_path: str) -> None:
    path = Path(config_path)
    if not path.is_file():
        die(f"配置文件不存在: {config_path}")
    text = path.read_text(encoding="utf-8-sig")
    _parsed = json.loads(text)  # 仅用于校验 JSON 合法性和提取值
    username = _parsed.get("username")
    password = _parsed.get("password")
    if not username:
        die("配置文件中 username 为空，无法迁移")
    had_password = bool(password)
    if password:
        save_password(username, password)
        # 文本级别删除 password 行，保留文件原始格式
        text = re.sub(
            r'^\s*"password"\s*:\s*"[^"]*",?\s*$\n?',
            "",
            text,
            flags=re.MULTILINE,
        )
    # 更新或插入 password_ref
    ref_line = f'  "password_ref": "system-keyring:{KEYRING_SERVICE}:{username}"'
    if '"password_ref"' in text:
        text = re.sub(r'"password_ref":\s*"[^"]*"', ref_line, text)
    else:
        text = re.sub(r'("username":\s*"[^"]*")', rf'\1,\n{ref_line}', text)
    path.write_text(text, encoding="utf-8")
    if had_password:
        print(f"已将明文密码迁移到系统凭证库并从配置文件中删除（user={username}）")
    else:
        print(f"已确保 password_ref 指向凭证库（service={KEYRING_SERVICE}, user={username}）")


# --------------------------------------------------------------------------- #
def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    cmd = args[0]
    if cmd == "get":
        if len(args) < 2:
            die("用法: cred_helper.py get <username>")
        sys.stdout.write(load_password(args[1]))
        return 0
    if cmd == "set":
        if len(args) < 2:
            die("用法: cred_helper.py set <username>（密码从 stdin 读取）")
        password = sys.stdin.read().rstrip("\n")
        save_password(args[1], password)
        print(f"已保存密码到系统凭证库（user={args[1]}）")
        return 0
    if cmd == "delete":
        if len(args) < 2:
            die("用法: cred_helper.py delete <username>")
        delete_password(args[1])
        print(f"已从系统凭证库删除（user={args[1]}）")
        return 0
    if cmd == "migrate":
        if len(args) < 2:
            die("用法: cred_helper.py migrate <config_path>")
        migrate(args[1])
        return 0
    die(f"未知子命令: {cmd}\n\n{__doc__}")


if __name__ == "__main__":
    sys.exit(main())
