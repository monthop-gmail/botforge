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
| `gocode` · `adkcode` | server ของเราเอง — ห่อเป็น adapter | ⬜ |
| `qwen-code` | รอ `qwen serve` ออกจาก experimental (Stage 2 ทำ WebSocket/OpenAPI) | ⬜ |
| `gemini-cli` | ยังไม่มีทางเลือก — spawn ต่อไปจนกว่า PR merge | ⬜ |

การยุบ `codex` + `codex-appserver` ตรงกับ Q3 ที่ตัดสินไว้ว่ายุบได้ และตรงกับที่ [`current-state.md`](current-state.md) §2.1 วัดได้ว่าฝั่ง bot ของสองตัวนี้ **เหมือนกันทุก byte**

`RuntimePort` รองรับทั้งสองแบบอยู่แล้ว — adapter ที่ spawn ต่อ request ก็ implement `sendPrompt()` ได้เหมือนกัน ต่างแค่ประสิทธิภาพ

---

## 5. ที่มา

- [OpenAI — Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/)
- [codex app-server developer guide](https://gist.github.com/oneryalcin/ee2c27e2d8aa040da8fbe7eebcc2ecea) — ที่มาของเรื่อง transport
- [gemini-cli PR #20700](https://github.com/google-gemini/gemini-cli/pull/20700)
- [Qwen Code — daemon mode (`qwen serve`)](https://qwenlm.github.io/qwen-code-docs/en/users/qwen-serve/)
