# -*- coding: utf-8 -*-
"""replay-finalization-guard.py — ทดสอบ guard ที่ตัดสินจาก "สถานะ" ไม่ใช่ "ถ้อยคำ"

ปัญหาที่จะแก้: instance รับใบงานแล้วทำไปเกือบครบ แต่จบ turn ก่อนจะปิดใบ
ใบจึงค้างที่ in_progress ทั้งที่งานเสร็จแล้ว (pristine #2)

intent_ack_continuation แก้ไม่ได้ พิสูจน์แล้วด้วย replay-intent-ack.py
เพราะมันอ่านถ้อยคำ และมีด่าน no-prior-tools ที่ขัดกับอาการนี้โดยนิยาม

กติกาที่เสนอ — ไม่แตะถ้อยคำเลยสักตัว:

    ถ้ารอบการทำงานนี้ "รับใบ" ไปแล้ว และใบนั้น "ยังไม่ถึงสถานะปลายทาง"
    ตอนที่ agent กำลังจะจบ turn -> ดันให้เดินต่อในรอบเดิม (จำกัดจำนวนครั้ง)

    guard ห้ามปิดใบแทน — ต้องให้ agent เรียก update_task เอง
    หรือรายงาน blocker เอง มิฉะนั้น done จะไม่ใช่หลักฐานว่า agent ทำงานจบ

หลักฐานที่ใช้ตัดสิน ทั้งหมดอยู่ใน state.db ของรอบนั้นเอง ไม่ต้องเรียก network:
    accept_handoff -> ผลลัพธ์เป็น JSON มี task_id + task_status
    update_task    -> ผลลัพธ์เป็น JSON มี task_id + status

วิธีใช้:
    python3 replay-finalization-guard.py <state.db> [session_id ...]
    ไม่ใส่ session_id = ไล่ทุก session ที่ source='cli'

ไม่แก้ไฟล์ production · ไม่เรียกโมเดล · ไม่เรียก MCP · อ่าน state.db อย่างเดียว
"""
import json
import re
import sqlite3
import sys

TERMINAL_STATUSES = {"done", "blocked", "cancelled"}
ACCEPT_TOOLS = ("accept_handoff",)
UPDATE_TOOLS = ("update_task",)
MAX_NUDGES = 2

# ผลลัพธ์ของ MCP tool ถูกห่อไว้สองชั้น: untrusted_tool_result -> {"result": "<json string>"}
_RESULT_RE = re.compile(r'\{"result":\s*"(.*)"\}', re.S)


def _parse_tool_result(content):
    """ดึง JSON ของจริงออกจากผลลัพธ์ tool — คืน dict หรือ None ถ้าอ่านไม่ออก"""
    if not content:
        return None
    m = _RESULT_RE.search(content)
    if not m:
        return None
    try:
        inner = json.loads('"%s"' % m.group(1))
        return json.loads(inner)
    except (ValueError, TypeError):
        return None


def evaluate(db_path, session_id):
    """ตัดสินว่ารอบนี้ควรถูกดันให้เดินต่อไหม — คืน dict อธิบายเหตุผล"""
    db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
    db.row_factory = sqlite3.Row
    sess = db.execute(
        "select id, source, end_reason, tool_call_count from sessions where id=?",
        (session_id,),
    ).fetchone()
    if sess is None:
        return {"session": session_id, "verdict": "not-found"}

    rows = db.execute(
        "select role, finish_reason, tool_name, content from messages "
        "where session_id=? order by rowid",
        (session_id,),
    ).fetchall()

    accepted = {}   # task_id -> สถานะตอนรับ
    finalized = {}  # task_id -> สถานะที่ agent เขียนกลับไป
    for m in rows:
        name = m["tool_name"] or ""
        if m["role"] != "tool":
            continue
        payload = _parse_tool_result(m["content"])
        if not isinstance(payload, dict):
            continue
        tid = payload.get("task_id")
        if not tid:
            continue
        if any(t in name for t in ACCEPT_TOOLS):
            accepted[tid] = payload.get("task_status") or payload.get("status")
        elif any(t in name for t in UPDATE_TOOLS):
            finalized[tid] = payload.get("status")

    last_assistant = [m for m in rows if m["role"] == "assistant"]
    last_finish = last_assistant[-1]["finish_reason"] if last_assistant else None

    # ด่านที่ 1 — ขอบเขต: เฉพาะงาน coordination ที่ botforge ยิงด้วย hermes -z
    # แชท LINE ปกติไม่เข้าเงื่อนไขนี้ตั้งแต่ต้น จึงยิงใส่บทสนทนาของทีมไม่ได้เลย
    if sess["source"] != "cli":
        return {"session": session_id, "source": sess["source"], "accepted": len(accepted),
                "verdict": "allow-stop", "why": "ไม่ใช่งาน coordination (source != cli)"}

    # ด่านที่ 2 — ไม่ได้รับใบอะไรไว้ ก็ไม่มีอะไรค้าง
    if not accepted:
        return {"session": session_id, "source": sess["source"], "accepted": 0,
                "verdict": "allow-stop", "why": "รอบนี้ไม่ได้รับใบงาน"}

    pending = {t: s for t, s in accepted.items()
               if str(finalized.get(t) or "").lower() not in TERMINAL_STATUSES}

    if not pending:
        return {"session": session_id, "source": sess["source"], "accepted": len(accepted),
                "verdict": "allow-stop", "why": "ใบที่รับไว้ถูกปิดครบแล้ว",
                "finalized": finalized}

    return {"session": session_id, "source": sess["source"], "accepted": len(accepted),
            "verdict": "continue", "why": "รับใบแล้วแต่ยังไม่ปิด",
            "pending": list(pending), "last_finish_reason": last_finish,
            "note": "guard ดันให้เดินต่อได้ไม่เกิน %d ครั้ง และห้ามปิดใบแทน agent" % MAX_NUDGES}


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    db_path = argv[1]
    sids = argv[2:]
    if not sids:
        db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
        sids = [r[0] for r in db.execute(
            "select id from sessions where source='cli' order by started_at desc limit 20")]
    for sid in sids:
        r = evaluate(db_path, sid)
        verdict = r.get("verdict")
        mark = "→ ดันต่อ " if verdict == "continue" else "  ปล่อยจบ"
        print("%s %-24s %-11s %s" % (mark, sid, verdict, r.get("why", "")))
        if verdict == "continue":
            print("%14s ใบที่ค้าง: %s · finish_reason=%s"
                  % ("", ", ".join(r["pending"]), r.get("last_finish_reason")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
