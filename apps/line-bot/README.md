# @botforge/line-bot

**LINE bot ที่ deploy ได้ — ชิ้นที่ทำให้ V2 ส่งมอบอะไรได้เป็นครั้งแรก**

ก่อนหน้านี้ V2 มี library ครบแต่ไม่มีอะไรประกอบเป็น service
`channel-web` มี HTTP server เต็มตัวตั้งแต่แรก ส่วน **LINE ซึ่งเป็น channel ของทั้ง 14 bot มีแค่ primitive**

## รัน

```bash
cp apps/line-bot/.env.example apps/line-bot/.env   # แล้วเติมค่า
npm start --prefix apps/line-bot
```

### docker compose (แนะนำ)

**ไฟล์เดียวรองรับทุก runtime** ผ่าน compose profiles — v1 มี `docker-compose.yml` แยกต่อ engine
เพราะแต่ละ engine เป็นคนละ template

```bash
# จาก root ของ repo
COMPOSE_PROFILES=opencode,tunnel docker compose -f apps/line-bot/docker-compose.yml up -d --build
COMPOSE_PROFILES=claude          docker compose -f apps/line-bot/docker-compose.yml up -d --build
```

| profile | service ที่ขึ้น |
| --- | --- |
| `opencode` | `line-bot` + `opencode` |
| `adkcode` | `line-bot` + `adkcode` |
| `claude` / ไม่ใส่ | `line-bot` อย่างเดียว |
| `+ tunnel` | เพิ่ม `cloudflared` |

**`codex` และ `claude` ไม่ต้องมี container ของ engine** — `codex` spawn `app-server` เป็น
child process ส่วน `claude` เรียก SDK ใน process เดียวกับ bot

ของที่ต้อง mount จาก host (credential, `opencode.json`) ใส่ใน `docker-compose.override.yml`
— ดู [`docker-compose.override.yml.example`](docker-compose.override.yml.example)
**ไม่ใส่ในไฟล์หลักเพราะ compose ไม่มีวิธีทำ mount แบบ optional ที่ไม่เปราะ**

### docker แบบไม่ใช้ compose

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

## ยืนยัน compose แล้ว

`COMPOSE_PROFILES=opencode` build + up จริง แล้วยิง webhook จากในเครือข่าย compose:

```
line-bot  Up (healthy)      ← healthcheck ทำงาน
opencode  Up

POST /webhook -> 200 OK (78 ms)
   1 STATE_TRANSITION   pending→queued     channel=line
   2 EXECUTION_STARTED                     channel=line
   3 STATE_TRANSITION   running→succeeded  channel=line
```

**bot container คุยกับ opencode container ผ่าน service name ได้จริง** และ model จริงตอบ

`line-bot` **ไม่ publish port** เหมือน v1 — เข้าจากภายนอกผ่าน `cloudflared` เท่านั้น

## UI ของ engine — ทางออกสำหรับงานยาว

LINE บังคับให้ reply เร็ว (`replyToken` หมดอายุ และผู้ใช้รอไม่ไหว) งานที่กินเวลานาน ๆ
จึงคุยผ่าน LINE ไม่ไหว — ให้ไปเปิด **UI ของ engine** แทน แล้วกลับมาสั่งงานสั้น ๆ ทาง LINE

`botforge-deploy tunnel setup` เปิดให้ **2 hostname ต่อ 1 project**:

| hostname | ไปที่ | ใช้ทำอะไร |
| --- | --- | --- |
| `<name>.<domain>` | `http://<name>-line-bot:3000` | LINE webhook |
| `<name>-server.<domain>` | `http://<name>-server:<port>` | UI ของ engine |

ทั้งคู่ไม่ต้อง publish port ออกเครื่อง — `cloudflared` อยู่ในเครือข่าย compose เดียวกัน
เรียก service name ตรง ๆ ได้เลย

engine ที่มี UI:

| runtime | container | port | UI |
| --- | --- | --- | --- |
| `opencode` | `<prefix>-server` | 4096 | ✅ เว็บของ OpenCode |
| `adkcode` | `<prefix>-server` | 8000 | ✅ FastAPI + ADK dev UI |
| `codex` | — | — | ❌ spawn app-server เป็น child process |
| `claude` | — | — | ❌ เรียก SDK ใน process เดียวกับ bot |

`codex`/`claude` ไม่มี container ของ engine แยก `tunnel setup` เลยข้าม route ตัวที่สองให้เอง

> ⚠️ **ชื่อ container ต้องเป็น `<prefix>-server`**
> ingress ของ tunnel ชี้ไปที่ `http://<name>-server:<port>` ตายตัว
> ถ้าตั้งชื่อ container เป็น `<prefix>-opencode` route UI จะ 502
> (ยืนยันแล้วด้วย stack จริง: `http://uitest-server:4096/` → `200 text/html` title `OpenCode`)

### ล็อกอิน UI ของ opencode

**Basic auth · username คือ `opencode`** (ตายตัว) · password คือ `OPENCODE_PASSWORD`

```bash
curl -u "opencode:$OPENCODE_PASSWORD" https://<name>-server.<domain>/global/health
```

เบราว์เซอร์จะขึ้นกล่องให้กรอก — ใส่ `opencode` เป็นชื่อผู้ใช้
ทั้ง V1 (`src/index.ts:61`) และ V2 (`adapter-opencode/src/client.ts:27`) ประกอบ header
แบบเดียวกัน ใส่ username อื่นจะได้ 401

> ⚠️ **auth ของ server เป็น opt-in และค่าว่าง = ไม่ติดตั้ง middleware เลย**
> ตรวจแล้วกับ container จริง — `/global/health` ตอบ 200 โดยไม่ต้อง auth
>
> `botforge new` และ `botforge-migrate run` **สุ่มรหัส 32 ตัวอักษรให้อัตโนมัติ**
> ([`lib/secret.sh`](../../lib/secret.sh)) ถ้าสร้าง `.env` เองต้องตั้งเอง —
> `tunnel setup` จะเตือนถ้ายังว่างตอนกำลังจะเปิด route ออกอินเทอร์เน็ต

## audit event

เขียนลง **stdout เป็น JSON บรรทัดละใบ** ตาม `event/v1`
ยังไม่ได้ส่งเข้า ecosystem — เปลี่ยนปลายทางได้ที่ `sink` ใน `main.ts` โดยไม่แตะที่อื่น

## config ที่ขาดไม่ได้

`BOTFORGE_TENANT_ID` และ `BOTFORGE_WORKSPACE_ID` **บังคับ** — `event/v1` เขียนไว้ว่า
*"event ที่ resolve tenant ไม่ได้ ให้ reject ที่ intake ห้ามเดา tenant ให้"*

ขาดแล้ว process จบด้วย **exit code 2** พร้อมบอกว่าขาดอะไร ไม่ใช่สตาร์ทแล้วปล่อย event ที่ผิด

## ยังไม่ได้ทำ

- ยังไม่ได้ยิงกับ LINE channel จริง — ต้องมี channel secret/token ของจริง
- ยังไม่ได้ย้าย bot จริงสักตัว — `botforge-migrate` ทดสอบกับ fixture เท่านั้น
  (`botforge-migrate check all` → 13 พร้อม / 1 ติด `legal-copilot` ที่รอ `adapter-copilot`)
- UI ของ engine ยังไม่เคยเปิดผ่าน tunnel จริง — ยืนยันแค่ในเครือข่าย compose
