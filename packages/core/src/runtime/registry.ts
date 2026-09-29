/**
 * ทะเบียน session ที่อยู่รอดข้าม process — ช่องว่างข้อที่ใหญ่ที่สุดของ V2
 *
 * วันนี้ (ก่อนไฟล์นี้) session → runtime อยู่ใน `Map` ของ adapter ทุกตัว
 *   adapter-adkcode:36 · adapter-claude:40 · adapter-codex:35 · adapter-opencode:31
 * และค้นทั้ง `packages/*​/src` ไม่มี sqlite / jsonl / writeFile เลยสักที่
 * แปลว่า **restart แล้วบทสนทนาทุกห้องเริ่มใหม่หมด** โดยไม่มีใครรู้ว่าเคยมีอะไรอยู่
 *
 * รายงานหลักฐานไว้ที่ dis-f1f037c7 seq 9 — เกณฑ์ Persistent Autonomous Participant
 * ของ seq 7 ข้อ "recover across runtime/process restart" จึงเป็น 🔴 มาตลอด
 *
 * ไฟล์นี้ไม่ทำให้ adapter ตัวไหนคงทนโดยอัตโนมัติ — มันให้ **ที่เก็บ** กับ **สัญญา**
 * ส่วน adapter ต้องประกาศ capability `persistence` แล้วใช้มันจริง ซึ่งเทส conformance
 * เป็นคนบังคับ (ดู `conformance.ts`)
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { RuntimeSessionInfo } from "./capabilities.ts"

export interface SessionRegistry {
  get(sessionKey: string): Promise<RuntimeSessionInfo | undefined>
  put(info: RuntimeSessionInfo): Promise<void>
  delete(sessionKey: string): Promise<void>
  list(): Promise<readonly RuntimeSessionInfo[]>
}

/** ที่เก็บในหน่วยความจำ — พฤติกรรมเท่าของเดิม ใช้เป็นฐานเทียบและใช้ในเทส */
export class MemorySessionRegistry implements SessionRegistry {
  readonly #rows = new Map<string, RuntimeSessionInfo>()

  async get(sessionKey: string): Promise<RuntimeSessionInfo | undefined> {
    return this.#rows.get(sessionKey)
  }
  async put(info: RuntimeSessionInfo): Promise<void> {
    this.#rows.set(info.sessionKey, info)
  }
  async delete(sessionKey: string): Promise<void> {
    this.#rows.delete(sessionKey)
  }
  async list(): Promise<readonly RuntimeSessionInfo[]> {
    return [...this.#rows.values()]
  }
}

/**
 * ที่เก็บเป็นไฟล์ JSON หนึ่งใบ — พอสำหรับ service process ของ Botforge หนึ่งตัว
 *
 * เลือกไฟล์เดียวไม่ใช่ sqlite เพราะ:
 *   · ทะเบียนนี้มีขนาดเท่าจำนวนห้องที่คุย (หลักสิบ ไม่ใช่หลักแสน)
 *   · เขียนทุกครั้งที่ผูก session ใหม่เท่านั้น ไม่ใช่ทุกข้อความ
 *   · ไม่เพิ่ม dependency ให้ของที่ต้อง deploy ใน container เล็ก ๆ
 * ถ้าวันหนึ่งมีหลาย process เขียนพร้อมกัน ต้องเปลี่ยนไป sqlite/redis —
 * เขียนไว้ตรงนี้เพราะตอนนั้นจะมีคนถามว่าทำไมตอนแรกไม่ใช้
 *
 * 🔒 การเขียนเป็น atomic — เขียนลงไฟล์ชั่วคราวแล้ว `rename()` ทับ
 *    ถ้า process ตายกลางทาง ไฟล์เดิมยังอ่านได้ ไม่ได้ครึ่ง ๆ กลาง ๆ
 */
export class FileSessionRegistry implements SessionRegistry {
  readonly #path: string
  readonly #log: (...args: unknown[]) => void
  #rows: Map<string, RuntimeSessionInfo> | null = null

  constructor(options: { path: string; log?: (...args: unknown[]) => void }) {
    this.#path = options.path
    this.#log = options.log ?? (() => {})
  }

  /** โฟลเดอร์สถานะของ service — `BOTFORGE_STATE_DIR` ไม่ตั้งก็ใช้ `data/` */
  static fromEnv(env: Record<string, string | undefined> = process.env,
                 log?: (...args: unknown[]) => void): FileSessionRegistry {
    const dir = env.BOTFORGE_STATE_DIR ?? "data"
    return new FileSessionRegistry({ path: join(dir, "sessions.json"), log })
  }

  async #load(): Promise<Map<string, RuntimeSessionInfo>> {
    if (this.#rows) return this.#rows
    const rows = new Map<string, RuntimeSessionInfo>()
    let raw: string
    try {
      raw = await readFile(this.#path, "utf8")
    } catch {
      this.#rows = rows        // ยังไม่มีไฟล์ = ยังไม่เคยมี session ไม่ใช่ error
      return rows
    }
    try {
      const parsed = JSON.parse(raw)
      const list: unknown[] = Array.isArray(parsed) ? parsed : parsed?.sessions ?? []
      for (const r of list) if (isSessionInfo(r)) rows.set(r.sessionKey, r)
      if (list.length !== rows.size) {
        // แถวที่รูปไม่ครบถูกทิ้ง — ต้องดัง ไม่ใช่หายเงียบ
        this.#log(
          `session registry: ทิ้ง ${list.length - rows.size} แถวที่รูปไม่ครบจาก ${this.#path}`,
        )
      }
    } catch (e) {
      // 🔴 ไฟล์เสีย — ไม่ลบทิ้งและไม่เงียบ · ย้ายไปไว้ข้าง ๆ แล้วเริ่มใหม่จากว่าง
      //    ถ้าลบทิ้งเงียบ ๆ เราจะไม่รู้เลยว่าเคยมีบทสนทนาอยู่กี่ห้อง
      const quarantine = `${this.#path}.corrupt-${Date.now()}`
      await rename(this.#path, quarantine).catch(() => {})
      this.#log(
        `session registry: อ่าน ${this.#path} ไม่ออก (${(e as Error).message}) — ` +
          `ย้ายไปไว้ที่ ${quarantine} แล้วเริ่มจากทะเบียนว่าง ` +
          `· บทสนทนาที่เคยมีจะไม่ถูก resume รอบนี้`,
      )
    }
    this.#rows = rows
    return rows
  }

  async #flush(rows: Map<string, RuntimeSessionInfo>): Promise<void> {
    const body = JSON.stringify(
      { version: 1, sessions: [...rows.values()] },
      null,
      2,
    )
    await mkdir(dirname(this.#path), { recursive: true })
    const tmp = `${this.#path}.tmp-${process.pid}`
    await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 })
    try {
      await rename(tmp, this.#path)
    } catch (e) {
      await unlink(tmp).catch(() => {})
      throw e
    }
  }

  async get(sessionKey: string): Promise<RuntimeSessionInfo | undefined> {
    return (await this.#load()).get(sessionKey)
  }
  async put(info: RuntimeSessionInfo): Promise<void> {
    const rows = await this.#load()
    rows.set(info.sessionKey, info)
    await this.#flush(rows)
  }
  async delete(sessionKey: string): Promise<void> {
    const rows = await this.#load()
    if (!rows.delete(sessionKey)) return
    await this.#flush(rows)
  }
  async list(): Promise<readonly RuntimeSessionInfo[]> {
    return [...(await this.#load()).values()]
  }
}

function isSessionInfo(v: unknown): v is RuntimeSessionInfo {
  if (typeof v !== "object" || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.sessionKey === "string" && r.sessionKey !== "" &&
    typeof r.runtimeName === "string" && r.runtimeName !== "" &&
    typeof r.runtimeSessionId === "string" && r.runtimeSessionId !== "" &&
    typeof r.createdAt === "string" && typeof r.lastUsedAt === "string"
  )
}
