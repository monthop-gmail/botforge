/**
 * อ่าน config จาก env แล้วประกอบ runtime
 *
 * แยกจาก `main.ts` เพราะ **การเลือก adapter คือจุดที่พลาดง่ายที่สุด** และควรทดสอบได้
 * โดยไม่ต้องสตาร์ท server หรือมี LINE token
 */
import { resolveScope, type Scope } from "@botforge/core/identity"
import type { RuntimePort } from "@botforge/core/router"
import type { UserContextFormat } from "@botforge/core/context"

export const RUNTIMES = ["opencode", "codex", "claude", "adkcode"] as const
export type RuntimeName = (typeof RUNTIMES)[number]

export interface BotConfig {
  scope: Scope
  runtimeName: RuntimeName
  channelSecret: string
  channelAccessToken: string
  port: number
  botName: string
  lineOaUrl: string
  workspaceDir: string
  promptTimeoutMs: number
  /** `opencode` ใช้ `[User Info: …]` ส่วนที่เหลือใช้ `[User: …]` */
  userContextFormat: UserContextFormat
  /** `opencode` ไม่ใช้กลไกต่อท้ายว่าโดนตัดตามความยาว */
  lengthTruncationNotice: boolean
}

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = "ConfigError" }
}

function required(env: Record<string, string | undefined>, key: string): string {
  const v = env[key]
  if (!v) throw new ConfigError(`ต้องตั้ง ${key}`)
  return v
}

export function readConfig(env: Record<string, string | undefined>): BotConfig {
  const runtimeName = (env.BOTFORGE_RUNTIME ?? "opencode") as RuntimeName
  if (!RUNTIMES.includes(runtimeName)) {
    throw new ConfigError(
      `BOTFORGE_RUNTIME "${runtimeName}" ไม่รองรับ — เลือกจาก ${RUNTIMES.join(" · ")}`,
    )
  }
  // resolveScope โยนเองถ้าขาด — event/v1 ห้ามเดา tenant
  const scope = resolveScope(env)

  return {
    scope,
    runtimeName,
    channelSecret: required(env, "LINE_CHANNEL_SECRET"),
    channelAccessToken: required(env, "LINE_CHANNEL_ACCESS_TOKEN"),
    port: Number(env.PORT ?? 3000),
    botName: env.BOT_NAME ?? `${runtimeName} Bot`,
    lineOaUrl: env.LINE_OA_URL ?? "",
    workspaceDir: env.WORKSPACE_DIR ?? "/workspace",
    promptTimeoutMs: Number(env.PROMPT_TIMEOUT_MS ?? 120_000),
    // ยกค่าเริ่มต้นของแต่ละ engine มาจาก v1 ตามจริง
    userContextFormat: runtimeName === "opencode" ? "verbose" : "standard",
    lengthTruncationNotice: runtimeName !== "opencode",
  }
}

/**
 * สร้าง adapter ตาม config — `import` แบบ lazy เพื่อไม่ให้ต้องโหลด SDK
 * ของ engine ที่ไม่ได้ใช้ (โดยเฉพาะ `claude` ที่ SDK เป็น optional peer)
 */
export async function createRuntime(
  config: BotConfig,
  env: Record<string, string | undefined>,
): Promise<RuntimePort> {
  switch (config.runtimeName) {
    case "opencode": {
      const { OpenCodeAdapter } = await import("@botforge/adapter-opencode")
      return new OpenCodeAdapter({
        url: env.OPENCODE_URL ?? "http://opencode:4096",
        password: env.OPENCODE_PASSWORD,
        directory: env.OPENCODE_DIR ?? config.workspaceDir,
        promptTimeoutMs: config.promptTimeoutMs,
      })
    }
    case "codex": {
      const { CodexAdapter } = await import("@botforge/adapter-codex")
      return new CodexAdapter({
        command: env.CODEX_BIN ?? "codex",
        args: ["app-server"],
        model: env.CODEX_MODEL ?? "o4-mini",
        workspaceDir: config.workspaceDir,
        promptTimeoutMs: config.promptTimeoutMs,
      })
    }
    case "claude": {
      const { ClaudeAdapter } = await import("@botforge/adapter-claude")
      return new ClaudeAdapter({
        workspaceDir: config.workspaceDir,
        model: env.CLAUDE_MODEL ?? "sonnet",
        maxTurns: Number(env.CLAUDE_MAX_TURNS ?? 10),
        maxBudgetUsd: Number(env.CLAUDE_MAX_BUDGET_USD ?? 1.0),
        promptTimeoutMs: config.promptTimeoutMs,
      })
    }
    case "adkcode": {
      const { AdkcodeAdapter } = await import("@botforge/adapter-adkcode")
      return new AdkcodeAdapter({
        url: env.ADKCODE_URL ?? "http://server:8000",
        auth: env.SERVER_PASSWORD ? `Bearer ${env.SERVER_PASSWORD}` : undefined,
        promptTimeoutMs: config.promptTimeoutMs,
      })
    }
  }
}
