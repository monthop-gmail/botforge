/**
 * อ่าน config จาก workspace — system prompt และ MCP server
 *
 * ยกมาจาก `loadSystemPrompt()` / `loadMcpServers()` ของ v1-final
 * v1 อ่านครั้งเดียวตอน module load แล้ว cache ไว้ตลอดอายุ process
 * ที่นี่ทำเป็นฟังก์ชันเรียกได้ เพื่อให้ test ชี้ไป dir อื่นได้และ reload ได้
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** ไฟล์ที่ประกอบเป็น system prompt เรียงตามลำดับที่ v1 อ่าน */
export const SYSTEM_PROMPT_FILES = ["CLAUDE.md", "AGENTS.md"] as const

/** ต่อด้วย `\n\n---\n\n` เหมือน v1 · ไม่มีไฟล์ไหนเลยคืนสตริงว่าง */
export function loadSystemPrompt(workspaceDir: string): string {
  const parts: string[] = []
  for (const file of SYSTEM_PROMPT_FILES) {
    try {
      parts.push(readFileSync(join(workspaceDir, file), "utf-8"))
    } catch {
      // ไม่มีไฟล์ = ข้าม ไม่ใช่ error — v1 ก็เงียบ
    }
  }
  return parts.join("\n\n---\n\n")
}

/**
 * `.mcp.json` จาก workspace — รูปแบบเดียวกับ Claude Code และ Cursor
 *
 * คืน `undefined` เมื่อไม่มีไฟล์ หรือมีแต่ `mcpServers` ว่าง
 * (SDK ตีความ `{}` ต่างจาก `undefined`)
 */
export function loadMcpServers(
  workspaceDir: string,
  log: (...args: unknown[]) => void = () => {},
): Record<string, unknown> | undefined {
  try {
    const raw = readFileSync(join(workspaceDir, ".mcp.json"), "utf-8")
    const config = JSON.parse(raw)
    if (config?.mcpServers && Object.keys(config.mcpServers).length > 0) {
      log(`โหลด MCP server: ${Object.keys(config.mcpServers).join(", ")}`)
      return config.mcpServers
    }
  } catch {
    // ไม่มีไฟล์ หรือ JSON พัง = ไม่มี MCP · v1 เงียบเหมือนกัน
  }
  return undefined
}
