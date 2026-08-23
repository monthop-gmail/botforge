# ย้าย 14 bot จาก V1 มา V2

**2026-08-24** · เครื่องมือ: [`botforge-migrate`](../../botforge-migrate)

---

## หลักการ — สร้างของใหม่คู่กัน ไม่แปลงของเดิมในที่

```
projects/legal-opencode/       ← V1 ยังรันอยู่ ไม่ถูกแตะเลย
projects/legal-opencode-v2/    ← V2 สร้างใหม่ รันคู่กันได้
```

container คนละชื่อ (`legal-opencode-*` กับ `legal-opencode-v2-*`) จึงขึ้นพร้อมกันได้
**ถอยกลับ = ชี้ tunnel กลับไปที่ตัวเดิม** ซึ่งยังไม่ถูกแตะ

> ไม่มีขั้นตอนไหนที่แก้ของเดิม จนกว่าคุณจะสั่งหยุดมันเอง

---

## ตัวตนต้องต่อเนื่อง

| | ค่า |
| --- | --- |
| โฟลเดอร์ · container prefix | `legal-opencode-v2` |
| **`BOTFORGE_WORKSPACE_ID`** | **`legal-opencode`** — ชื่อเดิม |
| `BOTFORGE_TENANT_ID` | `legal` |

**`workspace_id` ต้องเป็นชื่อเดิม** ไม่งั้น audit event ก่อนและหลังย้ายจะกลายเป็นคนละ workspace
ในสายตา `identity/v1` และความต่อเนื่องขาด — โฟลเดอร์เปลี่ยนได้ ตัวตนเปลี่ยนไม่ได้

> จุดนี้รอบแรกทำผิด (`workspace_id` ติด `-v2` ไปด้วย) แล้วแก้

---

## สถานะความพร้อม — ตรวจจริงเมื่อ 2026-08-24

```
พร้อมย้าย 13 · ติดปัญหา 1
```

| engine V1 | จำนวน | runtime V2 | |
| --- | ---: | --- | :-: |
| `opencode` | 9 | `opencode` | ✅ |
| `claude-code` | 2 | `claude` | ✅ |
| `adkcode` | 2 | `adkcode` | ✅ |
| **`copilot-cli`** | **1** | — | ❌ **ยังไม่มี adapter** |

`legal-copilot` ย้ายไม่ได้จนกว่าจะมี `adapter-copilot` — ต่างจาก `claude-code` แค่ 41 diff-lines
จึงน่าจะเร็ว แต่ตอนนี้พักไว้ตามที่ตกลง

> `codex-appserver` ย้ายได้ด้วย — V2 ยุบมันกับ `codex` เป็น adapter เดียวแล้ว

---

## ขั้นตอน

### 1. ดูภาพรวมก่อน — ไม่แก้อะไร

```bash
./botforge-migrate check all
```

### 2. ดูว่าจะทำอะไรกับตัวหนึ่ง — ไม่แก้อะไร

```bash
./botforge-migrate plan legal-opencode
```

บอกด้วยว่ามี key ไหนใน `.env` ที่ V2 **ยังไม่รู้จัก** — จะได้ไม่หายเงียบ

### 3. สร้างของใหม่

```bash
TENANT=legal ./botforge-migrate run legal-opencode
```

- สร้าง `projects/legal-opencode-v2/` จาก `templates/bot-service-v2`
- copy ค่าจาก `.env` เดิม (**ไม่พิมพ์ค่าออกหน้าจอทุกกรณี** · `.env` ใหม่ตั้ง `chmod 600`)
- copy `workspace/` แล้ว **ลบ `.git` ออก** เพื่อเริ่ม history ใหม่ ไม่ลาก history เดิมมาปน
- `API_PASSWORD` ของ V1 → `SERVER_PASSWORD` ของ V2

### 4. build image แล้วลองรัน — ยังไม่สลับ tunnel

```bash
npm run image
cd projects/legal-opencode-v2/bot-service
COMPOSE_PROFILES=opencode docker compose up -d
```

ทดสอบด้วย webhook ที่เซ็นเองก่อน (ดู [`apps/line-bot/README.md`](../../apps/line-bot/README.md))

### 5. สลับ tunnel

ตัวใหม่ใช้ `CLOUDFLARE_TUNNEL_TOKEN` เดิม — เปิดตัวใหม่แล้วหยุด `cloudflared` ของตัวเดิม
webhook URL ไม่เปลี่ยน

### 6. หยุดตัวเดิม (เมื่อมั่นใจแล้วเท่านั้น)

```bash
./botforge-deploy down legal-opencode
```

**อย่าลบ** — เก็บไว้เป็นทางถอยจนกว่าจะผ่านไปสักระยะ

---

## `.env` ที่ย้ายได้

| กลุ่ม | key |
| --- | --- |
| ทุก engine | `LINE_CHANNEL_ACCESS_TOKEN` `LINE_CHANNEL_SECRET` `LINE_OA_URL` `CLOUDFLARE_TUNNEL_TOKEN` `GITHUB_TOKEN` `PROMPT_TIMEOUT_MS` |
| `opencode` | `OPENCODE_PASSWORD` + API key ของ 7 provider |
| `claude` | `ANTHROPIC_API_KEY` `CLAUDE_MODEL` `CLAUDE_MAX_TURNS` `CLAUDE_MAX_BUDGET_USD` |
| `adkcode` | `GOOGLE_API_KEY` |
| `codex` | `CODEX_MODEL` |

key ที่ไม่อยู่ในรายการนี้ **ไม่ถูกย้าย และเครื่องมือจะเตือน** เช่น `ADKCODE_MODEL_SMART` ·
`ADKCODE_MODEL_FAST` ที่ V2 ยังไม่รองรับ · `GH_CONFIG_DIR` ของ copilot

---

## สิ่งที่ได้หลังย้าย

| | V1 | V2 |
| --- | --- | --- |
| ไฟล์ใน project | 13 (รวม `src/index.ts` ~900 บรรทัด) | **6 · 264 บรรทัด** |
| อัปเดตโค้ด | `botforge sync --full` copy ทับ | `docker compose pull` |
| เปลี่ยน engine | สร้าง project ใหม่ | แก้ `BOTFORGE_RUNTIME` |
| audit event | ไม่มีเลย | `event/v1` ครบทุกจังหวะ |
| request queue | **ไม่มีใน `opencode`** | มีทุก engine |
| error hints ไทย | **ไม่มีใน `opencode`** | มีทุก engine |

สามข้อล่างคือของที่ `opencode` ตกหล่นมาตลอด และ 9 ใน 14 bot ใช้ `opencode`

---

## ยังไม่ได้ทำ

- **ยังไม่ได้ย้ายจริงสักตัว** — เครื่องมือทดสอบด้วย fixture สังเคราะห์ ไม่ได้แตะ 14 bot จริง
- ยังไม่ได้ยิงกับ LINE channel จริง
- `adapter-copilot` สำหรับ `legal-copilot`
