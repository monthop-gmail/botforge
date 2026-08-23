import { test } from "node:test"
import assert from "node:assert/strict"
import { runTurn, type TurnDeps, type TurnInput, type RuntimeResult, type RuntimePort } from "./turn.ts"
import { LENGTH_TRUNCATION_NOTICE, TIMEOUT_NO_RESPONSE_MESSAGE } from "./response.ts"
import { SessionQueue } from "../session/queue.ts"
import { ProfileCache, type LineProfileSource } from "../context/profile.ts"
import { EventEmitter, MemorySink, BotforgeEvents, type TurnContext } from "../events/index.ts"
import { makePrincipal, type Scope } from "../identity.ts"
import { LINE_MAX_TEXT } from "../channel/line.ts"

const SCOPE: Scope = { tenant_id: "legal", workspace_id: "legal-opencode" }
const CHANNEL = "line-ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3"

const source: LineProfileSource = {
  async getProfile() { return { displayName: "สมชาย" } },
  async getGroupMemberProfile() { return { displayName: "สมชาย" } },
  async getGroupSummary() { return { groupName: "ทีมกฎหมาย" } },
}

type PromptFn = RuntimePort["sendPrompt"]

function harness(runtimeResult: RuntimeResult | PromptFn, over: Partial<TurnDeps> = {}) {
  const sent: Array<{ kind: string; text: string }> = []
  const loading: string[] = []
  const sink = new MemorySink()
  let n = 0
  const deps: TurnDeps = {
    runtime: {
      sendPrompt: typeof runtimeResult === "function"
        ? (runtimeResult as PromptFn)
        : async () => runtimeResult,
    },
    transport: {
      async reply(_t, text) { sent.push({ kind: "reply", text }) },
      async push(_to, text) { sent.push({ kind: "push", text }) },
    },
    queue: new SessionQueue(),
    profiles: new ProfileCache(source, { now: () => 1_700_000_000_000 }),
    events: new BotforgeEvents(new EventEmitter(SCOPE, {
      sink, now: () => new Date("2026-08-23T07:30:05Z"), newId: () => `ev-${++n}`,
    })),
    showLoading: (id) => loading.push(id),
    ...over,
  }
  return { deps, sent, loading, sink }
}

const ctx = (execId = "exec-0001"): TurnContext => ({
  executionId: execId,
  channelId: CHANNEL,
  channelType: "line",
  actor: makePrincipal("line", "U4af4980629f1b2c3d4e5f6a7b8c9d0e1", "สมชาย"),
})

const input = (over: Partial<TurnInput> = {}): TurnInput => ({
  sessionKey: CHANNEL,
  userId: "U4af4980629f1b2c3d4e5f6a7b8c9d0e1",
  text: "ช่วยเขียน code หน่อย",
  replyToken: "TOKEN",
  isGroup: false,
  ctx: ctx(),
  runtimeName: "opencode",
  ...over,
})

test("เทิร์นปกติ — ตอบกลับด้วย reply และปล่อย event ครบตามลำดับ", async () => {
  const { deps, sent, sink } = harness({ result: "นี่คือคำตอบครับ" })
  const out = await runTurn(deps, input())
  assert.equal(out.kind, "answered")
  assert.deepEqual(sent, [{ kind: "reply", text: "นี่คือคำตอบครับ" }])
  assert.deepEqual(
    sink.events.map((e) => e.event_type),
    ["STATE_TRANSITION", "EXECUTION_STARTED", "STATE_TRANSITION"],
  )
  assert.deepEqual(
    sink.events.map((e) => e.transition?.to).filter(Boolean),
    ["queued", "succeeded"],
  )
})

test("loading แสดงเฉพาะ 1:1 ไม่แสดงในกลุ่ม", async () => {
  const a = harness({ result: "ok" })
  await runTurn(a.deps, input({ isGroup: false }))
  assert.deepEqual(a.loading, ["U4af4980629f1b2c3d4e5f6a7b8c9d0e1"])

  const b = harness({ result: "ok" })
  await runTurn(b.deps, input({ isGroup: true, groupId: "C1" }))
  assert.deepEqual(b.loading, [], "ในกลุ่มต้องไม่โชว์ loading")
})

test("[SKIP] ในกลุ่ม → เงียบ ไม่ส่งอะไรเลย และปล่อย MESSAGE_SKIPPED", async () => {
  const { deps, sent, sink } = harness({ result: "[SKIP]" })
  const out = await runTurn(deps, input({ isGroup: true, groupId: "C1" }))
  assert.equal(out.kind, "skipped")
  assert.deepEqual(sent, [], "ต้องไม่ส่งข้อความใด ๆ")
  assert.ok(sink.events.some((e) => e.event_type === "MESSAGE_SKIPPED"))
  assert.equal(sink.events.some((e) => e.event_type === "EXECUTION_FAILED"), false)
})

test("[SKIP] ใน 1:1 → ตอบตามปกติ ไม่ถือเป็น skip", async () => {
  const { deps, sent } = harness({ result: "[SKIP]" })
  const out = await runTurn(deps, input({ isGroup: false }))
  assert.equal(out.kind, "answered")
  assert.deepEqual(sent, [{ kind: "reply", text: "[SKIP]" }])
})

test("timeout ไม่ได้อะไรเลย → แจ้งแล้วจบ", async () => {
  const { deps, sent, sink } = harness({ result: "", timedOut: true })
  const out = await runTurn(deps, input())
  assert.equal(out.kind, "timed_out")
  assert.deepEqual(sent, [{ kind: "reply", text: TIMEOUT_NO_RESPONSE_MESSAGE }])
  const failed = sink.events.find((e) => e.event_type === "EXECUTION_FAILED")
  assert.equal(failed!.error!.category, "timeout")
  assert.equal(failed!.transition!.to, "timed_out")
})

test("timeout ได้บางส่วน → ต่อท้ายว่ายังไม่ครบ (feature 2.8 ของ opencode)", async () => {
  const { deps, sent } = harness({ result: "คำตอบครึ่งเดียว", truncated: true })
  const out = await runTurn(deps, input())
  assert.equal(out.kind, "answered")
  assert.ok(sent[0]!.text.startsWith("คำตอบครึ่งเดียว"))
  assert.ok(sent[0]!.text.includes('พิมพ์ "ต่อ"'))
})

test("runtime บอกว่า error → แปลงเป็นข้อความไทย", async () => {
  const { deps, sent } = harness({ result: "Server 429: rate limit exceeded", isError: true })
  const out = await runTurn(deps, input())
  assert.equal(out.kind, "answered")
  assert.equal(sent[0]!.text, "เกิน rate limit ครับ รอสักครู่แล้วลองใหม่")
})

test("คำตอบยาวเกินสองเท่าลิมิต → ต่อท้ายว่าโดนตัด", async () => {
  const long = "x".repeat(LINE_MAX_TEXT * 2)
  const { deps, sent } = harness({ result: long })
  await runTurn(deps, input())
  assert.ok(sent.map((s) => s.text).join("").includes(LENGTH_TRUNCATION_NOTICE.trim()))
})

test("ปิด lengthTruncationNotice ได้ — opencode ไม่ใช้กลไกนี้", async () => {
  const long = "x".repeat(LINE_MAX_TEXT * 2)
  const { deps, sent } = harness({ result: long }, { lengthTruncationNotice: false })
  const out = await runTurn(deps, input())
  assert.equal(out.kind, "answered")
  assert.equal(sent.map((s) => s.text).join("").includes("ถูกตัดเนื่องจาก"), false)
})

test("runtime โยน exception → ผู้ใช้ยังได้ข้อความไทย ไม่เงียบ", async () => {
  const { deps, sent, sink } = harness(async () => { throw new Error("Server 500: internal server error") })
  const out = await runTurn(deps, input())
  assert.equal(out.kind, "failed")
  assert.deepEqual(sent, [{ kind: "reply", text: "server มีปัญหาครับ ลองใหม่อีกครั้ง" }])
  const failed = sink.events.find((e) => e.event_type === "EXECUTION_FAILED")
  assert.equal(failed!.error!.category, "provider_error")
})

test("error ที่โยนออกมาไม่หลุด credential เข้า audit", async () => {
  const { deps, sink } = harness(async () => { throw new Error("auth failed for sk-proj-AbCdEf1234567890XyZ") })
  await runTurn(deps, input())
  const failed = sink.events.find((e) => e.event_type === "EXECUTION_FAILED")!
  assert.equal(failed.error!.message.includes("sk-proj-AbCdEf1234567890XyZ"), false)
})

test("ชื่อกลุ่มถูกส่งเข้า runtime เฉพาะตอนอยู่ในกลุ่ม", async () => {
  const seen: Array<string | undefined> = []
  const { deps } = harness(async (i) => { seen.push(i.groupName); return { result: "ok" } })
  await runTurn(deps, input({ isGroup: true, groupId: "C1" }))
  await runTurn(deps, input({ isGroup: false }))
  assert.deepEqual(seen, ["ทีมกฎหมาย", undefined])
})

test("เทิร์นของ session เดียวกันรันทีละตัว", async () => {
  const order: string[] = []
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let first = true
  const { deps } = harness(async () => {
    if (first) { first = false; order.push("1-start"); await gate; order.push("1-end") }
    else order.push("2")
    return { result: "ok" }
  })
  const p1 = runTurn(deps, input())
  const p2 = runTurn(deps, input())
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(order, ["1-start"], "ตัวที่สองต้องรอ")
  release()
  await Promise.all([p1, p2])
  assert.deepEqual(order, ["1-start", "1-end", "2"])
})

test("usage ไหลเข้า event เมื่อ runtime รายงาน", async () => {
  const { deps, sink } = harness({ result: "ok", usage: { cost_usd: 0.0123 } })
  await runTurn(deps, input())
  const ok = sink.events.find((e) => e.transition?.to === "succeeded")!
  assert.equal(ok.usage!.cost_usd, 0.0123)
})

test("ไม่ส่ง ctx มา → ไม่ปล่อย event แต่ยังทำงานปกติ", async () => {
  const { deps, sent, sink } = harness({ result: "ok" })
  const out = await runTurn(deps, input({ ctx: undefined }))
  assert.equal(out.kind, "answered")
  assert.deepEqual(sent, [{ kind: "reply", text: "ok" }])
  assert.equal(sink.events.length, 0)
})
