# -*- coding: utf-8 -*-
"""replay-intent-ack.py — พิสูจน์ intent_ack_continuation แบบกำหนดผลได้ ไม่เรียกโมเดล

ใช้ตอบคำถามเดียว: guard ตัวนี้จับอาการที่ instance หยุดกลางคันของเราได้จริงไหม

วิธีใช้ (รันในคอนเทนเนอร์ Hermes — ต้องมี /opt/hermes อยู่จริง):
    docker exec -i <ctr> sh -c 'mkdir -p /tmp/replay && cat > /tmp/replay/replay-intent-ack.py' < scripts/replay-intent-ack.py
    docker exec -i <ctr> sh -c 'cat > /tmp/replay/pristine2.json' < <ไฟล์หลักฐาน>
    docker exec <ctr> sh -c 'cd /opt/hermes && .venv/bin/python /tmp/replay/replay-intent-ack.py'

pristine2.json ต้องมีคีย์: user_message, final_assistant_content, final_finish_reason,
final_tool_calls, n_tool_messages — ดึงจาก state.db ของรอบที่ล้มเหลวจริง

ผลที่วัดได้เมื่อ 2026-09-19 (Hermes v2026.8.3 · nous/upstage/solar-pro4:free):

    auto -> resolved=off -> fired=False
    true -> resolved=all -> fired=False   <- กับข้อความจริงของรอบที่ล้ม

ไม่ยิงเพราะมีสี่ด่าน แต่ละด่านพอตัวเอง (agent/agent_runtime_helpers.py:3445):
    1. any(role=="tool") -> return False ทันที     รอบที่ล้มมี tool มาก่อน 8 ตัว
    2. len(assistant_text) > 1200 -> False         ข้อความจริงยาว 1619
    3. future-ack regex เป็นอังกฤษล้วน              ข้อความจริงเป็นไทย
    4. action_markers ไม่มีคำว่า "update"           "I'll update the task" ก็ยังตก

ด่านที่ 1 ขัดกับอาการของเราโดยนิยาม — predicate จับ ack ที่ turn แรกก่อนลงมือ
ส่วนอาการของเราเกิดกลางงานเสมอ แก้เรื่องภาษาอย่างเดียวจึงไม่ช่วย

negative control ที่ต้องไม่ยิง (และไม่ยิงจริง): สรุปงานที่เสร็จแล้ว · ทักทาย ·
ถามกลับเพื่อขอความชัดเจน · "I'll help you brainstorm" — อันสุดท้ายมี I'll ครบ
แต่ตกที่ด่าน 4 แปลว่าลิสต์คำกริยาคือสิ่งเดียวที่กันการยิงมั่วอยู่ตอนนี้

ไม่เรียก provider · ไม่แตะ network · ไม่แก้ไฟล์ production · เรียก predicate ตัวจริงตรง ๆ
"""
import json, sys, os
sys.path.insert(0, "/opt/hermes")

from agent.agent_runtime_helpers import (
    looks_like_codex_intermediate_ack,
    intent_ack_continuation_mode,
    strip_think_blocks,
)

class ReplayAgent:
    """ตัวแทน agent เฉพาะส่วนที่ predicate เรียกใช้จริง — ไม่ mock ตัว predicate เอง"""
    def __init__(self, mode):
        self._intent_ack_continuation = mode
        self.valid_tool_names = ["mcp__ai_collab_write__update_task"]
        self.model = "upstage/solar-pro4:free"
        self.provider = "nous"
        # nous + model ที่ไม่ใช่ anthropic/* -> chat_completions (agent_init.py:646)
        self.api_mode = "chat_completions"
    def _strip_think_blocks(self, content):
        return strip_think_blocks(self, content)

FIXT = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pristine2.json")))
P2_USER  = FIXT["user_message"]
P2_FINAL = FIXT["final_assistant_content"]
P2_NTOOL = FIXT["n_tool_messages"]

def msgs_with_tools(n):
    out = [{"role": "user", "content": P2_USER}]
    for i in range(n):
        out.append({"role": "assistant", "content": "", "tool_calls": [{"id": str(i)}]})
        out.append({"role": "tool", "content": "<untrusted_tool_result .../>"})
    return out

def run(label, user, assistant, messages, mode):
    agent = ReplayAgent(mode)
    resolved = intent_ack_continuation_mode(agent)
    fired = False
    if resolved != "off" and agent.valid_tool_names:
        fired = looks_like_codex_intermediate_ack(
            agent, user, assistant, messages,
            require_workspace=(resolved == "codex_only"),
        )
    print(f"  {label:<46} mode={str(mode):<6} resolved={resolved:<10} fired={fired}")
    return fired

print("=" * 96)
print("ส่วนที่ 1 — ข้อความจริงของ pristine #2 (verbatim จาก state.db ของ live)")
print(f"  ความยาว {len(P2_FINAL)} ตัวอักษร · tool message ก่อนหน้า {P2_NTOOL} ตัว · finish_reason={FIXT['final_finish_reason']} · tool_calls={FIXT['final_tool_calls']}")
print("=" * 96)
r_auto = run("A. ข้อความจริง #2 (สภาพจริง)", P2_USER, P2_FINAL, msgs_with_tools(P2_NTOOL), "auto")
r_true = run("B. ข้อความจริง #2 (สภาพจริง)", P2_USER, P2_FINAL, msgs_with_tools(P2_NTOOL), True)

print()
print("=" * 96)
print("ส่วนที่ 2 — ไล่ทีละด่านว่าอะไรทำให้ไม่ผ่าน (ปลดทีละข้อ)")
print("=" * 96)
run("B1. ปลดด่าน prior-tool (messages ว่าง)",      P2_USER, P2_FINAL, [{"role":"user","content":P2_USER}], True)
short = "กำลัง update task เป็น done ให้เลยครับ"
run("B2. ปลด prior-tool + ตัดให้สั้นกว่า 1200",    P2_USER, short,   [{"role":"user","content":P2_USER}], True)
run("B3. B2 + แปลเป็นอังกฤษ (I'll update the task)", P2_USER,
    "I'll update the task to done now.", [{"role":"user","content":P2_USER}], True)
run("B4. B3 + ใช้ action verb ที่อยู่ในลิสต์ (check)", P2_USER,
    "I'll check the task and report back.", [{"role":"user","content":P2_USER}], True)

print()
print("=" * 96)
print("ส่วนที่ 3 — negative control (ต้องไม่ยิง)")
print("=" * 96)
run("N1. สรุปงานที่เสร็จแล้วจริง",  P2_USER, "เสร็จแล้วครับ ทั้ง 6 ขั้นตอนทำครบ task เป็น done แล้ว", [{"role":"user","content":P2_USER}], True)
run("N2. ทักทาย",                    "สวัสดี", "สวัสดีครับ วันนี้ให้ช่วยอะไรดีครับ", [{"role":"user","content":"สวัสดี"}], True)
run("N3. ถามกลับเพื่อขอความชัดเจน",  P2_USER, "แบบนี้จะต้อง accept แล้วปิด task ใช่ไหมครับ?", [{"role":"user","content":P2_USER}], True)
run("N4. อังกฤษ: เสนอช่วยคิด (ไม่ควรยิง)", "help me brainstorm",
    "I'll help you brainstorm some ideas.", [{"role":"user","content":"help me brainstorm"}], True)

print()
print("=" * 96)
print("ส่วนที่ 4 — เพดาน nudge (codex_ack_continuations < 2 ใน conversation_loop.py:6839)")
print("=" * 96)
agent = ReplayAgent(True)
ack = "I'll check the task and report back."
m = [{"role": "user", "content": P2_USER}]
counter = 0
for turn in range(1, 6):
    allowed = counter < 2
    pred = looks_like_codex_intermediate_ack(agent, P2_USER, ack, m, require_workspace=False)
    will = allowed and pred
    print(f"  turn {turn}: counter={counter} allowed={allowed} predicate={pred} -> continue={will}")
    if will:
        counter += 1
    else:
        print(f"  หยุดที่ turn {turn} — ยิง nudge ไปทั้งหมด {counter} ครั้ง")
        break
