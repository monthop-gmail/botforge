/**
 * port ของ Claude Agent SDK
 *
 * ⚠️ **Claude Agent SDK ไม่ใช่ Claude API** — เป็นคนละ package คนละ surface
 *   `@anthropic-ai/sdk`                  Claude API — คุณเขียน loop เอง
 *   `@anthropic-ai/claude-agent-sdk`     Claude Code ที่ห่อเป็น library
 *                                        มี built-in tool (Read/Write/Bash/Grep)
 *                                        loop, context management, hooks, subagent, session
 * adapter นี้ห่อตัวหลัง เพราะ `bot-service-claude-code` ของ v1 ใช้ตัวนั้น
 *
 * แยกเป็น port เพราะ:
 *   1. SDK เป็น optional peer dependency — ไม่บังคับให้คนที่ไม่ใช้ต้องลง
 *   2. test ฉีด fake ได้ ไม่ต้องมี API key และไม่ยิงเน็ตจริง
 *   3. เป็นรูปแบบเดียวกับ LineTransport / RpcTransport ของ adapter อื่น
 */

/** option ที่ส่งเข้า `query()` — ชื่อตรงกับ SDK */
export interface ClaudeQueryOptions {
  cwd?: string
  model?: string
  maxTurns?: number
  maxBudgetUsd?: number
  systemPrompt?: string
  resume?: string
  mcpServers?: Record<string, unknown>
  permissionMode?: string
  allowDangerouslySkipPermissions?: boolean
  includePartialMessages?: boolean
  abortController?: AbortController
}

/** message ที่ SDK ส่งกลับมา — อ่านเฉพาะ field ที่ adapter ใช้ */
export interface SdkMessage {
  type: string
  session_id?: string
  subtype?: string
  result?: unknown
  error?: unknown
  is_error?: boolean
  total_cost_usd?: number
  usage?: { input_tokens?: number; output_tokens?: number }
  message?: { content?: Array<Record<string, any>> }
  event?: Record<string, any>
  uuid?: string
}

export type ClaudeQuery = (args: {
  prompt: string
  options?: ClaudeQueryOptions
}) => AsyncIterable<SdkMessage>

let cached: ClaudeQuery | undefined

/**
 * โหลด `query` จาก SDK จริงแบบ lazy
 *
 * import ตอนเรียกครั้งแรกไม่ใช่ตอน import module เพื่อให้ package นี้
 * ใช้กับ test และ typecheck ได้โดยไม่ต้องติดตั้ง SDK
 */
export async function defaultQuery(): Promise<ClaudeQuery> {
  if (cached) return cached
  try {
    // import แบบ dynamic ผ่านตัวแปร เพื่อไม่ให้ typecheck ต้องการ SDK ที่เป็น optional peer
    const specifier = "@anthropic-ai/claude-agent-sdk"
    const mod = (await import(specifier)) as { query: ClaudeQuery }
    cached = mod.query
    return cached
  } catch (err) {
    throw new Error(
      "ไม่พบ @anthropic-ai/claude-agent-sdk — ติดตั้งด้วย " +
        "`npm i @anthropic-ai/claude-agent-sdk` หรือฉีด query เองผ่าน options.query\n" +
        `สาเหตุเดิม: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
