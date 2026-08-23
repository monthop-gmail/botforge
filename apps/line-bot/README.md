# @botforge/line-bot

**LINE bot ที่ deploy ได้ — ชิ้นที่ทำให้ V2 ส่งมอบอะไรได้เป็นครั้งแรก**

ก่อนหน้านี้ V2 มี library ครบแต่ไม่มีอะไรประกอบเป็น service
`channel-web` มี HTTP server เต็มตัวตั้งแต่แรก ส่วน **LINE ซึ่งเป็น channel ของทั้ง 14 bot มีแค่ primitive**

## รัน

```bash
cp apps/line-bot/.env.example apps/line-bot/.env   # แล้วเติมค่า
npm start --prefix apps/line-bot
```

```bash
docker build -f apps/line-bot/Dockerfile -t botforge-line-bot .
docker run --env-file apps/line-bot/.env -p 3000:3000 botforge-line-bot
```

webhook URL คือ `https://<domain>/webhook`

## เลือก runtime ด้วย env ตัวเดียว

```bash
BOTFORGE_RUNTIME=opencode   # หรือ codex · claude · adkcode
```

`main.ts` **ไม่มี logic ของ LINE หรือของ runtime อยู่เลย** — เป็นแค่ตัวต่อสาย
`config.ts` เป็นจุดเดียวที่รู้ว่า adapter ตัวไหนต้องการ env อะไร และ `import` แบบ lazy
เพื่อไม่ให้ต้องโหลด SDK ของ engine ที่ไม่ได้ใช้

### ค่าเริ่มต้นต่อ engine ยกมาจาก v1 ตามจริง

| | `opencode` | อื่น ๆ |
| --- | --- | --- |
| `userContextFormat` | `verbose` — `[User Info: ชื่อ (messages: n)]` | `standard` — `[User: ชื่อ]` |
| `lengthTruncationNotice` | ปิด — ใช้กลไก `_truncated` แทน | เปิด |

## ยืนยันแล้วกับ model จริง

สตาร์ทจริงต่อ OpenCode server แล้วยิง webhook ที่เซ็นถูกต้อง:

```
POST /webhook → 200 OK (67 ms — ตอบทันทีไม่รอ model)
signature ผิด → 403 Invalid signature

audit event (event/v1)
   1 STATE_TRANSITION   pending→queued     tenant=legal channel=line
   2 EXECUTION_STARTED                     tenant=legal channel=line
   3 STATE_TRANSITION   running→succeeded  tenant=legal channel=line
```

**ตอบ 200 ใน 67 ms** โดยไม่รอ model — LINE จะได้ไม่ retry (พฤติกรรมของ v1)

> ทดสอบด้วย LINE token ปลอม การส่งกลับจึงได้ 401 แล้ว **fallback จาก `reply` ไป `push` ทำงานจริง**
> ซึ่งก่อนหน้านี้พิสูจน์ได้แค่ใน test · ขั้นสุดท้ายที่ยังไม่ได้ยืนยันคือส่งถึง LINE จริง ต้องมี token ของจริง

## audit event

เขียนลง **stdout เป็น JSON บรรทัดละใบ** ตาม `event/v1`
ยังไม่ได้ส่งเข้า ecosystem — เปลี่ยนปลายทางได้ที่ `sink` ใน `main.ts` โดยไม่แตะที่อื่น

## config ที่ขาดไม่ได้

`BOTFORGE_TENANT_ID` และ `BOTFORGE_WORKSPACE_ID` **บังคับ** — `event/v1` เขียนไว้ว่า
*"event ที่ resolve tenant ไม่ได้ ให้ reject ที่ intake ห้ามเดา tenant ให้"*

ขาดแล้ว process จบด้วย **exit code 2** พร้อมบอกว่าขาดอะไร ไม่ใช่สตาร์ทแล้วปล่อย event ที่ผิด

## ยังไม่ได้ทำ

- ยังไม่ได้ยิงกับ LINE channel จริง — ต้องมี channel secret/token ของจริง
- ไม่มี `docker-compose.yml` — v1 มี 3 container (bot + server + tunnel) · ตัวนี้ยังเป็น container เดียว
- `botforge new` ยังสร้าง project แบบ V2 ไม่ได้ — ยังไม่มี template ที่ใช้ `packages/`
- ยังไม่มีเส้นทางย้าย 14 bot จาก V1 มา V2
