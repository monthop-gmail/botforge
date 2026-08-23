/**
 * profile ของผู้ใช้และชื่อกลุ่ม พร้อม cache 1 ชั่วโมง
 *
 * ยกมาจาก `getUserProfile()` / `getGroupName()` / `getUserContext()` ของ v1-final
 *
 * v1 มี UserProfile สามรูป:
 *   codex family (4 field) · gocode (+firstSeen) · opencode/adkcode (+pictureUrl, statusMessage)
 * core ใช้ **superset** — field ที่ engine เดิมไม่ได้เก็บก็เป็น optional ไม่มีใครเสียของ
 *
 * ส่วน `getUserContext()` ต่างกันจริงเชิงผลลัพธ์:
 *   8 engine → `[User: {name}]`
 *   opencode → `[User Info: {name} (messages: {n})]`
 * core ใช้ของ 8 engine เป็นค่าเริ่มต้น และเก็บของ opencode ไว้เป็น `"verbose"`
 */

/** cache 1 ชั่วโมงเท่า v1 */
export const PROFILE_TTL_MS = 3_600_000

export interface UserProfile {
  userId: string
  displayName: string
  firstSeen: number
  lastSeen: number
  messageCount: number
  pictureUrl?: string
  statusMessage?: string
}

/** สิ่งที่ core ต้องการจาก LINE SDK — adapter เป็นคนต่อของจริง */
export interface LineProfileSource {
  getProfile(userId: string): Promise<{ displayName?: string; pictureUrl?: string; statusMessage?: string }>
  getGroupMemberProfile(
    groupId: string,
    userId: string,
  ): Promise<{ displayName?: string; pictureUrl?: string }>
  getGroupSummary(groupId: string): Promise<{ groupName?: string }>
}

export interface ProfileCacheOptions {
  ttlMs?: number
  now?: () => number
  warn?: (...args: unknown[]) => void
}

export class ProfileCache {
  readonly #users = new Map<string, UserProfile>()
  readonly #groups = new Map<string, { name: string; ts: number }>()
  readonly #source: LineProfileSource
  readonly #ttl: number
  readonly #now: () => number
  readonly #warn: (...args: unknown[]) => void

  constructor(source: LineProfileSource, options: ProfileCacheOptions = {}) {
    this.#source = source
    this.#ttl = options.ttlMs ?? PROFILE_TTL_MS
    this.#now = options.now ?? Date.now
    this.#warn = options.warn ?? (() => {})
  }

  /**
   * ลำดับที่ยกมาจาก v1 ทั้งหมด:
   *   · cache ยังสด → นับ message เพิ่มแล้วคืนเลย ไม่ยิง API
   *   · อยู่ในกลุ่ม → ลอง getGroupMemberProfile ก่อน ถ้าพังค่อย fallback getProfile
   *   · ทั้งหมดพัง → คืน cache เก่า (แม้หมดอายุ) ไม่ใช่ null ถ้ามี
   *   · displayName ที่ว่างเปล่าถือเป็น "Unknown"
   */
  async getUser(userId: string, groupId?: string): Promise<UserProfile | null> {
    const cached = this.#users.get(userId)
    if (cached && this.#now() - cached.lastSeen < this.#ttl) {
      cached.lastSeen = this.#now()
      cached.messageCount++
      return cached
    }

    try {
      let displayName = "Unknown"
      let pictureUrl: string | undefined
      let statusMessage: string | undefined

      if (groupId) {
        try {
          const member = await this.#source.getGroupMemberProfile(groupId, userId)
          displayName = member.displayName || "Unknown"
          pictureUrl = member.pictureUrl
        } catch {
          const profile = await this.#source.getProfile(userId)
          displayName = profile.displayName || "Unknown"
          pictureUrl = profile.pictureUrl
          statusMessage = profile.statusMessage
        }
      } else {
        const profile = await this.#source.getProfile(userId)
        displayName = profile.displayName || "Unknown"
        pictureUrl = profile.pictureUrl
        statusMessage = profile.statusMessage
      }

      const profile: UserProfile = {
        userId,
        displayName,
        firstSeen: cached?.firstSeen || this.#now(),
        lastSeen: this.#now(),
        messageCount: (cached?.messageCount || 0) + 1,
        pictureUrl,
        statusMessage,
      }
      this.#users.set(userId, profile)
      return profile
    } catch (err) {
      this.#warn("Failed to get user profile:", err)
      return cached || null
    }
  }

  /** ชื่อกลุ่ม cache 1 ชั่วโมง · พังแล้วคืนของเก่า — `opencode` ไม่มีฟังก์ชันนี้เลยใน v1 */
  async getGroupName(groupId: string): Promise<string | null> {
    const cached = this.#groups.get(groupId)
    if (cached && this.#now() - cached.ts < this.#ttl) return cached.name
    try {
      const summary = await this.#source.getGroupSummary(groupId)
      const name = summary.groupName || null
      if (name) this.#groups.set(groupId, { name, ts: this.#now() })
      return name
    } catch {
      return cached?.name || null
    }
  }

  /** profile ที่ cache ไว้ โดยไม่ยิง API — ใช้กับ formatUserContext() */
  peekUser(userId: string): UserProfile | undefined {
    return this.#users.get(userId)
  }

  /** ล้าง entry ที่หมดอายุ — v1 ไม่มี ทำให้ Map โตไม่หยุดตลอดอายุ process */
  evictExpired(): { users: number; groups: number } {
    const t = this.#now()
    let users = 0
    let groups = 0
    for (const [k, v] of this.#users) if (t - v.lastSeen >= this.#ttl) { this.#users.delete(k); users++ }
    for (const [k, v] of this.#groups) if (t - v.ts >= this.#ttl) { this.#groups.delete(k); groups++ }
    return { users, groups }
  }

  get size(): { users: number; groups: number } {
    return { users: this.#users.size, groups: this.#groups.size }
  }
}

export type UserContextFormat = "standard" | "verbose"

/**
 * `[User: สมชาย]` — รูปแบบของ 8 ใน 9 engine
 * `"verbose"` → `[User Info: สมชาย (messages: 12)]` — รูปแบบของ `opencode`
 * ไม่มี profile → คืนสตริงว่างเหมือน v1
 */
export function formatUserContext(
  profile: UserProfile | undefined | null,
  format: UserContextFormat = "standard",
): string {
  if (!profile) return ""
  if (format === "verbose") {
    return `[User Info: ${profile.displayName} (messages: ${profile.messageCount})]`
  }
  return `[User: ${profile.displayName}]`
}

/** `[Group: ชื่อกลุ่ม]` — ไม่มีชื่อ คืนสตริงว่าง */
export function formatGroupContext(groupName: string | null | undefined): string {
  return groupName ? `[Group: ${groupName}]` : ""
}

/** `[Reply to message ID: xxx]` — ของ v1 อยู่ใน sendPrompt() ของแต่ละ engine */
export function formatQuoteContext(quotedMessageId: string | null | undefined): string {
  return quotedMessageId ? `[Reply to message ID: ${quotedMessageId}]` : ""
}
