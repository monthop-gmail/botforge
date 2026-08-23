# @botforge/channel-web

**Channel ที่สอง** — HTTP + SSE · มีอยู่เพื่อปิดครึ่งหลังของ Definition of Done

```
เปลี่ยน Codex → Claude โดยไม่แก้ Channel   ✅ adapter 3 ตัว 3 shape
เปลี่ยน LINE  → Web   โดยไม่แก้ Runtime    ✅ ← ตัวนี้
```

## พิสูจน์แล้วกับ model จริง

```bash
node --experimental-strip-types scripts/web-demo.ts
```

`web-demo.ts` ใช้ **`@botforge/adapter-opencode` ตัวเดียวกับที่ LINE ใช้ โดยไม่แก้อะไรเลย** —
ไม่มีบรรทัดไหนใน adapter ที่รู้ว่ามี Web อยู่

```
ผู้ใช้ : สวัสดีครับ ตอบสั้น ๆ ว่าคุณคือ model อะไร
bot   : สวัสดีครับ ผมคือ ox-alpha ซึ่งพัฒนาโดยองค์กรที่ไม่เปิดเผยชื่อครับ
ผล    : answered
audit event รวม 3 ใบ
```

## เส้นทาง

| | |
| --- | --- |
| `GET /` | หน้าเว็บเล็ก ๆ ไม่มี dependency ไม่มี build step |
| `GET /events?c=<id>` | SSE — ข้อความจาก bot |
| `POST /message` | `{ conversationId, text }` → `202` ทันที คำตอบไปทาง SSE |
| `GET /health` | |

## สิ่งที่ต่างจาก LINE และทำให้ core ต้องปรับ

| | LINE | Web |
| --- | --- | --- |
| reply token | มี ใช้ได้ครั้งเดียว ฟรี | **ไม่มี** — `reply()` ทำงานเหมือน `push()` |
| ลิมิตความยาว | 5000 ตัวอักษร | ไม่มี |
| ผู้รับ | หนึ่งคน/หนึ่งกลุ่ม | **หลายแท็บในห้องเดียวกัน** |
| ตัวตนผู้ใช้ | Profile API | ไม่มี — ใครก็ได้ที่เปิดหน้าเว็บ |
| signature | HMAC บังคับ | token เลือกใส่ได้ |

### สองจุดที่ core ต้องแก้เพราะ channel ที่สอง

**1. `LineTransport` → `ChannelTransport`** — ชื่อเดิมสมัยที่มีแต่ LINE (คง alias ไว้ไม่ให้พัง)
พร้อมเขียนกำกับว่า channel ที่ไม่มี reply token ให้ `reply()` ทำงานเหมือน `push()` ได้

> ระหว่างทางเจอว่า `adapter-codex` ก็มี `LineTransport` แต่หมายถึง **line-delimited**
> คนละเรื่องกับ LINE แชท — เปลี่ยนเป็น `LineDelimitedTransport` แล้ว

**2. `SendOptions.chunkLimit`** — เดิม `sendMessage()` ผูกกับ `LINE_MAX_TEXT` ตายตัว
Web ไม่มีลิมิต · Telegram ใช้ 4096 · ตอนมี channel เดียวมองไม่เห็นว่านี่เป็นการผูก

> gap แบบเดียวกับ `userContext` / `groupMemory` ที่เจอตอนเขียน adapter —
> ของที่แยกไว้แต่ยังไม่มีคนที่สองมาใช้ ยังพิสูจน์ไม่ได้ว่าแยกถูก

## `ChannelHub` — สิ่งที่ LINE ไม่ต้องมี

LINE ส่งกลับหาผู้รับคนเดียว · Web มีหลายแท็บเปิดห้องเดียวกันได้ จึงต้องมีทะเบียน subscriber

- ห้องว่างแล้วลบทิ้ง — ไม่งั้น `Map` โตตามจำนวนห้องที่เคยมีคนเข้า
- client ที่เขียนไม่ได้ถูกถอดออกเอง
- ตอบตอนไม่มีใครฟัง → เก็บ backlog (จำกัดจำนวน) ส่งให้ client ที่ต่อทีหลัง

## audit event

ใช้ `channel-event/v1` ตัวเดียวกับ LINE — ต่างแค่ `channel_type: "web"` และ `channel_id: "web-<room>"`
schema ไม่ต้องแก้เลย

## test

```bash
npm test --prefix packages/channel-web
```

12 test · ยิง **HTTP + SSE จริง** ผ่าน `node:http` ไม่ใช่ mock ของ fetch

## ยังไม่ได้ทำ

- reconnect / `Last-Event-ID` — client ที่หลุดแล้วต่อใหม่ได้ backlog แต่ไม่มี cursor ที่แน่นอน
- ตัวตนผู้ใช้ — ทุกคนในห้องเดียวกันคือคนเดียวกันในสายตา core (`actor` ยังไม่มี)
- streaming ทีละ token — ตอนนี้ส่งข้อความเดียวตอนจบเทิร์น
