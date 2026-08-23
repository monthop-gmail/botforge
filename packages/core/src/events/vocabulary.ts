/**
 * Vocabulary ของ Botforge — event type และ state ที่ระบบนี้ผลิตจริง
 *
 * ค่านอก 7 ตัวมาตรฐานใช้ได้ เพราะ field `event_type` อ้าง `EventTypeName`
 * ซึ่งบังคับแค่รูปแบบชื่อ และ schema ระบุเองว่าเป็น "🔓 ชุดเปิด"
 * `ecosystem-intelligence` ก็ทำแบบเดียวกันด้วย `ADVISORY_ISSUED`
 */
import type { EventEmitter } from "./emitter.ts"
import type { ChannelEvent } from "./types.ts"
import type { Principal } from "../identity.ts"
import type { PlatformError } from "../errors.ts"

/** event type ที่ Botforge ปล่อย — 3 ตัวแรกเป็นของมาตรฐาน ที่เหลือเป็นส่วนขยาย */
export const BOTFORGE_EVENT_TYPES = {
  EXECUTION_STARTED: "EXECUTION_STARTED",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  STATE_TRANSITION: "STATE_TRANSITION",
  SESSION_STARTED: "SESSION_STARTED",
  SESSION_CLOSED: "SESSION_CLOSED",
  CHANNEL_JOINED: "CHANNEL_JOINED",
  CHANNEL_LEFT: "CHANNEL_LEFT",
  MESSAGE_SKIPPED: "MESSAGE_SKIPPED",
} as const

/**
 * `execution/v1#/$defs/ExecutionState` — Botforge ใช้ 6 จาก 10
 *
 * ที่ไม่ใช้: `pending` `authorizing` `awaiting_approval` `rejected`
 * เพราะยังไม่มี policy layer · เป็นเหตุผลที่ `execution/v1` ยังอยู่ใน `not_yet:`
 * ของ manifest — transition ของ contract บังคับ `pending → authorizing` เท่านั้น
 */
export type BotforgeExecutionState =
  | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out"

export interface TurnContext {
  /** id ของ execution นี้ — หนึ่ง prompt หนึ่ง execution */
  executionId: string
  /** ห้องสนทนา ผ่าน toChannelId() แล้ว */
  channelId: string
  channelType: NonNullable<ChannelEvent["channel_type"]>
  actor?: Principal
  messageId?: string
  correlationId?: string
}

/**
 * ตัวห่อที่ทำให้ทุกจังหวะสำคัญของ Botforge มีบันทึก
 *
 * มีอยู่เพื่อปิด guarantee ข้อ "no silent state change" — v1 เรียก
 * `sessions.delete()` 3–4 จุดต่อไฟล์โดยไม่มีบันทึกสักใบ
 */
export class BotforgeEvents {
  readonly #emitter: EventEmitter

  constructor(emitter: EventEmitter) {
    this.#emitter = emitter
  }

  #base(ctx: TurnContext) {
    return {
      channel_type: ctx.channelType,
      channel_id: ctx.channelId,
      ...(ctx.actor ? { actor: ctx.actor } : {}),
      ...(ctx.messageId ? { message_id: ctx.messageId } : {}),
      ...(ctx.correlationId ? { correlation_id: ctx.correlationId } : {}),
    }
  }

  /** session ใหม่ถูกสร้างฝั่ง runtime — subject เป็น execution ตัวแรกของ session */
  sessionStarted(ctx: TurnContext, runtime: string) {
    return this.#emitter.emit({
      ...this.#base(ctx),
      event_type: BOTFORGE_EVENT_TYPES.SESSION_STARTED,
      subject_type: "execution",
      subject_id: ctx.executionId,
      execution_id: ctx.executionId,
      metadata: { runtime },
    })
  }

  /** session ถูกปิด — `/new` `/model` `/abort` หรือ bot ออกจากกลุ่ม */
  sessionClosed(ctx: TurnContext, reason: string) {
    return this.#emitter.emit({
      ...this.#base(ctx),
      event_type: BOTFORGE_EVENT_TYPES.SESSION_CLOSED,
      subject_type: "execution",
      subject_id: ctx.executionId,
      execution_id: ctx.executionId,
      metadata: { reason },
    })
  }

  /** prompt เข้าคิว → รอ SessionQueue */
  queued(ctx: TurnContext) {
    return this.#emitter.emitTransition(
      { type: "execution", id: ctx.executionId },
      "pending", "queued",
      { ...this.#base(ctx), execution_id: ctx.executionId, reason: "รอคิวของ session" },
    )
  }

  /** เริ่มยิง prompt เข้า runtime */
  started(ctx: TurnContext, runtime: string, model?: string) {
    return this.#emitter.emit({
      ...this.#base(ctx),
      event_type: BOTFORGE_EVENT_TYPES.EXECUTION_STARTED,
      subject_type: "execution",
      subject_id: ctx.executionId,
      execution_id: ctx.executionId,
      metadata: model ? { runtime, model } : { runtime },
    })
  }

  /** ตอบกลับสำเร็จ — usage ใส่เมื่อ runtime รายงาน cost (มีแค่ claude-code / copilot-cli) */
  succeeded(ctx: TurnContext, usage?: { cost_usd?: number; input_tokens?: number; output_tokens?: number }) {
    return this.#emitter.emitTransition(
      { type: "execution", id: ctx.executionId },
      "running", "succeeded",
      { ...this.#base(ctx), execution_id: ctx.executionId, ...(usage ? { usage } : {}) },
    )
  }

  /** ล้ม — error เป็น object ตาม `error/v1` ไม่ใช่ข้อความอิสระ */
  failed(ctx: TurnContext, error: PlatformError) {
    return this.#emitter.emit({
      ...this.#base(ctx),
      event_type: BOTFORGE_EVENT_TYPES.EXECUTION_FAILED,
      subject_type: "execution",
      subject_id: ctx.executionId,
      execution_id: ctx.executionId,
      error,
      transition: { from: "running", to: error.category === "timeout" ? "timed_out" : "failed" },
    })
  }

  /** ผู้ใช้สั่ง `/abort` */
  cancelled(ctx: TurnContext, reason = "ผู้ใช้สั่ง /abort") {
    return this.#emitter.emitTransition(
      { type: "execution", id: ctx.executionId },
      "running", "cancelled",
      { ...this.#base(ctx), execution_id: ctx.executionId, reason },
    )
  }

  /** bot ถูกเชิญเข้ากลุ่ม — subject เป็น record เพราะไม่ได้เกิดจาก job */
  channelJoined(channelType: NonNullable<ChannelEvent["channel_type"]>, channelId: string) {
    return this.#emitter.emit({
      event_type: BOTFORGE_EVENT_TYPES.CHANNEL_JOINED,
      subject_type: "record",
      subject_id: channelId,
      channel_type: channelType,
      channel_id: channelId,
      metadata: { record_type: "channel" },
    })
  }

  channelLeft(channelType: NonNullable<ChannelEvent["channel_type"]>, channelId: string) {
    return this.#emitter.emit({
      event_type: BOTFORGE_EVENT_TYPES.CHANNEL_LEFT,
      subject_type: "record",
      subject_id: channelId,
      channel_type: channelType,
      channel_id: channelId,
      metadata: { record_type: "channel" },
    })
  }

  /**
   * AI ตอบ `[SKIP]` ในกลุ่ม — ข้อความไม่ได้เรียกถึง bot
   *
   * ⚠️ ไม่บันทึกเนื้อข้อความของผู้ใช้ · บันทึกแค่ว่ามีการข้าม
   *    `event/v1.metadata` ห้ามเก็บเนื้อหา prompt
   */
  messageSkipped(ctx: TurnContext) {
    return this.#emitter.emit({
      ...this.#base(ctx),
      event_type: BOTFORGE_EVENT_TYPES.MESSAGE_SKIPPED,
      subject_type: "execution",
      subject_id: ctx.executionId,
      execution_id: ctx.executionId,
      metadata: { decided_by: "agent" },
    })
  }
}
