#!/usr/bin/env python3
"""Ensure lib/user-guide.js SECTIONS[].id appear in docs/USER_GUIDE.md."""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "lib/user-guide.js"
MD = ROOT / "docs/USER_GUIDE.md"


def main() -> int:
    js = JS.read_text(encoding="utf-8")
    md = MD.read_text(encoding="utf-8")
    ids = re.findall(r"id:\s*['\"]([^'\"]+)['\"]", js)
    # prefer SECTIONS array only — take unique preserving order
    seen = []
    for i in ids:
        if i not in seen:
            seen.append(i)
    missing = [i for i in seen if i not in md and f"#{i}" not in md and f"id=\"{i}\"" not in md]
    # also accept markdown headings containing id
    missing = [i for i in seen if i not in md]
    if missing:
        print("missing section ids in USER_GUIDE.md:", missing)
        return 1
    print(f"ok: {len(seen)} section ids present in USER_GUIDE.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
