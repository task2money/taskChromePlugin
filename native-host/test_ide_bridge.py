#!/usr/bin/env python3
"""ide_bridge 窗口标题匹配回归测（OPT-20261006-037）。

只测纯函数 match_title，不依赖真实 wmctrl/剪贴板。
"""
from __future__ import annotations

import importlib.util
import pathlib

_HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("ide_bridge", _HERE / "ide_bridge.py")
assert _spec and _spec.loader
ide_bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ide_bridge)


def test_trae_cn_variant_matches():
    assert ide_bridge.match_title(ide_bridge.TITLES["trae"], ["x", "Trae CN — f.py"]) == "Trae"


def test_bytedance_trae_variant_matches():
    assert ide_bridge.match_title(ide_bridge.TITLES["trae"], ["ByteDance Trae"]) == "Trae"


def test_work_buddy_with_space_matches():
    assert ide_bridge.match_title(ide_bridge.TITLES["workbuddy"], ["Work Buddy"]) == "Work Buddy"


def test_bytedance_workbuddy_variant_matches():
    assert ide_bridge.match_title(ide_bridge.TITLES["workbuddy"], ["ByteDance WorkBuddy"]) == "WorkBuddy"


def test_match_is_case_insensitive():
    assert ide_bridge.match_title(ide_bridge.TITLES["workbuddy"], ["workbuddy v2"]) == "WorkBuddy"


def test_no_window_returns_none():
    assert ide_bridge.match_title(ide_bridge.TITLES["trae"], ["gedit notes.txt"]) is None
    assert ide_bridge.match_title(ide_bridge.TITLES["trae"], []) is None


def _main() -> int:
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"OK  {name}")
            except AssertionError as exc:  # noqa: BLE001
                failed += 1
                print(f"FAIL {name}: {exc}")
    if failed:
        print(f"{failed} failed")
        return 1
    print("all title-match tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
