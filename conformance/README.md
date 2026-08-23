# conformance

ตรวจว่า Botforge ยังพูดภาษาเดียวกับ `agent-platform` — **ข้อยกเว้นเดียวที่มี code ได้ นอกจาก `packages/`**

ADR-0006 ของ `agent-platform` กำหนดว่า consumer ต้องมีครบ 3 อย่าง:

| # | ข้อกำหนด | ที่นี่ | สถานะ |
| :-: | --- | --- | :-: |
| 1 | manifest | [`docs/architecture/platform-contract.draft.yaml`](../docs/architecture/platform-contract.draft.yaml) | 🚧 ยังเป็นร่าง ยังไม่ขึ้น root |
| 2 | conformance test ที่ validate **payload จริง** | `payload_check.py` | ✅ |
| 3 | release gate — CI ไม่ผ่าน = merge ไม่ได้ | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | 🚧 ต้องตั้ง required check ใน repo settings |

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

## ยังไม่ได้ทำ

- `event/v1` vendor ไว้แล้วแต่ยังไม่มี payload ให้ตรวจ — core ยังไม่ปล่อย event
- `drift_check.py` ตอน dev เทียบกับ working tree ของ sibling ซึ่งไม่รับประกันว่าอยู่ที่ commit ที่ pin
  (มีคำเตือนบอกตอนรัน) · ตอน CI ดึงจาก GitHub ที่ commit ที่ pin จริง
