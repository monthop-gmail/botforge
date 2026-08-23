# ย้าย domain

`sumana.online` หมดอายุ — zone หายจาก Cloudflare (`Invalid zone identifier`)
และไม่มี NS record เหลือ เอกสารนี้คือสิ่งที่ตรวจเจอตอนสำรวจ (2026-08-24) และวิธีย้าย

## domain ฝังอยู่ตรงไหน

**ไม่มีในไฟล์ที่รันจริงเลย** — compose · `.env` · container ไม่มีสักที่ ที่มีคือ:

| # | ที่ | ปริมาณ | ใครแก้ |
| --- | --- | --- | --- |
| 1 | `.botforge-deploy.env` → `CF_ZONE_ID` · `CF_DOMAIN` | 1 ไฟล์ | `domain change` |
| 2 | `DEFAULT_DOMAIN_SUFFIX` ใน `botforge` · `botforge-deploy` | 2 บรรทัด | `domain change` |
| 3 | Cloudflare — ingress ของ tunnel + DNS CNAME | 14 tunnel | `domain change` → `tunnel setup all` |
| 4 | LINE — webhook URL ของแต่ละ channel | 14 channel | `domain change` |
| 5 | เอกสารใน `projects/` | 27 ไฟล์ | `domain change` |
| — | ซื้อ domain + เพิ่ม zone ใน CF + ชี้ NS ที่ registrar | — | **มือ ทำแทนไม่ได้** |

**tunnel ไม่ต้องสร้างใหม่** — token ผูกกับ account + tunnel ไม่ใช่ domain
และ cloudflared ดึง ingress จาก Cloudflare เอง เปลี่ยนแล้วรับเองโดยไม่ต้อง restart

## คำสั่ง

```bash
./botforge-deploy domain show                        # domain + webhook ที่ LINE ถืออยู่จริง
./botforge-deploy domain change <new> --dry-run      # ดูก่อน ไม่แตะอะไร
./botforge-deploy domain change <new>                # ย้ายจริง (ถาม yes/no ก่อน)
```

flag: `--yes` · `--skip-tunnel` · `--skip-line` · `--skip-docs` · `--force-line`

`domain change` หา **zone id ของ domain ใหม่ให้เอง** จากชื่อ ผู้ใช้ไม่ต้องไปคัดลอกจาก dashboard
ถ้ายังไม่ได้เพิ่ม zone จะหยุดพร้อมบอกให้ไปเพิ่มก่อน ถ้า zone ยัง `pending` จะเตือนว่า NS ยังไม่ propagate

ลำดับสำคัญ: **LINE ต้องทำหลัง DNS + tunnel** เพราะ LINE ยิงทดสอบ URL ตอนตั้ง
`domain change` เรียงให้แล้ว (3 → 4) และหลัง `PUT` จะยิง
`POST /v2/bot/channel/webhook/test` ยืนยันว่า DNS + tunnel + bot พร้อมจริง

endpoint ของ LINE ยืนยันจาก `@line/bot-sdk` ไม่ได้เดา:
`PUT`/`GET /v2/bot/channel/webhook/endpoint` · `POST /v2/bot/channel/webhook/test`

## กับดักที่เจอจริง

### webhook ไม่ได้อยู่บน domain เดิมทุกตัว

`legal-services` ชี้ไป `https://legal.thaidirection.com/line/webhook`
— **คนละ domain คนละ path** เขียนทับเป็น `<name>.<new>/webhook` คือทำ bot พัง

`domain change` จึง **อ่าน webhook ปัจจุบันจาก LINE ก่อนเสมอ ไม่เดาจากชื่อ project**
ตัวที่ host ไม่ตรง `<name>.<old-domain>` จะถูกข้ามพร้อมบอกว่าตอนนี้ชี้ไปไหน
จะเขียนทับต้องใส่ `--force-line` เอง

### `legal-services` ไม่มี tunnel ใน Cloudflare

`tunnel setup legal-services` จะสร้างใหม่ให้ ไม่ใช่แค่แก้ ingress

### tunnel ที่รันอยู่ ไม่ได้อยู่บนเครื่องนี้

`docker ps` บนเครื่องนี้เห็น botforge แค่ 3 container แต่ Cloudflare รายงานว่า
**tunnel ทั้ง 14 ยังอยู่ และ 7 ตัว healthy มี connection จริง** — รันบนเครื่องอื่น

รวม `legal-claudecode` · `legal-copilot` · `legal-adkcode` ซึ่งเป็น 3 ใน 5 ตัว
ที่เพิ่งตั้งรหัสให้ **ที่เข้าไม่ถึงตอนนี้เพราะ DNS ตาย ไม่ใช่เพราะ tunnel ไม่ได้รัน**
ชี้ domain ใหม่เมื่อไหร่ก็เปิดทันที — ดู [`open-items.md`](open-items.md) §6

### tunnel ที่ไม่มี project คู่กัน

`icbserv-ssh` · `onboard-claudecode` อยู่ใน Cloudflare แต่ไม่มีใน `projects/`
`domain change` ไม่แตะ (วนตาม `projects/`) ต้องตัดสินใจเองว่าจะเอายังไงต่อ

### zone ที่มีอยู่แล้วในบัญชี

`iway.co.th` · `nisshoseiko.com` · **`sumana.org`** · `ttavt.com` — ทั้งหมด `active`
`sumana.org` ใช้ได้เลยถ้าจะเอา อาจไม่ต้องซื้อใหม่

## ถอยกลับ

`domain change` สำรอง `.botforge-deploy.env.bak-<stamp>` (chmod 600) ไว้ก่อนแก้
DNS + ingress ของ domain เก่าไม่ถูกลบ (zone หายไปแล้ว ไม่มีอะไรให้ลบ)
LINE webhook ถอยกลับได้ด้วยการรัน `domain change` กลับไป domain เดิม

---

# แผนย้ายมารวมที่เครื่องเดียว (2026-08-25)

เป้าหมาย: ปิด bot ที่ office แล้วยก domain ใหม่ + V2 ขึ้นที่ `143.198.204.251`

## ตอนนี้ของอยู่ที่ไหน

| เครื่อง | อะไรรันอยู่ | เข้าถึง |
| --- | --- | --- |
| `27.130.59.37` office A (Debian 13) | 7 tunnel — `cowork-opencode` `legal-adkcode` `legal-claudecode` `legal-copilot` `legal-opencode` `onboard-opencode` `willpower-opencode` | ssh ผ่าน cloudflared tunnel |
| `110.77.138.198` office B | 1 tunnel — `nst-opencode` | ssh ผ่าน OpenVPN |
| `143.198.204.251` เครื่องนี้ | `legal-services` (ออกทาง Caddy ไม่ใช่ tunnel) | ตรง |
| ไม่ได้รันที่ไหนเลย | `cowork-claudecode` `dede-opencode` `hct-opencode` `mtr-opencode` `onboard-claudecode` | — |

## ⚠️ กับดักที่เห็นล่วงหน้าได้

### 1. token เดียวกันรันสองที่ = แบ่ง traffic ไม่ใช่ทับกัน

cloudflared รองรับ replica — ถ้ายก bot ขึ้นที่เครื่องนี้โดยที่ office ยังไม่ดับ
Cloudflare จะเห็นสอง origin แล้ว **สลับส่ง request ไปทั้งสองฝั่ง** ผลคือ bot ตอบมั่ว
บางข้อความเข้าเครื่องเก่า บางข้อความเข้าเครื่องใหม่ เซสชันขาดเป็นช่วง ๆ หาสาเหตุยากมาก

**ต้องดับฝั่ง office ให้ครบก่อนเสมอ** แล้วยืนยันด้วย
`./botforge-deploy tunnel list` ว่า status เป็น `down` ทุกตัวก่อนยกที่นี่

### 2. ทาง ssh เข้า office A อาจใช้ไม่ได้

tunnel ชื่อ `icbserv-ssh` ในบัญชีเดียวกันสถานะ **`down` conns=0**
ถ้านั่นคือทางที่ใช้ ssh เข้า office A อยู่ ต้องมีทางสำรองไว้ก่อนดับอะไร

### 3. `.env` บนเครื่องนี้เป็นสำเนาเดือนเมษา

`projects/*/bot-service/.env` ที่นี่แก้ล่าสุด **2026-04-18** ทั้งหมด
ส่วนของจริงที่ให้บริการอยู่คือของบนเครื่อง office ซึ่งอาจถูกแก้ไปแล้ว
(รหัส server ที่ตั้งไว้เมื่อ 2026-08-24 ก็ตั้งบนสำเนานี้ ไม่ได้แตะของจริง)

**ก่อนดับ office: copy `.env` และ `workspace/` ของ 8 project นั้นกลับมาก่อน**
ไม่งั้นยกขึ้นที่นี่ด้วย config เดือนเมษา

### 4. V2 ใช้ hostname คนละชื่อ

`botforge-migrate run <name>` สร้าง `projects/<name>-v2/` (container prefix `<name>-v2`)
`tunnel setup` จึงได้ `<name>-v2.<domain>` — **คนละ URL กับของเดิม** ซึ่งถูกต้องสำหรับ
การรันคู่กันเพื่อทดสอบ แต่ตอนตัดจริงต้องย้าย webhook ของ LINE ไปที่ชื่อใหม่
หรือเปลี่ยนชื่อโฟลเดอร์ให้เป็นชื่อเดิม (`workspace_id` คงเป็นชื่อเดิมอยู่แล้ว)

## ลำดับที่แนะนำ

```bash
# — บน office A / office B —
# 1. เอา config ของจริงกลับมาก่อน (ยังไม่ดับ)
#    scp projects/*/bot-service/.env  และ workspace/  กลับมาที่เครื่องนี้
# 2. ดับ
./botforge-deploy down all          # หรือ docker compose down ทีละตัว

# — บนเครื่องนี้ —
./botforge-deploy tunnel list        # ยืนยันว่า down หมดแล้วจริง

./botforge-deploy domain change sumana.org --dry-run
./botforge-deploy domain change sumana.org

./botforge-deploy up all --build     # ยกขึ้นที่นี่
./botforge-deploy domain show        # ยืนยัน webhook + LINE ยิงทดสอบผ่าน
```

ทำ V2 ทีหลัง ทีละตัว — `botforge-migrate check all` แล้ว `run` ตัวที่มั่นใจก่อน
ของเดิมไม่ถูกแตะ ถอยกลับได้ตลอด

## ที่ยังค้างอยู่ ไม่เกี่ยวกับการย้าย

`legal-services-server.eformservice.com` เปิดโล่งอยู่ (ดู [`open-items.md`](open-items.md))
ไม่เกี่ยวกับ domain ที่หมดอายุ และไม่หายไปเองหลังย้าย
