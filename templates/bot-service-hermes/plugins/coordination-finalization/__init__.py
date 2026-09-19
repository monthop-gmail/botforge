# -*- coding: utf-8 -*-
"""ดันให้ Hermes ปิดใบงานที่รับไว้ ก่อนจะปล่อยให้จบรอบ

ปัญหา: instance รับใบ ทำงานไปเกือบครบ แล้วจบ turn ก่อนเรียก update_task
ใบค้าง in_progress ทั้งที่งานเสร็จแล้ว — ฝั่ง server ไม่มีใครรู้ว่าจบหรือยัง

กติกา (ตัดสินโดย ai-collab เมื่อ 2026-09-19):
  * ถ้อยคำไม่ใช่หลักฐาน — พูดว่า done หรือ blocked เฉย ๆ ไม่นับ
  * ใบถึงปลายทางเมื่อ "รอบนี้" มีผล update_task ที่ status เป็น done หรือ blocked
  * ถ้าติดจริง Hermes ต้องเรียก update_task(status=blocked, detail=...) เอง
  * plugin ห้ามปิดใบแทน — มิฉะนั้น done จะไม่ใช่หลักฐานว่า agent ทำงานจบ

ทำไมอ่าน state.db แทนที่จะเรียก MCP:
  ผล tool ถูกเก็บเป็น JSON ที่มีโครงสร้างอยู่แล้ว (task_id + status)
  จึงไม่ต้องยิง network ไม่เพิ่ม latency และไม่สร้าง side effect ใหม่
  ขอบเขต "รอบนี้" ตรงกับ hermes -z หนึ่งครั้ง = หนึ่งงานพอดี

ขอบเขต: เฉพาะ session ที่ source เป็น cli — แชท LINE ไม่เข้าเงื่อนไขตั้งแต่ต้น
"""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

TERMINAL_STATUSES = {"done", "blocked", "cancelled"}
ACCEPT_TOOL_MARKERS = ("accept_handoff",)
UPDATE_TOOL_MARKERS = ("update_task",)
COORDINATION_SOURCES = {"cli"}

# ผล MCP tool ห่อสองชั้น: untrusted_tool_result -> {"result": "<json string>"}
_RESULT_RE = re.compile(r'\{"result":\s*"(.*)"\}', re.S)


def _state_db_path() -> str:
    return os.path.join(os.environ.get("HERMES_HOME", "/opt/data"), "state.db")


def _parse_tool_result(content: Optional[str]) -> Optional[Dict[str, Any]]:
    """ดึง JSON ของจริงออกจากผลลัพธ์ tool — None ถ้าอ่านไม่ออก (ไม่ raise)"""
    if not content:
        return None
    m = _RESULT_RE.search(content)
    if not m:
        return None
    try:
        return json.loads(json.loads('"%s"' % m.group(1)))
    except (ValueError, TypeError):
        return None


def scan_session(db_path: str, session_id: str) -> Dict[str, Any]:
    """อ่านรอบนี้จาก state.db แล้วบอกว่าใบไหนรับไว้ ใบไหนปิดแล้ว

    แยกออกมาเป็นฟังก์ชันเดี่ยวเพื่อให้ harness ทดสอบได้โดยไม่ต้องมี Hermes ทั้งตัว
    """
    out: Dict[str, Any] = {"source": None, "accepted": {}, "finalized": {}, "found": False}
    try:
        db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
        db.row_factory = sqlite3.Row
    except sqlite3.Error:
        return out

    try:
        sess = db.execute("select source from sessions where id=?", (session_id,)).fetchone()
        if sess is None:
            return out
        out["found"] = True
        out["source"] = sess["source"]
        rows = db.execute(
            "select role, tool_name, content from messages where session_id=? order by rowid",
            (session_id,),
        ).fetchall()
    except sqlite3.Error:
        return out
    finally:
        db.close()

    for m in rows:
        if m["role"] != "tool":
            continue
        name = m["tool_name"] or ""
        payload = _parse_tool_result(m["content"])
        if not isinstance(payload, dict):
            continue
        task_id = payload.get("task_id")
        if not task_id:
            continue
        if any(marker in name for marker in ACCEPT_TOOL_MARKERS):
            out["accepted"][task_id] = payload.get("task_status") or payload.get("status")
        elif any(marker in name for marker in UPDATE_TOOL_MARKERS):
            out["finalized"][task_id] = payload.get("status")
    return out


def pending_tasks(scan: Dict[str, Any]) -> List[str]:
    """ใบที่รับไว้ในรอบนี้แต่ยังไม่มีผล update_task ที่สถานะปลายทาง"""
    finalized = scan.get("finalized") or {}
    return [
        task_id
        for task_id in (scan.get("accepted") or {})
        if str(finalized.get(task_id) or "").lower() not in TERMINAL_STATUSES
    ]


def build_nudge(pending: List[str], attempt: int) -> str:
    """ข้อความที่ใช้ดัน — คงที่ ไม่สุ่ม เพื่อให้ replay ได้ผลเดิมทุกครั้ง

    ต้องบอกทั้งสองทางออก ไม่ใช่สั่งให้ปิดใบอย่างเดียว มิฉะนั้นจะกลายเป็นการ
    กดดันให้ปิดใบทั้งที่งานยังไม่เสร็จ ซึ่งแย่กว่าใบค้าง
    """
    listed = ", ".join(pending)
    return (
        "[System: รอบนี้รับใบงานไว้แล้วแต่ยังไม่ได้ปิด — %s\n"
        "ถ้างานเสร็จแล้ว ให้เรียก update_task(status=\"done\") ให้ครบทุกใบ\n"
        "ถ้าติดจริงจนไปต่อไม่ได้ ให้เรียก update_task(status=\"blocked\") "
        "พร้อม detail สั้น ๆ ที่บอกว่าติดตรงไหน\n"
        "การเขียนสรุปว่าเสร็จแล้วหรือติดแล้ว ไม่นับว่าปิดใบ — "
        "ต้องเรียก tool จริงเท่านั้น (ครั้งที่ %d)]" % (listed, attempt + 1)
    )


def decide(
    *,
    session_id: str,
    attempt: int = 0,
    db_path: Optional[str] = None,
    coordination_sources: Optional[Set[str]] = None,
) -> Optional[Dict[str, str]]:
    """ตรรกะทั้งหมดอยู่ตรงนี้ — แยกจาก hook เพื่อให้ทดสอบตรง ๆ ได้"""
    if not session_id:
        return None
    scan = scan_session(db_path or _state_db_path(), session_id)
    if not scan["found"]:
        return None
    sources = coordination_sources or COORDINATION_SOURCES
    if scan["source"] not in sources:
        return None          # แชท LINE และ subagent ไม่เข้าเงื่อนไข
    if not scan["accepted"]:
        return None          # ไม่ได้รับใบอะไรไว้ ก็ไม่มีอะไรค้าง
    pending = pending_tasks(scan)
    if not pending:
        return None          # ปิดครบแล้ว ปล่อยจบ
    return {"action": "continue", "message": build_nudge(sorted(pending), attempt)}


def _on_pre_verify(*, session_id: str = "", attempt: int = 0, **_: Any):
    """hook ปลาย turn — รับ kwargs เกินมาได้โดยไม่พัง (core เติม field เพิ่มได้)"""
    try:
        return decide(session_id=session_id, attempt=attempt)
    except Exception:
        # plugin พังต้องไม่ทำให้ turn พัง — ปล่อยจบตามปกติ
        logger.warning("coordination-finalization hook failed", exc_info=True)
        return None


def register(ctx) -> None:
    ctx.register_hook("pre_verify", _on_pre_verify)
