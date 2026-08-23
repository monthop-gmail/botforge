/**
 * แปลง payload ของ OpenCode เป็นข้อความที่ผู้ใช้อ่านได้
 *
 * ยกมาจาก `extractResponse()` / `stripThinkTags()` ของ v1-final
 * ตัวนี้เป็น extractResponse ที่ **รวยที่สุดในบรรดา 9 engine** — จัดการ
 * `text` · `tool.question` · `reasoning` ส่วน gocode/adkcode เหลือแค่ `result.result`
 * 8 บรรทัด (ดู feature-matrix.md §7) จึงยกของตัวนี้มาเป็นฐานตามที่ component-map แนะนำ
 */

export const EMPTY_RESPONSE = "เสร็จแล้วครับ (ไม่มีข้อความตอบกลับ)"

/**
 * ตัด `<think>...</think>` ที่ reasoning model ฝังมาในคำตอบ
 * (Pathumma · THaLLE · OpenThaiGPT — Thai LLM 8B ที่ตั้งค่าไว้ใน opencode.json)
 */
export function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .trim()
}

export interface ExtractOutcome {
  text: string
  /** payload มี `info.error` — ตรงกับ `is_error` ของ engine อื่น */
  isError: boolean
}

/**
 * ลำดับที่ยกมาจาก v1 ทั้งหมด:
 *   1. มี `info.error` → คืนข้อความ error (ผู้เรียกเอาไปแปลงเป็นไทยผ่าน core)
 *   2. ไม่มี `parts` เลย → ข้อความว่างมาตรฐาน
 *   3. เดินทุก part: `text` (strip think) · `tool.question` (กาง option) ·
 *      `reasoning` (ใช้ต่อเมื่อไม่มี text part เลย)
 *   4. ต่อด้วย `\n\n` · ว่างทั้งหมด → ข้อความว่างมาตรฐาน
 */
export function extractResponse(result: unknown): ExtractOutcome {
  const r = result as any

  if (r?.info?.error) {
    const err = r.info.error
    const errMsg = err.data?.message || err.name || "Unknown error"
    return { text: `❌ API Error: ${errMsg}`, isError: true }
  }

  if (!r?.parts) return { text: EMPTY_RESPONSE, isError: false }

  const parts: string[] = []
  const hasText = r.parts.some((x: any) => x.type === "text" && x.text)

  for (const p of r.parts) {
    if (p.type === "text" && p.text) {
      const cleaned = stripThinkTags(p.text)
      if (cleaned) parts.push(cleaned)
    }
    if (p.type === "tool" && p.tool === "question" && p.state?.input?.questions) {
      for (const q of p.state.input.questions) {
        let qText = q.question || ""
        if (q.options?.length) {
          qText +=
            "\n" +
            q.options
              .map((o: any, i: number) => `${i + 1}. ${o.label}${o.description ? ` - ${o.description}` : ""}`)
              .join("\n")
        }
        if (qText) parts.push(qText)
      }
    }
    if (p.type === "reasoning" && p.text && !hasText) {
      parts.push(stripThinkTags(p.text))
    }
  }

  return { text: parts.join("\n\n") || EMPTY_RESPONSE, isError: false }
}
