/**
 * event/v1 — audit event ของ ecosystem
 *
 * ผูกกับ agent-platform `contracts/event/v1/event.schema.yaml`
 * semantics เป็นของ `devfactory-core` (RFC-0003 · RFC-0008) — เปลี่ยนที่นี่ไม่ได้
 */
import type { Principal, Id, TenantId, WorkspaceId } from "../identity.ts"
import type { PlatformError } from "../errors.ts"

/** `^[A-Z][A-Z0-9_]{2,63}$` — บังคับแค่รูปแบบชื่อ ค่านอกลิสต์มาตรฐานใช้ได้ */
export const EVENT_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/

/**
 * 7 ค่ามาตรฐาน + ใบปิดท้าย + consent — **ชุดเปิด**
 * เพิ่มได้ ลบ/เปลี่ยนความหมายไม่ได้ (ต้องมี RFC ที่ devfactory-core)
 */
export const STANDARD_EVENT_TYPES = [
  "JOB_CREATED",
  "STATE_TRANSITION",
  "GOVERNANCE_DECISION",
  "TASK_ASSIGNED",
  "EXECUTION_STARTED",
  "EXECUTION_FAILED",
  "JOB_COMPLETED",
  "JOB_SETTLED",
  "CONSENT_GRANTED",
  "CONSENT_REVOKED",
] as const

export type SubjectType =
  | "job" | "execution" | "step" | "agent" | "tool_call"
  | "artifact" | "approval" | "consent" | "external" | "record"

export interface EventSource {
  kind: "internal" | "external"
  /** ระบบต้นทางเมื่อ kind เป็น external */
  system?: string
}

export interface Transition {
  from?: string
  to?: string
  reason?: string
}

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cached_input_tokens?: number
  cost_usd?: number
}

/** event/v1 — required: [event_id, event_type, tenant_id, subject_type, subject_id, occurred_at, source] */
export interface AuditEvent {
  event_id: Id
  event_type: string
  tenant_id: TenantId
  workspace_id?: WorkspaceId
  subject_type: SubjectType
  subject_id: Id
  /** 🔒 ห้ามสร้างค่าปลอม — ไม่มี job ก็ไม่ต้องใส่ */
  job_id?: Id
  execution_id?: Id
  agent_id?: Id
  actor?: Principal
  correlation_id?: Id
  occurred_at: string
  sequence?: number
  source: EventSource
  transition?: Transition
  usage?: Usage
  error?: PlatformError
  /** 🔒 ห้ามเก็บ private reasoning / chain-of-thought */
  metadata?: Record<string, unknown>
}

/**
 * ส่วนขยายของ Botforge — `channel-event/v1`
 * additive ตาม RFC-0009 · ไม่ลดทอน guarantee ข้อใดของ `event/v1`
 *
 * ⚠️ ไม่มี `reply_token` โดยเจตนา — เป็น token ที่ใช้ยิง API ได้จริง
 *    ไม่ควรอยู่ในบันทึกที่ append-only และอ่านย้อนหลังได้ตลอดไป
 */
export interface ChannelEvent extends AuditEvent {
  channel_type?: "line" | "telegram" | "web" | "discord"
  /** id ของห้องสนทนา ผ่าน toChannelId() แล้ว — group/room/1:1 */
  channel_id?: Id
  message_id?: string
}
