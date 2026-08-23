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
