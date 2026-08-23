/**
 * ทะเบียน model ของ OpenCode — ยกมาจาก `MODELS` ของ v1-final ทั้งชุด
 *
 * สองตัวแรกเป็น **model ฟรีผ่าน Zen** ใช้ทดสอบได้โดยไม่ต้องมี API key
 * ที่เหลือต้องมี key ของ provider นั้น
 */
export interface ModelSpec {
  providerID: string
  modelID: string
  label: string
  /**
   * model นี้ถูก serve โดยไม่มี tool calling ที่ใช้ได้จริง — ดู `tool_call: false`
   * ใน `opencode.json` · ผู้ใช้ควรรู้ว่าถามให้อ่าน/แก้ไฟล์ไม่ได้
   */
  noTools?: boolean
}

export const MODELS: Readonly<Record<string, ModelSpec>> = {
  // opencode (Free via Zen)
  "opencode/big-pickle": { providerID: "opencode", modelID: "big-pickle", label: "Big Pickle (Free)" },
  "opencode/nemotron-3-super": { providerID: "opencode", modelID: "nemotron-3-super-free", label: "Nemotron 3 Super (Free)" },
  // deepseek (API key)
  "deepseek/deepseek-chat": { providerID: "deepseek", modelID: "deepseek-chat", label: "DeepSeek Chat" },
  "deepseek/deepseek-reasoner": { providerID: "deepseek", modelID: "deepseek-reasoner", label: "DeepSeek Reasoner" },
  // qwen (API key via DashScope)
  "qwen/qwen3.5-plus": { providerID: "qwen", modelID: "qwen3.5-plus", label: "Qwen3.5 Plus (1M)" },
  // groq (API key)
  "groq/kimi-k2": { providerID: "groq", modelID: "moonshotai/kimi-k2-instruct-0905", label: "Kimi K2 (Groq)" },
  // okmd (OKMD AI Playground — key เดียว โควต้า token รายวันแยกต่อ model)
  // รายชื่อเต็ม 23 model อยู่ใน opencode.json — ที่นี่คือชุดที่เปิดให้เลือกผ่าน LINE
  "okmd/claude-sonnet-5": { providerID: "okmd", modelID: "claude-sonnet-5", label: "Claude Sonnet 5 (OKMD)" },
  "okmd/gpt-5.4": { providerID: "okmd", modelID: "gpt-5.4", label: "GPT-5.4 (OKMD)" },
  "okmd/gpt-5.4-mini": { providerID: "okmd", modelID: "gpt-5.4-mini", label: "GPT-5.4 Mini (OKMD)" },
  "okmd/gemini-3.5-flash": { providerID: "okmd", modelID: "gemini-3.5-flash", label: "Gemini 3.5 Flash (OKMD)" },
  "okmd/deepseek-v4-pro": { providerID: "okmd", modelID: "deepseek-v4-pro", label: "DeepSeek V4 Pro (OKMD)" },
  "okmd/qwen3.7-max": { providerID: "okmd", modelID: "qwen3.7-max", label: "Qwen3.7 Max (OKMD)" },
  "okmd/grok-4.3": { providerID: "okmd", modelID: "grok-4.3", label: "Grok 4.3 (OKMD)" },
  "okmd/sonar-pro": { providerID: "okmd", modelID: "sonar-pro", label: "Sonar Pro (OKMD)" },
  // thaillm.or.th — Thai LLM ใช้ apikey ร่วมผ่าน THAILLM_API_KEY
  "thaillm/openthaigpt-8b": { providerID: "openthaigpt", modelID: "/model", label: "OpenThaiGPT 8B v7.2 (ไทย)", noTools: true },
  "thaillm/pathumma-8b": { providerID: "pathumma", modelID: "/model", label: "Pathumma Qwen3 8B Think (ไทย)", noTools: true },
  "thaillm/typhoon-s-8b": { providerID: "typhoon-thai", modelID: "/model", label: "Typhoon-S 8B (ไทย)" },
  "thaillm/thalle-8b": { providerID: "thalle", modelID: "/model", label: "THaLLE 0.2 8B (ไทย)" },
}

export const DEFAULT_MODEL = "opencode/big-pickle"

/** model ที่ใช้ได้โดยไม่ต้องมี API key — ใช้ smoke test ได้เลย */
export const FREE_MODELS = ["opencode/big-pickle", "opencode/nemotron-3-super"] as const

/** ต่อท้ายตอนผู้ใช้เปลี่ยนไป model ที่ไม่มี tool calling */
export const NO_TOOLS_NOTE = "\n⚠️ โมเดลนี้ตอบข้อความอย่างเดียว อ่าน/แก้ไฟล์ไม่ได้"

export function isNoTools(modelKey: string): boolean {
  return MODELS[modelKey]?.noTools === true
}

/** ข้อความยืนยันหลังเปลี่ยน model — ต่อ NO_TOOLS_NOTE ให้อัตโนมัติเมื่อจำเป็น */
export function modelSwitchedMessage(modelKey: string): string {
  const spec = MODELS[modelKey]
  if (!spec) return `ไม่รู้จัก model "${modelKey}"`
  return `เปลี่ยนเป็น ${spec.label} แล้วครับ\n(${modelKey})\nSession ใหม่พร้อมใช้งาน${spec.noTools ? NO_TOOLS_NOTE : ""}`
}
