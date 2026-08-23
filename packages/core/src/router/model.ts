/**
 * เลือก model จากคำที่ผู้ใช้พิมพ์หลัง `/model`
 *
 * v1 มีสองวิธีที่ให้ผลไม่เหมือนกัน — ทั้งคู่ยกมาไว้ที่นี่แล้วเลือกด้วย strategy
 * ไม่ได้เดาว่าอันไหน "ถูก" เพราะทั้งคู่คือพฤติกรรมจริงของ bot ที่ใช้งานอยู่
 *
 *   opencode              `k.endsWith("/" + arg)`   ต้องตรงส่วนท้ายหลัง `/`
 *   claude-code · copilot `k.includes(arg)`         ตรงตรงไหนก็ได้
 *
 * ตัวอย่างที่ให้ผลต่างกัน: `/model claude` กับรายการ
 * `["anthropic/claude-sonnet-4", "openai/gpt-5"]`
 *   suffix    → ไม่เจอ (ไม่มีตัวไหนลงท้ายด้วย `/claude`)
 *   substring → เจอ `anthropic/claude-sonnet-4`
 */
export type ModelMatchStrategy = "suffix" | "substring"

export interface ModelResolution {
  /** key ที่เลือกได้ · null = ไม่เจอ */
  key: string | null
  /** ตรงเป๊ะ หรือได้จากการเดา */
  exact: boolean
}

/**
 * `arg` ต้องเป็นตัวพิมพ์เล็กมาแล้ว — v1 ทำ `text.slice(6).trim().toLowerCase()`
 * ค่าว่างแปลว่าผู้ใช้แค่อยากดูรายการ ไม่ได้จะเปลี่ยน
 */
export function resolveModel(
  modelKeys: readonly string[],
  arg: string,
  strategy: ModelMatchStrategy = "substring",
): ModelResolution {
  if (!arg) return { key: null, exact: false }
  if (modelKeys.includes(arg)) return { key: arg, exact: true }
  const found =
    strategy === "suffix"
      ? modelKeys.find((k) => k.endsWith("/" + arg))
      : modelKeys.find((k) => k.includes(arg))
  return { key: found ?? null, exact: false }
}

/** จัดรายการ model ตาม provider แบบที่ `opencode` แสดงใน `/model` */
export function groupModelsByProvider(modelKeys: readonly string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (const key of modelKeys) {
    const provider = key.split("/")[0] ?? key
    ;(grouped[provider] ??= []).push(key)
  }
  return grouped
}
