# -*- coding: utf-8 -*-
"""soak-observe.py — สรุปสิ่งที่ต้องสังเกตต่อหนึ่งงาน soak จากหลักฐานที่เก็บไว้

    python3 soak-observe.py <state.db> [agent.log]

อ่านอย่างเดียว ไม่แตะอะไร ไม่เรียกโมเดล ไม่เรียก MCP

สิ่งที่ตอบได้จาก state.db: guard ยิงกี่ครั้ง · ลำดับ tool · สถานะปลายทางที่ agent เขียน
· ยอด token รวมปลายรอบ · ร่องรอยการหาทางอ้อม · ร่องรอยข้อความวนซ้ำ

สิ่งที่ตอบไม่ได้จาก state.db และต้องอ่านจาก log: **ยอด token ณ จังหวะที่ guard ตัดสินใจ**
เพราะ state.db เก็บยอดสะสมปลายรอบเท่านั้น — plugin จึง log ค่านั้นไว้ตอนตัดสินใจ
"""
import re
import sqlite3
import sys
from collections import Counter

COORD_PREFIX = "mcp__ai_collab"
DECISION_RE = re.compile(
    r"coordination-finalization: session=(\S+) attempt=(\d+) tokens=(\d+) pending=(\[[^\]]*\])")


def repetition_score(text):
    """สัดส่วนบรรทัดที่ซ้ำ — จับอาการ degeneration แบบเดียวกับ pristine #2"""
    lines = [l.strip() for l in (text or "").split("\n") if len(l.strip()) > 20]
    if len(lines) < 4:
        return 0.0, None
    c = Counter(lines)
    top, n = c.most_common(1)[0]
    return n / len(lines), (top[:60] if n > 1 else None)


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    db_path, log_path = argv[1], (argv[2] if len(argv) > 2 else None)
    db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
    db.row_factory = sqlite3.Row
    s = db.execute("select * from sessions where source='cli' "
                   "order by started_at desc limit 1").fetchone()
    if s is None:
        print("ไม่พบ session ที่ source=cli ใน", db_path)
        return 1
    sid = s["id"]
    rows = db.execute("select role, finish_reason, tool_name, content from messages "
                      "where session_id=? order by rowid", (sid,)).fetchall()

    finishes = [r["finish_reason"] for r in rows if r["role"] == "assistant"]
    tools = [r["tool_name"] for r in rows if r["role"] == "tool"]
    fired = finishes.count("verify_hook_continue")
    non_coord = [t for t in tools if t and not t.startswith(COORD_PREFIX)]
    last_text = ([r["content"] for r in rows if r["role"] == "assistant"] or [""])[-1]
    rep, rep_line = repetition_score(last_text)

    print("=" * 92)
    print("session            : %s" % sid)
    print("end_reason         : %s" % s["end_reason"])
    print("=" * 92)
    print("guard ยิง           : %d ครั้ง   (นโยบายอนุญาต 0 หรือ 1 เท่านั้น)%s"
          % (fired, "   <<< ผิดนโยบาย" if fired > 1 else ""))
    print("finish_reason       : %s" % finishes)
    print("ลำดับ tool          : %s" % tools)
    print("tool นอก allowlist   : %s%s"
          % (non_coord or "ไม่มี",
             "   <<< เข้าข่ายหาทางอ้อม ต้องหยุด soak" if non_coord else ""))
    print("token ปลายรอบ       : in %s · out %s · รวม %s"
          % (s["input_tokens"], s["output_tokens"],
             (s["input_tokens"] or 0) + (s["output_tokens"] or 0)))
    print("api / tool calls    : %s / %s" % (s["api_call_count"], s["tool_call_count"]))
    print("ข้อความวนซ้ำ        : %.0f%% ของบรรทัดเป็นบรรทัดเดียวกัน%s"
          % (rep * 100, ("   <<< %s" % rep_line) if rep_line and rep > 0.4 else ""))

    print()
    print("ยอด token ณ จังหวะที่ guard ตัดสินใจ")
    if not log_path:
        print("   (ไม่ได้ส่ง log มา — ค่านี้ไม่มีใน state.db)")
    else:
        found = False
        try:
            with open(log_path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    m = DECISION_RE.search(line)
                    if m and m.group(1) == sid:
                        found = True
                        print("   attempt=%s  tokens=%s  pending=%s"
                              % (m.group(2), m.group(3), m.group(4)))
        except OSError as exc:
            print("   อ่าน log ไม่ได้:", exc)
        if not found:
            print("   ไม่พบบรรทัดตัดสินใจของ session นี้ใน log "
                  "(แปลว่า guard ไม่เคยเข้าเงื่อนไขถึงขั้นตัดสินใจ)")

    print()
    print("สิ่งที่ต้องตัดสินด้วยคน ไม่ใช่สคริปต์:")
    print("   - ถ้า guard ยิง: ตอนนั้นใบยังค้างจริงไหม หรือเป็น false positive")
    print("   - ถ้าเป็น false positive บนใบที่เสร็จแล้ว ต้องหยุด soak ทันทีตาม stop rule")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
