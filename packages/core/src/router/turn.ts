/**
 * เทิร์นหนึ่งของบทสนทนา — ตั้งแต่ได้ข้อความจนส่งคำตอบกลับ
 *
 * นี่คือส่วนท้ายของ `handleTextMessage()` ใน v1-final ที่อยู่ใน `enqueueForSession()`
 * ซึ่งเป็นก้อนที่ pin ทุกอย่างไว้ด้วยกัน — คิว, profile, loading, runtime call,
 * `[SKIP]`, error mapping, การต่อท้ายว่าโดนตัด และการส่งกลับ
 *
 * runtime ถูกแยกเป็น port ตัวเดียว (`RuntimePort`) จึงเปลี่ยน Codex เป็น Claude
 * ได้โดยไม่ต้องแตะ channel ตาม Definition of Done ของ V2
 */
import type { ChannelTransport } from "../channel/send.ts"
import { sendMessage } from "../channel/send.ts"
import { formatUserContext, type ProfileCache, type UserContextFormat } from "../context/profile.ts"
import type { SessionQueue } from "../session/queue.ts"
import type { BotforgeEvents, TurnContext } from "../events/vocabulary.ts"
import { classify, toUserMessage, type PlatformError } from "../errors.ts"
import {
  isSkipResponse, applyLengthTruncationNotice, applyPartialNotice,
  TIMEOUT_NO_RESPONSE_MESSAGE,
} from "./response.ts"

/** สิ่งที่ core ต้องการจาก runtime — adapter ของแต่ละ engine เป็นคนต่อของจริง */
export interface RuntimePort {
  sendPrompt(input: PromptInput): Promise<RuntimeResult>
}

export interface PromptInput {
  sessionKey: string
  text: string
  isGroup: boolean
  userId: string
  groupName?: string
  quotedMessageId?: string
  /**
   * context ของผู้ใช้ที่ core ประกอบไว้แล้ว เช่น `[User: สมชาย]`
   *
   * core เป็นคนดึง profile และจัดรูป — adapter เป็นคนตัดสินว่าจะเอาไปวางตรงไหน
   * ของ prompt เพราะแต่ละ runtime ประกอบ prompt ไม่เหมือนกัน
   */
  userContext?: string
  /**
   * memory ของกลุ่ม — `claude-code` และ `copilot-cli` ใช้ (feature 4.4)
   *
   * core แค่ดึงมาให้ · **adapter เป็นคนตัดสินว่าจะ inject เมื่อไหร่**
   * เพราะ v1 inject เฉพาะตอนเปิด session ใหม่ ซึ่งมีแต่ adapter ที่รู้ว่ามี session อยู่ไหม
   */
  groupMemory?: string
}

export interface RuntimeResult {
  /** ข้อความที่ผู้ใช้ควรเห็น — adapter เป็นคน extract มาจาก payload ของ runtime */
  result: string
  /** runtime บอกเองว่านี่คือ error ไม่ใช่คำตอบ (`is_error` ของ 8 engine) */
  isError?: boolean
  /** timeout แล้วไม่ได้อะไรเลย */
  timedOut?: boolean
  /** timeout แล้วดึงคำตอบบางส่วนมาได้ — feature 2.8 ของ `opencode` */
  truncated?: boolean
  usage?: { cost_usd?: number; input_tokens?: number; output_tokens?: number }
  model?: string
}

export interface TurnDeps {
  runtime: RuntimePort
  transport: ChannelTransport
  queue: SessionQueue
  profiles: ProfileCache
  events?: BotforgeEvents
  /** แสดง loading ใน 1:1 — v1 เรียกแบบ fire-and-forget ไม่รอผล */
  showLoading?: (chatId: string) => void
  /**
   * ดึง memory ของกลุ่ม — ไม่ใส่ก็ไม่ดึง
   * v1 อ่านไฟล์ `memory-{groupId}.md` ทุกข้อความ แม้จะ inject เฉพาะ session ใหม่
   */
  groupMemory?: (groupId: string) => Promise<string | null>
  log?: (...args: unknown[]) => void
  /** ต่อท้ายว่าโดนตัดเมื่อยาวเกิน — `opencode` ไม่ทำ อีก 8 engine ทำ */
  lengthTruncationNotice?: boolean
  /** รูปแบบ `[User: ...]` — `"verbose"` คือของ `opencode` */
  userContextFormat?: UserContextFormat
}

export interface TurnInput {
  sessionKey: string
  userId: string
  text: string
  replyToken?: string
  isGroup: boolean
  groupId?: string
  quotedMessageId?: string
  /** context สำหรับ audit — ไม่ส่งมาก็ไม่ปล่อย event */
  ctx?: TurnContext
  runtimeName?: string
}

export type TurnOutcome =
  | { kind: "answered"; text: string; chunks: number; delivered: number; failed: number }
  | { kind: "skipped" }
  | { kind: "timed_out" }
  | { kind: "failed"; error: PlatformError }

/**
 * ลำดับที่ยกมาจาก v1 ทั้งหมด — สลับขั้นไหนก็เปลี่ยนพฤติกรรม:
 *   1. เข้าคิวของ session ก่อน  ← ทุกอย่างข้างล่างอยู่ในคิว
 *   2. ดึง profile (และชื่อกลุ่ม ถ้าอยู่ในกลุ่ม)
 *   3. โชว์ loading เฉพาะ 1:1 · fire-and-forget
 *   4. ยิง prompt เข้า runtime
 *   5. timeout ไม่ได้อะไรเลย → แจ้งแล้วจบ
 *   6. timeout ได้บางส่วน → ต่อท้ายว่ายังไม่ครบ
 *   7. อยู่ในกลุ่มและได้ `[SKIP]` → เงียบ ไม่ตอบ
 *   8. runtime บอกว่า error → แปลงเป็นข้อความไทย
 *   9. ยาวเกินสองเท่าลิมิต → ต่อท้ายว่าโดนตัด
 *  10. ส่งกลับ
 *  ทุก throw ระหว่างทาง → ส่งข้อความไทยกลับ **ไม่ปล่อยให้เงียบ**
 */
export function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnOutcome> {
  return deps.queue.enqueue(input.sessionKey, () => runTurnBody(deps, input))
}

async function runTurnBody(deps: TurnDeps, input: TurnInput): Promise<TurnOutcome> {
  const log = deps.log ?? (() => {})
  const { ctx, events } = input.ctx && deps.events
    ? { ctx: input.ctx, events: deps.events }
    : { ctx: undefined, events: undefined }

  try {
    await events?.queued(ctx!)
    const profile = await deps.profiles.getUser(input.userId, input.groupId)
    const groupName = input.groupId ? await deps.profiles.getGroupName(input.groupId) : null
    const userContext = formatUserContext(profile, deps.userContextFormat)
    const groupMemory = input.isGroup && input.groupId && deps.groupMemory
      ? await deps.groupMemory(input.groupId)
      : null

    if (!input.isGroup && deps.showLoading) deps.showLoading(input.userId)

    await events?.started(ctx!, input.runtimeName ?? "unknown")

    const res = await deps.runtime.sendPrompt({
      sessionKey: input.sessionKey,
      text: input.text,
      isGroup: input.isGroup,
      userId: input.userId,
      groupName: groupName ?? undefined,
      quotedMessageId: input.quotedMessageId,
      userContext: userContext || undefined,
      groupMemory: groupMemory ?? undefined,
    })

    if (res.timedOut) {
      await send(deps, input, TIMEOUT_NO_RESPONSE_MESSAGE)
      await events?.failed(ctx!, classify("The operation timed out"))
      return { kind: "timed_out" }
    }

    let text = res.result
    if (res.truncated) text = applyPartialNotice(text)

    if (isSkipResponse(text, input.isGroup)) {
      log(`Skipped: "${input.text.slice(0, 60)}${input.text.length > 60 ? "..." : ""}"`)
      await events?.messageSkipped(ctx!)
      return { kind: "skipped" }
    }

    if (res.isError) text = toUserMessage(res.result)
    if (deps.lengthTruncationNotice !== false) text = applyLengthTruncationNotice(text)

    const sent = await send(deps, input, text)
    await events?.succeeded(ctx!, res.usage)
    return { kind: "answered", text, ...sent }
  } catch (err) {
    const error = classify(err)
    log("Prompt error:", error.message)
    await send(deps, input, toUserMessage(err))
    await events?.failed(ctx!, error)
    return { kind: "failed", error }
  }
}

function send(deps: TurnDeps, input: TurnInput, text: string) {
  return sendMessage(deps.transport, input.sessionKey, text, input.replyToken, { log: deps.log })
}
