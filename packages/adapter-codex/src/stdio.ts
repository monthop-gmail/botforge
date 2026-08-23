/**
 * transport แบบ stdio — spawn `codex app-server` ครั้งเดียวแล้วคุยผ่าน stdin/stdout
 *
 * นี่คือ transport ที่ upstream ระบุว่า stable · ต่างจาก `--listen ws://…`
 * ที่เอกสารของ Codex เขียนเองว่า "Experimental, unsupported"
 * (v1 `bot-service-codex-appserver` ใช้ ws — ดู README)
 *
 * process อยู่ยาวตลอดอายุ adapter ไม่ได้ spawn ใหม่ทุก request แบบ
 * `bot-service-codex` ที่เรียก `spawn("codex", …)` ต่อหนึ่งข้อความ
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import type { LineDelimitedTransport } from "./jsonrpc.ts"

export interface StdioOptions {
  command?: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** stderr ของ app-server — ไม่ใช่ช่องทาง protocol แต่มี log ที่ต้องดูตอน debug */
  onStderr?: (chunk: string) => void
  onExit?: (code: number | null, signal: string | null) => void
}

export class StdioTransport implements LineDelimitedTransport {
  readonly child: ChildProcessWithoutNullStreams
  #buffer = ""
  #lineHandler: ((line: string) => void) | undefined
  #closeHandler: ((reason?: string) => void) | undefined
  #closed = false

  constructor(options: StdioOptions = {}) {
    const command = options.command ?? "codex"
    const args = options.args ?? ["app-server"]
    this.child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    })

    this.child.stdout.setEncoding("utf8")
    this.child.stdout.on("data", (chunk: string) => this.#onChunk(chunk))

    this.child.stderr.setEncoding("utf8")
    this.child.stderr.on("data", (chunk: string) => options.onStderr?.(chunk))

    this.child.on("exit", (code, signal) => {
      options.onExit?.(code, signal)
      this.#fireClose(`app-server จบการทำงาน (code=${code} signal=${signal})`)
    })
    this.child.on("error", (err) => this.#fireClose(`spawn ไม่สำเร็จ: ${err.message}`))
  }

  /**
   * framing เป็น newline-delimited — chunk ที่ได้จาก stdout ไม่ตรงกับขอบ message
   * ต้องเก็บเศษไว้ต่อกับ chunk ถัดไป ไม่งั้น JSON จะขาดกลาง
   */
  #onChunk(chunk: string): void {
    this.#buffer += chunk
    let index: number
    while ((index = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, index)
      this.#buffer = this.#buffer.slice(index + 1)
      if (line.trim()) this.#lineHandler?.(line)
    }
  }

  send(line: string): void {
    if (this.#closed) throw new Error("transport ปิดแล้ว")
    this.child.stdin.write(line + "\n")
  }

  onLine(handler: (line: string) => void): void {
    this.#lineHandler = handler
  }

  onClose(handler: (reason?: string) => void): void {
    this.#closeHandler = handler
  }

  close(): void {
    if (this.#closed) return
    this.child.stdin.end()
    this.child.kill("SIGTERM")
    // ไม่ยอมตายใน 3 วิ ค่อยบังคับ — เหมือนที่ v1 ทำกับ spawn ต่อ request
    const t = setTimeout(() => { if (!this.child.killed) this.child.kill("SIGKILL") }, 3000)
    t.unref?.()
    this.#fireClose("ปิดโดยผู้เรียก")
  }

  #fireClose(reason: string): void {
    if (this.#closed) return
    this.#closed = true
    this.#closeHandler?.(reason)
  }
}
