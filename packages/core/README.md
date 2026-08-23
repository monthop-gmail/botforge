# @botforge/core

ของที่ไม่ผูกกับ runtime — เดิมถูก copy อยู่ใน **23 ไฟล์** (9 template + 14 project)

ดู [`docs/architecture/component-map.md`](../../docs/architecture/component-map.md) §3 สำหรับขอบเขตเต็ม

## สถานะ

| module | มาแทน | สถานะ |
| --- | --- | :-: |
| `errors.ts` | `getErrorHint()` × 23 สำเนา | ✅ |
| `identity.ts` | id ของ channel → `identity/v1` | ✅ |
| `channel/line.ts` | `chunkText` `validateSignature` `getSessionKey` `isBotMentioned` × 23 สำเนา | ✅ |
| `channel/send.ts` | `sendMessage` — reply-first + retry 429 × 23 สำเนา | ✅ |
| `session/queue.ts` | `enqueueForSession` — **เดิมมีแค่ 6 ใน 9 engine** | ✅ |
| `context/time.ts` | `getTimeContext` + timestamp ของ `log()` | ✅ |
| `context/profile.ts` | `getUserProfile` `getGroupName` `getUserContext` + cache 1 ชม. | ✅ |
| `events/` | ปล่อย `event/v1` + `channel-event/v1` — **ของใหม่ v1 ไม่มีบันทึกเลย** | ✅ |
| `router/` | `handleTextMessage()` 240 บรรทัด × 23 สำเนา | ✅ |

**110 test ผ่าน** · typecheck สะอาด · ไม่มี runtime dependency

## duplication ที่ปิดไปแล้ว

| | |
| --- | ---: |
| ฟังก์ชันที่ยกเข้า core | 12 ตัว ~197 บรรทัด/ไฟล์ |
| เดิมกระจายอยู่ | 23 ไฟล์ (9 template + 14 project) |
| บรรทัดที่เคยซ้ำ | **~4,500** |
| ตอนนี้อยู่ที่ | 1 ที่ |

## ช่องว่างที่ปิดไปด้วยระหว่างทาง

การย้ายเข้า core ทำให้ของที่เคยมีแค่บาง engine กลายเป็นของทุก engine:

| feature | เดิมมีที่ | ผลตอนนี้ |
| --- | --- | --- |
| 2.11 request queue | 6/9 — **ไม่มีใน `opencode`** ที่เป็น engine ของ 9 ใน 14 bot | ทุก engine |
| 6.2 error hints ไทย | 8/9 — ไม่มีใน `opencode` | ทุก engine |
| 4.3 / 5.5 group context | 8/9 — ไม่มีใน `opencode` | ทุก engine |

ไม่ใช่ feature ใหม่ — เป็นของที่ engine อื่นมีอยู่แล้วแต่ `opencode` ตกหล่น

## รัน test

```bash
npm test --prefix packages/core        # node --experimental-strip-types --test
npm run typecheck --prefix packages/core
```

ใช้ `node:test` ของ node 22 ไม่มี dependency — เครื่อง dev ไม่มี `bun` ติดตั้ง
ส่วน bot-service ที่ generate ออกไปยังรันบน Bun เหมือนเดิม (core เป็น TS ธรรมดา ไม่ผูก runtime)

## เกณฑ์ว่างานนี้สำเร็จ

> แก้ `chunkText()` แล้วต้องแตะ **1 ไฟล์** ไม่ใช่ 23 ✅

และ Definition of Done ของ V2:

> เปลี่ยน Codex → Claude โดยไม่แก้ Channel ✅ — runtime อยู่หลัง `RuntimePort` ตัวเดียว
> เปลี่ยน LINE → Web โดยไม่แก้ Runtime · ⬜ — `LineTransport` แยกแล้ว แต่ยังไม่มี channel ที่สอง

adapter ที่มีแล้ว 3 shape: [`adapter-opencode`](../adapter-opencode/) (HTTP) · [`adapter-codex`](../adapter-codex/) (stdio JSON-RPC) · [`adapter-claude`](../adapter-claude/) (in-process SDK) —
พิสูจน์แล้วด้วย `e2e.test.ts` ที่วิ่งผ่าน HTTP จริง และ `scripts/smoke-opencode.ts`
ที่ยิง OpenCode server จริงได้ด้วย model ฟรี

## Preserve behavior พิสูจน์ยังไง

เก็บโค้ด v1 ฉบับ **verbatim** ไว้เป็น oracle ในไฟล์ test แล้วเทียบผลทุกตัวอักษร:

| oracle | corpus | ที่มา |
| --- | --- | --- |
| `getErrorHint_v1()` | 27 แบบ รวมเคสที่ลำดับสำคัญ (`"429 timeout"` · `"timeout during authentication"`) | `bot-service-codex/src/index.ts:219` |
| `chunkText_v1()` | 13 แบบ × limit 14/20/50/100/999/5000 | `bot-service-opencode/src/index.ts:401` |
| `getTimeContext_v1()` | 4 จุดเวลา รวมข้ามวันและข้ามปี | `bot-service-codex/src/index.ts:154` |

ตรวจแล้วว่าโค้ดที่ยกมา **เหมือนกันเชิงความหมายทั้ง 9 engine**:
`chunkText` ต่างกันแค่ comment บรรทัดเดียว · `validateSignature` เหมือนทุก byte ·
`getSessionKey` และ `sendMessage` ต่างแค่การจัดบรรทัดกับ `console.log` vs `log()` ·
`isBotMentioned` ต่างแค่ชื่อ engine ใน trigger จึงทำเป็น parameter (`triggersFor()`)

`getErrorHint` ไม่มีใน `opencode` — ส่ง error ดิบให้ผู้ใช้แทน
ดู [`feature-matrix.md`](../../docs/architecture/feature-matrix.md) §6

ตรวจแล้วว่า `getErrorHint()` **เหมือนกันทุก byte ทั้ง 8 engine** ที่มีฟังก์ชันนี้
(`opencode` ไม่มี — ส่ง error ดิบให้ผู้ใช้แทน ดู [`feature-matrix.md`](../../docs/architecture/feature-matrix.md) §6)

## สิ่งที่เปลี่ยนจาก v1 โดยตั้งใจ

`getErrorHint()` เดิมทำสองอย่างปนกัน — จำแนก error กับสร้างข้อความไทย · core แยกเป็นสองหน้าที่:

```
classify(err)    → error/v1 object   ← ไปที่ audit event · message ถูก redact
renderThai(e)    → ข้อความไทย         ← ไปที่ผู้ใช้ · ตรงกับของเดิมทุกตัวอักษร
```

ที่ต้องแยกเพราะ `error/v1` เขียนไว้ว่า `message` **ห้ามมี credential, PII หรือเนื้อหา prompt**
แต่ข้อความที่ผู้ใช้เห็นของเดิมเอา error ดิบมาต่อท้าย — สองอย่างนี้ไปด้วยกันไม่ได้ในฟิลด์เดียว


## ที่ต่างจาก v1 โดยตั้งใจ — มีสองจุด

**1. `classify()` / `renderThai()` แยกจากกัน** (อธิบายข้างบน)

**2. `chunkText()` มี progress guard**

v1 **วนไม่จบ** เมื่อ `limit` เล็กพอที่จุดตัดจะสั้นกว่า 4 ตัวอักษร และ chunk นั้นมี
code fence เป็นเลขคี่ — เพราะเติม `` "```\n" `` (4 ตัว) กลับเข้า `remaining`
มากกว่าที่ตัดออกไป · ยืนยันแล้วว่า `limit=10` กับข้อความที่มี fence ค้าง
วนเกิน 5,000 รอบโดยไม่จบ ส่วน `limit=50` ขึ้นไปจบปกติ

production ใช้ `limit=5000` ซึ่งจุดตัดสั้นสุดคือ 1,500 ตัว จึงไม่เคยเจอของจริง
แต่ `limit` เป็น parameter ที่เรียกด้วยค่าอะไรก็ได้ และการวนไม่จบไม่ใช่พฤติกรรมที่ควรรักษา

ผลลัพธ์ยัง **เท่ากับ v1 ทุกตัวอักษรเมื่อ `limit >= 14`** — มี test ยืนยัน
