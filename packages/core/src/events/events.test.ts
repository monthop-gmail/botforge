import { test } from "node:test"
import assert from "node:assert/strict"
import {
  EventEmitter, MemorySink, BotforgeEvents, EVENT_TYPE_PATTERN,
  InvalidEventError, ReasoningInMetadataError, type TurnContext,
} from "./index.ts"
import { ID_PATTERN, makePrincipal, type Scope } from "../identity.ts"
import { classify } from "../errors.ts"

const SCOPE: Scope = { tenant_id: "legal", workspace_id: "legal-opencode" }
const AT = new Date("2026-08-23T07:30:05Z")

let n = 0
const setup = () => {
  n = 0
  const sink = new MemorySink()
  const emitter = new EventEmitter(SCOPE, {
    sink,
    now: () => AT,
    newId: () => `ev-${String(++n).padStart(4, "0")}`,
  })
  return { sink, emitter, events: new BotforgeEvents(emitter) }
}

const CTX: TurnContext = {
  executionId: "exec-abc123",
  channelId: "line-ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3",
  channelType: "line",
  actor: makePrincipal("line", "U4af4980629f1b2c3d4e5f6a7b8c9d0e1", "สมชาย"),
  messageId: "m-001",
}

test("event ที่สร้างมี field ที่ event/v1 บังคับครบ", async () => {
  const { events, sink } = setup()
  await events.started(CTX, "opencode", "anthropic/claude-sonnet-4")
  const e = sink.events[0]!
  for (const f of ["event_id", "event_type", "tenant_id", "subject_type", "subject_id", "occurred_at", "source"]) {
    assert.ok(f in e, `ขาด required field: ${f}`)
  }
  assert.equal(e.tenant_id, "legal")
  assert.equal(e.workspace_id, "legal-opencode")
  assert.equal(e.occurred_at, "2026-08-23T07:30:05.000Z")
  assert.deepEqual(e.source, { kind: "internal" })
})

test("id ทุกตัวตรง ID_PATTERN และ event_type ตรง EVENT_TYPE_PATTERN", async () => {
  const { events, sink } = setup()
  await events.sessionStarted(CTX, "opencode")
  await events.queued(CTX)
  await events.started(CTX, "opencode")
  await events.succeeded(CTX, { cost_usd: 0.0123 })
  await events.channelJoined("line", CTX.channelId)
  for (const e of sink.events) {
    assert.match(e.event_id, ID_PATTERN, `event_id ผิด: ${e.event_id}`)
    assert.match(e.subject_id, ID_PATTERN, `subject_id ผิด: ${e.subject_id}`)
    assert.match(e.tenant_id, ID_PATTERN)
    assert.match(e.event_type, EVENT_TYPE_PATTERN, `event_type ผิด: ${e.event_type}`)
    if (e.channel_id) assert.match(e.channel_id, ID_PATTERN)
  }
})

test("randomUUID เป็นค่า default และผ่าน ID_PATTERN", () => {
  const emitter = new EventEmitter(SCOPE)
  const e = emitter.build({ event_type: "EXECUTION_STARTED", subject_type: "execution", subject_id: "exec-1" })
  assert.match(e.event_id, ID_PATTERN)
})

test("ห้ามสร้าง job_id ปลอม — ไม่มีคือไม่มี", async () => {
  const { events, sink } = setup()
  await events.started(CTX, "opencode")
  assert.equal("job_id" in sink.events[0]!, false, "Botforge ไม่มี job ต้องไม่มี field นี้เลย")
})

test("sequence เพิ่มขึ้นต่อ subject และแยกกันคนละ subject", async () => {
  const { emitter } = setup()
  const a = emitter.build({ event_type: "EXECUTION_STARTED", subject_type: "execution", subject_id: "exec-a" })
  const b = emitter.build({ event_type: "STATE_TRANSITION", subject_type: "execution", subject_id: "exec-a" })
  const c = emitter.build({ event_type: "EXECUTION_STARTED", subject_type: "execution", subject_id: "exec-b" })
  assert.equal(a.sequence, 1)
  assert.equal(b.sequence, 2)
  assert.equal(c.sequence, 1, "subject คนละตัวต้องเริ่มนับใหม่")
})

test("event ที่ออกไปแล้วแก้ไม่ได้ — append-only", async () => {
  const { events, sink } = setup()
  await events.started(CTX, "opencode")
  const e = sink.events[0]! as Record<string, unknown>
  assert.throws(() => { e.tenant_id = "คนอื่น" }, TypeError)
  assert.equal(sink.events[0]!.tenant_id, "legal")
})

test("subject จำเป็นเสมอ", () => {
  const { emitter } = setup()
  assert.throws(
    () => emitter.build({ event_type: "EXECUTION_STARTED", subject_type: "execution", subject_id: "" }),
    InvalidEventError,
  )
})

test("event_type ผิดรูปถูกปฏิเสธ", () => {
  const { emitter } = setup()
  for (const bad of ["lowercase", "AB", "มีไทย", "HAS-DASH", ""]) {
    assert.throws(
      () => emitter.build({ event_type: bad, subject_type: "execution", subject_id: "exec-1" }),
      InvalidEventError,
      `ควรปฏิเสธ: ${bad}`,
    )
  }
  // ค่านอกลิสต์มาตรฐานต้องผ่าน — vocabulary เป็นชุดเปิด
  for (const ok of ["SESSION_STARTED", "CHANNEL_JOINED", "MESSAGE_SKIPPED", "SIGHTING_RECORDED"]) {
    assert.doesNotThrow(() => emitter.build({ event_type: ok, subject_type: "execution", subject_id: "exec-1" }))
  }
})

test("external event ต้องบอกระบบต้นทาง", () => {
  const { emitter } = setup()
  assert.throws(
    () => emitter.build({
      event_type: "EXECUTION_STARTED", subject_type: "external", subject_id: "x-1",
      source: { kind: "external" },
    }),
    InvalidEventError,
  )
  const ok = emitter.build({
    event_type: "EXECUTION_STARTED", subject_type: "external", subject_id: "x-1",
    source: { kind: "external", system: "navi-ims" },
  })
  assert.deepEqual(ok.source, { kind: "external", system: "navi-ims" })
})

test("ห้ามเก็บ chain-of-thought ใน metadata", () => {
  const { emitter } = setup()
  for (const key of ["reasoning", "thinking", "chain_of_thought", "scratchpad", "cot"]) {
    assert.throws(
      () => emitter.build({
        event_type: "EXECUTION_STARTED", subject_type: "execution", subject_id: "exec-1",
        metadata: { [key]: "ผมคิดว่า..." },
      }),
      ReasoningInMetadataError,
      `ควรปฏิเสธ key: ${key}`,
    )
  }
  assert.doesNotThrow(() => emitter.build({
    event_type: "EXECUTION_STARTED", subject_type: "execution", subject_id: "exec-1",
    metadata: { runtime: "opencode", model: "claude-sonnet-4" },
  }))
})

test("no silent state change — ทุก transition มีบันทึก from/to", async () => {
  const { events, sink } = setup()
  await events.queued(CTX)
  await events.succeeded(CTX)
  await events.cancelled(CTX)
  const transitions = sink.events.filter((e) => e.event_type === "STATE_TRANSITION")
  assert.equal(transitions.length, 3)
  assert.deepEqual(
    transitions.map((e) => [e.transition?.from, e.transition?.to]),
    [["pending", "queued"], ["running", "succeeded"], ["running", "cancelled"]],
  )
})

test("failed() แนบ error/v1 และแยก timeout ออกจาก failed", async () => {
  const { events, sink } = setup()
  await events.failed(CTX, classify("Server 500: internal server error"))
  await events.failed(CTX, classify("The operation timed out"))
  assert.equal(sink.events[0]!.error!.category, "provider_error")
  assert.equal(sink.events[0]!.transition!.to, "failed")
  assert.equal(sink.events[1]!.error!.category, "timeout")
  assert.equal(sink.events[1]!.transition!.to, "timed_out", "timeout ต้องไปสถานะ timed_out")
})

test("channelJoined/Left ใช้ subject_type record + record_type", async () => {
  const { events, sink } = setup()
  await events.channelJoined("line", CTX.channelId)
  await events.channelLeft("line", CTX.channelId)
  for (const e of sink.events) {
    assert.equal(e.subject_type, "record")
    assert.equal(e.metadata!.record_type, "channel")
    assert.equal("execution_id" in e, false, "ไม่ได้เกิดจาก execution")
  }
})

test("messageSkipped ไม่บันทึกเนื้อข้อความของผู้ใช้", async () => {
  const { events, sink } = setup()
  await events.messageSkipped(CTX)
  const e = sink.events[0]!
  assert.deepEqual(e.metadata, { decided_by: "agent" })
  assert.equal(JSON.stringify(e).includes("text"), false)
})

test("actor เป็น Principal ตาม identity/v1", async () => {
  const { events, sink } = setup()
  await events.started(CTX, "opencode")
  assert.deepEqual(sink.events[0]!.actor, {
    type: "human",
    id: "line-u4af4980629f1b2c3d4e5f6a7b8c9d0e1",
    display_name: "สมชาย",
  })
})

test("usage ใส่เมื่อ runtime รายงาน cost เท่านั้น", async () => {
  const { events, sink } = setup()
  await events.succeeded(CTX)
  await events.succeeded(CTX, { cost_usd: 0.0123, input_tokens: 1200, output_tokens: 340 })
  assert.equal("usage" in sink.events[0]!, false, "opencode ไม่รายงาน cost ต้องไม่มี field")
  assert.equal(sink.events[1]!.usage!.cost_usd, 0.0123)
})
