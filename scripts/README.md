# scripts

## `smoke-opencode.ts` — ยิงเทิร์นเดียวกับ OpenCode server จริง

```bash
OPENCODE_URL=http://127.0.0.1:4096 \
  node --experimental-strip-types scripts/smoke-opencode.ts "คำถามของคุณ"
```

| env | ค่าเริ่มต้น |
| --- | --- |
| `OPENCODE_URL` | `http://localhost:4096` |
| `OPENCODE_PASSWORD` | — (ไม่ตั้ง = server ไม่ได้ล็อก) |
| `BOTFORGE_MODEL` | `opencode/big-pickle` — ฟรีผ่าน Zen |
| `PROMPT_TIMEOUT_MS` | `120000` |

## `scenarios/group-turns.ts` — สามเทิร์นในกลุ่ม LINE

พิสูจน์ของที่ unit test พิสูจน์ไม่ได้ — ต้องมี model จริงตัดสินใจเอง

1. คนอื่นคุยกันเอง → agent ตอบ `[SKIP]` → bot เงียบ
2. `@bot ...` → ตอบจริง
3. ถามต่อโดยไม่ทวนหัวข้อ → ตอบถูกบริบท = session ถูกใช้ซ้ำจริง

```bash
node --experimental-strip-types scripts/scenarios/group-turns.ts
```

## สตาร์ท OpenCode server สำหรับทดสอบ

ไม่ต้อง build image เต็มของ template (มี `pip install` จาก git ที่ไม่จำเป็นสำหรับ smoke test)

```bash
docker run -d --name botforge-v2-smoke \
  -p 127.0.0.1:4096:4096 \
  -v "$PWD/workspace:/workspace" \
  -v "$PWD/templates/bot-service-opencode/opencode.json:/root/.config/opencode/opencode.json:ro" \
  -w /workspace \
  ghcr.io/anomalyco/opencode:latest serve --hostname=0.0.0.0 --port=4096

docker rm -f botforge-v2-smoke      # เลิกใช้แล้วลบ
```

`opencode/big-pickle` กับ `opencode/nemotron-3-super` ใช้ได้เลยโดยไม่ต้องมี API key
ส่วน provider อื่นใน `opencode.json` ต้องมี key ของแต่ละเจ้า


## `web-demo.ts` — Definition of Done ครึ่งหลัง

```bash
node --experimental-strip-types scripts/web-demo.ts
# แล้วเปิด http://127.0.0.1:8788
```

ใช้ **`adapter-opencode` ตัวเดียวกับที่ LINE ใช้ โดยไม่แก้อะไรเลย** ต่อ Web channel แทน
พิสูจน์ว่า *"เปลี่ยน LINE → Web โดยไม่แก้ Runtime"* ทำได้จริง

ต้องมี OpenCode server รันอยู่ (ดูข้างบน) · `PORT` เปลี่ยนได้ · `BOTFORGE_MODEL` เลือก model ได้
