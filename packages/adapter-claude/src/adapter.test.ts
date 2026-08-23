import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ClaudeAdapter } from "./adapter.ts"
import { buildPrefix, GROUP_CHAT_INSTRUCTION } from "./prompt.ts"
import { loadSystemPrompt, loadMcpServers } from "./workspace.ts"
import type { ClaudeQuery, ClaudeQueryOptions, SdkMessage } from "./sdk.ts"

/** SDK ปลอม — บันทึก option ที่ถูกส่งเข้ามา แล้วคายชุด message ที่กำหนด */
function fakeSdk(script: (prompt: string, opts?: ClaudeQueryOptions) => SdkMessage[] | Promise<SdkMessage[]>) {
  const calls: Array<{ prompt: string; options?: ClaudeQueryOptions }> = []
  const query: ClaudeQuery = ({ prompt, options }) => {
    calls.push({ prompt, options })
    return (async function* () {
      for (const m of await script(prompt, options)) yield m
    })()
  }
  return { query, calls }
}

const ok = (text: string, sessionId = "sdk-1", cost = 0.0042): SdkMessage[] => [
  { type: "system", session_id: sessionId },
  { type: "result", subtype: "success", session_id: sessionId, result: text, total_cost_usd: cost,
    usage: { input_tokens: 1200, output_tokens: 340 } },
]

const prompt = (over: Record<string, unknown> = {}) => ({
  sessionKey: "line-c1", userId: "U1", text: "สวัสดี", isGroup: false, ...over,
}) as any

function workspace(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "botforge-ws-"))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test("เรียก query ตรง ๆ ไม่มี IPC — shape ที่สามของ adapter", async () => {
  const { query, calls } = fakeSdk(() => ok("สวัสดีครับ"))
  const a = new ClaudeAdapter({ query, workspaceDir: "/nope" })
  const out = await a.sendPrompt(prompt())
  assert.equal(out.result, "สวัสดีครับ")
  assert.equal(calls.length, 1)
  assert.ok(calls[0]!.prompt.endsWith("สวัสดี"))
})

test("cost และ token ไหลเข้า usage — ตัวแรกที่มีเลขจริงจาก runtime", async () => {
  const { query } = fakeSdk(() => ok("ตอบ"))
  const out = await new ClaudeAdapter({ query, workspaceDir: "/nope" }).sendPrompt(prompt())
  assert.deepEqual(out.usage, { cost_usd: 0.0042, input_tokens: 1200, output_tokens: 340 })
})

test("ไม่มี cost → ไม่มี usage field", async () => {
  const { query } = fakeSdk(() => [{ type: "result", subtype: "success", session_id: "s", result: "x", total_cost_usd: 0 }])
  const out = await new ClaudeAdapter({ query, workspaceDir: "/nope" }).sendPrompt(prompt())
  assert.equal("usage" in out, false)
})

test("session ถูกใช้ซ้ำผ่าน resume", async () => {
  const { query, calls } = fakeSdk(() => ok("ตอบ", "sdk-abc"))
  const a = new ClaudeAdapter({ query, workspaceDir: "/nope" })
  await a.sendPrompt(prompt())
  assert.equal(calls[0]!.options?.resume, undefined, "ครั้งแรกไม่มี resume")
  await a.sendPrompt(prompt())
  assert.equal(calls[1]!.options?.resume, "sdk-abc", "ครั้งที่สองต้อง resume")
  assert.deepEqual(a.sessionInfo("line-c1"), { sessionId: "sdk-abc", model: "sonnet" })
})

test("resume พัง → ลองใหม่แบบไม่ resume หนึ่งครั้ง (ยกมาจาก v1)", async () => {
  let n = 0
  const { query, calls } = fakeSdk(() => {
    n++
    if (n === 2) throw new Error("No conversation found for session")
    return ok("ตอบได้", `sdk-${n}`)
  })
  const a = new ClaudeAdapter({ query, workspaceDir: "/nope" })
  await a.sendPrompt(prompt())
  const out = await a.sendPrompt(prompt())
  assert.equal(out.result, "ตอบได้")
  assert.equal(calls.length, 3, "ครั้งที่สองพัง แล้วลองใหม่")
  assert.equal(calls[2]!.options?.resume, undefined, "ครั้งที่ลองใหม่ต้องไม่ resume")
})

test("error ที่ไม่ใช่ session หมดอายุ → ไม่ retry และ core แปลงเป็นไทยได้", async () => {
  let n = 0
  const { query, calls } = fakeSdk(() => { n++; throw new Error("Server 429: rate limit exceeded") })
  const out = await new ClaudeAdapter({ query, workspaceDir: "/nope" }).sendPrompt(prompt())
  assert.equal(out.isError, true)
  assert.equal(calls.length, 1, "ต้องไม่ retry")
  const { toUserMessage } = await import("@botforge/core/errors")
  assert.equal(toUserMessage(out.result), "เกิน rate limit ครับ รอสักครู่แล้วลองใหม่")
})

test("result subtype ที่ไม่ใช่ success → isError", async () => {
  const { query } = fakeSdk(() => [
    { type: "result", subtype: "error_max_turns", session_id: "s", result: "ถึงขีดจำกัด turn", is_error: true },
  ])
  const out = await new ClaudeAdapter({ query, workspaceDir: "/nope" }).sendPrompt(prompt())
  assert.equal(out.isError, true)
  assert.equal(out.result, "ถึงขีดจำกัด turn")
})

test("timeout → timedOut", async () => {
  const { query } = fakeSdk(async (_p, opts) => {
    await new Promise((r) => setTimeout(r, 300))
    if (opts?.abortController?.signal.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e }
    return ok("ไม่ควรมาถึง")
  })
  const out = await new ClaudeAdapter({ query, workspaceDir: "/nope", promptTimeoutMs: 60 }).sendPrompt(prompt())
  assert.equal(out.timedOut, true)
})

test("/abort ยกเลิกผ่าน AbortController · session ยังอยู่", async () => {
  const { query } = fakeSdk(async (_p, opts) => {
    await new Promise((r) => setTimeout(r, 500))
    if (opts?.abortController?.signal.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e }
    return ok("ไม่ควรมาถึง")
  })
  const a = new ClaudeAdapter({ query, workspaceDir: "/nope", promptTimeoutMs: 5000 })
  assert.equal(a.abort("line-c1"), false, "ยังไม่มี turn เดินอยู่")
  const p = a.sendPrompt(prompt())
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(a.abort("line-c1"), true)
  assert.equal((await p).timedOut, true)
})

test("/model เปลี่ยนแล้ว session ใหม่ใช้ model ใหม่", async () => {
  const { query, calls } = fakeSdk(() => ok("ตอบ"))
  const a = new ClaudeAdapter({ query, workspaceDir: "/nope" })
  await a.sendPrompt(prompt())
  assert.equal(calls[0]!.options?.model, "sonnet")
  a.setModel("line-c1", "opus")
  assert.equal(a.modelOf("line-c1"), "opus")
  await a.sendPrompt(prompt())
  assert.equal(calls[1]!.options?.model, "opus")
  assert.equal(calls[1]!.options?.resume, undefined, "เปลี่ยน model ต้องเริ่ม session ใหม่")
})

// ── workspace ──

test("system prompt = CLAUDE.md + AGENTS.md ต่อด้วยเส้นคั่น", () => {
  const ws = workspace({ "CLAUDE.md": "หนึ่ง", "AGENTS.md": "สอง" })
  try {
    assert.equal(loadSystemPrompt(ws.dir), "หนึ่ง\n\n---\n\nสอง")
  } finally { ws.cleanup() }
})

test("ไม่มีไฟล์เลย → สตริงว่าง ไม่ throw", () => {
  const ws = workspace({})
  try { assert.equal(loadSystemPrompt(ws.dir), "") } finally { ws.cleanup() }
})

test("MCP โหลดจาก .mcp.json — feature 11.4 ที่ engine อื่นไม่มี", () => {
  const ws = workspace({ ".mcp.json": JSON.stringify({ mcpServers: { context7: { url: "https://x" } } }) })
  try {
    assert.deepEqual(loadMcpServers(ws.dir), { context7: { url: "https://x" } })
  } finally { ws.cleanup() }
})

test("mcpServers ว่าง หรือ JSON พัง → undefined ไม่ใช่ {}", () => {
  const empty = workspace({ ".mcp.json": JSON.stringify({ mcpServers: {} }) })
  const broken = workspace({ ".mcp.json": "{ พัง" })
  const none = workspace({})
  try {
    assert.equal(loadMcpServers(empty.dir), undefined)
    assert.equal(loadMcpServers(broken.dir), undefined)
    assert.equal(loadMcpServers(none.dir), undefined)
  } finally { empty.cleanup(); broken.cleanup(); none.cleanup() }
})

test("adapter ส่ง systemPrompt และ mcpServers จาก workspace เข้า SDK", async () => {
  const ws = workspace({
    "CLAUDE.md": "คุณคือ bot",
    ".mcp.json": JSON.stringify({ mcpServers: { gh: { command: "npx" } } }),
  })
  try {
    const { query, calls } = fakeSdk(() => ok("ตอบ"))
    const a = new ClaudeAdapter({ query, workspaceDir: ws.dir })
    await a.sendPrompt(prompt())
    assert.equal(calls[0]!.options?.systemPrompt, "คุณคือ bot")
    assert.deepEqual(calls[0]!.options?.mcpServers, { gh: { command: "npx" } })
    assert.deepEqual(a.mcpServers(), { gh: { command: "npx" } })
  } finally { ws.cleanup() }
})

// ── prompt ──

test("group memory inject เฉพาะ session ใหม่ — feature 4.5", () => {
  const base = { groupMemory: "จำไว้ว่า…", isGroup: true, now: new Date("2026-08-23T07:30:05Z") }
  assert.ok(buildPrefix({ ...base, hasSession: false }).includes("[Group Memory]"))
  assert.equal(buildPrefix({ ...base, hasSession: true }).includes("[Group Memory]"), false,
    "session เดิมต้องไม่ inject ซ้ำ")
})

test("prefix ครบตามลำดับของ claude-code", () => {
  const p = buildPrefix({
    userContext: "[User: สมชาย]", groupName: "ทีมกฎหมาย", quotedMessageId: "m-1",
    groupMemory: "บันทึก", hasSession: false, isGroup: true, now: new Date("2026-08-23T07:30:05Z"),
  })
  assert.ok(p.startsWith("[User: สมชาย] [Group: ทีมกฎหมาย] [Time: 2026-08-23 14:30:05+07:00]"))
  assert.ok(p.indexOf("[Reply to message ID: m-1]") < p.indexOf("[Group Memory]"))
  assert.ok(p.indexOf("[Group Memory]") < p.indexOf(GROUP_CHAT_INSTRUCTION))
})

test("adapter ส่ง group memory เข้า prompt เฉพาะเทิร์นแรก", async () => {
  const { query, calls } = fakeSdk(() => ok("ตอบ", "sdk-x"))
  const a = new ClaudeAdapter({ query, workspaceDir: "/nope" })
  const p = prompt({ isGroup: true, groupId: "C1", groupMemory: "จำไว้ว่าลูกค้าชื่อ ก" })
  await a.sendPrompt(p)
  await a.sendPrompt(p)
  assert.ok(calls[0]!.prompt.includes("[Group Memory]"))
  assert.equal(calls[1]!.prompt.includes("[Group Memory]"), false)
})
