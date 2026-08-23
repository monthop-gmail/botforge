# @botforge/adapter-opencode

`RuntimePort` ตัวแรกของ V2 — ต่อ [OpenCode serve](https://opencode.ai) เข้ากับ `@botforge/core`

เลือก `opencode` เป็นตัวแรกเพราะเป็น engine ของ **9 ใน 14 bot ที่รันอยู่จริง**
และมี feature มากที่สุดในบรรดา 9 engine — multi-provider · `parts[]` parsing เต็ม ·
partial response on timeout · `stripThinkTags` ถ้า port รองรับตัวนี้ได้ ที่เหลือง่ายกว่า

## ลองเลย — ไม่ต้องมี API key

`opencode/big-pickle` กับ `opencode/nemotron-3-super` เป็น **model ฟรีผ่าน Zen**

```bash
# ต้องมี OpenCode server รันอยู่ก่อน
OPENCODE_URL=http://localhost:4096 \
  node --experimental-strip-types scripts/smoke-opencode.ts "ช่วยอธิบาย docker compose สั้น ๆ"
```

script นี้ประกอบ bot ทั้งตัวจาก `core` + adapter เหมือนที่ LINE bot ทำ
ต่างแค่ transport พิมพ์ลง stdout แทนที่จะยิงเข้า LINE — จึงทดสอบได้โดยไม่ต้องมี LINE channel

ผลลัพธ์ที่ได้:

```
─── ตอบกลับ (reply) ───
สวัสดีครับ ...

ผลลัพธ์  : answered  (28 ms)

audit event ที่ปล่อยออกมา 3 ใบ:
   1 STATE_TRANSITION pending → queued
   2 EXECUTION_STARTED
   3 STATE_TRANSITION running → succeeded · $0.00031
```

## สิ่งที่ adapter รับผิดชอบ

| | |
| --- | --- |
| session state | `sessionId` เป็นของ runtime · core รู้จักแค่ `sessionKey` (ห้องสนทนา) |
| การประกอบ prompt | แต่ละ runtime ประกอบไม่เหมือนกัน · core ส่งแค่วัตถุดิบมาให้ |
| `extractResponse` | `text` · `tool.question` · `reasoning` · `<think>` |
| auto-retry 404 | session หมดอายุฝั่ง server → สร้างใหม่แล้วลองอีกครั้ง (feature 2.6) |
| partial on timeout | abort แล้วดึงคำตอบที่เขียนไปแล้วมาให้ (feature 2.8 — มีเจ้าเดียวใน 9 engine) |

## สิ่งที่ adapter **ไม่** รับผิดชอบ

chunk · signature · คิว · profile · `[SKIP]` · error → ไทย · audit event
ทั้งหมดอยู่ใน `@botforge/core` และใช้ร่วมกับทุก engine

## ช่องว่างของ port ที่เจอตอนเขียน adapter ตัวนี้

`RuntimePort.sendPrompt()` เดิมไม่มี `userContext` — แต่ v1 ของ `opencode`
ประกอบ `[User Info: ...]` เข้า prompt ข้างใน `sendPrompt()` โดยอ่านจาก
`userProfiles` ที่เป็น module-level state

แก้โดยให้ **core ดึง profile และจัดรูป** แล้วส่ง `userContext` เป็น string
มาให้ adapter ตัดสินว่าจะวางตรงไหนของ prompt — เพราะการดึง profile เป็นเรื่องของ
channel ส่วนการประกอบ prompt เป็นเรื่องของ runtime

> นี่คือเหตุผลที่ควรเขียน adapter จริงก่อนเขียนอีก 8 ตัวตามแบบเดียวกัน

## test

```bash
npm test --prefix packages/adapter-opencode
```

- `extract.test.ts` — characterization เทียบ `extractResponse()` ฉบับ verbatim จาก v1 บน corpus 22 แบบ
- `adapter.test.ts` — fake OpenCode ที่เคารพ `AbortSignal` จริง · ครอบ 404 retry · timeout · `/new` `/model` `/abort` `/sessions`
- `e2e.test.ts` — **HTTP จริง** ผ่าน `node:http` ตั้งแต่ payload ของ LINE จนถึงข้อความที่ส่งกลับ
