/**
 * แปลง payload ของ OpenCode เป็นข้อความที่ผู้ใช้อ่านได้
 *
 * ยกมาจาก `extractResponse()` / `stripThinkTags()` ของ v1-final
 * ตัวนี้เป็น extractResponse ที่ **รวยที่สุดในบรรดา 9 engine** — จัดการ
 * `text` · `tool.question` · `reasoning` ส่วน gocode/adkcode เหลือแค่ `result.result`
 * 8 บรรทัด (ดู feature-matrix.md §7) จึงยกของตัวนี้มาเป็นฐานตามที่ component-map แนะนำ
 */

export const EMPTY_RESPONSE = "เสร็จแล้วครับ (ไม่มีข้อความตอบกลับ)"

export const STRAY_TOOL_CALL_NOTE =
  "โมเดลพยายามเรียกใช้เครื่องมือแต่ไม่สำเร็จครับ ลองถามใหม่อีกครั้ง หรือพิมพ์ /model เพื่อเปลี่ยนโมเดล"

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

/**
 * ตัดบล็อก `<tool_call>` ที่ parser ฝั่ง server กินไม่หมด
 *
 * Thai LLM 8B บางตัวปิด tool call ด้วย `</think>` แทน `</tool_call>` ทำให้ vLLM
 * parse ไม่ได้ แล้วปล่อย JSON ดิบค้างอยู่ใน text response — ซึ่งจะหลุดไปถึงผู้ใช้
 *
 * บังคับว่าต้องมี `"name"` อยู่ใน payload เพื่อไม่ให้ไปตัดข้อความธรรมดาที่บังเอิญ
 * พูดถึงแท็กนี้
 */
export function stripStrayToolCalls(text: string): string {
  return text
    .replace(/<tool_call>\s*\{[\s\S]*?"name"[\s\S]*?(?:<\/tool_call>|<\/think>|$)\s*/g, "")
    .replace(/<\/(?:think|tool_call)>\s*/g, "")
    .trim()
}

/** คืนข้อความที่ผู้ใช้ควรเห็น พร้อมบอกว่าระหว่างทางมี tool call พังถูกทิ้งไปไหม */
export function cleanModelText(text: string): { text: string; strayToolCall: boolean } {
  const withoutThink = stripThinkTags(text)
  const cleaned = stripStrayToolCalls(withoutThink)
  return { text: cleaned, strayToolCall: cleaned !== withoutThink }
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
export interface ExtractOptions {
  log?: (...args: unknown[]) => void
}

export function extractResponse(result: unknown, options: ExtractOptions = {}): ExtractOutcome {
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
      const { text, strayToolCall } = cleanModelText(p.text)
      if (strayToolCall) options.log?.("Dropped unparsed <tool_call> block from model text response")
      if (text) parts.push(text)
      // ตัดแล้วไม่เหลืออะไรเลย = คำตอบทั้งก้อนคือ tool call ที่พัง ต้องบอกผู้ใช้ ไม่ใช่เงียบ
      else if (strayToolCall) parts.push(STRAY_TOOL_CALL_NOTE)
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
      parts.push(cleanModelText(p.text).text)
    }
  }

  return { text: parts.join("\n\n") || EMPTY_RESPONSE, isError: false }
}
