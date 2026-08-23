# @botforge/adapter-codex

`RuntimePort` บน [`codex app-server`](https://openai.com/index/unlocking-the-codex-harness/) — **stdio JSON-RPC 2.0**

## ทำไมต้อง app-server ไม่ใช่ `spawn("codex")`

v1 มี codex สองแบบ และทั้งคู่มีปัญหาคนละอย่าง:

| template | โหมด | ปัญหา |
| --- | --- | --- |
| `bot-service-codex` | `spawn("codex", …)` **ทุก request** | ไม่มี process อยู่ยาว · จ่ายค่า startup ทุกข้อความ · state อยู่ที่ไหนไม่ชัด |
| `bot-service-codex-appserver` | `codex app-server --listen ws://…` | ใช้ transport ที่ **upstream ระบุเองว่า "Experimental, unsupported"** |

adapter นี้เอาข้อดีของแบบหลัง (process อยู่ยาว ถือ thread) มาวางบน transport ที่ upstream รับประกัน

```
stdio                ✅ stable · production-ready · ทางที่ VS Code extension และ Python SDK ใช้
--listen ws://…      ⚠️ experimental · ไม่รับประกันความเข้ากันได้ระหว่าง version
```

app-server เป็น harness เดียวกับที่ขับ Codex ทุก surface — web, CLI, IDE extension, macOS app

## ลองเลย

```bash
# ต้องมี codex CLI และล็อกอินแล้ว
node --experimental-strip-types scripts/smoke-codex.ts "ช่วยอธิบาย docker compose สั้น ๆ"

# ไม่มี codex ก็ลองได้ — ใช้ app-server ปลอมใน fixtures
BOTFORGE_CODEX_FAKE=1 node --experimental-strip-types scripts/smoke-codex.ts "ทดสอบ"
```

## โครง

| ไฟล์ | หน้าที่ |
| --- | --- |
| `jsonrpc.ts` | JSON-RPC 2.0 client แบบ line-delimited — ไม่ผูก transport |
| `stdio.ts` | spawn `codex app-server` ครั้งเดียว คุยผ่าน stdin/stdout |
| `appserver.ts` | handshake `initialize` → `initialized` |
| `prompt.ts` | ประกอบ prefix แบบ codex |
| `adapter.ts` | thread ต่อ `sessionKey` · turn · auto-approve · interrupt |

## protocol ที่ใช้

```
initialize / initialized                    handshake ครั้งเดียวต่อ connection
thread/start   {model, cwd, approvalPolicy, sandboxPolicy} → {thread:{id}}
turn/start     {threadId, input:[{type:"text",text}], …}
  ← turn/started                {turn:{id}}
  ← item/agentMessage/delta     {text}          สตรีมทีละก้อน
  ← turn/completed              {turn:{status, items, codexErrorInfo}}
  ← item/*/requestApproval      → ตอบด้วย item/*/respondApproval
turn/interrupt {threadId, turnId}            หยุด turn โดยไม่ทำลาย thread
```

`turn/interrupt` = `cancellation: graceful` ตาม `provider/v1/agent-provider` — ต่างจาก `gocode` ที่ `/abort` ไปลบ session ทิ้ง (`kill_only`)

## ⚠️ ค่าเริ่มต้นเปิดกว้างมาก — ยกมาจาก v1 ตามจริง

```ts
approvalPolicy: "never"
sandboxPolicy:  { type: "dangerFullAccess" }
autoApprove:    true      // ตอบรับทุกคำขอ command/file
```

นี่คือสิ่งที่ `bot-service-codex-appserver` ทำอยู่ **ยกมาเหมือนเดิมเพื่อไม่เปลี่ยนพฤติกรรมเงียบ ๆ**

แต่ในบริบทของ LINE bot แปลว่า **ใครก็ตามที่พิมพ์ในกลุ่มสั่งให้ agent อ่าน/เขียนไฟล์อะไรก็ได้ใน workspace**
ควรบีบให้แคบลงก่อนใช้กับ bot ที่คนนอกเข้าถึงได้:

```ts
new CodexAdapter({
  sandboxPolicy: { type: "workspaceWrite" },   // ตามที่ app-server รองรับ
  autoApprove: false,                          // แต่ต้องมีคนตอบ ไม่งั้น turn ค้าง
})
```

ปิด `autoApprove` แล้ว**ไม่มีใครตอบ** turn จะค้างจนหมดเวลา — มี test ล็อกพฤติกรรมนี้ไว้

## test

```bash
npm test --prefix packages/adapter-codex
```

25 test · **ทุกตัวคุยกับ child process จริง** ผ่าน stdio ไม่ใช่ mock ของ `spawn`

`fixtures/fake-app-server.mjs` พูด JSON-RPC เหมือนของจริง และ **จงใจเขียน stdout เป็นก้อนละ 7 ตัวอักษร**
เพื่อพิสูจน์ว่า framing ต่อเศษบรรทัดถูก — ของจริงก็ไม่รับประกันว่า chunk จะตรงขอบ message
กับ **เขียน log ที่ไม่ใช่ JSON ปนมาทาง stdout** เพราะ app-server จริงก็ทำ

## ยังไม่ได้ทำ

- ยังไม่ได้ยิง `codex app-server` ตัวจริง — เครื่องที่พัฒนาไม่มี codex CLI
  โครง protocol ถอดมาจาก `bot-service-codex-appserver` ที่ v1 เขียนไว้และพูดกับของจริงได้
- `cost_usd` — v1 ก็คืน 0 ตลอด · app-server มี usage ใน turn แต่ยังไม่ได้ map
- resume thread ข้าม restart — `thread/resume` มีใน protocol แต่ adapter ยังไม่เก็บ threadId ลง storage
