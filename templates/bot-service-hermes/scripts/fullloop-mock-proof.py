# -*- coding: utf-8 -*-
"""fullloop-mock-proof.py — ขับ conversation loop จริงของ Hermes ด้วย provider ปลอม

ตอบคำถามเดียวที่ replay กับ unit test ตอบไม่ได้:
    พอ turn จะจบโดยที่ใบยังค้าง loop จริงเรียก pre_verify แล้วเดินต่อ "ในรอบเดิม" ไหม
    และพอ response ถัดไปเรียก update_task แล้วมันยอมจบจริงไหม

ไม่มีการเรียกโมเดลหรือ network เลย — แทนที่จุดเชื่อมสองจุดบน object ของ agent เท่านั้น
ไม่แก้ไฟล์ใน /opt/hermes (นอกจาก patch ที่ apply แยกไว้แล้ว)

    agent._interruptible_api_call   -> คืน response ที่เขียนสคริปต์ไว้
    agent._execute_tool_calls       -> ใส่ผล tool ที่เขียนสคริปต์ไว้ ไม่ยิง MCP จริง

ต้องรันในคอนเทนเนอร์ Hermes ที่ apply patch 0001-pre-verify-always แล้ว
และเปิด agent.pre_verify_always: true + plugins.enabled มี coordination-finalization
"""
import json
import os
import sys
import types

sys.path.insert(0, "/opt/hermes")
os.environ.setdefault("HERMES_YOLO_MODE", "1")

RESULTS = []


# ── provider ปลอม ────────────────────────────────────────────────────────────
class FakeFn:
    def __init__(self, name, args):
        self.name = name
        self.arguments = json.dumps(args, ensure_ascii=False)


class FakeToolCall:
    def __init__(self, idx, name, args):
        self.id = "call_%d" % idx
        self.type = "function"
        self.function = FakeFn(name, args)


class FakeMessage:
    def __init__(self, content=None, tool_calls=None):
        self.role = "assistant"
        self.content = content
        self.tool_calls = tool_calls or None
        self.reasoning = None
        self.reasoning_content = None

    def model_dump(self, *a, **k):
        return {"role": "assistant", "content": self.content}


class FakeChoice:
    def __init__(self, message, finish_reason):
        self.index = 0
        self.message = message
        self.finish_reason = finish_reason


class FakeUsage:
    prompt_tokens = 10
    completion_tokens = 5
    total_tokens = 15
    prompt_tokens_details = None
    completion_tokens_details = None


class FakeResponse:
    def __init__(self, message, finish_reason):
        self.id = "chatcmpl-fake"
        self.model = "mock/deterministic"
        self.choices = [FakeChoice(message, finish_reason)]
        self.usage = FakeUsage()
        self.system_fingerprint = None


def say(text):
    """โมเดลตอบข้อความแล้วพยายามจบ turn — ไม่มี tool call"""
    return FakeResponse(FakeMessage(content=text), "stop")


def call(name, args):
    """โมเดลสั่งเรียก tool"""
    return FakeResponse(FakeMessage(content=None, tool_calls=[FakeToolCall(1, name, args)]),
                        "tool_calls")


WRAPPER = ('<untrusted_tool_result source="%s">\n%s\n</untrusted_tool_result>')


def wrap(tool_name, payload):
    inner = json.dumps({"result": json.dumps(payload, ensure_ascii=False, indent=2)},
                       ensure_ascii=False)
    return WRAPPER % (tool_name, inner)


TOOL_REPLIES = {
    "mcp__ai_collab_write__accept_handoff": {
        "handoff_id": "ho-mock", "task_id": "task-MOCK-0001",
        "task_status": "in_progress", "accepted_by": "monthop-gmail/nst-hermes"},
    "mcp__ai_collab__get_discussion": {"messages": [], "latest_seq": 1},
}


def build_agent(platform="cli"):
    from run_agent import AIAgent
    from hermes_state import SessionDB
    agent = AIAgent(
        api_key="mock-key",
        base_url="http://127.0.0.1:9/v1",     # ไม่มีอะไรฟังอยู่ — กันพลาดไปยิงของจริง
        provider="nous",
        api_mode="chat_completions",
        model="mock/deterministic",
        enabled_toolsets=[],
        quiet_mode=True,
        platform=platform,
        session_db=SessionDB(),
        skip_context_files=True,
        skip_memory=True,
    )
    agent.suppress_status_output = True
    agent.stream_delta_callback = None
    agent.tool_gen_callback = None
    return agent


def install_mock(agent, script):
    """ต่อ provider ปลอมและ tool ปลอมเข้ากับ agent ตัวนี้เท่านั้น"""
    state = {"i": 0, "calls": []}

    def fake_api(api_kwargs):
        i = state["i"]
        state["i"] = i + 1
        resp = script[i] if i < len(script) else say("(สคริปต์หมดแล้ว)")
        state["calls"].append(i)
        return resp

    def fake_exec(assistant_message, messages, effective_task_id, api_call_count=0):
        for tc in (assistant_message.tool_calls or []):
            name = tc.function.name
            args = json.loads(tc.function.arguments or "{}")
            if name == "mcp__ai_collab_write__update_task":
                payload = {"task_id": args.get("task_id", "task-MOCK-0001"),
                           "status": args.get("status", "done"),
                           "updated_by": "monthop-gmail/nst-hermes"}
                if args.get("detail"):
                    payload["detail"] = args["detail"]
            else:
                payload = TOOL_REPLIES.get(name, {"ok": True})
            messages.append({"role": "tool", "tool_call_id": tc.id,
                             "tool_name": name, "content": wrap(name, payload)})

    agent._interruptible_api_call = fake_api
    agent._execute_tool_calls = fake_exec
    # Hermes มี seam สำหรับเทสอยู่แล้ว: ถ้า agent.client เป็น unittest.mock.Mock
    # loop จะปิด streaming เอง (conversation_loop.py:2364-2368) เพราะ mock ไม่ใช่
    # iterator ของ stream — ใช้ทางนี้แทนการฝืนตั้ง flag ภายใน
    from unittest.mock import MagicMock
    agent.client = MagicMock()

    # ต้องประกาศชื่อ tool ให้ agent รู้จักก่อน ไม่งั้น loop จะปฏิเสธตั้งแต่ชั้น
    # validation แล้วคืน "Tool ... does not exist" โดยไม่เคยเรียก executor เลย
    names = [ACCEPT, UPDATE, "mcp__ai_collab__get_discussion"]
    agent.tools = [{"type": "function",
                    "function": {"name": n, "description": "mock",
                                 "parameters": {"type": "object", "properties": {}}}}
                   for n in names]
    agent.valid_tool_names = set(names)
    return state


def signatures(agent, result):
    """ลายเซ็นที่ใช้ตัดสิน — ดึงจาก messages ที่ loop คืนมาจริง"""
    msgs = result.get("messages") or getattr(agent, "_session_messages", []) or []
    finishes = [m.get("finish_reason") for m in msgs
                if isinstance(m, dict) and m.get("role") == "assistant"]
    # nudge ที่ฉีดเข้าไปถูกตัดออกจาก transcript ถาวรตามที่ Hermes ตั้งใจ
    # (flag _pre_verify_synthetic) จึงนับจากลายเซ็นที่ loop เขียนไว้แทน
    synthetic = [m for m in msgs if isinstance(m, dict) and m.get("_pre_verify_synthetic")]
    tools = [m.get("tool_name") for m in msgs
             if isinstance(m, dict) and m.get("role") == "tool"]
    return finishes, synthetic, tools


def scenario(name, script, platform="cli", expect_continue=True, expect_cap=None):
    print("\n" + "=" * 100)
    print("SCENARIO: %s" % name)
    print("=" * 100)
    agent = build_agent(platform=platform)
    state = install_mock(agent, script)
    result = agent.run_conversation("ทำใบงานใน ai-collab ให้จบในรอบนี้")
    finishes, synthetic, tools = signatures(agent, result)
    nudges = finishes.count("verify_hook_continue")
    print("  session_id            : %s" % agent.session_id)
    print("  api call ที่ mock ตอบไป : %d" % len(state["calls"]))
    print("  finish_reason ราย turn : %s" % finishes)
    print("  tool ที่ถูกเรียก        : %s" % tools)
    print("  verify_hook_continue   : %d ครั้ง  (nudge ที่ยังอยู่ใน transcript: %d)"
          % (nudges, len(synthetic)))
    got = nudges > 0
    ok = (got == expect_continue) if expect_cap is None else (nudges == expect_cap)
    RESULTS.append((name, ok))
    print("  ผล                     : %s" % ("ok" if ok else "FAIL"))
    if synthetic:
        print("  ข้อความ nudge ตัวแรก    : %s" % (synthetic[0].get("content") or "")[:120].replace("\n", " "))
    return agent, result


ACCEPT = "mcp__ai_collab_write__accept_handoff"
UPDATE = "mcp__ai_collab_write__update_task"


def main():
    from hermes_cli import plugins
    plugins._ensure_plugins_discovered(force=True)
    from agent.verify_hooks import pre_verify_always, max_verify_nudges
    from hermes_cli.lifecycle import has_hook
    print("=" * 100)
    print("สภาพ runtime ก่อนเริ่ม")
    print("=" * 100)
    print("  pre_verify_always()   : %s" % pre_verify_always())
    print("  max_verify_nudges()   : %s" % max_verify_nudges())
    print("  has_hook(pre_verify)  : %s" % has_hook("pre_verify"))
    print("  hook ที่ลงทะเบียน      : %s" % {
        k: [f.__module__ + "." + f.__name__ for f in v]
        for k, v in getattr(plugins.get_plugin_manager(), "_hooks", {}).items()})

    # DONE — รับใบ แล้วพยายามจบทั้งที่ยังไม่ปิด แล้วถูกดันจนเรียก update_task(done)
    scenario("DONE — ถูกดันแล้วปิดใบด้วย done",
             [call(ACCEPT, {"handoff_id": "ho-mock"}),
              say("ทำครบแล้วครับ กำลัง update task เป็น done ให้เลย"),
              call(UPDATE, {"task_id": "task-MOCK-0001", "status": "done"}),
              say("ปิดใบเรียบร้อยครับ")],
             expect_continue=True)

    # BLOCKED — ถูกดันแล้วบันทึก blocked พร้อมหลักฐาน
    scenario("BLOCKED — ถูกดันแล้วปิดใบด้วย blocked + detail",
             [call(ACCEPT, {"handoff_id": "ho-mock"}),
              say("ติดปัญหาครับ ไปต่อไม่ได้"),
              call(UPDATE, {"task_id": "task-MOCK-0001", "status": "blocked",
                            "detail": "post_message ล้มสองครั้งด้วย 502"}),
              say("บันทึก blocker ลงใบแล้วครับ")],
             expect_continue=True)

    # NARRATION-ONLY — พูดอย่างเดียวตลอด ต้องถูกดันจนชนเพดานแล้วหยุด
    scenario("NARRATION-ONLY — พูดอย่างเดียว ต้องชนเพดานแล้วหยุด",
             [call(ACCEPT, {"handoff_id": "ho-mock"})] + [say("เดี๋ยวปิดใบให้ครับ")] * 8,
             expect_cap=max_verify_nudges())

    # NO-TASK — ไม่ได้รับใบ ต้องไม่ถูกดัน
    scenario("NO-TASK — CLI ที่ไม่ได้รับใบงาน",
             [say("ตอนนี้ไม่มีงานค้างครับ")],
             expect_continue=False)

    # LINE — มีใบค้างแต่เป็น messaging surface ต้องไม่ถูกดัน
    scenario("LINE — มีใบค้างแต่เป็นแชท",
             [call(ACCEPT, {"handoff_id": "ho-mock"}),
              say("รับงานแล้วครับ")],
             platform="line", expect_continue=False)

    print("\n" + "=" * 100)
    bad = [n for n, ok in RESULTS if not ok]
    print("ผ่าน %d/%d%s" % (len(RESULTS) - len(bad), len(RESULTS),
                            ("  -> FAIL: " + ", ".join(bad)) if bad else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
