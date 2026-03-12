// --- GitHub Copilot SDK integration ---

import { CopilotClient, CopilotSession, approveAll } from "@github/copilot-sdk"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { publish } from "./events"
import type { MessageInfo, MessagePart } from "./session"

// Load system prompt from workspace CLAUDE.md + AGENTS.md at startup
function loadSystemPrompt(workspaceDir: string): string {
  const files = ["CLAUDE.md", "AGENTS.md"]
  const parts: string[] = []
  for (const file of files) {
    try {
      parts.push(readFileSync(join(workspaceDir, file), "utf-8"))
    } catch {}
  }
  return parts.join("\n\n---\n\n")
}

// Load MCP server config from workspace .mcp.json
function loadMcpServers(workspaceDir: string): Record<string, any> | undefined {
  try {
    const raw = readFileSync(join(workspaceDir, ".mcp.json"), "utf-8")
    const config = JSON.parse(raw)
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      console.log(`[copilot] Loaded MCP servers: ${Object.keys(config.mcpServers).join(", ")}`)
      return config.mcpServers
    }
  } catch {}
  return undefined
}

const defaultWorkspaceDir = process.env.WORKSPACE_DIR ?? "/workspace"
const cachedSystemPrompt = loadSystemPrompt(defaultWorkspaceDir)
if (cachedSystemPrompt) {
  console.log(`[copilot] Loaded system prompt from workspace (${cachedSystemPrompt.length} chars)`)
}
const cachedMcpServers = loadMcpServers(defaultWorkspaceDir)

// --- Copilot Client (singleton, manages CLI process) ---
let client: CopilotClient | null = null

async function getClient(): Promise<CopilotClient> {
  if (client && client.getState() === "connected") return client

  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.COPILOT_GITHUB_TOKEN
  client = new CopilotClient({
    logLevel: "warning",
    ...(ghToken ? { githubToken: ghToken } : { useLoggedInUser: true }),
  })
  await client.start()

  // Verify auth
  const auth = await client.getAuthStatus()
  console.log(`[copilot] Auth: ${auth.isAuthenticated ? "OK" : "NOT authenticated"} (${auth.authType ?? "none"}, ${auth.login ?? "unknown"})`)

  return client
}

export interface CopilotOptions {
  model?: string
  maxTurns?: number
  systemPrompt?: string
  resumeSessionId?: string
  workspaceDir?: string
  abortController?: AbortController
  sessionId?: string
}

export interface CopilotResult {
  result: string
  session_id: string
  cost_usd: number
  duration_ms: number
  is_error: boolean
  messages: MessageInfo[]
}

const defaultModel = process.env.COPILOT_MODEL ?? "claude-sonnet-4.5"
const defaultMaxTurns = Number(process.env.COPILOT_MAX_TURNS ?? 10)
const promptTimeoutMs = Number(process.env.COPILOT_TIMEOUT_MS ?? 300_000)

export async function runCopilot(
  prompt: string,
  options: CopilotOptions = {},
  isRetry = false,
): Promise<CopilotResult> {
  const start = Date.now()
  const cwd = options.workspaceDir ?? defaultWorkspaceDir
  const sid = options.sessionId // our session ID for events

  const collectedMessages: MessageInfo[] = []
  let resultText = ""
  let isError = false
  let copilotSessionId = ""

  try {
    const c = await getClient()

    // Build system message
    const systemContent = options.systemPrompt ?? cachedSystemPrompt ?? undefined

    // Create or resume session
    let session: CopilotSession

    if (options.resumeSessionId) {
      try {
        session = await c.resumeSession(options.resumeSessionId, {
          onPermissionRequest: approveAll,
          model: options.model ?? defaultModel,
          workingDirectory: cwd,
          systemMessage: systemContent ? { mode: "append", content: systemContent } : undefined,
          mcpServers: cachedMcpServers,
        })
      } catch (err: any) {
        if (!isRetry) {
          console.log(`[copilot] Resume failed, creating new session`)
          return runCopilot(prompt, { ...options, resumeSessionId: undefined }, true)
        }
        throw err
      }
    } else {
      session = await c.createSession({
        onPermissionRequest: approveAll,
        model: options.model ?? defaultModel,
        workingDirectory: cwd,
        systemMessage: systemContent ? { mode: "append", content: systemContent } : undefined,
        mcpServers: cachedMcpServers,
      })
    }

    copilotSessionId = session.sessionId

    // Subscribe to events for SSE broadcasting
    session.on((event) => {
      if (event.type === "assistant.message" && sid) {
        const parts: MessagePart[] = [{
          id: crypto.randomUUID(),
          type: "text",
          text: event.data.content,
        }]
        const msg: MessageInfo = {
          id: crypto.randomUUID(),
          role: "assistant",
          parts,
          createdAt: new Date().toISOString(),
        }
        collectedMessages.push(msg)
        publish({
          type: "message.updated",
          properties: { sessionId: sid, message: msg },
        })
      }
    })

    // Send prompt and wait for response
    const response = await session.sendAndWait(
      { prompt },
      promptTimeoutMs,
    )

    if (response) {
      resultText = response.data.content ?? ""
    } else {
      resultText = "Done. (no text output)"
    }

    // Disconnect session (preserves on disk for resume)
    await session.disconnect()
  } catch (err: any) {
    if (err?.name === "AbortError") {
      resultText = "Query was aborted"
    } else {
      resultText = err?.message ?? "Unknown error"
    }
    isError = true
  }

  return {
    result: resultText || "Done. (no text output)",
    session_id: copilotSessionId,
    cost_usd: 0, // Copilot SDK doesn't expose cost directly
    duration_ms: Date.now() - start,
    is_error: isError,
    messages: collectedMessages,
  }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  if (client) {
    await client.stop().catch(() => {})
  }
})
