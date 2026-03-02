# Botforge — คู่มือภาษาไทย

สร้าง LINE Bot + AI Coding Agent แค่คำสั่งเดียว

---

## สิ่งที่ต้องเตรียม

- Docker & Docker Compose
- Bash shell (Linux/macOS/WSL)
- [LINE Developers Account](https://developers.line.biz)
- [Cloudflare Account](https://cloudflare.com) + domain
- AI API Key อย่างน้อย 1 ตัว

### API Keys ตาม engine ที่เลือก

**OpenCode engine:**
- [Qwen](https://dashscope.console.aliyun.com) — ฟรี tier มี (แนะนำ)
- [DeepSeek](https://platform.deepseek.com) — ถูกมาก
- [Google Gemini](https://aistudio.google.com) — ฟรี tier มี
- [Anthropic](https://console.anthropic.com) — Claude ($5 ขึ้นไป)
- [OpenAI](https://platform.openai.com) — GPT ($5 ขึ้นไป)

**Claude Code engine:**
- [Anthropic](https://console.anthropic.com) API key หรือใช้ Claude Pro/Max (OAuth)

---

## เริ่มต้นใช้งาน

### 1. Clone Botforge

```bash
git clone https://github.com/monthop-gmail/botforge.git
cd botforge
```

### 2. สร้าง Project ใหม่

```bash
./botforge new my-bot
```

ระบบจะถามข้อมูล:

```
  Engine:
    1) opencode    — Multi-model (Claude, GPT, Gemini, DeepSeek, Qwen)
    2) claude-code — Claude only (Agent SDK, simpler, cost control)
  Select [1]: 1

  GitHub org/user [monthop-gmail]: ↵
  Domain suffix [sumana.online]: ↵
  Proceed? [Y/n]: Y
```

### 3. ตั้งค่า Credentials

```bash
cd projects/my-bot/bot-service
cp .env.example .env
# แก้ .env ใส่ค่าจริง
```

### 4. Deploy

```bash
docker compose up -d --build
```

เสร็จ! Bot พร้อมใช้งานที่ `https://my-bot.sumana.online/webhook`

---

## เลือก Engine

### OpenCode — หลาย model หลาย provider

เหมาะสำหรับ:
- ต้องการใช้ได้หลาย model (Claude, GPT, Gemini, DeepSeek, Qwen)
- ต้องการสลับ model ได้จากใน LINE (`/model`)
- ต้องการ MCP tools (เช่น Odoo ERP)

ตั้งค่า `.env`:
```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
CLOUDFLARE_TUNNEL_TOKEN=...
QWEN_API_KEY=sk-...          # ฟรี
DEEPSEEK_API_KEY=sk-...      # ถูก
ANTHROPIC_API_KEY=sk-ant-... # Claude
OPENCODE_PASSWORD=changeme
```

### Claude Code — ง่าย เบา คุม cost ได้

เหมาะสำหรับ:
- ต้องการใช้แค่ Claude (Sonnet/Opus/Haiku)
- ต้องการ setup ง่ายๆ แค่ ANTHROPIC_API_KEY
- ต้องการคุม cost ด้วย `CLAUDE_MAX_BUDGET_USD`

ตั้งค่า `.env`:
```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
CLOUDFLARE_TUNNEL_TOKEN=...
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=sonnet
CLAUDE_MAX_TURNS=10
CLAUDE_MAX_BUDGET_USD=1.00
```

---

## ตั้งค่า LINE Bot

1. เข้า https://developers.line.biz/console/
2. **Create Provider** → ตั้งชื่อ
3. **Create Channel** → เลือก **Messaging API**
4. Tab **Messaging API**:
   - copy **Channel Secret**
   - กด **Issue** Channel Access Token → copy
5. Webhook settings:
   - URL: `https://my-bot.sumana.online/webhook`
   - Use webhook = **ON**
   - Auto-reply = **OFF**

---

## ตั้งค่า Cloudflare Tunnel

1. เข้า https://one.dash.cloudflare.com → **Networks** → **Tunnels**
2. **Create a tunnel** → ตั้งชื่อ: `my-bot`
3. copy **Tunnel Token**
4. เพิ่ม **Public Hostname**:
   - Subdomain: `my-bot`
   - Domain: `sumana.online` (หรือ domain ของคุณ)
   - Service: `HTTP` → `line-bot:3000`

---

## คำสั่ง LINE Bot

### OpenCode engine

| คำสั่ง | หน้าที่ |
|--------|---------|
| `/new` | เริ่ม session ใหม่ |
| `/abort` | ยกเลิก prompt |
| `/sessions` | ดู session status |
| `/model` | ดู/เปลี่ยน AI model (40+ ตัว) |
| `/about` | แนะนำตัว bot |
| `/help` | คำสั่งทั้งหมด |

### Claude Code engine

| คำสั่ง | หน้าที่ |
|--------|---------|
| `/new` | เริ่ม session ใหม่ |
| `/abort` | ยกเลิก prompt |
| `/sessions` | ดู session + cost |
| `/cost` | ดูค่าใช้จ่าย |

---

## คำสั่ง Botforge CLI

```bash
./botforge new <ชื่อ>    # สร้าง project ใหม่
./botforge list          # ดู projects ทั้งหมด
./botforge help          # วิธีใช้
```

### กฎตั้งชื่อ

- ตัวพิมพ์เล็ก + ขีดกลาง เท่านั้น
- ขึ้นต้นด้วยตัวอักษร
- 2-50 ตัวอักษร
- ตัวอย่าง: `hr-bot`, `customer-support`, `sales-01`

---

## จัดการ Docker

```bash
cd projects/<ชื่อ>/bot-service

# เริ่ม / หยุด
docker compose up -d             # เริ่ม
docker compose down              # หยุด
docker compose restart           # restart

# Logs
docker logs <ชื่อ>-line-bot -f   # log bot (realtime)
docker logs <ชื่อ>-server -f     # log AI server

# Rebuild หลังแก้ code
docker compose up -d --build line-bot    # rebuild เฉพาะ bot
docker compose up -d --build             # rebuild ทั้งหมด
```

---

## Customize Bot

### แก้พฤติกรรม bot

แก้ `workspace/AGENTS.md` — bot อ่านไฟล์นี้ทุกครั้งที่เริ่ม session

### แก้ code bot

แก้ `bot-service/src/index.ts` แล้ว rebuild:
```bash
docker compose up -d --build line-bot
```

### เปลี่ยน AI provider (OpenCode)

แก้ `bot-service/opencode.json`

### เปลี่ยน Claude model (Claude Code)

แก้ `CLAUDE_MODEL` ใน `.env` → `sonnet`, `opus`, หรือ `haiku`

---

## Troubleshooting

| ปัญหา | วิธีแก้ |
|--------|--------|
| Bot ไม่ตอบ | ตรวจ `.env` → ดู `docker logs <ชื่อ>-line-bot` |
| Tunnel ไม่เชื่อม | ตรวจ `CLOUDFLARE_TUNNEL_TOKEN` + hostname ใน Cloudflare Dashboard |
| AI ไม่ตอบ | ตรวจ API key ของ provider ที่ใช้ |
| Webhook 403 | `LINE_CHANNEL_SECRET` ผิด |
| Timeout | เพิ่ม `PROMPT_TIMEOUT_MS` ใน `.env` |
| Container ไม่ start | `docker compose logs` ดู error |

---

## Links

- **GitHub:** https://github.com/monthop-gmail/botforge
- **Issues:** https://github.com/monthop-gmail/botforge/issues
- **LINE Developers:** https://developers.line.biz
- **Cloudflare:** https://cloudflare.com

---

*Botforge — สร้าง LINE Bot + AI Coding Agent แค่คำสั่งเดียว*
