# Runtime Matrix

**2026-08-23** · ตอบคำถามว่า engine ไหนมี **server mode** ให้ใช้ และตัวไหนยังต้อง spawn ต่อ request

เอกสารนี้เป็นหนึ่งใน deliverable ของ Phase 0 ที่ค้างอยู่ ([`ref/botforge-v2-architecture-direction.md`](../../ref/botforge-v2-architecture-direction.md) §16)

---

## 1. โหมดของแต่ละ engine ที่ `v1-final`

| engine | โหมดจริง | process อยู่ยาว? | หลักฐาน |
| --- | --- | :-: | --- |
| `opencode` | OpenCode serve — HTTP แยก container | ✅ | `docker-compose.yml` service `opencode` |
| `claude-code` | Agent SDK **ใน process** ของ Hono | ✅ | `@anthropic-ai/claude-agent-sdk` · ไม่มี `spawn` |
| `copilot-cli` | Copilot SDK **ใน process** | ✅ | `@github/copilot-sdk` · ไม่มี `spawn` |
| `gocode` | server ที่เราเขียนเอง (Go + chi) | ✅ | `server/main.go` |
| `adkcode` | server ที่เราเขียนเอง (FastAPI + ADK) | ✅ | `server/api.py` |
| `codex-appserver` | `codex app-server --listen ws://…` | ✅ | `server/entrypoint.sh` |
| **`codex`** | **`spawn("codex", …)` ต่อ request** | ❌ | `server/src/codex.ts:53` |
| **`gemini-cli`** | **`spawn()` ต่อ request** | ❌ | `server/src/gemini.ts` |
| **`qwen-code`** | **`spawn()` ต่อ request** | ❌ | `server/src/qwen.ts` |

**3 ตัวที่ยัง spawn ต่อ request** — `codex` · `gemini-cli` · `qwen-code`

---

## 2. upstream มี server mode ให้ไหม

| CLI | server mode | สถานะ | ใช้ได้เลยไหม |
| --- | --- | --- | :-: |
| **Codex** | `codex app-server` | JSON-RPC 2.0 · harness เดียวกับที่ขับ Codex ทุก surface (web · CLI · IDE · macOS) | ✅ |
| **Qwen Code** | `qwen serve` | HTTP + SSE · ship ตั้งแต่ v0.16-alpha · Stage 1 merged พ.ค. 2026 · **experimental** | ⚠️ |
| **Gemini CLI** | daemon mode | [PR #20700](https://github.com/google-gemini/gemini-cli/pull/20700) **ยังไม่ merge** (เปิดค้างตั้งแต่ มิ.ย. 2026 · unix socket) | ❌ |
| **Claude Code** | *(ไม่มี HTTP API server)* | Agent SDK คือ surface ที่ถูกต้อง — ดู §6 | ✅ ผ่าน SDK |

> ⚠️ ผลค้นหาเว็บสรุปว่า Gemini CLI *"has introduced daemon mode"* — **ไม่จริง** ต้องเปิด PR ดูเองถึงเห็นว่ายังไม่ merge ติด security review + CI แดง

---

## 3. transport ของ Codex app-server — จุดที่ v1 เลือกผิด

app-server มีสอง transport และคุณภาพต่างกันชัด:

| transport | สถานะจาก upstream |
| --- | --- |
| **stdio** (spawn child ครั้งเดียว · newline-delimited JSON บน stdin/stdout) | ✅ **stable · production-ready** — ทางที่ VS Code extension และ Python SDK ใช้ |
| `--listen ws://…` | ⚠️ **"Experimental, unsupported"** — ไม่รับประกันความเข้ากันได้ระหว่าง version |

`bot-service-codex-appserver/server/entrypoint.sh` ใช้:

```bash
codex app-server --listen "ws://0.0.0.0:$PORT" &
```

คือตัวที่ upstream เขียนเองว่าไม่ซัพพอร์ต · template นี้มี **0 project ใช้จริง** จาก 14

**V2 ใช้ stdio** — ดู [`packages/adapter-codex`](../../packages/adapter-codex/)

---

## 4. แผน

| engine | ทำอะไร | สถานะ |
| --- | --- | :-: |
| `opencode` | adapter บน OpenCode serve | ✅ [`adapter-opencode`](../../packages/adapter-opencode/) |
| `codex` + `codex-appserver` | **ยุบเป็นตัวเดียว** บน app-server/stdio | ✅ [`adapter-codex`](../../packages/adapter-codex/) |
| `claude-code` | SDK อยู่ใน process แล้ว — ห่อเป็น adapter | ✅ [`adapter-claude`](../../packages/adapter-claude/) |
| `copilot-cli` | ต่างจาก `claude-code` แค่ 41 diff-lines — น่าจะได้เกือบฟรี | ⬜ |
| `adkcode` | server ของเราเอง (FastAPI + ADK) — **multi-agent ตัวเดียวใน 9** | ✅ [`adapter-adkcode`](../../packages/adapter-adkcode/) |
| `gocode` | server ของเราเอง (Go + chi) · ไม่มี project ใช้ | ⬜ |
| `qwen-code` | รอ `qwen serve` ออกจาก experimental (Stage 2 ทำ WebSocket/OpenAPI) | ⬜ |
| `gemini-cli` | ยังไม่มีทางเลือก — spawn ต่อไปจนกว่า PR merge | ⬜ |

การยุบ `codex` + `codex-appserver` ตรงกับ Q3 ที่ตัดสินไว้ว่ายุบได้ และตรงกับที่ [`current-state.md`](current-state.md) §2.1 วัดได้ว่าฝั่ง bot ของสองตัวนี้ **เหมือนกันทุก byte**

`RuntimePort` รองรับทั้งสองแบบอยู่แล้ว — adapter ที่ spawn ต่อ request ก็ implement `sendPrompt()` ได้เหมือนกัน ต่างแค่ประสิทธิภาพ

---

## 5. Claude Code — สำรวจเมื่อ 2026-08-23

**ไม่มี HTTP server mode แบบที่ `opencode serve` หรือ `codex app-server` เป็น**

| surface | เป็น server mode ให้ Botforge ไหม |
| --- | --- |
| `claude -p` (headless) | ❌ one-shot · รันจบแล้ว exit |
| `claude -c` / `--resume` | ⚠️ session อุ่นข้าม invocation ได้ แต่ยัง one-shot ต่อครั้ง |
| `claude --bg` + `claude daemon` | ⚠️ supervisor ของ background session — ไม่ใช่ API ให้ต่อ |
| `claude remote-control` | ⚠️ HTTP จริง แต่ **ผูกกับ TTY** — ดูข้างล่าง |
| `claude gateway` | ❌ SSO/policy proxy สำหรับองค์กร (Bedrock/Vertex/Foundry) ไม่ใช่ runtime API |
| `claude mcp serve` | ❌ **ไม่มีแล้ว** — `claude mcp` เหลือแค่ config ฝั่งที่ Claude Code ไปต่อ |
| **Claude Agent SDK** | ✅ **surface ที่ถูกต้อง — [`adapter-claude`](../../packages/adapter-claude/) ใช้อยู่แล้ว** |

### `remote-control` ทำไมใช้ไม่ได้

มีจริงและเป็น HTTP (ควบคุมจาก claude.ai หรือมือถือ) แต่ยังต้องมี TTY —
[claude-code#30447](https://github.com/anthropics/claude-code/issues/30447) ขอ `--headless` **ยังเปิดค้าง**
ตั้งแต่ 2026-03-03 · คอมเมนต์ล่าสุด 2026-08-06 มีคนแปะ systemd unit + log filter + watchdog
ที่เขียนขึ้นมาเพราะ *"the TUI isn't daemon-friendly; a `--headless` mode would delete most of it"*

รันใน container ไม่ได้จริง

> **ข้อสรุป: ไม่ต้องเปลี่ยน `adapter-claude`** — ต่างจากเคส codex ที่ v1 เลือก transport ที่ upstream ไม่ซัพพอร์ต

---

## 6. ⚠️ Claude Code มี **channels** แล้ว — ทับกับสิ่งที่ Botforge ทำ

[channels](https://code.claude.com/docs/en/channels) คือ MCP server ที่ **push ข้อความจากภายนอกเข้า session ที่รันอยู่**
แล้ว Claude ตอบกลับทางเดิมได้ พร้อม pairing · sender allowlist · permission relay

```bash
claude --channels plugin:telegram@claude-plugins-official
```

**นี่คือสิ่งที่ Botforge ทำ** ในรูปแบบ first-party

### ที่ยังต่างกัน

| | Claude Code channels | Botforge |
| --- | --- | --- |
| **LINE** | ❌ ไม่มี — มีแต่ Telegram · Discord · iMessage · fakechat | ✅ 14 bot ที่รันจริง |
| จำนวน session | **หนึ่ง session ที่รันอยู่** — event มาถึงเฉพาะตอนเปิดอยู่ | หลาย bot × หลาย group แยก session |
| runtime | ผูกกับ Claude · ใช้บน Bedrock/Vertex/Foundry ไม่ได้ | 9 engine |
| deployment | ผู้ใช้รัน terminal ค้างไว้เอง | Docker + Cloudflare tunnel + CLI จัดการหลาย bot |
| สถานะ | **research preview** — flag/protocol เปลี่ยนได้ · ไม่โผล่ใน `claude --help` | — |

> ตรวจรายการ plugin จริงที่ [`claude-plugins-official/external_plugins`](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins) แล้ว —
> asana · context7 · discord · fakechat · firebase · github · gitlab · greptile · imessage ·
> laravel-boost · linear · playwright · serena · telegram · terraform
>
> **ไม่มี LINE** (ตอนแรก grep `line` ไปจับ `linear` เข้า — false positive)

### อ่านได้สองแบบ

1. **ยืนยันว่าทิศทาง V2 ถูก** — Anthropic มองว่า channel → agent session เป็น pattern ที่ควรมี first-party
2. **แต่เป็นสัญญาณด้วย** — ถ้า LINE plugin โผล่มาเมื่อไหร่ ส่วนที่ทับกันจะมากขึ้น
   สิ่งที่ Botforge ถือไว้จริงคือ **multi-runtime · multi-bot · deployment** ไม่ใช่ตัว bridge เอง

มี [`channels-reference`](https://code.claude.com/docs/en/channels-reference) ให้เขียน channel เอง —
ทำ LINE channel เสียบเข้า Claude Code ได้ แต่เป็นคนละ product shape
(session เดียวบนเครื่องผู้ใช้ vs. โรงงาน bot หลายตัวที่ deploy ให้ลูกค้า)

---

## 7. ที่มา

- [OpenAI — Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/)
- [codex app-server developer guide](https://gist.github.com/oneryalcin/ee2c27e2d8aa040da8fbe7eebcc2ecea) — ที่มาของเรื่อง transport
- [gemini-cli PR #20700](https://github.com/google-gemini/gemini-cli/pull/20700)
- [Qwen Code — daemon mode (`qwen serve`)](https://qwenlm.github.io/qwen-code-docs/en/users/qwen-serve/)
- [Claude Code — CLI reference](https://code.claude.com/docs/en/cli-reference) · [channels](https://code.claude.com/docs/en/channels) · [channels-reference](https://code.claude.com/docs/en/channels-reference)
- [claude-code#30447](https://github.com/anthropics/claude-code/issues/30447) — `remote-control --headless` ยังเปิดค้าง
