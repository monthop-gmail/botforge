/**
 * เทสชุดเดียวที่ adapter ทุกตัวต้องผ่าน — **บังคับว่าประกาศแล้วต้องมีจริง**
 *
 * เหตุผลที่ต้องมีไฟล์นี้ ไม่ใช่แค่เทสในแต่ละ package:
 *
 *   `provider/v1.session.resumable` ของ agent-platform เป็น boolean ที่ประกาศได้
 *   แต่ไม่มีอะไรตรวจ (dis-f1f037c7 seq 8 §5 เรียกมันว่า "ประกาศ ≠ ทำได้จริง")
 *   ถ้า `describe()` ของเราเป็นแค่ object ที่เขียนอะไรก็ได้ เราจะได้ธงชุดเดียวกัน
 *
 * ตรวจสองทางเสมอ:
 *   ประกาศ true  แล้วไม่มีเมธอด  → แดง  (คำโฆษณาที่ไม่มีของ)
 *   ประกาศ false แต่มีเมธอด      → แดง  (ความสามารถที่ไม่มีใครรับผิดชอบ — และ
 *                                        channel จะไม่เรียกมันเพราะอ่านจาก describe())
 *
 * ชั้น static (ไฟล์นี้) ตรวจได้แค่ "รูป" — ไม่ต้องมี server จริง จึงรันใน CI ได้ทุก PR
 * ชั้น live (มี `probe`) ตรวจ "พฤติกรรม" — ต้องมี runtime จริง จึงรันเฉพาะตอนมีของ
 */
import type { RuntimeCapabilityName } from "./capabilities.ts"
import { RUNTIME_CAPABILITIES } from "./capabilities.ts"
import type { RuntimeAdapter } from "./port.ts"

/** เมธอดที่แต่ละ capability ต้องมี — ตารางเดียวที่ทั้งเทสและคนอ่านใช้ร่วมกัน */
const REQUIRED_METHODS: Readonly<Record<RuntimeCapabilityName, readonly string[]>> = {
  sessions: ["resetSession", "sessionInfo"],
  abort: ["abort"],
  model: ["setModel", "modelOf"],
  usage: [],          // ตรวจได้เฉพาะจากเนื้อของ RuntimeResult → ต้องมี probe
  persistence: ["exportSession", "restoreSession"],
}

export interface ConformanceOptions {
  /**
   * ยิงของจริงหนึ่งรอบ — ใส่เมื่อมี runtime ให้คุย
   * ใช้ตรวจ `usage` และตรวจว่า `persistence` คืนของที่ใช้ต่อได้จริง
   */
  probe?: {
    sessionKey: string
    send(): Promise<{ usage?: unknown }>
  }
}

/** คืนรายการปัญหา — ว่าง = ผ่าน · ไม่ throw เพื่อให้ผู้เรียกพิมพ์ได้ทั้งชุด */
export async function runRuntimeConformance(
  adapter: RuntimeAdapter,
  options: ConformanceOptions = {},
): Promise<string[]> {
  const problems: string[] = []

  if (typeof adapter.describe !== "function") {
    return ["ไม่มี describe() — adapter ต้องประกาศความสามารถของตัวเอง"]
  }
  const d = adapter.describe()

  if (!d.name) problems.push("describe().name ว่าง — catalog ใช้ชื่อนี้อ้างอิง")
  if (!d.family) problems.push("describe().family ว่าง — DoD ข้อ 3 ต้องการตระกูลของวิธีต่อ")

  // ทุกคีย์ต้องมีค่า — ไม่ใช่ undefined (declareCapabilities() ทำให้ครบอยู่แล้ว)
  for (const cap of RUNTIME_CAPABILITIES) {
    if (typeof d.capabilities?.[cap] !== "boolean") {
      problems.push(`capabilities.${cap} ไม่ใช่ boolean — ต้องเขียน false ไม่ใช่เว้นว่าง`)
    }
  }

  const has = (m: string) => typeof (adapter as unknown as Record<string, unknown>)[m] === "function"

  for (const cap of RUNTIME_CAPABILITIES) {
    const declared = d.capabilities?.[cap] === true
    for (const m of REQUIRED_METHODS[cap]) {
      if (declared && !has(m)) {
        problems.push(`ประกาศ ${cap}: true แต่ไม่มีเมธอด ${m}() — คำโฆษณาที่ไม่มีของ`)
      }
      if (!declared && has(m)) {
        problems.push(
          `มีเมธอด ${m}() แต่ประกาศ ${cap}: false — ` +
            `ความสามารถที่ไม่ได้ประกาศจะไม่มีใครเรียก เพราะ channel อ่านจาก describe()`,
        )
      }
    }
  }

  // sendPrompt ต้องมีเสมอ — เป็นสัญญาเดียวของ RuntimePort
  if (!has("sendPrompt")) problems.push("ไม่มี sendPrompt() — ไม่ใช่ RuntimePort")

  // ── ชั้น live ─────────────────────────────────────────────────────
  if (options.probe) {
    const { usage } = await options.probe.send()
    if (d.capabilities.usage && usage === undefined) {
      problems.push("ประกาศ usage: true แต่ยิงจริงแล้ว RuntimeResult ไม่มี usage")
    }
    if (!d.capabilities.usage && usage !== undefined) {
      problems.push("ยิงจริงได้ usage กลับมา แต่ประกาศ usage: false")
    }
    if (d.capabilities.persistence) {
      const info = adapter.exportSession?.(options.probe.sessionKey) ?? null
      if (!info) {
        problems.push(
          "ประกาศ persistence: true แต่ยิงจริงแล้ว exportSession() คืน null — " +
            "ไม่มีอะไรให้เก็บลงทะเบียน",
        )
      } else if (info.sessionKey !== options.probe.sessionKey) {
        problems.push("exportSession() คืน sessionKey ไม่ตรงกับที่ขอ")
      } else if (!info.runtimeSessionId) {
        problems.push("exportSession() คืน runtimeSessionId ว่าง — restore กลับไม่ได้")
      }
    }
  }

  return problems
}
