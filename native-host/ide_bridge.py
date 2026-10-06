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
TITLES = {
    "cursor": ("Cursor",),
    "claude": ("Claude",),
    "codex": ("Codex",),
    "trae": ("Trae",),
    "workbuddy": ("WorkBuddy", "Workbuddy"),
}


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
        for title in titles:
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
