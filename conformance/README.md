# conformance

ตรวจว่า Botforge ยังพูดภาษาเดียวกับ `agent-platform` — **ข้อยกเว้นเดียวที่มี code ได้ นอกจาก `packages/`**

ADR-0006 ของ `agent-platform` กำหนดว่า consumer ต้องมีครบ 3 อย่าง:

| # | ข้อกำหนด | ที่นี่ | สถานะ |
| :-: | --- | --- | :-: |
| 1 | manifest | [`platform-contract.yaml`](../platform-contract.yaml) | ✅ |
| 2 | conformance test ที่ validate **payload จริง** | `payload_check.py` — `error/v1` 16 ใบ · `channel-event/v1` 17 ใบ + สำมะโน leaf | ✅ |
| 3 | release gate — CI ไม่ผ่าน = merge ไม่ได้ | ruleset `V1 freeze — main` + `V2 release gate — v2` + [`ci.yml`](../.github/workflows/ci.yml) | ✅ |

## รัน

```bash
python3 conformance/drift_check.py      # vendor ยังตรงกับต้นทางที่ pin ไหม
python3 conformance/payload_check.py    # payload ที่ core ผลิตจริงผ่าน schema ไหม
```

ต้องมี `pyyaml` `jsonschema` `referencing` และ `node` 22+

## ไฟล์

| ไฟล์ | หน้าที่ |
| --- | --- |
| `pinned.yaml` | commit ของ `agent-platform` ที่ vendor ไว้ + รายการ schema |
| `vendor/` | สำเนา schema ที่ commit นั้น — **ห้ามแก้ด้วยมือ** |
| `drift_check.py` | เทียบ `vendor/` กับต้นทาง (local checkout ตอน dev · GitHub ตอน CI) |
| `emit_payloads.ts` | ให้ `@botforge/core` ปล่อย payload จริงออกมา |
| `payload_check.py` | validate payload นั้นกับ schema + ตรวจ guarantee ที่ JSON Schema ตรวจไม่ได้ |

## ทำไม `emit_payloads.ts` ห้ามเขียน object ตรง ๆ

ADR-0006 ข้อ 2 ต้องการ payload **จริงที่ระบบผลิตออกมา** ไม่ใช่ fixture ที่เขียนให้ผ่าน
`emit_payloads.ts` จึงเรียก `classify()` ของ core จริง แล้วส่งผลลัพธ์ออกทาง stdout
— ถ้า core เปลี่ยนพฤติกรรมจนผิด contract ไฟล์นี้จะจับได้ · ถ้าเขียน object เอง จะจับไม่ได้เลย

## guarantee ที่ JSON Schema ตรวจให้ไม่ได้

`payload_check.py` ตรวจเพิ่มเอง:

- `error/v1.message` **ห้ามมี credential** — ตรวจ `sk-*` `ghp_*` `Bearer *` และ hex ยาว
- `message` ยาวไม่เกิน 200 ตัวอักษร — เท่ากับที่ v1 ตัดไว้

## สำมะโน leaf — RFC-0013 · `event/v1` semantics 1.3

กฎใหม่ของ `event/v1`: **leaf ที่อาจถือข้อความของคนต้องประกาศไว้ในสัญญา ที่เหลือทุก leaf
เป็นตัวชี้** · กฎอยู่ที่ระดับ leaf ไม่ใช่ field ระดับบน

`payload_check.py` เดิน leaf ทุกตัวของ payload จริงทั้งสองสัญญา (34 leaf ต่างกัน) แล้วบังคับว่า
แต่ละตัวต้องอยู่ในทะเบียนตัวชี้ (`EVENT_POINTERS` / `ERROR_POINTERS` ในไฟล์นั้น)
หรือถูกประกาศใน `text_fields` ของ [`platform-contract.yaml`](../platform-contract.yaml)
— **leaf ใหม่ที่ยังไม่มีใครตัดสินใจเรื่องมันจะแดง** ไม่ใช่ผ่านเงียบ ๆ

การประกาศถูก**อ่านจากใบโดยตรง** ไฟล์นี้ไม่ถือสำเนา · รายการที่แยกจากตัวตรวจจะ drift
ภายในเดือนเดียว ซึ่งเป็นข้อที่ RFC-0013 ปฏิเสธไว้เอง

สามข้อที่ปิดด้วยโค้ด ไม่ใช่ด้วยคำแถลง:

| | |
| --- | --- |
| `actor.display_name` | **ห้ามมีในใบไหนเลย** — ชื่อคนจากโปรไฟล์ LINE · ตัดที่ emit แล้ว |
| `metadata` | open bag ของ `event/v1` → ปิดด้วยทะเบียน key · key นอกทะเบียนแดง |
| `error.details` | open bag อีกตัว → ต้องว่างหรือเป็นตัวชี้ · ปิดก่อนมีคนใส่ครั้งแรก |

### selftest สองทาง — ADR-0011

เช็คที่ไม่เคยเห็นของผิดบอกไม่ได้ว่ามันทำงาน · สีเขียวของสำมะโนอ่านได้พอดีทั้ง
*"ไม่มี leaf แปลกปลอม"* และ *"ไม่ได้เดินเลย"* · `payload_check.py` จึงรัน 6 เคสทุกครั้ง
โดย**กลายพันธุ์จาก payload จริง** ไม่ใช่เขียน fixture ใหม่:

```
ชื่อคนกลับเข้ามา · key ใหม่ใน metadata · error.details มีของ · leaf ใหม่ใน error/v1
ถอดการประกาศออกจากใบแล้วต้องแดง   ← พิสูจน์ว่าทะเบียนมาจาก manifest จริง
ของจริงที่ไม่ได้แตะต้องเงียบ        ← กันเช็คที่แดงทุกอย่าง
```

และตอนจบมันพิมพ์ว่าเดินไปกี่ leaf — **ศูนย์จากการเดิน 34 ที่ กับศูนย์จากการเดินศูนย์ที่
เป็นคนละคำตอบ**

## schema ที่ vendor ไว้ 8 ไฟล์ แต่ประกาศใน manifest แค่ 2

`event/v1` `$ref` ไปหา `identity` `error` `model` `policy` `consent` และต่อไปถึง
`capability` `tool` — ต้อง resolve ให้ได้ครบตอน validate ไม่งั้น `payload_check` รันไม่ผ่าน
การ vendor ไว้จึงไม่ได้แปลว่าประกาศว่าใช้ · `contracts:` ของ manifest ยังมีแค่
`error/v1` กับ `event/v1` ตามที่มี payload จริงให้ตรวจ

## ทำไม heuristic หา credential ข้าม field ที่เป็น id

LINE id คือ hex 32 ตัวโดยธรรมชาติ (`line-ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3`)
ซึ่งชน pattern ของ hex ยาวโดยไม่ได้เป็น credential เลย
`payload_check.py` จึงสแกนเฉพาะส่วนที่เป็น **ข้อความอิสระ** — `error.message`
`transition.reason` `metadata` `source.system` `message_id`
(`actor.display_name` ยังอยู่ในรายการสแกน แต่วันนี้ห้ามมีอยู่แล้วตั้งแต่ชั้นสำมะโน)

## ยังไม่ได้ทำ

- `drift_check.py` ตอน dev เทียบกับ working tree ของ sibling ซึ่งไม่รับประกันว่าอยู่ที่ commit ที่ pin
  (มีคำเตือนบอกตอนรัน) · ตอน CI ดึงจาก GitHub ที่ commit ที่ pin จริง
- ~~`v2` ยังไม่มี required check~~ — **ข้อนี้ไม่จริงแล้ว** ruleset `V2 release gate — v2`
  `enforcement: active` อยู่บน GitHub จริง (ตรวจด้วย `gh api repos/.../rulesets` เมื่อ 2026-09-20)
  ตามที่ `agent-platform#43` ทักว่า gate ที่คุมแต่ branch ที่ freeze ไว้ไม่ได้กันอะไรเลย
- log ของ audit event ยังไม่มีเพดาน — sink เขียนลง stdout → docker `json-file` ที่ไม่มี
  rotation ทั้งใน `apps/line-bot/docker-compose.yml` และที่ daemon · ต้องตั้งก่อน V2 ขึ้นของจริง
  (เขียนไว้ที่ `cutover.retention_layer` ของ manifest)
