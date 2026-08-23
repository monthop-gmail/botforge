# @botforge/adapter-claude

`RuntimePort` บน **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`)

## ⚠️ Claude Agent SDK ≠ Claude API

สอง package นี้ชื่อคล้ายกันแต่คนละเรื่อง:

| | คืออะไร |
| --- | --- |
| `@anthropic-ai/sdk` | **Claude API** — คุณเขียน agent loop เอง หรือใช้ Tool Runner กับ tool ที่คุณนิยาม ไม่มี built-in tool |
| `@anthropic-ai/claude-agent-sdk` | **Claude Code ที่ห่อเป็น library** — มี built-in tool (Read/Write/Edit/Bash/Grep/WebSearch), agent loop, context management, hooks, subagent, session |

adapter นี้ห่อตัวหลัง เพราะ `bot-service-claude-code` ของ v1 ใช้ตัวนั้น
เอกสารของ Agent SDK อยู่ที่ [code.claude.com/docs/en/agent-sdk](https://code.claude.com/docs/en/agent-sdk)

## shape ที่สามของ adapter — ไม่มี IPC เลย

```
opencode   HTTP ข้าม container     process แยก
codex      stdio JSON-RPC          child process
claude     เรียก query() ตรง ๆ      process เดียวกับ core   ← ตัวนี้
```

ไม่มี transport ให้พัง ไม่มี framing ให้ต่อ ไม่มี handshake · session อยู่ฝั่ง SDK และอ้างกลับด้วย `resume`

**พิสูจน์ว่า `RuntimePort` ไม่ได้แอบสมมติว่า runtime อยู่นอก process** — ซึ่งเป็นคำถามที่ตอบไม่ได้จนกว่าจะมี adapter แบบนี้

## SDK เป็น optional peer dependency

package นี้ **ไม่บังคับให้ติดตั้ง** `@anthropic-ai/claude-agent-sdk` — `import` แบบ lazy ตอนเรียกครั้งแรก
ทำให้ typecheck และ test รันได้โดยไม่ต้องมี SDK และไม่ต้องมี API key

```ts
new ClaudeAdapter({ query })                  // ฉีดเอง — ใช้ตอน test
new ClaudeAdapter({ workspaceDir: "/workspace" })  // โหลด SDK จริงตอนเรียกครั้งแรก
```

## สิ่งที่ adapter นี้ปลดล็อก

| | ก่อนหน้านี้ | ตอนนี้ |
| --- | --- | --- |
| **`usage.cost_usd` ของจริง** | opencode ฟรี = $0 · codex ยังไม่ map | `total_cost_usd` จาก SDK ไหลเข้า `event/v1` |
| **MCP** | หมวด 11 ของ feature-matrix = 0/9 | `.mcp.json` จาก workspace ส่งเข้า SDK ได้จริง |
| **system prompt จาก workspace** | ไม่มี adapter ไหนทำ | `CLAUDE.md` + `AGENTS.md` ต่อด้วย `\n\n---\n\n` |

## port gap ที่เจอจากการเขียน adapter ตัวนี้ — `groupMemory`

v1 inject `[Group Memory]` เข้า prompt **เฉพาะตอนเปิด session ใหม่**:

```ts
if (!session && options?.groupMemory) { ... }   // bot-service-claude-code/src/index.ts:334
```

`PromptInput` ยังไม่มี field นี้ · แก้โดยให้ **core ดึงมาให้** (`deps.groupMemory`) แล้ว
**adapter เป็นคนตัดสินว่าจะ inject เมื่อไหร่** เพราะมีแต่ adapter ที่รู้ว่ามี session อยู่หรือยัง

> เป็น gap ที่สามที่เจอเพราะเขียน adapter จริง — ต่อจาก `userContext` (opencode)
> การเขียน adapter ตัวที่สองที่ shape เหมือนตัวแรกจะไม่เจออะไรแบบนี้

## แก้ audit ของตัวเองไปด้วย

ตอนทำ A1 ผมสรุปว่า feature 4.5 (session-only injection) **ไม่มีที่ไหนเลย** ซึ่ง**ผิด** —
grep หา `isNewSession|newSession` ที่ไม่มีวันเจอ เพราะโค้ดเขียนว่า `!session`

ของจริง: **อ่านไฟล์**ทุกข้อความ (เปลืองจริง) แต่ **inject** เฉพาะ session ใหม่ (ตรงตาม checklist)
แก้เป็น ⚠️ แล้วใน [`feature-matrix.md`](../../docs/architecture/feature-matrix.md) §4 · คะแนน `claude-code` 64 → 65

## ค่าเริ่มต้น — ยกมาจาก v1

```
model            "sonnet"      alias ของ SDK ไม่ใช่ model id เต็ม
maxTurns         10
maxBudgetUsd     1.00          SDK หยุดเองเมื่อประเมินว่าถึงเพดาน
permissionMode   "bypassPermissions" + allowDangerouslySkipPermissions
```

⚠️ `bypassPermissions` แปลว่า agent อ่าน/เขียนไฟล์ได้โดยไม่ถาม เหมือน `dangerFullAccess` ของ codex
ยกมาเหมือนเดิมเพื่อไม่เปลี่ยนพฤติกรรมเงียบ ๆ แต่ควรพิจารณาก่อนใช้กับ bot ที่คนนอกเข้าถึงได้

## test

```bash
npm test --prefix packages/adapter-claude
```

22 test · ฉีด SDK ปลอมที่บันทึก option ที่ถูกส่งเข้าไป จึงตรวจได้ว่า `resume` `model`
`systemPrompt` `mcpServers` ถูกส่งถูกต้อง โดยไม่ต้องมี SDK และไม่ยิงเน็ต

## ยังไม่ได้ทำ

- ยังไม่ได้ยิง SDK ตัวจริง — ไม่มี API key และไม่มี `~/.claude` ในเครื่องพัฒนา
- streaming — v1 ปล่อย `message.part.delta` ผ่าน SSE ของตัวเอง · adapter ยังคืนแต่ข้อความสุดท้าย
  (`includePartialMessages: true` ส่งไปแล้ว แต่ยังไม่ได้ใช้ event ที่ได้กลับมา)
- `maxTurns` / `maxBudgetUsd` ยังไม่ได้ map เป็น `error/v1` เมื่อชนเพดาน — ตอนนี้ตกเป็น `isError` ธรรมดา
