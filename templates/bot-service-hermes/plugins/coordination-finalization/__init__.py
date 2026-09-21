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
import sqlite3
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

TERMINAL_STATUSES = {"done", "blocked", "cancelled"}
ACCEPT_TOOL_MARKERS = ("accept_handoff",)
UPDATE_TOOL_MARKERS = ("update_task",)
COORDINATION_SOURCES = {"cli"}

# ผล MCP tool ห่อสองชั้น: untrusted_tool_result -> {"result": "<json string>"}
#
# เดิมใช้ regex `\{"result":\s*"(.*)"\}` ซึ่ง `.*` เป็น greedy — ถ้าข้อความหนึ่งมีซอง
# มากกว่าหนึ่งอัน มันจะคาบตั้งแต่ซองแรกถึงปลายซองสุดท้ายแล้ว json.loads ล้ม
# คืน None เงียบ ๆ · แถวนั้นถูกข้ามไปโดยไม่มีใครรู้ ซึ่งแปลว่า accept หรือ update
# รอบนั้นหายไปจากสายตา plugin: หาย accept = ไม่ nudge ทั้งที่ควร · หาย update =
# nudge ทั้งที่ปิดใบแล้ว
#
# ตอนนี้ใช้ตัวถอด JSON จริงไล่ทีละซองแทน และ log เมื่อเห็นซองแต่แกะไม่ออก
# — ความว่างที่ไม่บอกอะไรเลย อ่านได้พอดีทั้ง "ไม่มี" และ "ไม่ได้ดู"
_RESULT_MARK = '{"result":'


def _state_db_path() -> str:
    return os.path.join(os.environ.get("HERMES_HOME", "/opt/data"), "state.db")


def _parse_tool_result(content: Optional[str]) -> Optional[Dict[str, Any]]:
    """ดึง JSON ของจริงออกจากผลลัพธ์ tool — None ถ้าอ่านไม่ออก (ไม่ raise)

    ทนต่อคีย์ที่ไม่รู้จักทุกชนิด: อ่านด้วยชื่อคีย์เสมอ ไม่ยึดลำดับหรือจำนวน
    (ยืนยันกับ ai-collaboration-mcp ที่ dis-c6095786 seq 28)
    """
    if not content:
        return None
    decoder = json.JSONDecoder()
    seen_envelope = False
    idx = content.find(_RESULT_MARK)
    while idx != -1:
        seen_envelope = True
        try:
            envelope, _ = decoder.raw_decode(content, idx)
        except ValueError:
            envelope = None
        if isinstance(envelope, dict) and isinstance(envelope.get("result"), str):
            try:
                inner = json.loads(envelope["result"])
            except (ValueError, TypeError):
                inner = None
            if isinstance(inner, dict):
                return inner
        idx = content.find(_RESULT_MARK, idx + 1)
    if seen_envelope:
        # เห็นซองแต่แกะไม่ออก — ต้องดังพอให้คนเห็น ไม่ใช่เงียบแล้วข้าม
        logger.warning(
            "coordination-finalization: เห็นซอง %s แต่แกะ JSON ไม่ออก — "
            "แถวนี้ถูกข้าม ใบที่รับหรือปิดในแถวนี้จะมองไม่เห็น (ยาว %d ตัวอักษร)",
            _RESULT_MARK, len(content),
        )
    return None


def scan_session(db_path: str, session_id: str) -> Dict[str, Any]:
    """อ่านรอบนี้จาก state.db แล้วบอกว่าใบไหนรับไว้ ใบไหนปิดแล้ว

    แยกออกมาเป็นฟังก์ชันเดี่ยวเพื่อให้ harness ทดสอบได้โดยไม่ต้องมี Hermes ทั้งตัว
    """
    out: Dict[str, Any] = {"source": None, "accepted": {}, "finalized": {},
                           "found": False, "tokens": 0}
    try:
        db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
        db.row_factory = sqlite3.Row
    except sqlite3.Error:
        return out

    try:
        sess = db.execute(
            "select source, input_tokens, output_tokens from sessions where id=?",
            (session_id,),
        ).fetchone()
        if sess is None:
            return out
        out["found"] = True
        out["source"] = sess["source"]
        # ยอดนี้ถูกเขียนโดย background writer ของ Hermes จึงตามหลังจริงราวหนึ่ง
        # api call — วัดแล้วด้วยการขับ loop จริง: หลัง call ที่ 2 จะเห็นยอดของ call ที่ 1
        # ช้าพอจะไม่เป๊ะ แต่เร็วพอจะใช้ตัดสินใจว่าจะจ่ายค่า nudge อีกก้อนไหม
        out["tokens"] = (sess["input_tokens"] or 0) + (sess["output_tokens"] or 0)
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


def build_nudge(pending: List[str]) -> str:
    """ข้อความที่ใช้ดัน — คงที่ ไม่สุ่ม เพื่อให้ replay ได้ผลเดิมทุกครั้ง

    ต้องบอกทั้งสองทางออก ไม่ใช่สั่งให้ปิดใบอย่างเดียว มิฉะนั้นจะกลายเป็นการ
    กดดันให้ปิดใบทั้งที่งานยังไม่เสร็จ ซึ่งแย่กว่าใบค้าง

    และต้องห้ามหาทางอ้อมอย่างชัดเจน — รอบ 08 ของ canary จริงแสดงให้เห็นว่า
    ถ้าไม่ห้าม โมเดลจะไปค้นหาเครื่องมืออื่นมาแทน ซึ่งขัดกับกฎใน SOUL.md
    ที่ว่าถ้า tool เดิมพังซ้ำให้หยุด ไม่ใช่หาทางอื่น
    """
    listed = ", ".join(pending)
    return (
        "[System: รอบนี้รับใบงานไว้แล้วแต่ยังไม่ได้ปิด — %s\n"
        "ถ้างานเสร็จแล้ว ให้เรียก update_task(status=\"done\") ให้ครบทุกใบ\n"
        "ถ้าติดจริงจนไปต่อไม่ได้ ให้เรียก update_task(status=\"blocked\") "
        "พร้อม detail สั้น ๆ ที่บอกว่าติดตรงไหน\n"
        "ถ้า update_task ใช้ไม่ได้ ให้โพสต์ blocker สั้น ๆ ลงกระทู้ของใบนี้หนึ่งครั้ง แล้วจบรอบ\n"
        "ห้ามไปค้นหาหรือลองเครื่องมืออื่นมาแทน ห้ามหาทางอ้อม — "
        "ใบที่ค้างอยู่ไม่ใช่ความผิดพลาดที่ต้องแก้ด้วยวิธีอื่น\n"
        "การเขียนสรุปว่าเสร็จแล้วหรือติดแล้ว ไม่นับว่าปิดใบ — ต้องเรียก tool จริงเท่านั้น\n"
        "นี่คือการเตือนครั้งเดียวของรอบนี้ จะไม่มีครั้งที่สอง]" % listed
    )


# ── สัญญางานที่รอบนี้ถูกส่งมาทำ ────────────────────────────────────────────
# runner รู้อยู่แล้วว่ายิง hermes -z มาเพื่อใบไหน จึงบอก plugin ตรง ๆ ตั้งแต่ตอน launch
# ไม่ต้องให้ plugin ไปเดาหรือไปยิง MCP ถามเอง
#
# อ่านจาก env ครั้งเดียวตอน import แล้วแช่ไว้ — โมเดลเขียนทับระหว่างรอบไม่ได้
# และ env ถูกตั้งเฉพาะ docker exec ครั้งนั้น ไม่ติดไปถึง gateway ของ LINE
#
# ค่าพวกนี้เป็นแค่ที่อยู่ของงาน ไม่ใช่หลักฐานสิทธิ์ — สิทธิ์ยังตัดสินที่ token
# และ actor ฝั่ง server เหมือนเดิม ใครตั้ง env มั่วก็ทำอะไรเกินสิทธิ์ตัวเองไม่ได้
ENV_WORKSPACE = "BOTFORGE_EXPECTED_WORKSPACE"
ENV_TASK = "BOTFORGE_EXPECTED_TASK"
ENV_HANDOFF = "BOTFORGE_EXPECTED_HANDOFF"


def _read_expected_job() -> Optional[Dict[str, str]]:
    """อ่านสัญญางานจาก env — None ถ้าไม่มี แปลว่า plugin ไม่ทำงานเลย"""
    task = (os.environ.get(ENV_TASK) or "").strip()
    handoff = (os.environ.get(ENV_HANDOFF) or "").strip()
    workspace = (os.environ.get(ENV_WORKSPACE) or "").strip()
    if not task and not handoff:
        return None
    # หลายใบในรอบเดียว: ปิดไว้ก่อนโดยตั้งใจ ไม่เดาแทน
    # ถ้าวันหนึ่งต้องรองรับจริง ต้องออกแบบว่า nudge ก้อนเดียวพูดถึงหลายใบยังไง
    if "," in task or "," in handoff:
        logger.warning(
            "coordination-finalization: สัญญางานระบุหลายใบ (%r / %r) — "
            "ยังไม่รองรับ ปิดการทำงานของ guard รอบนี้", task, handoff,
        )
        return None
    return {"workspace": workspace, "task_id": task, "handoff_id": handoff}


EXPECTED_JOB = _read_expected_job()
"""แช่ไว้ตั้งแต่ import — ไม่อ่านซ้ำระหว่างรอบ"""


MAX_SESSION_TOKENS = 80_000
"""ถ้ารอบนี้ใช้ไปเกินนี้แล้ว จะไม่จ่ายค่า nudge เพิ่มอีก

ไม่ใช่การตัดกลางคัน — Hermes ไม่มีที่ให้แทรกแบบนั้นโดยไม่ทำ session เสียหาย
แต่ nudge คือสิ่งเดียวที่ guard นี้ทำให้แพงขึ้น การปฏิเสธไม่ nudge จึงเป็น
จุดคุมค่าใช้จ่ายที่แท้จริงอยู่แล้ว

ค่าเริ่มต้นมาจากหลักฐานจริง: รอบ 07 ที่ทำครบ lifecycle ใช้ in+out ราว 48K
ตั้งไว้ 80K จึงเผื่อรอบที่ยาวกว่าปกติ แต่ยังตัดก่อนจะบานแบบรอบ 08 (134K)
"""

MAX_COORDINATION_NUDGES = 1
"""เตือนได้ครั้งเดียวต่อรอบ — เข้มกว่า max_verify_nudges=3 ของ Hermes โดยตั้งใจ

เหตุผลมาจากรอบ 08 ของ canary จริง: การเตือนสามครั้งกินโควตา 124K/9.5K
เทียบกับรอบ 07 ที่เตือนครั้งเดียวแล้วจบ ใช้ 45K/2.8K
เพราะการเตือนแต่ละครั้งส่ง context ทั้งกองกลับไปใหม่ ยิ่งบทสนทนายาวยิ่งแพง
ต้นทุนจึงไม่คงที่ และครั้งที่สอง/สามแทบไม่เคยเปลี่ยนผล
"""


def build_preaccept_nudge(expected: Dict[str, str]) -> str:
    """ข้อความสำหรับกรณีที่รอบนี้ยังไม่เคยรับใบที่ถูกส่งมาให้ทำ

    แยกจาก build_nudge เพราะปัญหาคนละอย่าง — อันนั้นคือ "ทำแล้วแต่ไม่ปิด"
    อันนี้คือ "ยังไม่ได้เริ่มเลย ทั้งที่อาจเขียนไปแล้วว่าเริ่มแล้ว"

    ต้องพูดถึงหลักฐานตรง ๆ เพราะอาการที่เจอจริงในงาน soak ที่ 3 คือโมเดลเขียนว่า
    "Accepted handoff แล้ว" ทั้งที่ไม่เคยเรียก tool เลย
    """
    who = expected.get("handoff_id") or expected.get("task_id")
    return (
        "[System: รอบนี้ถูกส่งมาทำใบ %s แต่จากบันทึกการเรียกเครื่องมือของรอบนี้ "
        "ยังไม่มี accept_handoff ที่สำเร็จเลย\n"
        "ถ้ายังจะทำงานนี้ ให้เรียก accept_handoff จริง ๆ ก่อน แล้วเดินตามใบให้จบ\n"
        "การเขียนว่ารับใบแล้วไม่นับ — นับเฉพาะที่มีหลักฐานจาก server\n"
        "ห้ามไปค้นหาหรือลองเครื่องมืออื่นมาแทน ห้ามหาทางอ้อม\n"
        "นี่คือการเตือนครั้งเดียวของรอบนี้ จะไม่มีครั้งที่สอง]" % who
    )


def decide(
    *,
    session_id: str,
    attempt: int = 0,
    db_path: Optional[str] = None,
    coordination_sources: Optional[Set[str]] = None,
    max_tokens: Optional[int] = MAX_SESSION_TOKENS,
    expected: Optional[Dict[str, str]] = None,
) -> Optional[Dict[str, str]]:
    """ตรรกะทั้งหมดอยู่ตรงนี้ — แยกจาก hook เพื่อให้ทดสอบตรง ๆ ได้

    ครอบ lifecycle ทั้งเส้น โดยใช้งบ nudge ก้อนเดียวร่วมกันทั้งสองช่วง
      ก่อนรับใบ  — ถูกส่งมาทำใบนี้ แต่ยังไม่มี accept_handoff ที่สำเร็จ
      หลังรับใบ  — รับแล้วแต่ยังไม่มี update_task ที่สถานะปลายทาง

    คืน ``None`` เมื่อควรปล่อยให้รอบจบ รวมถึงกรณีที่เตือนไปแล้วและงานยังค้าง
    """
    if not session_id:
        return None
    job = EXPECTED_JOB if expected is None else expected
    if not job:
        # ไม่มีสัญญางาน = รอบนี้ไม่ใช่งาน coordination ที่ runner ส่งมา
        # ปิดไว้เลยดีกว่าไปเดาจากสถานะ workspace ซึ่งเป็นพื้นที่ให้ยิงมั่ว
        return None
    if attempt >= MAX_COORDINATION_NUDGES:
        # งบ nudge ก้อนเดียวใช้ร่วมกันทั้งก่อนและหลังรับใบ ไม่ใช่ช่วงละก้อน
        return None
    scan = scan_session(db_path or _state_db_path(), session_id)
    if not scan["found"]:
        return None
    sources = coordination_sources or COORDINATION_SOURCES
    if scan["source"] not in sources:
        return None          # แชท LINE และ subagent ไม่เข้าเงื่อนไข

    accepted = scan["accepted"]
    expected_task = job.get("task_id") or ""
    matched = expected_task in accepted if expected_task else bool(accepted)

    if not matched:
        phase, pending, message = "pre-accept", [expected_task or job.get("handoff_id", "")], \
            build_preaccept_nudge(job)
    else:
        pending = [t for t in pending_tasks(scan) if t == expected_task]
        if not pending:
            return None      # ใบที่ถูกส่งมาทำ ปิดเรียบร้อยแล้ว
        phase, message = "post-accept", build_nudge(sorted(pending))

    logger.info(
        "coordination-finalization: session=%s phase=%s attempt=%s tokens=%s "
        "expected_task=%s expected_handoff=%s pending=%s",
        session_id, phase, attempt, scan.get("tokens"),
        job.get("task_id"), job.get("handoff_id"), pending,
    )
    if max_tokens and scan.get("tokens", 0) >= max_tokens:
        logger.warning(
            "coordination-finalization: ข้ามการเตือนเพราะรอบนี้ใช้ไป %s token แล้ว "
            "(เพดาน %s) งานที่ยังค้าง: %s", scan.get("tokens"), max_tokens, pending,
        )
        return None
    return {"action": "continue", "message": message}


def residual_pending(session_id: str, db_path: Optional[str] = None) -> List[str]:
    """ใบที่ยังค้างหลังรอบจบ — ให้ runner/monitoring เอาไปรายงานต่อได้

    แยกจาก ``decide`` เพราะการ "ปล่อยจบ" ไม่ได้แปลว่าไม่มีอะไรค้าง
    """
    return pending_tasks(scan_session(db_path or _state_db_path(), session_id))


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
