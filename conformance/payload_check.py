#!/usr/bin/env python3
"""
ตรวจว่า payload ที่ @botforge/core ผลิตออกมาจริง validate ผ่าน schema ที่ pin ไว้

ADR-0006 ข้อ 2 ของ agent-platform ต้องการ payload จริง ไม่ใช่ fixture ที่เขียนให้ผ่าน
ไฟล์นี้จึงรัน core จริงผ่าน conformance/emit_payloads.ts แล้วเอาผลลัพธ์มาตรวจ

ตรวจสองชั้น:
  1. JSON Schema — error/v1 และ channel-event/v1 (ซึ่ง allOf กับ event/v1)
  2. guarantee ที่ JSON Schema ตรวจให้ไม่ได้ — เขียนไว้ในบล็อก `guarantees` ของ schema

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

# schema ที่ Botforge เป็นเจ้าของเอง — ไม่ได้ vendor มา
LOCAL_SCHEMAS = [ROOT / "contracts" / "event" / "v1" / "channel-event.schema.yaml"]

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
EVENT_TYPE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{2,63}$")
SECRET_PATTERNS = [
    re.compile(r"\b(sk|pk|ghp|gho|ghs|ghu|xox[baprs])[-_][A-Za-z0-9_-]{8,}"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{8,}", re.I),
    re.compile(r"\b[0-9a-f]{32,}\b", re.I),
]
REASONING_KEYS = {
    "reasoning", "thinking", "thought", "thoughts", "chain_of_thought",
    "chainOfThought", "scratchpad", "internal_monologue", "cot",
}
EVENT_REQUIRED = ["event_id", "event_type", "tenant_id", "subject_type",
                  "subject_id", "occurred_at", "source"]


def load_registry() -> Registry:
    registry = Registry()
    docs = [(VENDOR / rel, None) for rel in PINNED["schemas"]]
    docs += [(p, None) for p in LOCAL_SCHEMAS]
    for path, _ in docs:
        doc = yaml.safe_load(path.read_text())
        registry = registry.with_resource(doc["$id"], Resource.from_contents(doc))
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


def check_error_guarantees(p: dict) -> list[str]:
    """error/v1: message ห้ามมี credential, PII หรือเนื้อหา prompt ของผู้ใช้"""
    out = []
    msg = p.get("message", "")
    for pat in SECRET_PATTERNS:
        if pat.search(msg):
            out.append(f"message อาจมี credential: {pat.pattern}")
    if len(msg) > 200:
        out.append(f"message ยาว {len(msg)} — ของเดิมตัดที่ 200")
    return out


def check_event_guarantees(e: dict) -> list[str]:
    """guarantees ของ event/v1 (🔒 frozen) + rules ของ channel-event/v1"""
    out = []
    for f in EVENT_REQUIRED:
        if f not in e:
            out.append(f"ขาด required field: {f}")

    if not EVENT_TYPE_PATTERN.match(e.get("event_type", "")):
        out.append(f"event_type ผิดรูป: {e.get('event_type')!r}")

    for field in ("event_id", "subject_id", "tenant_id", "workspace_id", "channel_id", "execution_id"):
        v = e.get(field)
        if v is not None and not ID_PATTERN.match(v):
            out.append(f"{field} ผิด ID_PATTERN: {v!r}")

    # 🔒 ห้ามสร้าง job_id ปลอม — Botforge ไม่มี job
    if "job_id" in e:
        out.append("มี job_id ทั้งที่ Botforge ไม่มี job — guarantee ห้ามสร้างค่าปลอม")

    # 🔒 external ต้องคง source
    src = e.get("source", {})
    if src.get("kind") == "external" and not src.get("system"):
        out.append("source.kind เป็น external แต่ไม่มี source.system")

    # 🔒 ห้ามเก็บ chain-of-thought
    for k in (e.get("metadata") or {}):
        if k in REASONING_KEYS:
            out.append(f"metadata มี private reasoning: {k}")

    # rules ของ channel-event/v1
    blob = json.dumps(e, ensure_ascii=False)
    if "reply_token" in blob or "replyToken" in blob:
        out.append("มี reply_token — ห้ามลงบันทึกที่ append-only")

    # สแกน credential เฉพาะส่วนที่เป็นข้อความอิสระ
    # ไม่รวม field ที่เป็น id เพราะ LINE id คือ hex 32 ตัวโดยธรรมชาติ
    # (`line-ca56f9e2...`) ซึ่งชน heuristic ของ hex ยาวโดยไม่ได้เป็น credential
    free_text = [
        (e.get("error") or {}).get("message", ""),
        (e.get("transition") or {}).get("reason", ""),
        json.dumps(e.get("metadata") or {}, ensure_ascii=False),
        (e.get("actor") or {}).get("display_name", ""),
        (e.get("source") or {}).get("system", ""),
        e.get("message_id", "") or "",
    ]
    for text in free_text:
        for pat in SECRET_PATTERNS:
            if pat.search(text):
                out.append(f"ข้อความอิสระอาจมี credential: {pat.pattern} ใน {text[:40]!r}")

    # occurred_at ต้องเป็น date-time ที่ parse ได้
    try:
        from datetime import datetime
        datetime.fromisoformat(e["occurred_at"].replace("Z", "+00:00"))
    except Exception:
        out.append(f"occurred_at ไม่ใช่ date-time: {e.get('occurred_at')!r}")

    return out


def check_sequences(events: list[dict]) -> list[str]:
    """sequence ต้องเพิ่มขึ้นเสมอภายใน subject เดียวกัน — ช่องว่างไม่ผิด"""
    out = []
    last: dict[str, int] = {}
    for e in events:
        sid, seq = e.get("subject_id"), e.get("sequence")
        if seq is None:
            continue
        if sid in last and seq <= last[sid]:
            out.append(f"sequence ไม่เพิ่มขึ้นที่ subject {sid}: {last[sid]} → {seq}")
        last[sid] = seq
    return out


def run(label: str, schema_id: str, payloads: list[dict], guarantee_fn, registry: Registry) -> int:
    schema = registry.get_or_retrieve(schema_id).value.contents
    validator = Draft202012Validator(schema, registry=registry)
    failures = 0
    for i, p in enumerate(payloads):
        errs = sorted(validator.iter_errors(p), key=lambda e: list(e.path))
        extra = guarantee_fn(p)
        if errs or extra:
            failures += 1
            print(f"  ✗ [{i}] {p.get('code') or p.get('event_type')}")
            for e in errs:
                print(f"      schema: {e.message}")
            for e in extra:
                print(f"      guarantee: {e}")
    if failures == 0:
        print(f"  ✓ {label}: ผ่านทั้ง {len(payloads)} ใบ")
    else:
        print(f"  ✗ {label}: ไม่ผ่าน {failures}/{len(payloads)} ใบ")
    return failures


def main() -> int:
    registry = load_registry()
    data = emit_payloads()
    errors, events = data["errors"], data["events"]

    print(f"pinned commit : {PINNED['commit'][:12]}")
    print(f"payload จริงจาก @botforge/core — ไม่มี fixture")
    print()

    failures = 0
    failures += run(
        "error/v1", "https://schemas.agent-platform.internal/error/v1/error.schema.yaml",
        errors, check_error_guarantees, registry,
    )
    failures += run(
        "channel-event/v1 (allOf event/v1)",
        "https://schemas.botforge.internal/event/v1/channel-event.schema.yaml",
        events, check_event_guarantees, registry,
    )

    seq_problems = check_sequences(events)
    if seq_problems:
        failures += len(seq_problems)
        for p in seq_problems:
            print(f"  ✗ sequence: {p}")
    else:
        print("  ✓ sequence เพิ่มขึ้นเสมอภายใน subject เดียวกัน")

    print()
    if failures:
        print(f"✗ ไม่ผ่าน {failures} จุด")
        return 1

    cats = sorted({p["category"] for p in errors})
    types = sorted({e["event_type"] for e in events})
    print(f"  error category  : {', '.join(cats)}")
    print(f"  event type      : {', '.join(types)}")
    print(f"  ✓ ไม่มี credential · ไม่มี reply_token · ไม่มี chain-of-thought · ไม่มี job_id ปลอม")
    return 0


if __name__ == "__main__":
    sys.exit(main())
