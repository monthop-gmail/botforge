/**
 * ผลิต audit event ตาม `event/v1` พร้อมบังคับ guarantee ที่ JSON Schema ตรวจให้ไม่ได้
 *
 * guarantee ที่บังคับในไฟล์นี้ (🔒 frozen — เป็นของ devfactory-core):
 *   · append-only               → event ที่คืนออกไปถูก freeze
 *   · subject จำเป็นเสมอ         → ไม่มี subject = โยน error
 *   · ห้ามสร้าง job_id ปลอม      → ไม่มี job ก็ไม่ต้องใส่ ไม่มี default
 *   · resolve tenant ไม่ได้ = reject → ห้ามเดา (บังคับตั้งแต่ resolveScope())
 *   · external ต้องคง source     → source.kind กับ system บังคับคู่กัน
 *   · ห้ามเก็บ chain-of-thought  → กรอง key ที่รู้จักออกจาก metadata
 *
 * ส่วน `sequence` ใช้เรียงเท่านั้น — ช่องว่างไม่มีความหมาย ห้ามตีความว่าใบหาย
 */
import { randomUUID } from "node:crypto"
import { assertId, type Scope, type Principal } from "../identity.ts"
import {
  EVENT_TYPE_PATTERN,
  type AuditEvent,
  type ChannelEvent,
  type EventSource,
  type SubjectType,
} from "./types.ts"

export interface EventSink {
  emit(event: Readonly<ChannelEvent>): void | Promise<void>
}

/** key ที่ถือว่าเป็น private reasoning — ห้ามลงบันทึก */
const REASONING_KEYS = new Set([
  "reasoning", "thinking", "thought", "thoughts", "chain_of_thought",
  "chainOfThought", "scratchpad", "internal_monologue", "cot",
])

export class ReasoningInMetadataError extends Error {
  constructor(key: string) {
    super(
      `metadata มี key "${key}" ซึ่งถือเป็น private reasoning — ` +
        `event/v1 guarantee ห้ามเก็บ chain-of-thought เป็น audit record`,
    )
    this.name = "ReasoningInMetadataError"
  }
}

export class InvalidEventError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidEventError"
  }
}

export interface NewEventInput {
  event_type: string
  subject_type: SubjectType
  subject_id: string
  execution_id?: string
  agent_id?: string
  actor?: Principal
  correlation_id?: string
  job_id?: string
  source?: EventSource
  transition?: { from?: string; to?: string; reason?: string }
  usage?: AuditEvent["usage"]
  error?: AuditEvent["error"]
  metadata?: Record<string, unknown>
  channel_type?: ChannelEvent["channel_type"]
  channel_id?: string
  message_id?: string
}

export interface EmitterOptions {
  sink?: EventSink
  now?: () => Date
  newId?: () => string
}

export class EventEmitter {
  readonly #scope: Scope
  readonly #sink: EventSink | undefined
  readonly #now: () => Date
  readonly #newId: () => string
  readonly #sequences = new Map<string, number>()

  constructor(scope: Scope, options: EmitterOptions = {}) {
    this.#scope = scope
    this.#sink = options.sink
    this.#now = options.now ?? (() => new Date())
    this.#newId = options.newId ?? randomUUID
  }

  /** สร้าง event โดยไม่ส่งออก — ใช้ตอนอยากตรวจก่อน */
  build(input: NewEventInput): Readonly<ChannelEvent> {
    if (!EVENT_TYPE_PATTERN.test(input.event_type)) {
      throw new InvalidEventError(
        `event_type ${JSON.stringify(input.event_type)} ผิดรูป — ต้องตรง ${EVENT_TYPE_PATTERN.source}`,
      )
    }
    if (!input.subject_id) {
      throw new InvalidEventError("ขาด subject_id — ทุก event ต้องตอบได้ว่าเกี่ยวกับอะไร")
    }

    const source: EventSource = input.source ?? { kind: "internal" }
    if (source.kind === "external" && !source.system) {
      throw new InvalidEventError("source.kind เป็น external ต้องระบุ source.system ว่ามาจากระบบไหน")
    }

    if (input.metadata) {
      for (const key of Object.keys(input.metadata)) {
        if (REASONING_KEYS.has(key)) throw new ReasoningInMetadataError(key)
      }
    }

    const subject_id = assertId(input.subject_id, "subject_id")
    const seq = (this.#sequences.get(subject_id) ?? 0) + 1
    this.#sequences.set(subject_id, seq)

    const event: ChannelEvent = {
      event_id: assertId(this.#newId(), "event_id"),
      event_type: input.event_type,
      tenant_id: this.#scope.tenant_id,
      workspace_id: this.#scope.workspace_id,
      subject_type: input.subject_type,
      subject_id,
      occurred_at: this.#now().toISOString(),
      sequence: seq,
      source,
    }

    // ใส่เฉพาะที่มีค่าจริง — ไม่สร้าง default ให้ field ที่ไม่มี โดยเฉพาะ job_id
    if (input.job_id) event.job_id = assertId(input.job_id, "job_id")
    if (input.execution_id) event.execution_id = assertId(input.execution_id, "execution_id")
    if (input.agent_id) event.agent_id = assertId(input.agent_id, "agent_id")
    if (input.actor) event.actor = input.actor
    if (input.correlation_id) event.correlation_id = assertId(input.correlation_id, "correlation_id")
    if (input.transition) event.transition = input.transition
    if (input.usage) event.usage = input.usage
    if (input.error) event.error = input.error
    if (input.metadata) event.metadata = { ...input.metadata }
    if (input.channel_type) event.channel_type = input.channel_type
    if (input.channel_id) event.channel_id = assertId(input.channel_id, "channel_id")
    if (input.message_id) event.message_id = input.message_id

    // append-only — ผู้รับแก้ของที่ออกไปแล้วไม่ได้
    if (event.metadata) Object.freeze(event.metadata)
    return Object.freeze(event)
  }

  /** สร้างแล้วส่งเข้า sink */
  async emit(input: NewEventInput): Promise<Readonly<ChannelEvent>> {
    const event = this.build(input)
    if (this.#sink) await this.#sink.emit(event)
    return event
  }

  /** ทุกการเปลี่ยน state ต้องผ่านทางนี้ — "no silent state change" */
  async emitTransition(
    subject: { type: SubjectType; id: string },
    from: string,
    to: string,
    extra: Omit<NewEventInput, "event_type" | "subject_type" | "subject_id" | "transition"> & {
      reason?: string
    } = {},
  ): Promise<Readonly<ChannelEvent>> {
    const { reason, ...rest } = extra
    return this.emit({
      ...rest,
      event_type: "STATE_TRANSITION",
      subject_type: subject.type,
      subject_id: subject.id,
      transition: { from, to, reason },
    })
  }

  /** ลำดับล่าสุดของ subject — ใช้ตรวจตอน test ไม่ใช่ตอนตัดสินว่าใบครบ */
  sequenceOf(subjectId: string): number {
    return this.#sequences.get(subjectId) ?? 0
  }
}

/** sink สำหรับ test และ conformance — เก็บไว้ใน memory */
export class MemorySink implements EventSink {
  readonly events: Array<Readonly<ChannelEvent>> = []
  emit(event: Readonly<ChannelEvent>): void {
    this.events.push(event)
  }
}
