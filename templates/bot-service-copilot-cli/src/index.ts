import { messagingApi } from "@line/bot-sdk"
import { createHmac } from "node:crypto"

// --- Config ---
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN
const channelSecret = process.env.LINE_CHANNEL_SECRET
const port = Number(process.env.PORT ?? 3000)
const serverUrl = process.env.SERVER_URL ?? "http://server:4096"
const serverPassword = process.env.SERVER_PASSWORD
const timeoutMs = Number(process.env.PROMPT_TIMEOUT_MS ?? 300_000)

if (!channelAccessToken || !channelSecret) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET")
  process.exit(1)
}

// --- Logging helper ---
function log(...args: any[]) {
  const ts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(new Date())
  console.log(`[${ts}]`, ...args)
}

console.log("Copilot CLI LINE bot configuration:")
console.log("- Server URL:", serverUrl)
console.log("- Server auth:", serverPassword ? "enabled" : "disabled")
console.log("- Timeout:", `${timeoutMs}ms`)

// --- LINE Client ---
const lineClient = new messagingApi.MessagingApiClient({ channelAccessToken })

// --- Server HTTP Client ---
const serverAuth = serverPassword ? `Bearer ${serverPassword}` : ""

async function serverRequest(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<any> {
  const headers: Record<string, string> = {}
  if (serverAuth) headers["Authorization"] = serverAuth
  if (body !== undefined) headers["Content-Type"] = "application/json"

  const resp = await fetch(`${serverUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  })

  const text = await resp.text()
  if (!resp.ok) throw new Error(`Server ${resp.status}: ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// --- Session Management ---
// For user chats: key = userId
// For group chats: key = groupId/roomId (shared session)
interface UserSession {
  sessionId: string
  totalCost: number
}

const sessions = new Map<string, UserSession>()
const userQueues = new Map<string, Promise<void>>()

// --- Per-session request queue ---
function enqueueForSession<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = userQueues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  userQueues.set(
    key,
    next.then(
      () => {},
      () => {},
    ),
  )
  return next
}

// --- User Profile Memory ---
interface UserProfile {
  userId: string
  displayName: string
  lastSeen: number
  messageCount: number
}
const userProfiles = new Map<string, UserProfile>()

async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const cached = userProfiles.get(userId)
  if (cached && Date.now() - cached.lastSeen < 3600000) {
    cached.lastSeen = Date.now()
    cached.messageCount++
    return cached
  }

  try {
    const profile = await lineClient.getProfile(userId)
    const userProfile: UserProfile = {
      userId,
      displayName: profile.displayName || "Unknown",
      lastSeen: Date.now(),
      messageCount: (cached?.messageCount || 0) + 1,
    }
    userProfiles.set(userId, userProfile)
    return userProfile
  } catch {
    return cached || null
  }
}

function getUserContext(userId: string): string {
  const profile = userProfiles.get(userId)
  if (!profile) return ""
  return `[User: ${profile.displayName}]`
}

function getTimeContext(): string {
  const bangkokTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(new Date())
  return `[Time: ${bangkokTime}+07:00]`
}

// --- Get session key based on source type ---
function getSessionKey(event: any): string | null {
  if (event.source?.groupId) return event.source.groupId
  if (event.source?.roomId) return event.source.roomId
  if (event.source?.userId) return event.source.userId
  return null
}

// --- LINE Signature Validation ---
function validateSignature(body: string, signature: string): boolean {
  const hash = createHmac("SHA256", channelSecret!)
    .update(body)
    .digest("base64")
  return hash === signature
}

// --- Chunk long messages for LINE (max 5000 chars) ---
const LINE_MAX_TEXT = 5000

function chunkText(text: string, limit: number = LINE_MAX_TEXT): string[] {
  if (text.length <= limit) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }

    let breakAt = remaining.lastIndexOf("\n", limit)
    if (breakAt < limit * 0.3) {
      breakAt = remaining.lastIndexOf(" ", limit)
    }
    if (breakAt < limit * 0.3) {
      breakAt = limit
    }

    const chunk = remaining.slice(0, breakAt)
    remaining = remaining.slice(breakAt).trimStart()

    // Handle unclosed code blocks
    const backtickCount = (chunk.match(/```/g) || []).length
    if (backtickCount % 2 !== 0) {
      chunks.push(chunk + "\n```")
      remaining = "```\n" + remaining
    } else {
      chunks.push(chunk)
    }
  }

  return chunks
}

// --- Send message: replyMessage first (free), fallback to pushMessage ---
async function sendMessage(to: string, text: string, replyToken?: string): Promise<void> {
  const chunks = chunkText(text)

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    // First chunk: try replyMessage (free, no quota)
    if (i === 0 && replyToken) {
      try {
        await lineClient.replyMessage({
          replyToken,
          messages: [{ type: "text", text: chunk }],
        })
        continue
      } catch (err: any) {
        log("replyMessage failed, falling back to push:", err?.message)
      }
    }

    // Remaining chunks or reply failed: pushMessage
    await lineClient
      .pushMessage({
        to,
        messages: [{ type: "text", text: chunk }],
      })
      .catch((err: any) => {
        console.error("Failed to send LINE message:", err?.message ?? err)
      })
  }
}

// --- Send prompt to server ---
async function sendPrompt(
  sessionKey: string,
  prompt: string,
  isGroup: boolean = false,
  userId?: string,
): Promise<{ result: string; cost: number; isError: boolean }> {
  const session = sessions.get(sessionKey)

  // Build prompt with context
  let fullPrompt = ""

  // User context
  if (userId) {
    const ctx = getUserContext(userId)
    if (ctx) fullPrompt += `${ctx} `
  }

  // Time context
  fullPrompt += `${getTimeContext()}\n\n`

  // Group chat: instruct AI to skip irrelevant messages
  if (isGroup) {
    fullPrompt += `[GROUP CHAT: You are in a group chat. If this message is clearly NOT directed at you (just people chatting with each other, unrelated conversations), respond with exactly [SKIP] and nothing else. If the message mentions you, asks a question, or could be directed at you, respond normally.]\n\n`
  }

  fullPrompt += prompt

  // Create session if needed
  if (!session) {
    const created = await serverRequest("POST", "/session")
    sessions.set(sessionKey, { sessionId: created.id, totalCost: 0 })
    log(`[${sessionKey.slice(-8)}] Created session: ${created.id}`)
  }

  const { sessionId } = sessions.get(sessionKey)!

  log(`[${sessionKey.slice(-8)}] Sending prompt to session ${sessionId}`)

  try {
    const result = await serverRequest(
      "POST",
      `/session/${sessionId}/message`,
      { prompt: fullPrompt },
    )

    const cost = result.cost_usd ?? 0
    const s = sessions.get(sessionKey)!
    s.totalCost += cost

    return {
      result: result.result ?? "Done. (no text output)",
      cost,
      isError: result.is_error ?? false,
    }
  } catch (err: any) {
    // If session expired or not found, create fresh and retry
    if (
      err?.message?.includes("404") ||
      err?.message?.includes("not found") ||
      err?.message?.includes("No conversation")
    ) {
      log(`[${sessionKey.slice(-8)}] Session expired, creating fresh`)
      sessions.delete(sessionKey)
      return sendPrompt(sessionKey, prompt, isGroup, userId)
    }
    throw err
  }
}

// --- Check if bot is mentioned in a group message ---
function isBotMentioned(event: any): boolean {
  const mentionees = event.message?.mention?.mentionees
  if (Array.isArray(mentionees)) {
    if (mentionees.some((m: any) => m.type === "user" && m.userId === botUserId)) return true
  }
  const text = (event.message?.text ?? "").toLowerCase()
  if (text.startsWith("@bot") || text.startsWith("claude") || text.startsWith("@claude")) return true
  if (text.startsWith("/")) return true
  return false
}

// --- Handle LINE Join events (bot added to group) ---
async function handleJoinEvent(event: any): Promise<void> {
  const groupId = event.source?.groupId
  const roomId = event.source?.roomId
  const chatId = groupId || roomId

  if (chatId) {
    log(`Bot joined group/room: ${chatId}`)
    const welcomeMsg = `🧑‍💻 สวัสดีครับ! ผมคือ Copilot CLI Bot

💬 พิมพ์อะไรก็ได้ ผมช่วยได้ครับ
📖 พิมพ์ /help ดูคำสั่งทั้งหมด`

    if (groupId) {
      await lineClient.pushMessage({
        to: groupId,
        messages: [{ type: "text", text: welcomeMsg }],
      }).catch((err: any) => console.error("Welcome error:", err?.message))
    }
  }
}

// --- Handle LINE Leave events (bot removed from group) ---
async function handleLeaveEvent(event: any): Promise<void> {
  const groupId = event.source?.groupId
  const roomId = event.source?.roomId
  const chatId = groupId || roomId

  if (chatId) {
    log(`Bot left group/room: ${chatId}`)
    sessions.delete(chatId)
  }
}

// --- Handle incoming LINE message ---
async function handleTextMessage(
  userId: string,
  text: string,
  replyToken: string,
  sessionKey: string | null = userId,
  isGroup: boolean = false,
): Promise<void> {
  const userName = userProfiles.get(userId)?.displayName || userId.slice(-8)
  const key = sessionKey || userId
  log(`💬 ${userName}: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}" [group:${isGroup}, key:${key.slice(-8)}]`)

  // --- Commands ---
  if (text.toLowerCase() === "/new") {
    const session = sessions.get(key)
    if (session) {
      await serverRequest("DELETE", `/session/${session.sessionId}`).catch(
        () => {},
      )
    }
    sessions.delete(key)
    await lineClient.replyMessage({
      replyToken,
      messages: [
        {
          type: "text",
          text: "เริ่ม session ใหม่แล้วครับ ส่งข้อความมาได้เลย!",
        },
      ],
    })
    return
  }

  if (text.toLowerCase() === "/abort") {
    const session = sessions.get(key)
    if (session) {
      const res = await serverRequest(
        "POST",
        `/session/${session.sessionId}/abort`,
      ).catch(() => ({ aborted: false }))
      if (res.aborted) {
        await lineClient.replyMessage({
          replyToken,
          messages: [{ type: "text", text: "ยกเลิกคำสั่งแล้วครับ" }],
        })
        return
      }
    }
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: "ไม่มี prompt ที่กำลังทำอยู่ครับ" }],
    })
    return
  }

  if (text.toLowerCase() === "/sessions") {
    const session = sessions.get(key)
    if (session) {
      const info = await serverRequest(
        "GET",
        `/session/${session.sessionId}`,
      ).catch(() => null)
      const msg = info
        ? `Session: ...${session.sessionId.slice(-8)}\nCost: $${session.totalCost.toFixed(4)}\nStatus: ${info.status}`
        : `Session: ...${session.sessionId.slice(-8)}\nCost: $${session.totalCost.toFixed(4)}`
      await lineClient.replyMessage({
        replyToken,
        messages: [{ type: "text", text: msg }],
      })
    } else {
      await lineClient.replyMessage({
        replyToken,
        messages: [
          {
            type: "text",
            text: "ยังไม่มี session ครับ ส่งข้อความมาเพื่อเริ่มใช้งาน!",
          },
        ],
      })
    }
    return
  }

  if (text.toLowerCase() === "/about" || text.toLowerCase() === "/who") {
    const aboutMsg = `🧑‍💻 สวัสดีครับ! ผมคือ Copilot CLI Bot

🤖 AI Coding Agent (GitHub Copilot SDK)
📱 ทำงานผ่าน LINE — ถามอะไรก็ได้ ช่วยเขียน code ให้

📦 GitHub: https://github.com/{{GITHUB_ORG}}/{{PROJECT_NAME}}
📖 พิมพ์ /help ดูคำสั่งทั้งหมด`
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: aboutMsg }],
    })
    return
  }

  if (text.toLowerCase() === "/help" || text.toLowerCase() === "/คำสั่ง") {
    const helpMsg = `📖 คำสั่งทั้งหมด:

🤖 ทั่วไป
  /about — แนะนำตัว bot
  /help — คำสั่งทั้งหมด

💻 Session
  /new — เริ่มบทสนทนาใหม่
  /abort — ยกเลิก prompt ที่กำลังทำ
  /sessions — ดูสถานะ session + cost
  /cost — ดูค่าใช้จ่าย

💬 วิธีใช้งาน:
  แชทส่วนตัว — พิมพ์ได้เลย!
  ในกลุ่ม — พิมพ์ได้เลย bot จะตอบเฉพาะข้อความที่เกี่ยวข้อง`
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: helpMsg }],
    })
    return
  }

  if (text.toLowerCase() === "/cost") {
    const session = sessions.get(key)
    const msg = session
      ? `Total cost this session: $${session.totalCost.toFixed(4)}`
      : "ยังไม่มี session ครับ"
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: msg }],
    })
    return
  }

  // --- Enqueue prompt ---
  enqueueForSession(key, async () => {
    try {
      // Get user profile for context
      await getUserProfile(userId)

      // Show loading animation (free, doesn't consume replyToken)
      if (!isGroup) {
        lineClient.showLoadingAnimation({ chatId: userId, loadingSeconds: 60 }).catch(() => {})
      }

      const { result, cost, isError } = await sendPrompt(key, text, isGroup, userId)

      // In group: skip if AI decides message isn't for it
      const trimmed = result.trim()
      if (isGroup && (trimmed === "[SKIP]" || trimmed.startsWith("[SKIP]\n") || trimmed.startsWith("[SKIP] "))) {
        log(`⏭️ Skipped: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`)
        return
      }

      let responseText = result
      if (cost > 0) {
        responseText += `\n\n[cost: $${cost.toFixed(4)}]`
      }
      if (isError) {
        responseText = `Error: ${result}`
      }

      log(
        `[${key.slice(-8)}] Response: ${responseText.length} chars, cost: $${cost.toFixed(4)}`,
      )
      await sendMessage(key, responseText, replyToken)
    } catch (err: any) {
      log("Prompt error:", err?.message)
      await sendMessage(
        key,
        `Error: ${err?.message?.slice(0, 200) ?? "Unknown error"}`,
        replyToken,
      )
    }
  })
}

// --- Get bot userId for mention detection ---
let botUserId = ""
try {
  const info = await lineClient.getBotInfo()
  botUserId = info.userId ?? ""
  console.log("Bot userId:", botUserId)
} catch (err: any) {
  console.warn("Could not get bot info:", err?.message)
}

// --- HTTP Server for LINE Webhook ---
Bun.serve({
  port,
  async fetch(req: Request) {
    const url = new URL(req.url)

    if (req.method === "GET" && url.pathname === "/") {
      return new Response("Copilot CLI LINE Bot is running")
    }

    if (req.method === "POST" && url.pathname === "/webhook") {
      const body = await req.text()
      const signature = req.headers.get("x-line-signature") || ""

      if (!validateSignature(body, signature)) {
        console.error("Invalid LINE signature")
        return new Response("Invalid signature", { status: 403 })
      }

      let parsed: { events: any[] }
      try {
        parsed = JSON.parse(body)
      } catch {
        return new Response("Invalid JSON", { status: 400 })
      }

      for (const event of parsed.events) {
        // Handle Join events (bot added to group)
        if (event.type === "join") {
          handleJoinEvent(event).catch((err) => {
            console.error("Error handling join event:", err)
          })
          continue
        }

        // Handle Leave events (bot removed from group)
        if (event.type === "leave") {
          handleLeaveEvent(event).catch((err) => {
            console.error("Error handling leave event:", err)
          })
          continue
        }

        // Handle text messages (user or group)
        if (
          event.type === "message" &&
          event.message?.type === "text" &&
          event.source?.userId
        ) {
          const isGroup = !!event.source?.groupId || !!event.source?.roomId
          const sessionKey = getSessionKey(event)

          handleTextMessage(
            event.source.userId,
            event.message.text.trim(),
            event.replyToken,
            sessionKey,
            isGroup,
          ).catch((err) => {
            console.error("Error handling message:", err)
          })
        }
      }

      return new Response("OK")
    }

    return new Response("Not Found", { status: 404 })
  },
})

log(
  `Copilot CLI LINE bot listening on http://localhost:${port}/webhook`,
)
