# Botforge → Agent Platform — Contract Mapping

**Phase 1** · 2026-08-23 · ต่อจาก [`feature-matrix.md`](feature-matrix.md)
**Source:** `../poc-agent-platform/contracts/` @ `2026-08-22` — 15 ตระกูล · schema รวม 1,808 บรรทัด
**ขอบเขต:** map ของที่ Botforge มีอยู่แล้วเข้ากับ contract ที่มีอยู่แล้ว — **ไม่ใช่การออกแบบ contract ใหม่**

> ตาม [`contracts/README.md`](../../../poc-agent-platform/contracts/README.md) contract ทั้งหมด**ผูกพัน** และแก้ได้ผ่าน ADR ที่ `agent-platform` เท่านั้น
> repo ลูกที่อยากเปลี่ยนต้องเปิด issue ที่นั่น ไม่ใช่แก้ในบ้านตัวเอง

---

## สรุป

| กลุ่ม | จำนวน | ความหมาย |
| --- | ---: | --- |
| **A. map ได้ตรง** | 5 contract | มีของเดิมอยู่แล้ว แค่เปลี่ยนรูป |
| **B. ต้องออกแบบเพิ่มก่อน map** | 3 contract | ของเดิมมีบางส่วน ขาด concept สำคัญ |
| **C. ไม่มีของเดิมเลย** | 4 contract | implement ใหม่ตาม contract ตั้งแต่ต้น (ง่ายกว่า migrate) |
| **D. ไม่ควรเสนอเข้า platform** | 1 | ChannelContract — เหตุผลที่ §6 |

**Blocker 2 ข้อที่ต้องตัดสินใจก่อนเขียนโค้ดบรรทัดแรก:** `identity` ของ LINE (§5.1) และ tenant ที่ยังไม่มี (§5.2)

---

## 1. หมวดของ Botforge → contract

จาก 12 หมวดใน [`feature-matrix.md`](feature-matrix.md)

| หมวด Botforge | Contract | กลุ่ม | หมายเหตุ |
| --- | --- | :-: | --- |
| 6. Error Handling | `error/v1` | **A** | `getErrorHint()` มี taxonomy 5 แบบตรงกับ `Category` เกือบหมด — §4.1 |
| 2. Session (บางส่วน) | `execution/v1` | **B** | มี session แต่ไม่มี state machine — §4.3 |
| 3. LINE Integration | *(ไม่มี — เป็นของ Botforge)* | **D** | §6 |
| 4. Group Chat | *(ไม่มี — เป็นของ Botforge)* | **D** | subject ของ group อยู่ที่ `identity/v1` ได้ แต่ semantics เป็นของ channel |
| 5. Context Enrichment | `identity/v1#Principal` | **B** | user profile → `Principal` ได้ แต่ id ผิด pattern — §5.1 |
| 2.10 / 5.6 Cost | `model/v1#/$defs/Usage` | **A** | `cost_usd` ชื่อตรงกันเป๊ะ |
| 1. Bot Commands | *(ไม่มี)* | **D** | เป็น UX ของ channel |
| 9. Infrastructure | *(ไม่มี)* | — | deployment เป็นของ Botforge ตาม boundary เดิม |
| 10. Auth & Credentials | `provider/v1#AuthType` + `mcp/v1.auth.credential_ref` | **B** | ของเดิม mount ไฟล์ตรง ๆ ไม่มี secret ref |
| 11. MCP | `mcp/v1` + `tool/v1` | **C** | **ไม่มีของเดิมเลย** ตาม feature-matrix §11 |
| 12. Workspace Skills | `agent/v1` + `profile/v1` | **C** | **ไม่มีของเดิมเลย** |
| Runtime adapters (9 engine) | `provider/v1/agent-provider` | **A** | fit ดีมาก — §4.4 |
| Model registry (`botforge-models`) | `provider/v1/model-provider` + `model/v1` | **A** | fetch ได้อยู่แล้ว แค่ยังไม่มี schema |
| *(ยังไม่มี)* | `event/v1` | **C** | ต้องผลิตขึ้นใหม่ — แต่เป็นทางเดียวที่ conform ได้ §7 |
| *(ยังไม่มี)* | `policy/v1` `capability/v1` `approval/v1` `consent/v1` `artifact/v1` | — | `not_yet:` |

---

## 2. contract ที่ **ไม่ต้องแตะ**

`approval/v1` · `consent/v1` · `artifact/v1` · `capability/v1` · `policy/v1`

Botforge ไม่มี approval flow, ไม่จัดการ PII ที่ต้องขอความยินยอม, ไม่ผลิต artifact และไม่ตัดสิน policy เอง — ประกาศไว้ที่ `not_yet:` ตามแบบของ `care-agent-platform` ที่เขียนไว้ว่า *"contract ที่ยังไม่ได้ใช้ — จะเพิ่มเมื่อ implement จริง ไม่ประกาศล่วงหน้า"*

---

## 3. contract ที่ควรเริ่ม — เรียงตามความพร้อม

| ลำดับ | Contract | ทำไม |
| :-: | --- | --- |
| 1 | `error/v1` | ของเดิมใกล้ที่สุด · ไม่ต้องรอ decision อะไร · §4.1 |
| 2 | `identity/v1` | ทุก contract อื่น `$ref` มาที่นี่ · แต่ติด blocker 2 ข้อ · §5.1–5.2 |
| 3 | `event/v1` | สิ่งเดียวที่ทำให้ `payload_check` มีของจริงให้ตรวจ · §4.2 |
| 4 | `provider/v1/agent-provider` | fit กับ RuntimeAdapter อยู่แล้ว · §4.4 |
| 5 | `model/v1` | `botforge-models` มีข้อมูลแล้ว แค่ไม่มีรูป |

---

## 4. Field-level mapping

### 4.1 `error/v1` — ใกล้ที่สุด

`getErrorHint()` (มีใน 8 จาก 9 engine · ไม่มีใน `opencode`) map เข้า `Category` ได้เกือบครบ:

| `getErrorHint()` ตรวจ | ข้อความไทยเดิม | `error/v1` Category | `retryable` |
| --- | --- | --- | :-: |
| `429` · `rate limit` | "เกิน rate limit ครับ รอสักครู่แล้วลองใหม่" | `rate_limited` | ✅ |
| `timeout` · `timed out` · `abort` | "AI ใช้เวลานานเกินไปครับ ลองพิมพ์ /new" | `timeout` | ✅ |
| `401` · `403` · `auth` · `unauthorized` | "มีปัญหาเรื่อง authentication ครับ" | `authentication` / `authorization` | ❌ |
| `500` · `internal server` | "server มีปัญหาครับ ลองใหม่อีกครั้ง" | `provider_error` | ✅ |
| `context` · `too long` · `token` | "บทสนทนายาวเกินไปครับ ลองพิมพ์ /new" | **ไม่มี category ตรง** ⚠️ | ❌ |

**ช่องว่างที่เจอ:** `error/v1` `Category` ไม่มีค่าที่หมายถึง "context window เต็ม" ตัวที่ใกล้ที่สุดคือ `validation` (*"input ผิดรูป — retry ไม่ช่วย"*) ซึ่งพอใช้ได้เพราะ retry ไม่ช่วยเหมือนกัน แต่ความหมายเพี้ยน — ไม่ใช่ input ผิดรูป

> ทางเลือก: ใช้ `validation` + `code: "runtime.context_exhausted"` ไปก่อน แล้วเก็บเป็นข้อสังเกตให้ upstream — **ยังไม่ควรเปิด issue** เพราะเกณฑ์รับ contract ข้อ 2 ต้องมี consumer 2 ราย

**สิ่งที่ต้องเปลี่ยนในโค้ด:**

```
เดิม   getErrorHint(errMsg: string): string        → ข้อความไทย
ใหม่   toError(err): Error(error/v1)               → { code, category, message, retryable }
       renderThai(error): string                    ← อยู่ที่ channel layer
```

⚠️ `error/v1.message` เขียนไว้ว่า **"ห้ามใส่ credential, PII หรือเนื้อหา prompt ของผู้ใช้"** — ของเดิม `❌ API Error: ${errMsg}` ใน `opencode` ส่ง error ดิบจาก provider ให้ผู้ใช้เห็น **ต้องตรวจว่าไม่มี key หลุด**

### 4.2 `event/v1` — ต้องผลิตใหม่ แต่จำเป็น

ADR-0006 ข้อ 2 บังคับให้ conformance test validate **payload จริงที่ระบบผลิต** ไม่ใช่ fixture ที่เขียนให้ผ่าน — Botforge ตอนนี้ไม่ผลิต payload รูป contract เลย จึงต้องเริ่มปล่อย event

`required: [event_id, event_type, tenant_id, subject_type, subject_id, occurred_at, source]`

event ที่ Botforge ผลิตได้ทันทีจาก flow เดิม:

| จังหวะเดิมในโค้ด | `event_type` | `subject_type` | `subject_id` |
| --- | --- | --- | --- |
| `createSession()` สำเร็จ | `SESSION_STARTED` * | `execution` | execution_id |
| `sendPrompt()` เริ่ม | `EXECUTION_STARTED` | `execution` | execution_id |
| ตอบกลับสำเร็จ | `STATE_TRANSITION` | `execution` | execution_id |
| error ทุกชนิด | `EXECUTION_FAILED` | `execution` | execution_id |
| `/abort` | `STATE_TRANSITION` | `execution` | execution_id |
| bot join/leave group | `CHANNEL_JOINED` * / `CHANNEL_LEFT` * | `record` + `metadata.record_type` | group id |

\* ค่านอก 7 ตัวมาตรฐาน — **ทำได้** เพราะ `event_type` อ้าง `EventTypeName` (pattern `^[A-Z][A-Z0-9_]{2,63}$`) ไม่ใช่ `EventType` enum และ schema ระบุไว้ว่าเป็น **"🔓 ชุดเปิด"** โดยเจตนา · `ecosystem-intelligence` ก็ทำแบบเดียวกันด้วย `ADVISORY_ISSUED`

**กฎที่ JSON Schema ตรวจให้ไม่ได้ แต่ต้องทำ** (`guarantees` · 🔒 frozen):

- append-only — แก้/ลบไม่ได้
- **no silent state change** — ทุกการเปลี่ยน state ต้องมี event · ของเดิม `sessions.delete()` เกิดขึ้น 3–4 จุดต่อไฟล์โดยไม่มีบันทึกเลย
- **ห้ามสร้าง `job_id` ปลอม** — Botforge ไม่มี job ก็ไม่ต้องใส่
- **event ที่ resolve tenant ไม่ได้ ให้ reject ที่ intake ห้ามเดา** → ดู §5.2
- **ห้ามเก็บ chain-of-thought เป็น audit record** — ⚠️ `opencode` มี `stripThinkTags()` ที่ตัด `<think>` ออกจาก **response** แต่ถ้าจะ log ต้องระวังไม่ให้ reasoning ไหลเข้า `metadata`

### 4.3 `execution/v1` — session ของ Botforge ยังไม่ใช่ execution

ของเดิม: `sessions: Map<string, { sessionId, userId, isGroup }>` — **ไม่มี state**

`execution/v1` ต้องการ state machine 10 สถานะ พร้อม transition ที่กำหนดไว้ชัด:

```
pending → authorizing → queued → running → succeeded
                                        ↘ failed / timed_out / cancelled
```

| Botforge เดิม | `ExecutionState` |
| --- | --- |
| อยู่ใน `enqueueForSession()` รอคิว | `queued` |
| กำลัง `sendPrompt()` | `running` |
| ตอบกลับแล้ว | `succeeded` |
| `AbortSignal.timeout()` ทำงาน | `timed_out` |
| `/abort` | `cancelled` |
| error | `failed` |

**ช่องว่าง:** `pending` `authorizing` `awaiting_approval` `rejected` ไม่มีของเดิมรองรับ เพราะ Botforge ไม่มี policy layer — ใช้ได้แต่จะข้าม `authorizing` ไปเลย ซึ่ง**ผิด transition** (`pending: [authorizing, cancelled]` เท่านั้น)

> ต้องตัดสินใจ: มี `authorizing` ที่ผ่านตลอด (no-op) หรือยังไม่ pin `execution/v1` — **เสนอให้อยู่ใน `not_yet:` รอบแรก**

`retry_policy` ของ contract ตรงกับของเดิมข้อหนึ่งพอดี: *"retry ได้ต่อเมื่อ `error.retryable: true`"* — ของเดิมมี auto-retry on 404 (feature 2.6 ✅ ทุก engine) แต่ retry แบบสร้าง session ใหม่ ไม่ใช่ `attempt` ใหม่ใต้ execution เดิม

### 4.4 `provider/v1/agent-provider` — fit ดีที่สุดในทั้งหมด

schema นี้เขียนมาเพื่อกรณีนี้ตรง ๆ — description ระบุชื่อ *"Claude Code, Gemini CLI, Codex CLI, Copilot CLI, Amazon Q, **OpenCode**"* ซึ่งคือ 9 engine ของ Botforge เกือบทั้งชุด

| field | ค่าของ Botforge |
| --- | --- |
| `kind` | `agent` |
| `is_native` | `false` ทั้ง 9 — Botforge ไม่ได้ถือ loop เอง provider ถือ |
| `models` | จาก `MODELS` map (มีแค่ `opencode` `claude-code` `copilot-cli`) |
| `session.stateful` | `true` ทั้ง 9 — ทุกตัวมี sessionId |
| `session.resumable` | `false` ทั้ง 9 — session หายเมื่อ restart (เก็บใน memory Map) |
| `session.max_duration_seconds` | จาก `PROMPT_TIMEOUT_MS` |
| `observability_depth` | `turn` ทั้ง 9 — ไม่มี engine ไหนรายงาน step |
| `cancellation` | **ไม่เท่ากัน — ดูข้างล่าง** |

**`cancellation` เผยความต่างที่ซ่อนอยู่ใต้คำสั่งเดียวกัน** — `/abort` มีครบทั้ง 9 engine (feature 1.2 ✅) แต่ทำคนละอย่าง:

| Engine | `/abort` ทำอะไรจริง | `cancellation` |
| --- | --- | --- |
| `opencode` | `abortSession()` → `POST /session/{id}/abort` | `graceful` |
| `claude-code` `copilot-cli` `codex` family | `POST /session/{id}/abort` แล้วเช็ค `res.aborted` | `graceful` |
| `adkcode` | `POST /session/{id}/abort` (ไม่เช็คผล) | `graceful` |
| **`gocode`** | **`DELETE /api/sessions/{id}` + `sessions.delete()`** | **`kill_only`** |

`gocode` ไม่ได้ยกเลิก prompt ที่ค้างอยู่ — มัน**ทำลาย session ทิ้ง** ผู้ใช้พิมพ์ `/abort` แล้วได้ข้อความ "ยกเลิกคำสั่งแล้วครับ" เหมือนกันทุกตัว แต่ผลไม่เหมือนกัน

> นี่คือตัวอย่างที่ดีที่สุดว่า contract ให้ประโยชน์อะไร — ความต่างนี้มองไม่เห็นจาก feature checklist (ทั้ง 9 ตัวได้ ✅ ข้อ 1.2 เท่ากัน) แต่ `cancellation` บังคับให้ประกาศ

---

## 5. ช่องว่างที่ต้องตัดสินใจ

### 5.1 🔴 LINE id ใช้เป็น `identity/v1#Id` ไม่ได้

`identity/v1#/$defs/Id` pattern: `^[a-z0-9][a-z0-9_-]{0,62}$`

ของเดิม `getSessionKey()` คืน LINE id ดิบ ๆ:

```ts
if (event.source?.groupId) return event.source.groupId   // C........
if (event.source?.roomId)  return event.source.roomId    // R........
if (event.source?.userId)  return event.source.userId    // U........
```

ทดสอบแล้ว:

| ค่า | ผล |
| --- | :-: |
| `U4af4980629f1b2c3...` (userId) | **ไม่ผ่าน** |
| `Ca56f9e2b1c3d4e5...` (groupId) | **ไม่ผ่าน** |
| `R1b2c3d4e5f6a7b8...` (roomId) | **ไม่ผ่าน** |
| `u4af4980629f1b2c3...` (lowercase) | ผ่าน |
| `line-u4af4980629f1b2c3...` (prefix) | ผ่าน |

LINE id ขึ้นต้นด้วยตัวพิมพ์ใหญ่ `U`/`C`/`R` เสมอ — **ผิด pattern ทั้งหมด** และ id นี้ไหลไปทุกที่: `subject_id` ของ event, `ActorId` ของ Principal, `WorkspaceId`

**ทางเลือก:**

| | วิธี | ข้อดี | ข้อเสีย |
| --- | --- | --- | --- |
| a | lowercase ตรง ๆ | ง่าย · reversible | ตัวพิมพ์เล็ก/ใหญ่ชนกันได้ในทฤษฎี |
| b | prefix + lowercase `line-u4af...` | อ่านออกว่ามาจากไหน · ไม่ชนกับ channel อื่น | ยาวขึ้น (แต่ยังไม่เกิน 63) |
| c | hash | ไม่รั่ว id ของ LINE | ตามรอยกลับไม่ได้ · debug ยาก |

**เสนอ (b)** — `line-{lowercase}` ยาว 38 ตัวอักษร ผ่าน pattern สบาย ๆ และรองรับ multi-channel ใน Phase 5 ตั้งแต่ตอนนี้ (`telegram-...` `web-...`) โดยไม่ต้องแก้ทีหลัง

### 5.2 🔴 Botforge ไม่มี tenant

`event/v1` `required` มี `tenant_id` และ guarantee เขียนชัดว่า:

> *"event ที่ resolve tenant ไม่ได้ ให้ **reject ที่ intake ห้ามเดา tenant ให้**"*

Botforge ปัจจุบัน **ไม่มี concept ของ tenant เลย** — หนึ่ง bot = หนึ่ง container = หนึ่ง `.env` และแยกกันด้วย Docker ไม่ใช่ด้วย id

`identity/v1` กำหนดชั้น `Tenant → Workspace → Resource` (ADR-0007) และ `TenantId` เป็น *"ขอบเขต isolation แข็ง — ห้ามข้ามเด็ดขาด · isolation ต้องลงลึกถึง DB / index / storage layer"*

**ทางเลือก:**

| | mapping | เหมาะเมื่อ |
| --- | --- | --- |
| a | 1 bot project = 1 tenant | ตรงกับความจริงวันนี้มากที่สุด — แต่ละ bot คือลูกค้าคนละราย |
| b | 1 องค์กรลูกค้า = 1 tenant · bot = workspace | ถ้าลูกค้ารายเดียวมีหลาย bot |
| c | Botforge เอง = 1 tenant · bot = workspace | ผิดเจตนา — ข้อมูลลูกค้าคนละรายจะอยู่ tenant เดียวกัน |

**เสนอ (a) เป็นค่าเริ่มต้น** — `tenant_id = ชื่อ project` (เช่น `legal-opencode`) ซึ่งผ่าน pattern `Id` อยู่แล้วเพราะเป็น lower-kebab · แล้ว `workspace_id` = `default` จนกว่าจะมีเหตุให้แยก

⚠️ ต้องยืนยันกับเจ้าของธุรกิจก่อน — ถ้าลูกค้ารายเดียวมีหลาย bot (สังเกตว่ามี `legal-opencode` `legal-claudecode` `legal-copilot` `legal-adkcode` `legal-services` = 5 ตัวที่ขึ้นต้นด้วย `legal`) ต้องเป็น (b)

### 5.3 🟡 `session` ของ Botforge หายเมื่อ restart

เก็บใน `Map` ใน memory — restart container = session หายหมด ตรงกับ `session.resumable: false` ที่ประกาศได้ตรง ๆ ไม่ผิด contract แต่ควรรู้ว่ากำลังประกาศอะไร

### 5.4 🟡 credential ยังเป็น file mount ไม่ใช่ secret ref

`mcp/v1.auth.credential_ref` เขียนว่า *"ตัวชี้ไป secret store — **ห้ามใส่ค่าจริง**"* ของเดิม mount `~/.claude` `~/.config/gh` `~/.config/gcloud` เข้า container ตรง ๆ (feature 10.2–10.5)

ไม่ผิด contract ตราบใดที่ไม่ประกาศ `mcp/v1` — แต่ถ้าจะ pin `mcp/v1` ต้องมี secret store ก่อน

### 5.5 🟢 `usage.cost_usd` ชื่อตรงกันพอดี

`model/v1#/$defs/Usage` มี `input_tokens` `output_tokens` `cached_input_tokens` `cost_usd` — ของเดิม `claude-code`/`copilot-cli` เก็บ `cost_usd` ชื่อเดียวกันเป๊ะ ยกเข้าได้เลย · อีก 7 engine ไม่มี (feature 2.10)

---

## 6. ChannelContract — **ไม่ควรเสนอเข้า `agent-platform`**

ใน [`component-map.md`](component-map.md) §5 เขียนไว้ว่า ChannelContract คือ *"อันเดียวที่เป็นของ Botforge จริง"* — พออ่านเกณฑ์รับ contract ใหม่ใน `contracts/README.md` แล้ว **ข้อสรุปเปลี่ยน**

เกณฑ์มี 4 ข้อ ต้องครบทุกข้อ:

| # | เกณฑ์ | Botforge |
| :-: | --- | :-: |
| 1 | มี contract เดิมตอบได้ไหม — ถ้ามีให้ขยายตัวนั้น | ✅ ไม่มีจริง |
| 2 | **มี consumer อย่างน้อย 2 ราย** หรือ 1 รายที่ใช้จริงแล้ว + รายที่สองระบุตัวได้ | **❌ Botforge เจ้าเดียว** |
| 3 | มี implementation จริงให้อ้าง | ✅ LINE ครบ 11/11 |
| 4 | platform เข้าใจ semantics พอจะเป็นผู้ตัดสิน | ❌ platform ไม่ควรรู้เรื่อง LINE |

ตกข้อ 2 และ 4 — และข้อ 4 คือสิ่งที่ architecture doc §4 เขียนไว้เองว่า *"Agent Platform ไม่ควรรู้รายละเอียดของ LINE Bot"*

**ทางที่ถูกคือทำเป็น extension ของ Botforge เอง** ตามแบบที่ `care-agent-platform` ทำกับ `care-event/v1`:

```yaml
extensions:
  - id: channel-event/v1
    path: contracts/event/v1/channel-event.schema.yaml
    extends: event/v1
    detail: เพิ่ม channel_type · channel_id · message_id — additive ตาม RFC-0009
```

Botforge เป็นเจ้าของ schema นี้เอง เก็บไว้ในrepo ตัวเอง ไม่ขอให้ platform ดูแล — ถ้าวันหนึ่งมี repo ที่สองที่ต้องการ channel semantics เหมือนกัน ค่อยเสนอขึ้นไป โดยตอนนั้นจะครบเกณฑ์ข้อ 2 พอดี

> **แก้ข้อสรุปเดิมใน `component-map.md` §5** — บรรทัดที่เขียนว่า "สิ่งที่ต้องเขียนใหม่จริง ๆ มีแค่ ChannelContract" ยังถูกในแง่ว่าต้องเขียน แต่**ผิดที่ปลายทาง** ไม่ใช่ contract ของ ecosystem แต่เป็น extension ของ Botforge

---

## 7. ร่าง manifest รอบแรก

ร่างอยู่ที่ [`platform-contract.draft.yaml`](platform-contract.draft.yaml) — **ยังไม่วางที่ root** เพราะ manifest ที่ root คือคำประกาศว่า conform แล้ว ซึ่งยังไม่จริง

หลักที่ใช้ร่าง — ตามแบบ `care-agent-platform`:

```
contracts:   ประกาศเฉพาะที่ใช้จริงและมี payload ให้ตรวจ
not_yet:     ที่เหลือ พร้อมเหตุผลว่าทำไมยัง
extensions:  ของที่ Botforge เป็นเจ้าของเอง
```

รอบแรกเสนอ **2 contract เท่านั้น**: `error/v1` + `event/v1`

น้อยแบบนี้เพราะ ADR-0006 ข้อ 2 ต้องการ payload จริงให้ตรวจ — ประกาศ `identity/v1` โดยที่ยังไม่ได้ตัดสิน §5.1/§5.2 จะเป็นคำประกาศที่ตรวจไม่ได้ ซึ่งแย่กว่าไม่ประกาศ

---

## 8. ลำดับที่แนะนำ

```
1  ตัดสิน §5.1 (id mapping) และ §5.2 (tenant)      ← blocker ต้องคนตัดสิน
2  @botforge/core: toError() → error/v1            ← Phase 1.5 เริ่มจากตรงนี้ได้เลย
   + renderThai() ที่ channel layer
3  core ปล่อย event/v1 ทุกจุดที่ state เปลี่ยน       ← ปิด "no silent state change"
4  conformance/drift_check.py + payload_check.py    ← ก๊อปโครงจาก agent-platform
5  CI ที่รันทั้งสองตัวทุก PR                          ← ครบ ADR-0006 ทั้ง 3 ข้อ
6  ย้าย platform-contract.yaml ขึ้น root + เปิด issue ขอแถวใน consumers.md
```

ข้อ 2 กับ 3 คือ **งาน de-duplicate (Phase 1.5) ที่ทำไปพร้อมกัน** — ไม่ใช่งานเพิ่ม เพราะการดึง `getErrorHint()` ออกจาก 23 สำเนามาไว้ที่เดียว กับการทำให้มันคืน `error/v1` เป็นงานเดียวกัน

---

## 9. ยังไม่ได้ตรวจ

| # | เรื่อง |
| --- | --- |
| — | `policy/v1` `capability/v1` `approval/v1` `consent/v1` `artifact/v1` — อ่านผ่าน ๆ ยังไม่ field-level |
| — | `profile/v1` เทียบกับ `AGENTS.md` — workspace ของ Botforge มีแค่ 2 ไฟล์ ยังห่างจาก profile มาก |
| — | `conformance/drift_check.py` ของ agent-platform ยังไม่ได้อ่าน code |
| — | ADR ที่เกี่ยวข้อง (0004 0005 0006 0007 0009 0010) อ่านแค่ที่ schema อ้างถึง |
