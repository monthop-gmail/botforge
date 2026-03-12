import * as line from "@line/bot-sdk"
import { createHmac } from "node:crypto"

// --- Config ---
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN
const channelSecret = process.env.LINE_CHANNEL_SECRET
const port = Number(process.env.PORT ?? 3000)
const adkcodeUrl = (process.env.ADKCODE_URL ?? "http://server:8000").replace(/\/$/, "")
const lineOAUrl = process.env.LINE_OA_URL ?? "https://line.me/ti/p/~your-oa"
const serverPassword = process.env.SERVER_PASSWORD

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

if (!channelAccessToken || !channelSecret) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET")
  process.exit(1)
}

console.log("LINE bot configuration:")
console.log("- Channel access token present:", !!channelAccessToken)
console.log("- Channel secret present:", !!channelSecret)
console.log("- Webhook port:", port)
console.log("- ADKcode URL:", adkcodeUrl)
console.log("- Server auth:", serverPassword ? "enabled" : "disabled")

// --- LINE Client ---
const lineClient = new line.messagingApi.MessagingApiClient({ channelAccessToken })

// --- ADKcode HTTP Client ---
const serverAuth = serverPassword ? `Bearer ${serverPassword}` : ""

async function adkcodeRequest(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (serverAuth) headers["Authorization"] = serverAuth

  const resp = await fetch(`${adkcodeUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: signal ?? AbortSignal.timeout(300_000),
  })

  const text = await resp.text()
  if (!resp.ok) {
    throw new Error(`ADKcode API ${resp.status}: ${text.slice(0, 300)}`)
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function createSession(userId?: string): Promise<{ id: string }> {
  return adkcodeRequest("POST", "/session", { user_id: userId })
}

const PROMPT_TIMEOUT_MS = Number(process.env.PROMPT_TIMEOUT_MS ?? 120_000)

async function sendPrompt(
  sessionId: string,
  content: string,
  options?: { userContext?: string; groupName?: string; quotedMessageId?: string },
): Promise<any> {
  let prefixed = "[IMPORTANT: Always respond directly with text. Do NOT ask clarifying questions. If unsure, make your best guess and explain your assumptions.]\n\n"

  // User context
  if (options?.userContext) {
    prefixed += `${options.userContext} `
  }

  // Group info context
  if (options?.groupName) {
    prefixed += `[Group: ${options.groupName}] `
  }

  // Time context
  prefixed += `${getTimeContext()}\n\n`

  // Reply/quote context
  if (options?.quotedMessageId) {
    prefixed += `[Reply to message ID: ${options.quotedMessageId}]\n\n`
  }

  prefixed += content

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS)

  try {
    const result = await adkcodeRequest("POST", `/session/${sessionId}/message`, { content: prefixed }, controller.signal)
    clearTimeout(timeout)
    return result
  } catch (err: any) {
    clearTimeout(timeout)
    if (err?.name === "AbortError" || err?.message?.includes("abort")) {
      return { _timedOut: true }
    }
    throw err
  }
}

// --- Extract response text ---
function extractResponse(result: any): string {
  if (result?.is_error) {
    return `Error: ${result.result || "Unknown error"}`
  }
  return result?.result || "เสร็จแล้วครับ (ไม่มีข้อความตอบกลับ)"
}

// --- Wait for server ---
async function waitForServer(maxRetries = 30, delayMs = 2000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(`${adkcodeUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      })
      if (resp.ok) {
        console.log("ADKcode server is ready")
        return true
      }
    } catch {
      // not ready yet
    }
    console.log(`Waiting for ADKcode server... (${i + 1}/${maxRetries})`)
    await new Promise((r) => setTimeout(r, delayMs))
  }
  console.error("ADKcode server did not become ready")
  return false
}

// --- Session Management ---
const sessions = new Map<string, { sessionId: string; userId: string; isGroup: boolean }>()

// --- User Memory ---
interface UserProfile {
  userId: string
  displayName: string
  pictureUrl?: string
  statusMessage?: string
  firstSeen: number
  lastSeen: number
  messageCount: number
}
const userProfiles = new Map<string, UserProfile>()

async function getUserProfile(userId: string, groupId?: string): Promise<UserProfile | null> {
  const cached = userProfiles.get(userId)
  if (cached && Date.now() - cached.lastSeen < 3600000) {
    cached.lastSeen = Date.now()
    cached.messageCount++
    return cached
  }

  try {
    let displayName = "Unknown"
    if (groupId) {
      try {
        const member = await lineClient.getGroupMemberProfile(groupId, userId)
        displayName = member.displayName || "Unknown"
      } catch {
        const profile = await lineClient.getProfile(userId)
        displayName = profile.displayName || "Unknown"
      }
    } else {
      const profile = await lineClient.getProfile(userId)
      displayName = profile.displayName || "Unknown"
    }
    const userProfile: UserProfile = {
      userId,
      displayName,
      pictureUrl: undefined,
      statusMessage: undefined,
      firstSeen: cached?.firstSeen || Date.now(),
      lastSeen: Date.now(),
      messageCount: (cached?.messageCount || 0) + 1,
    }
    userProfiles.set(userId, userProfile)
    return userProfile
  } catch (err) {
    console.warn("Failed to get user profile:", err)
    return cached || null
  }
}

function getUserContext(userId: string): string {
  const profile = userProfiles.get(userId)
  if (!profile) return ""
  return `[User: ${profile.displayName}]`
}

// --- Group name cache ---
const groupNames = new Map<string, { name: string; ts: number }>()

async function getGroupName(groupId: string): Promise<string | null> {
  const cached = groupNames.get(groupId)
  if (cached && Date.now() - cached.ts < 3600000) return cached.name
  try {
    const summary = await lineClient.getGroupSummary(groupId)
    const name = summary.groupName || null
    if (name) groupNames.set(groupId, { name, ts: Date.now() })
    return name
  } catch {
    return cached?.name || null
  }
}

function getTimeContext(): string {
  const now = new Date()
  const bangkokTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(now)
  return `[Time: ${bangkokTime}+07:00]`
}

// --- Thai error hints ---
function getErrorHint(errMsg: string): string {
  const msg = errMsg.toLowerCase()
  if (msg.includes("429") || msg.includes("rate limit")) return "เกิน rate limit ครับ รอสักครู่แล้วลองใหม่"
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("abort")) return "AI ใช้เวลานานเกินไปครับ ลองพิมพ์ /new แล้วถามใหม่"
  if (msg.includes("401") || msg.includes("403") || msg.includes("auth") || msg.includes("unauthorized")) return "มีปัญหาเรื่อง authentication ครับ กรุณาแจ้ง admin"
  if (msg.includes("500") || msg.includes("internal server")) return "server มีปัญหาครับ ลองใหม่อีกครั้ง"
  if (msg.includes("context") || msg.includes("too long") || msg.includes("token")) return "บทสนทนายาวเกินไปครับ ลองพิมพ์ /new เพื่อเริ่มใหม่"
  return `เกิดข้อผิดพลาดครับ: ${errMsg.slice(0, 200)}`
}

// --- Handle LINE Join/Leave events ---
async function handleJoinEvent(event: any): Promise<void> {
  const chatId = event.source?.groupId || event.source?.roomId
  if (chatId) {
    console.log(`Bot joined group/room: ${chatId}`)
    const welcomeMsg = `สวัสดีครับ! ผม ADKcode Bot

พิมพ์อะไรก็ได้ ผมช่วยได้ครับ
พิมพ์ /help ดูคำสั่งทั้งหมด
คุยส่วนตัว: ${lineOAUrl}`
    if (event.source?.groupId) {
      await lineClient.pushMessage({
        to: event.source.groupId,
        messages: [{ type: "text", text: welcomeMsg }],
      }).catch((err: any) => console.error("Welcome error:", err?.message))
    }
  }
}

async function handleLeaveEvent(event: any): Promise<void> {
  const chatId = event.source?.groupId || event.source?.roomId
  if (chatId) {
    console.log(`Bot left group/room: ${chatId}`)
    sessions.delete(chatId)
  }
}

// --- Get session key ---
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

    if (i === 0 && replyToken) {
      try {
        await lineClient.replyMessage({
          replyToken,
          messages: [{ type: "text", text: chunk }],
        })
        continue
      } catch (err: any) {
        console.log("replyMessage failed, falling back to push:", err?.message)
      }
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await lineClient.pushMessage({
          to,
          messages: [{ type: "text", text: chunk }],
        })
        break
      } catch (err: any) {
        const msg = err?.message ?? String(err)
        if (msg.includes("429") && attempt < 2) {
          const delay = (attempt + 1) * 5000
          console.log(`Rate limited, retrying in ${delay / 1000}s...`)
          await new Promise((r) => setTimeout(r, delay))
        } else {
          console.error("Failed to send LINE message:", msg)
          break
        }
      }
    }
  }
}

// --- Handle image messages ---
async function handleImageMessage(
  userId: string,
  replyToken: string,
  isGroup: boolean,
): Promise<void> {
  const userName = userProfiles.get(userId)?.displayName || userId.slice(-8)
  log(`Image from ${userName}, group: ${isGroup} (no vision)`)
  if (isGroup) return
  await lineClient.replyMessage({
    replyToken,
    messages: [{ type: "text", text: "ยังดูรูปไม่ได้ครับ ส่งเป็นข้อความแทนนะ" }],
  }).catch(() => {})
}

// --- Handle incoming LINE message ---
async function handleTextMessage(
  userId: string,
  text: string,
  replyToken: string,
  sessionKey: string | null = userId,
  isGroup: boolean = false,
  quotedMessageId?: string,
  groupId?: string,
): Promise<void> {
  const userName = userProfiles.get(userId)?.displayName || userId.slice(-8)
  log(`${userName}: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}" [group:${isGroup}, key:${sessionKey?.slice(-8)}]`)

  // --- Commands ---
  if (text.toLowerCase() === "/new") {
    if (sessionKey) sessions.delete(sessionKey)
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: "เริ่ม session ใหม่แล้วครับ ส่งข้อความมาได้เลย!" }],
    })
    return
  }

  if (text.toLowerCase() === "/abort") {
    const session = sessionKey ? sessions.get(sessionKey) : null
    if (session) {
      await adkcodeRequest("POST", `/session/${session.sessionId}/abort`).catch(() => {})
      await lineClient.replyMessage({
        replyToken,
        messages: [{ type: "text", text: "ยกเลิกคำสั่งแล้วครับ" }],
      })
    } else {
      await lineClient.replyMessage({
        replyToken,
        messages: [{ type: "text", text: "ไม่มี session ที่ใช้งานอยู่ครับ" }],
      })
    }
    return
  }

  if (text.toLowerCase() === "/sessions") {
    const session = sessionKey ? sessions.get(sessionKey) : null
    const msg = session
      ? `กำลังใช้งาน session อยู่ครับ (ID: ...${session.sessionId.slice(-8)})\nพิมพ์ /new เพื่อเริ่มใหม่`
      : "ยังไม่มี session ครับ ส่งข้อความมาเพื่อเริ่มใช้งาน!"
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: msg }],
    })
    return
  }

  if (text.toLowerCase() === "/about" || text.toLowerCase() === "/who") {
    const aboutMsg = `สวัสดีครับ! ผมคือ ADKcode Bot

AI Coding Agent (Google ADK + Gemini)
ทำงานผ่าน LINE -- ถามอะไรก็ได้ ช่วยเขียน code ให้
Multi-agent: coder, reviewer, tester

GitHub: https://github.com/{{GITHUB_ORG}}/{{PROJECT_NAME}}
คุยส่วนตัว: ${lineOAUrl}
พิมพ์ /help ดูคำสั่งทั้งหมด`
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: aboutMsg }],
    })
    return
  }

  if (text.toLowerCase() === "/help" || text.toLowerCase() === "/คำสั่ง") {
    const helpMsg = `คำสั่งทั้งหมด:

ทั่วไป
  /about -- แนะนำตัว bot
  /help -- คำสั่งทั้งหมด

Session
  /new -- เริ่มบทสนทนาใหม่
  /abort -- ยกเลิก prompt ที่กำลังทำ
  /sessions -- ดูสถานะ session

วิธีใช้งาน:
  แชทส่วนตัว -- พิมพ์ได้เลย!
  ในกลุ่ม -- พิมพ์ได้เลย bot จะตอบเฉพาะข้อความที่เกี่ยวข้อง`
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: helpMsg }],
    })
    return
  }

  // --- Get or create session ---
  let session = sessionKey ? sessions.get(sessionKey) : null

  if (!session) {
    console.log("Creating new ADKcode session...")
    try {
      const result = await createSession(userId)
      console.log("Created ADKcode session:", result.id)
      session = { sessionId: result.id, userId, isGroup }
      if (sessionKey) sessions.set(sessionKey, session)
    } catch (err: any) {
      console.error("Failed to create session:", err?.message)
      await sendMessage(sessionKey || userId, "สร้าง session ไม่สำเร็จครับ ลองส่งข้อความใหม่อีกครั้ง", replyToken)
      return
    }
  }

  // --- Send prompt ---
  log(`Sending to ADKcode (session: ${session.sessionId.slice(-8)}): ${text.slice(0, 60)}${text.length > 60 ? "..." : ""}`)

  if (!isGroup) {
    lineClient.showLoadingAnimation({ chatId: userId, loadingSeconds: 60 }).catch(() => {})
  }

  try {
    await getUserProfile(userId, groupId)

    // Gather group context
    let groupName: string | undefined
    if (isGroup && groupId) {
      groupName = (await getGroupName(groupId)) ?? undefined
    }

    const userCtx = getUserContext(userId)

    const result = await sendPrompt(session.sessionId, text, {
      userContext: userCtx || undefined,
      groupName,
      quotedMessageId,
    })

    if (result?._timedOut) {
      await sendMessage(sessionKey || userId, "AI ใช้เวลานานเกินไป ลองพิมพ์ /new แล้วถามใหม่", replyToken)
      return
    }

    let responseText = extractResponse(result)

    // In group: skip if AI decides message isn't for it
    const trimmedResponse = responseText.trim()
    if (isGroup && (trimmedResponse === "[SKIP]" || trimmedResponse.startsWith("[SKIP]\n") || trimmedResponse.startsWith("[SKIP] "))) {
      log(`Skipped: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`)
      return
    }

    // Truncated response indicator
    if (responseText.length >= LINE_MAX_TEXT * 2) {
      responseText += "\n\n--- ข้อความถูกตัดเนื่องจากยาวเกินไป ---"
    }

    log(`Response (${responseText.length} chars): ${responseText.slice(0, 100)}${responseText.length > 100 ? "..." : ""}`)
    await sendMessage(sessionKey || userId, responseText, replyToken)
  } catch (err: any) {
    log("ADKcode prompt error:", err?.message)

    if (err?.message?.includes("404") || err?.message?.includes("not found")) {
      if (sessionKey) sessions.delete(sessionKey)
      log("Session expired, auto-retrying with new session...")
      try {
        const newResult = await createSession(userId)
        session = { sessionId: newResult.id, userId, isGroup }
        if (sessionKey) sessions.set(sessionKey, session)
        const retryResult = await sendPrompt(session.sessionId, text)
        const retryText = extractResponse(retryResult)
        await sendMessage(sessionKey || userId, retryText, replyToken)
        return
      } catch (retryErr: any) {
        log("Auto-retry failed:", retryErr?.message)
        await sendMessage(sessionKey || userId, "สร้าง session ใหม่ไม่สำเร็จครับ ลองส่งข้อความมาใหม่อีกครั้ง", replyToken)
        return
      }
    } else {
      await sendMessage(sessionKey || userId, getErrorHint(err?.message ?? "ไม่ทราบสาเหตุ"), replyToken)
    }
  }
}

// --- Check if bot is mentioned in a group message ---
function isBotMentioned(event: any): boolean {
  const mentionees = event.message?.mention?.mentionees
  if (Array.isArray(mentionees)) {
    if (mentionees.some((m: any) => m.type === "user" && m.userId === botUserId)) return true
  }
  const text = (event.message?.text ?? "").toLowerCase()
  if (text.startsWith("@bot") || text.startsWith("adkcode") || text.startsWith("@adkcode")) return true
  if (text.startsWith("/")) return true
  return false
}

// --- Start ---
await waitForServer()

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
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === "GET" && url.pathname === "/") {
      return new Response("ADKcode LINE Bot is running")
    }

    if (req.method === "GET" && url.pathname === "/about") {
      const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ADKcode LINE Bot — About</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a1a;color:#e0e0e0;min-height:100vh;padding:2rem 1rem}
  .container{max-width:640px;margin:0 auto}
  h1{font-size:1.8rem;margin-bottom:.5rem;background:linear-gradient(135deg,#4285f4,#34a853);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  h2{font-size:1.3rem;margin-top:2rem;margin-bottom:.75rem;color:#34a853}
  p,li{line-height:1.7;color:#b2bec3;margin-bottom:.5rem}
  a{color:#74b9ff;text-decoration:none}
  a:hover{text-decoration:underline}
  .card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:1.25rem;margin-bottom:1rem}
  .card h3{color:#55efc4;font-size:1.1rem;margin-bottom:.5rem}
  ul{padding-left:1.2rem}
  footer{margin-top:3rem;text-align:center;color:#636e72;font-size:.8rem}
</style>
</head>
<body>
<div class="container">
  <h1>ADKcode LINE Bot</h1>
  <p>AI coding assistant powered by Google ADK + Gemini multi-agent system — ถามคำถาม ให้ AI ช่วยตอบได้เลยผ่าน LINE</p>

  <h2>LINE Bot Commands</h2>
  <div class="card">
    <ul>
      <li><strong>/new</strong> — เริ่ม session ใหม่</li>
      <li><strong>/abort</strong> — ยกเลิก prompt ที่กำลังทำ</li>
      <li><strong>/sessions</strong> — ดูสถานะ session</li>
      <li><strong>/about</strong> — แนะนำตัว bot</li>
      <li><strong>/help</strong> — ดูคำสั่งทั้งหมด</li>
    </ul>
  </div>

  <footer><p>Built with Google ADK + Gemini + LINE Messaging API</p></footer>
</div>
</body>
</html>`
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
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
        if (event.type === "join") {
          handleJoinEvent(event).catch((err) => console.error("Error handling join:", err))
          continue
        }
        if (event.type === "leave") {
          handleLeaveEvent(event).catch((err) => console.error("Error handling leave:", err))
          continue
        }

        // Handle image messages
        if (
          event.type === "message" &&
          event.message?.type === "image" &&
          event.source?.userId
        ) {
          const isGroup = !!event.source?.groupId || !!event.source?.roomId
          handleImageMessage(event.source.userId, event.replyToken, isGroup).catch((err) => {
            console.error("Error handling image:", err)
          })
          continue
        }

        if (
          event.type === "message" &&
          event.message?.type === "text" &&
          event.source?.userId
        ) {
          const isGroup = !!event.source?.groupId || !!event.source?.roomId
          const sessionKey = getSessionKey(event)
          const quotedMessageId = event.message?.quotedMessageId

          handleTextMessage(
            event.source.userId,
            event.message.text.trim(),
            event.replyToken,
            sessionKey,
            isGroup,
            quotedMessageId,
            event.source?.groupId,
          ).catch((err) => console.error("Error handling text message:", err))
        }
      }

      return new Response("OK")
    }

    return new Response("Not Found", { status: 404 })
  },
})

console.log(`ADKcode LINE bot webhook listening on http://localhost:${port}/webhook`)
