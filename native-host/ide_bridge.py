#!/usr/bin/env python3
"""Native Messaging host: copy suggestion text and optionally paste into a known IDE.

Chrome native-messaging JSON on stdin/stdout. Never executes payload text as a shell.
"""
from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys

ALLOWED = frozenset({"cursor", "claude", "codex", "trae", "workbuddy"})
# OPT-20261006-037: 部分发行版窗口标题带变体后缀/空格（如「Trae CN」
# 「ByteDance Trae」「Work Buddy」），只匹配基名会让已装桥静默降级到剪贴板。
TITLES = {
    "cursor": ("Cursor",),
    "claude": ("Claude",),
    "codex": ("Codex",),
    "trae": ("Trae", "Trae CN", "ByteDance Trae"),
    "workbuddy": ("WorkBuddy", "Workbuddy", "Work Buddy", "ByteDance WorkBuddy"),
}


def match_title(titles, window_titles):
    """在已知窗口标题里找第一个命中的候选（大小写不敏感子串）。

    返回命中的候选字符串；无命中返回 None。抽为纯函数便于用 wmctrl 输出做单测。
    """
    lowered = [str(w).lower() for w in (window_titles or [])]
    for cand in titles or ():
        needle = str(cand).lower()
        if any(needle in wt for wt in lowered):
            return cand
    return None


def list_window_titles() -> list[str]:
    """读取 wmctrl -l 的窗口标题（第 4 列起），失败返回空表。"""
    try:
        r = subprocess.run(["wmctrl", "-l"], capture_output=True, text=True, check=False)
    except OSError:
        return []
    if r.returncode != 0:
        return []
    titles: list[str] = []
    for line in r.stdout.splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4:
            titles.append(parts[3])
    return titles


def read_msg() -> dict | None:
    raw = sys.stdin.buffer.read(4)
    if not raw or len(raw) < 4:
        return None
    n = struct.unpack("<I", raw)[0]
    if n <= 0 or n > 8_000_000:
        return None
    body = sys.stdin.buffer.read(n)
    return json.loads(body.decode("utf-8"))


def write_msg(obj: dict) -> None:
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def copy_text(text: str) -> bool:
    if os.environ.get("AIDEVPUSH_IDE_BRIDGE_DRY") == "1":
        return True
    payload = text.encode("utf-8")
    if shutil.which("wl-copy"):
        r = subprocess.run(["wl-copy"], input=payload, check=False)
        return r.returncode == 0
    if shutil.which("xclip"):
        r = subprocess.run(["xclip", "-selection", "clipboard"], input=payload, check=False)
        return r.returncode == 0
    if shutil.which("xsel"):
        r = subprocess.run(["xsel", "--clipboard", "--input"], input=payload, check=False)
        return r.returncode == 0
    if shutil.which("pbcopy"):
        r = subprocess.run(["pbcopy"], input=payload, check=False)
        return r.returncode == 0
    return False


def focus_and_paste(target: str) -> bool:
    if os.environ.get("AIDEVPUSH_IDE_BRIDGE_DRY") == "1":
        return False
    titles = TITLES.get(target) or ()
    if shutil.which("wmctrl"):
        # 先用真实窗口标题挑出命中的候选（含变体），再激活；挑不到则按原顺序逐个尝试。
        matched = match_title(titles, list_window_titles())
        for title in ((matched,) if matched else titles):
            r = subprocess.run(["wmctrl", "-a", title], check=False)
            if r.returncode == 0:
                break
    if shutil.which("xdotool"):
        r = subprocess.run(["xdotool", "key", "ctrl+v"], check=False)
        return r.returncode == 0
    return False


def main() -> int:
    msg = read_msg()
    if not msg:
        write_msg({"ok": False, "error": "empty"})
        return 0
    target = str(msg.get("target") or "")
    if target not in ALLOWED:
        write_msg({"ok": False, "error": "bad_target"})
        return 0
    text = str(msg.get("text") or "")
    copied = copy_text(text)
    pasted = focus_and_paste(target) if copied else False
    if pasted:
        write_msg({"ok": True, "method": "paste"})
        return 0
    if copied:
        write_msg({"ok": True, "method": "clipboard"})
        return 0
    write_msg({"ok": False, "error": "clipboard_failed"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
