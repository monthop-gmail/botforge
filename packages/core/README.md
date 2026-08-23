# @botforge/core

ของที่ไม่ผูกกับ runtime — เดิมถูก copy อยู่ใน **23 ไฟล์** (9 template + 14 project)

ดู [`docs/architecture/component-map.md`](../../docs/architecture/component-map.md) §3 สำหรับขอบเขตเต็ม

## สถานะ

| module | มาแทน | สถานะ |
| --- | --- | :-: |
| `errors.ts` | `getErrorHint()` × 23 สำเนา | ✅ |
| `identity.ts` | `getSessionKey()` ที่คืน LINE id ดิบ | ✅ |
| channel (LINE) | `validateSignature` `sendMessage` `chunkText` `isBotMentioned` | ⬜ |
| session | `enqueueForSession` + `UserSession` | ⬜ |
| context | `getUserContext` `getTimeContext` `getGroupName` | ⬜ |
| command router | `handleTextMessage()` 240 บรรทัด | ⬜ |

## รัน test

```bash
npm test --prefix packages/core        # node --experimental-strip-types --test
npm run typecheck --prefix packages/core
```

ใช้ `node:test` ของ node 22 ไม่มี dependency — เครื่อง dev ไม่มี `bun` ติดตั้ง
ส่วน bot-service ที่ generate ออกไปยังรันบน Bun เหมือนเดิม (core เป็น TS ธรรมดา ไม่ผูก runtime)

## เกณฑ์ว่างานนี้สำเร็จ

> แก้ `chunkText()` แล้วต้องแตะ **1 ไฟล์** ไม่ใช่ 23

## Preserve behavior พิสูจน์ยังไง

`errors.test.ts` เก็บ `getErrorHint()` ฉบับ **verbatim จาก v1-final** ไว้เป็น oracle
แล้วยืนยันว่า `toUserMessage(x) === getErrorHint_v1(x)` ทุกตัวอักษร บน corpus 27 แบบ
ที่ครอบคลุมทุก branch รวมเคสที่ลำดับการตรวจสำคัญ (`"429 timeout"` · `"timeout during authentication"`)

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
