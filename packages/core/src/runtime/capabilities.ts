/**
 * ความสามารถที่ runtime **ประกาศเอง** — และเทส conformance เป็นคนบังคับว่าประกาศแล้วต้องมีจริง
 *
 * ทำไมต้องประกาศ ไม่ใช่ให้ core เดาจากว่ามีเมธอดไหม
 *
 *   `channel-line/src/server.ts:189` วันนี้ duck-type อยู่ — `as { resetSession?: ... }`
 *   แล้วเรียกถ้าเจอ · ใช้ได้ แต่มันตอบได้แค่ "มีเมธอดชื่อนี้" ไม่ได้ตอบว่า
 *   **เมธอดนั้นทำงานจริงไหม** และเวลาไม่มี ก็ไม่มีใครรู้ว่าเพราะ runtime ทำไม่ได้
 *   หรือเพราะคนเขียน adapter ยังไม่ได้ทำ — สองอย่างนี้ต้องแยกกันให้ออก
 *
 * 🔴 ของที่รีโปนี้เจอซ้ำมาทั้งเดือน: **ประกาศ ≠ ทำได้จริง**
 *    `provider/v1.session.resumable` ของ agent-platform เป็น boolean ที่ประกาศได้
 *    แต่ไม่มีอะไรตรวจ (ดู dis-f1f037c7 seq 8 §5) · ฝั่งเราจึงผูกการประกาศไว้กับ
 *    `runRuntimeConformance()` — ประกาศแล้วเทสจะไปเรียกของจริง และ**ไม่ประกาศแล้วมีเมธอด
 *    ก็แดงเหมือนกัน** เพราะความสามารถที่ไม่มีใครประกาศคือความสามารถที่ไม่มีใครรับผิดชอบ
 */

/** ตระกูลของวิธีต่อ — ใช้จัดกลุ่มใน catalog (DoD ข้อ 3 ของ plan-a587bb31) */
export type RuntimeFamily = "rest" | "rpc" | "sdk" | "acp" | "cli"

export type RuntimeCapabilityName =
  /** สร้าง/ผูก session ของ runtime กับ session key ของ channel ได้ */
  | "sessions"
  /** ยกเลิกงานที่กำลังวิ่งของ session นั้นได้ */
  | "abort"
  /** เปลี่ยนโมเดลต่อ session ได้ */
  | "model"
  /** คืนค่า usage (token/cost) กลับมาใน RuntimeResult */
  | "usage"
  /** คืน session id ของ runtime ออกมาให้เก็บ และรับกลับเข้าไปใช้ต่อได้ */
  | "persistence"

export const RUNTIME_CAPABILITIES: readonly RuntimeCapabilityName[] = [
  "sessions", "abort", "model", "usage", "persistence",
] as const

/**
 * ทุกคีย์ต้องมีค่าเสมอ — **ไม่มี optional และไม่มี undefined**
 *
 * ตั้งใจให้ `false` ต้องถูกเขียนออกมา ไม่ใช่เว้นว่างแล้วให้คนอ่านเดา
 * ช่องว่างที่ไม่มีใครเขียนถึงจะถูกอ่านว่ามีคนดูแลอยู่แล้ว
 */
export type RuntimeCapabilities = { readonly [K in RuntimeCapabilityName]: boolean }

export interface RuntimeDescriptor {
  /** ชื่อที่ใช้ใน catalog และใน log — ตรงกับ BOTFORGE_RUNTIME */
  readonly name: string
  readonly family: RuntimeFamily
  readonly capabilities: RuntimeCapabilities
}

/** เติมคีย์ที่ไม่ได้ระบุเป็น false ให้ครบ — กันการลืมประกาศแล้วกลายเป็น undefined */
export function declareCapabilities(
  partial: Partial<RuntimeCapabilities> = {},
): RuntimeCapabilities {
  const out = {} as { [K in RuntimeCapabilityName]: boolean }
  for (const k of RUNTIME_CAPABILITIES) out[k] = partial[k] === true
  return out
}

/**
 * สิ่งที่ต้องรู้เพื่อ "กลับไปคุยต่อ" ได้หลัง process ตาย
 *
 * ⚠️ ไม่มี field ที่ผูกกับ channel ใด ๆ โดยตั้งใจ (ไม่มี groupName ไม่มี displayName)
 *    ตาม Phase A ของ plan-a587bb31 ที่ขอให้ถอดสมมติฐานของ channel ออกจาก session
 *    ของ runtime · `sessionKey` เป็นตัวชี้ที่ channel เป็นคนตั้ง แต่ runtime ไม่ต้องรู้
 *    ว่ามันมาจาก LINE หรือจากที่ไหน
 */
export interface RuntimeSessionInfo {
  /** คีย์ของ session ฝั่ง channel เช่น `line:group:C123` — ตัวชี้ ไม่ใช่เนื้อหา */
  readonly sessionKey: string
  /** ชื่อ runtime ที่เป็นเจ้าของ session นี้ — กันการ restore ข้าม runtime */
  readonly runtimeName: string
  /** id ของ session/thread ฝั่ง runtime */
  readonly runtimeSessionId: string
  /** ISO-8601 · เวลาที่ผูกครั้งแรก */
  readonly createdAt: string
  /** ISO-8601 · เวลาที่ใช้ล่าสุด */
  readonly lastUsedAt: string
  /** โมเดลที่ session นี้ใช้ ถ้า runtime รองรับ capability `model` */
  readonly model?: string
}
