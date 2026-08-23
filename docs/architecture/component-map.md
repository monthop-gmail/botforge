# Botforge — Component Map

**Phase 0 Audit** · 2026-08-23 · คู่กับ [`current-state.md`](current-state.md)

---

## 1. Component จริงในวันนี้

```text
server-botforge/
│
├── botforge              bash 613   ── generator      new · sync · list
├── botforge-deploy       bash 823   ── orchestrator   up/down/rebuild/status/logs/tunnel
├── botforge-models       bash 209   ── model fetcher  7 provider
│
├── templates/
│   ├── bot-service-*  (9 ใช้ได้ + 1 ว่าง)
│   │      └── src/index.ts   662–900 บรรทัด  ← ทุกอย่างอยู่ในไฟล์นี้
│   │      └── server/        runtime ของ engine นั้น (TS / Go / Python)
│   └── workspace/            AGENTS.md + README.md เท่านั้น
│
└── projects/  (14 git repo แยก)
       └── <name>/bot-service/  ← สำเนาของ template ต่างกัน 1 บรรทัด
```

**ไม่มี component ใดที่ถูก import ซ้ำ** — ทุกการใช้ซ้ำเกิดจากการ copy ไฟล์

---

## 2. Dependency ปัจจุบัน

```text
        botforge new
             │  copy ไฟล์ + แทน {{PLACEHOLDER}}
             ▼
      projects/<name>/            ◄──── botforge sync --full
             │                            (copy ทับ ไม่มี version)
             ▼
      docker-compose.yml
             │
   ┌─────────┼──────────┐
   ▼         ▼          ▼
line-bot   server   cloudflared
(index.ts) (engine)  (tunnel)
   │         ▲
   │  HTTP   │
   └─────────┘

   ▲
   │ LINE Messaging API (webhook / reply / push / profile)
```

จุดที่ต้องสังเกต: **ไม่มีลูกศรไหนเป็น dependency จริง** — เป็นการ copy ทั้งหมด ยกเว้น HTTP ระหว่าง container

---

## 3. `src/index.ts` — แยกตามความผูกพันกับ runtime

จาก §4 ของ `current-state.md` — จัดกลุ่มว่าอะไรควรไปอยู่ไหน

### 3.1 ไม่ผูกกับ runtime → `@botforge/core`

| กลุ่ม | Function | มีในทุก template | เข้า core แล้ว |
| --- | --- | :---: | :---: |
| Channel — LINE transport | `validateSignature()` `sendMessage()` `chunkText()` | ✓ | ✅ ยกแล้ว |
| Channel — routing | `getSessionKey()` `isBotMentioned()` | ✓ | ✅ ยกแล้ว |
| Channel — events | `handleJoinEvent()` `handleLeaveEvent()` `handleImageMessage()` | ✓ | ⬜ |
| Session | `enqueueForSession()` · `interface UserSession` | ✓ (6/9) | ✅ ยกแล้ว |
| Context | `getUserProfile()` `getUserContext()` `getTimeContext()` `getGroupName()` | ✓ | ✅ ยกแล้ว |
| Context — memory | `getGroupMemory()` | claude-code, copilot-cli | ⬜ |
| Error | `getErrorHint()` | ✓ (8/9) | ✅ ยกแล้ว |
| Logging | `log()` (Bangkok TZ) | ✓ | ✅ ยกแล้ว (`logTimestamp`) |
| **Audit** | *(v1 ไม่มีเลย)* | ✗ | ✅ ใหม่ — `events/` ปล่อย `event/v1` |

> `chunkText()` มี code-block balancing (ปิด ``` ที่ค้าง) อยู่ในทุกไฟล์ — logic แบบนี้แหละที่ไม่ควรมี 23 สำเนา

### 3.2 ผูกกับ runtime → `RuntimeAdapter`

| Function | opencode | gocode | adkcode | codex-family | claude-family |
| --- | --- | --- | --- | --- | --- |
| transport | `opencodeRequest()` | `gocodeRequest()` | `adkcodeRequest()` | `serverRequest()` | `serverRequest()` |
| `createSession()` | ✓ | ✓ | ✓ (ต้องมี userId) | ✓ | ✓ |
| `sendPrompt()` | รับ `PromptContent` + model | รับ string + options | ✓ | ✓ | ✓ + cost |
| `extractResponse()` | text/tool/reasoning parts | ✓ | ✓ | ✓ | ✓ + `is_error` |
| `abortSession()` | ✓ | — | — | — | — |
| `waitForServer()` | `waitForOpenCode()` | ✓ | ✓ | — | — |

**ขนาดจริงของ adapter = 4–6 function** ไม่ใช่ 662–900 บรรทัด

### 3.3 ผสมกัน → ต้องผ่าตัด

`handleTextMessage()` · **232–243 บรรทัด** · มีในทุก template

```text
handleTextMessage()
├── text.trim() + command routing        ← core
│     /new /abort /sessions /model /about /help /cost
├── group [SKIP] handling                 ← core
├── context injection                     ← core
│     [User:] [Time:] [Group:] [Reply to:]
├── createSession / sendPrompt            ← adapter
├── extractResponse                       ← adapter
├── error → getErrorHint → ข้อความไทย      ← core
└── chunk + reply/push                    ← core
```

**นี่คือ blocker เดียวที่แท้จริงของการแยก layer** — โครง folder ที่ doc V2 §Phase 2 วางไว้ ทำเสร็จได้ใน 10 นาที แต่ถ้า `handleTextMessage()` ยังเป็นก้อนเดียว การแยกนั้นก็เป็นแค่การย้ายไฟล์

> **แก้แล้ว 2026-08-23** — แยกเป็น `router/commands.ts` (parse) · `router/model.ts` (เลือก model)
> · `router/response.ts` (`[SKIP]` · การต่อท้ายว่าโดนตัด) · `router/turn.ts` (pipeline)
> runtime อยู่หลัง `RuntimePort` ตัวเดียว · channel อยู่หลัง `LineTransport`
> 110 test ผ่าน ดู [`packages/core/README.md`](../../packages/core/README.md)

---

## 4. ขอบเขตที่เสนอ

```text
┌─────────────────────────────────────────────────┐
│ @botforge/core                                  │
│                                                 │
│  ChannelAdapter ◄── LineChannel (ของเดิม 100%)  │
│  SessionStore   ◄── enqueue · timeout · abort    │
│  ContextBuilder ◄── user · time · group · reply  │
│  CommandRouter  ◄── /new /model /abort ...       │
│  ErrorMapper    ◄── getErrorHint (ไทย)           │
│  Chunker        ◄── LINE 5000 + code fence       │
│                                                 │
│              RuntimeAdapter (interface)          │
└──────────────────────┬──────────────────────────┘
                       │
   ┌────────┬──────────┼──────────┬────────────┐
   ▼        ▼          ▼          ▼            ▼
opencode  claude   codex-family  gocode     adkcode
                   (รวม 4 ตัว)
```

**ผลที่ควรได้:** template แต่ละตัวเหลือ ~50–80 บรรทัด (config + adapter) จาก 662–900

**ตัวเลขที่ควรใช้วัดว่าสำเร็จ:** แก้ bug ใน `chunkText()` แล้วต้องแตะ **1 ไฟล์** ไม่ใช่ 23

---

## 5. Mapping ไปยัง contract ของ `agent-platform`

`poc-agent-platform/contracts/` มี 15 ตระกูลพร้อม CHANGELOG อยู่แล้ว — ตารางนี้คือ **ร่างแรก** ยังไม่ verify ราย field (เป็นงาน Phase 1)

| Botforge ต้องการ | Contract ที่มีอยู่แล้ว | หมายเหตุ |
| --- | --- | --- |
| RuntimeContract | `provider/v1/agent-provider.schema.yaml` + `execution/v1` | **ห้ามเขียนใหม่** |
| EventContract | `event/v1` | มี consumer จริง 3 ราย · `care-agent-platform` ต่อ `care-event/v1` เป็นตัวอย่างการ extend |
| SessionContract | `execution/v1` + `identity/v1` | ถ้าไม่พอ → เสนอ ADR แบบที่ `care-agent-platform` เสนอ `consent/v1` (ADR-0012) |
| ToolContract | `tool/v1` · `mcp/v1` | Botforge เป็น consumer ไม่ใช่เจ้าของ |
| WorkspaceContract | `profile/v1` | workspace ปัจจุบันมีแค่ `AGENTS.md` — ห่างจาก `profile/v1` พอสมควร |
| Model registry | `model/v1` · `provider/v1/model-provider` | `botforge-models` ทำ fetch อยู่แล้ว แต่ไม่มี schema |
| Error | `error/v1` | ตอนนี้ `getErrorHint()` คืน string ไทย ไม่ใช่ object |
| **ChannelContract** | **ไม่มีใครเป็นเจ้าของ** | เป็นของ Botforge จริง — แต่ทำเป็น **extension ของ repo เอง ไม่เสนอเข้า platform** ดู [`contract-mapping.md`](contract-mapping.md) §6 |

> ข้อสรุป: Phase 1 ควรเป็น **mapping** ไม่ใช่ **authoring** — สิ่งที่ต้องเขียนใหม่จริง ๆ มีแค่ ChannelContract
>
> **แก้เพิ่ม 2026-08-23 (Phase 1):** ตาราง mapping นี้ยืนยันแล้วราย field ที่ [`contract-mapping.md`](contract-mapping.md)
> — แต่ข้อสรุปเรื่อง ChannelContract **เปลี่ยน**: มันตกเกณฑ์รับ contract ใหม่ของ `agent-platform`
> ข้อ 2 (ต้องมี consumer 2 ราย) และข้อ 4 (platform ต้องเข้าใจ semantics)
> จึงต้องเป็น **extension ของ Botforge เอง** แบบ `care-event/v1` ไม่ใช่ contract ของ ecosystem

---

## 6. ลำดับที่เสนอ

```text
Phase 0    Audit                        ← เอกสารสองใบนี้
Phase 0.5  platform-contract.yaml + drift_check เข้า CI
           (ประกาศ contracts: น้อย ๆ ที่เหลือใส่ not_yet:)
Phase 1    Mapping → ADR เฉพาะที่ขาดจริง (ChannelContract)
Phase 1.5  De-duplicate → @botforge/core        ← ขั้นที่หายไปจาก doc เดิม
           เกณฑ์ผ่าน: แก้ chunkText() แตะไฟล์เดียว
Phase 2    จัดโครง core/ agents/ sessions/ ... ตาม doc V2
Phase 3    RuntimeAdapter ครบทุก engine
Phase 4    Agent Platform runtime เป็นทางเลือกที่สอง
Phase 5    Multi-channel
```

เทียบกับ doc เดิม — ต่างกัน 3 จุด:

1. **Phase 0.5 ย้ายขึ้นมาจาก Phase 4** — เข้าทะเบียน consumer ตั้งแต่ต้น ให้ drift เป็น CI แดงแทนที่จะเป็นข้อถกเถียง
2. **Phase 1 เปลี่ยนจาก author เป็น map** — contract 15 ตระกูลมีอยู่แล้ว เขียนใหม่ = เป็น Agent Platform ตัวที่สอง ซึ่งขัดกฎข้อ 4 ของ doc เอง
3. **Phase 1.5 เป็นของใหม่** — ไม่มีในแผนเดิม แต่ Definition of Done ทำไม่ได้ถ้าไม่ผ่านขั้นนี้

หลักการเดิม `Preserve → Contract → Isolate → Integrate → Expand` ยังใช้ได้ — แค่อ่าน **Contract** ว่า *adopt* ไม่ใช่ *author* และเพิ่ม **De-duplicate** ก่อน *Isolate*

---

## 7. งานที่ยังไม่ได้ทำใน audit นี้

| # | เรื่อง | ทำไมสำคัญ |
| --- | --- | --- |
| A1 | กรอก `bot-feature-checklist.md` ทั้ง 81 ช่องจาก source จริง | ตัวเลข "81 feature" ยังไม่เคย verify |
| A2 | อ่าน `server/` ของแต่ละ engine (~6,000 บรรทัด TS/Go/Python) | audit นี้เจาะที่ `src/index.ts` เป็นหลัก |
| A3 | ตรวจ git history ของ 14 project repo หา credential รั่ว | R6 ใน `current-state.md` |
| A4 | Verify contract ราย field กับ `agent-platform` | §5 ยังเป็นร่าง |
