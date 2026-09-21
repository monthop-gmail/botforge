# -*- coding: utf-8 -*-
"""apply-hermes-patch.py — ใส่ patch state-finalization ลงคอนเทนเนอร์ Hermes แบบ exact-string

ใช้แทน `patch(1)` เพราะอิมเมจ Hermes ไม่มีคำสั่งนั้น
แก้แบบตรงตัวอักษรเป๊ะ ถ้าไม่ตรงจะหยุดทันทีและไม่แก้อะไรเลย — ไม่มี fuzzy matching

    docker exec -u 0 <ctr> python3 /tmp/apply-hermes-patch.py          # ใส่
    docker exec -u 0 <ctr> python3 /tmp/apply-hermes-patch.py --check  # ตรวจอย่างเดียว

patch นี้เป็น ephemeral โดยตั้งใจ — หายเมื่อ container ถูกสร้างใหม่
ตัวเต็มพร้อมเหตุผลอยู่ที่ patches/0001-pre-verify-always.patch
"""
import io
import sys

EDITS = [
    ("/opt/hermes/agent/verify_hooks.py",
     'def coding_verify_guidance(config: Optional[dict[str, Any]] = None) -> Optional[str]:',
     '''def pre_verify_always(config: Optional[dict[str, Any]] = None) -> bool:
    """Whether ``pre_verify`` may fire on turns that edited no files."""
    return is_truthy_value(_agent_cfg(config).get("pre_verify_always", False), default=False)


def coding_verify_guidance(config: Optional[dict[str, Any]] = None) -> Optional[str]:'''),

    ("/opt/hermes/agent/conversation_loop.py",
     '                    from agent.verify_hooks import max_verify_nudges\n'
     '                    from hermes_cli.lifecycle import has_hook\n'
     '                    from hermes_cli.plugins import get_pre_verify_continue_message\n'
     '\n'
     '                    if _edited and has_hook("pre_verify") and _attempt < max_verify_nudges():',
     '                    from agent.verify_hooks import max_verify_nudges, pre_verify_always\n'
     '                    from hermes_cli.lifecycle import has_hook\n'
     '                    from hermes_cli.plugins import get_pre_verify_continue_message\n'
     '\n'
     '                    if (_edited or pre_verify_always()) and has_hook("pre_verify") and _attempt < max_verify_nudges():\n'
     '                        # hook ที่ตัดสินจากสิ่งที่ turn นี้ทำไปแล้ว อ่านได้ทางเดียวคือ\n'
     '                        # session store แต่ผล tool ของ turn ปัจจุบันยังไม่ถูก flush\n'
     '                        # วัดแล้ว: ตอน hook ทำงานมี 2 แถว หลังจบรอบมี 4 แถว\n'
     '                        try:\n'
     '                            agent._flush_messages_to_session_db(messages, conversation_history)\n'
     '                        except Exception:\n'
     '                            logger.debug("pre_verify preflush failed", exc_info=True)'),

    ("/opt/hermes/hermes_cli/config_defaults.py",
     '        "max_verify_nudges": 3,',
     '        "max_verify_nudges": 3,\n        "pre_verify_always": False,'),
]

MARKERS = ["pre_verify_always", "pre_verify_always", "pre_verify_always"]


def main(argv):
    check_only = "--check" in argv
    applied = missing = 0
    for (path, old, new), marker in zip(EDITS, MARKERS):
        s = io.open(path, encoding="utf-8").read()
        if marker in s:
            print("  มีอยู่แล้ว : %s" % path)
            applied += 1
            continue
        if check_only:
            print("  ยังไม่ใส่   : %s" % path)
            missing += 1
            continue
        if s.count(old) != 1:
            print("  FAIL ไม่ตรง : %s (เจอ %d ที่ ควรเจอ 1)" % (path, s.count(old)))
            return 1
        io.open(path, "w", encoding="utf-8").write(s.replace(old, new, 1))
        print("  ใส่แล้ว    : %s" % path)
        applied += 1

    if not check_only:
        import ast
        for path, _, _ in EDITS:
            ast.parse(io.open(path, encoding="utf-8").read())
        print("  syntax ผ่านทั้ง %d ไฟล์" % len(EDITS))
    print("สรุป: ใส่แล้ว %d · ยังไม่ใส่ %d" % (applied, missing))
    return 1 if (check_only and missing) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
