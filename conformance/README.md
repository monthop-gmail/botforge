# conformance

ตรวจว่า Botforge ยังพูดภาษาเดียวกับ `agent-platform` — **ข้อยกเว้นเดียวที่มี code ได้ นอกจาก `packages/`**

ADR-0006 ของ `agent-platform` กำหนดว่า consumer ต้องมีครบ 3 อย่าง:

| # | ข้อกำหนด | ที่นี่ | สถานะ |
| :-: | --- | --- | :-: |
| 1 | manifest | [`platform-contract.yaml`](../platform-contract.yaml) | ✅ |
| 2 | conformance test ที่ validate **payload จริง** | `payload_check.py` — `error/v1` 14 ใบ · `channel-event/v1` 17 ใบ | ✅ |
| 3 | release gate — CI ไม่ผ่าน = merge ไม่ได้ | ruleset `V1 freeze — main` + [`ci.yml`](../.github/workflows/ci.yml) | ✅ |

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

## schema ที่ vendor ไว้ 8 ไฟล์ แต่ประกาศใน manifest แค่ 2

`event/v1` `$ref` ไปหา `identity` `error` `model` `policy` `consent` และต่อไปถึง
`capability` `tool` — ต้อง resolve ให้ได้ครบตอน validate ไม่งั้น `payload_check` รันไม่ผ่าน
การ vendor ไว้จึงไม่ได้แปลว่าประกาศว่าใช้ · `contracts:` ของ manifest ยังมีแค่
`error/v1` กับ `event/v1` ตามที่มี payload จริงให้ตรวจ

## ทำไม heuristic หา credential ข้าม field ที่เป็น id

LINE id คือ hex 32 ตัวโดยธรรมชาติ (`line-ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3`)
ซึ่งชน pattern ของ hex ยาวโดยไม่ได้เป็น credential เลย
`payload_check.py` จึงสแกนเฉพาะส่วนที่เป็น **ข้อความอิสระ** — `error.message`
`transition.reason` `metadata` `actor.display_name` `source.system` `message_id`

## ยังไม่ได้ทำ

- `drift_check.py` ตอน dev เทียบกับ working tree ของ sibling ซึ่งไม่รับประกันว่าอยู่ที่ commit ที่ pin
  (มีคำเตือนบอกตอนรัน) · ตอน CI ดึงจาก GitHub ที่ commit ที่ pin จริง
- `v2` ยังไม่มี required check โดยตั้งใจ — gate อยู่ที่ `main` ซึ่งเป็นสายที่ปล่อยของจริง
  ใส่ที่ `v2` แล้วจะ push ตรงไม่ได้ทั้งที่ยังเป็น repo คนเดียว · จะใส่ตอนมีผู้ร่วมพัฒนา
