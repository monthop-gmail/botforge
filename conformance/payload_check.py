#!/usr/bin/env python3
"""
ตรวจว่า payload ที่ @botforge/core ผลิตออกมาจริง validate ผ่าน schema ที่ pin ไว้

ADR-0006 ข้อ 2 ของ agent-platform ต้องการ payload จริง ไม่ใช่ fixture ที่เขียนให้ผ่าน
ไฟล์นี้จึงรัน core จริงผ่าน conformance/emit_payloads.ts แล้วเอาผลลัพธ์มาตรวจ

รัน: python3 conformance/payload_check.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "conformance" / "vendor"
PINNED = yaml.safe_load((ROOT / "conformance" / "pinned.yaml").read_text())

BASE = "https://schemas.agent-platform.internal/"


def load_registry() -> Registry:
    registry = Registry()
    for rel in PINNED["schemas"]:
        doc = yaml.safe_load((VENDOR / rel).read_text())
        uri = doc.get("$id") or (BASE + rel)
        registry = registry.with_resource(uri, Resource.from_contents(doc))
    return registry


def emit_payloads() -> dict:
    proc = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "conformance" / "emit_payloads.ts")],
        capture_output=True, text=True, cwd=ROOT,
    )
    if proc.returncode != 0:
        print("core ปล่อย payload ไม่ได้:", file=sys.stderr)
        print(proc.stderr, file=sys.stderr)
        sys.exit(1)
    return json.loads(proc.stdout)


# กฎที่ JSON Schema ตรวจให้ไม่ได้ แต่ error/v1 เขียนไว้
SECRET_PATTERNS = [
    re.compile(r"\b(sk|pk|ghp|gho|ghs|ghu|xox[baprs])[-_][A-Za-z0-9_-]{8,}"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{8,}", re.I),
    re.compile(r"\b[0-9a-f]{32,}\b", re.I),
]


def check_guarantees(payload: dict) -> list[str]:
    """error/v1: message ห้ามมี credential, PII หรือเนื้อหา prompt ของผู้ใช้"""
    problems = []
    msg = payload.get("message", "")
    for pat in SECRET_PATTERNS:
        if pat.search(msg):
            problems.append(f"message อาจมี credential: {pat.pattern}")
    if len(msg) > 200:
        problems.append(f"message ยาว {len(msg)} — ของเดิมตัดที่ 200")
    return problems


def main() -> int:
    registry = load_registry()
    schema = yaml.safe_load((VENDOR / "error" / "v1" / "error.schema.yaml").read_text())
    validator = Draft202012Validator(schema, registry=registry)

    data = emit_payloads()
    payloads = data["payloads"]
    failures = 0

    print(f"pinned commit : {PINNED['commit'][:12]}")
    print(f"schema        : error/v1")
    print(f"payload จริง   : {len(payloads)} ใบ จาก @botforge/core")
    print()

    for i, p in enumerate(payloads):
        errs = sorted(validator.iter_errors(p), key=lambda e: e.path)
        extra = check_guarantees(p)
        if errs or extra:
            failures += 1
            print(f"  ✗ [{i}] code={p.get('code')}")
            for e in errs:
                print(f"      schema: {e.message}")
            for e in extra:
                print(f"      guarantee: {e}")

    if failures == 0:
        cats = sorted({p["category"] for p in payloads})
        print(f"  ✓ ผ่านทั้ง {len(payloads)} ใบ")
        print(f"  ✓ category ที่ครอบคลุม: {', '.join(cats)}")
        print(f"  ✓ ไม่มี credential หลุดใน message")
        return 0

    print(f"\n  ✗ ไม่ผ่าน {failures}/{len(payloads)} ใบ")
    return 1


if __name__ == "__main__":
    sys.exit(main())
