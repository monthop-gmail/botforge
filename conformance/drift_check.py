#!/usr/bin/env python3
"""
ตรวจว่า schema ที่ vendor ไว้ยังตรงกับ agent-platform ที่ commit ที่ pin ไว้

ADR-0011 ของ agent-platform ให้ conformance เป็นข้อยกเว้นเดียวที่มี code ได้
ไฟล์นี้ทำหน้าที่เดียว: จับว่า vendor เพี้ยนจากต้นทาง

แหล่งเทียบ เรียงตามลำดับ:
  1. $AGENT_PLATFORM_PATH        — path ที่ระบุเอง
  2. ../poc-agent-platform       — sibling checkout (ใช้ตอน dev)
  3. GitHub raw ที่ commit ที่ pin — ใช้ตอน CI

รัน: python3 conformance/drift_check.py
"""
from __future__ import annotations

import hashlib
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "conformance" / "vendor"
PINNED = yaml.safe_load((ROOT / "conformance" / "pinned.yaml").read_text())
RAW = "https://raw.githubusercontent.com/{repo}/{commit}/contracts/{rel}"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def local_source() -> Path | None:
    for cand in (os.environ.get("AGENT_PLATFORM_PATH"), ROOT.parent / "poc-agent-platform"):
        if not cand:
            continue
        p = Path(cand) / "contracts"
        if p.is_dir():
            return p
    return None


def fetch_remote(rel: str) -> bytes | None:
    url = RAW.format(repo=PINNED["repo"], commit=PINNED["commit"], rel=rel)
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            return r.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f"    ดึงจาก GitHub ไม่ได้: {e}", file=sys.stderr)
        return None


def main() -> int:
    src = local_source()
    if src:
        print(f"เทียบกับ  : {src}  (local checkout)")
        print(f"⚠️  local checkout ไม่รับประกันว่าอยู่ที่ commit {PINNED['commit'][:12]}")
    else:
        print(f"เทียบกับ  : GitHub {PINNED['repo']} @ {PINNED['commit'][:12]}")
    print()

    drift, missing = 0, 0
    for rel in PINNED["schemas"]:
        vendored = (VENDOR / rel).read_bytes()
        upstream = (src / rel).read_bytes() if src and (src / rel).is_file() else fetch_remote(rel)

        if upstream is None:
            print(f"  ? {rel}  — เทียบไม่ได้")
            missing += 1
            continue

        if digest(vendored) == digest(upstream):
            print(f"  ✓ {rel}  {digest(vendored)}")
        else:
            print(f"  ✗ {rel}")
            print(f"      vendor   {digest(vendored)}")
            print(f"      upstream {digest(upstream)}")
            drift += 1

    print()
    if drift:
        print(f"✗ drift {drift} ไฟล์ — vendor ไม่ตรงกับต้นทางที่ pin ไว้")
        print("  แก้: อัปเดต conformance/vendor/ และ commit ใน pinned.yaml ให้ตรงกัน")
        return 1
    if missing:
        print(f"? เทียบไม่ได้ {missing} ไฟล์ — ถือว่ายังไม่ยืนยัน")
        return 1
    print(f"✓ vendor ตรงกับต้นทางทั้ง {len(PINNED['schemas'])} ไฟล์")
    return 0


if __name__ == "__main__":
    sys.exit(main())
