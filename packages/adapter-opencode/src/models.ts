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
  // thaillm.or.th — Thai LLM ใช้ apikey ร่วมผ่าน THAILLM_API_KEY
  "thaillm/openthaigpt-8b": { providerID: "openthaigpt", modelID: "/model", label: "OpenThaiGPT 8B v7.2 (ไทย)" },
  "thaillm/pathumma-8b": { providerID: "pathumma", modelID: "/model", label: "Pathumma Qwen3 8B Think (ไทย)" },
  "thaillm/typhoon-s-8b": { providerID: "typhoon-thai", modelID: "/model", label: "Typhoon-S 8B (ไทย)" },
  "thaillm/thalle-8b": { providerID: "thalle", modelID: "/model", label: "THaLLE 0.2 8B (ไทย)" },
}

export const DEFAULT_MODEL = "opencode/big-pickle"

/** model ที่ใช้ได้โดยไม่ต้องมี API key — ใช้ smoke test ได้เลย */
export const FREE_MODELS = ["opencode/big-pickle", "opencode/nemotron-3-super"] as const
