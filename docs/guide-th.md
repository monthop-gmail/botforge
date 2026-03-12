# Botforge — คู่มือภาษาไทย

สร้าง LINE Bot + AI Coding Agent แค่คำสั่งเดียว

---

## สิ่งที่ต้องเตรียม

- Docker & Docker Compose
- Bash shell (Linux/macOS/WSL)
- [LINE Developers Account](https://developers.line.biz)
- [Cloudflare Account](https://cloudflare.com) + domain
- AI API Key อย่างน้อย 1 ตัว (หรือ OAuth/ADC login สำหรับ Gemini CLI, Qwen Code, Codex, ADKcode, Copilot CLI)

### API Keys ตาม engine ที่เลือก

**OpenCode engine:**
- [Qwen](https://dashscope.console.aliyun.com) — ฟรี tier มี (แนะนำ)
- [DeepSeek](https://platform.deepseek.com) — ถูกมาก
- [Google Gemini](https://aistudio.google.com) — ฟรี tier มี
- [Anthropic](https://console.anthropic.com) — Claude ($5 ขึ้นไป)
- [OpenAI](https://platform.openai.com) — GPT ($5 ขึ้นไป)

**Claude Code engine:**
- [Anthropic](https://console.anthropic.com) API key หรือใช้ Claude Pro/Max (OAuth)

**Gocode engine:**
- OpenAI-compatible API key (DeepSeek, GPT, Qwen, Groq, Ollama)

**ADKcode engine:**
- [Google Gemini](https://aistudio.google.com) API key หรือใช้ Vertex AI + ADC (ไม่ต้องมี key)

**Gemini CLI engine:**
- [Google Gemini](https://aistudio.google.com) API key หรือใช้ OAuth login (ไม่ต้องมี key)

**Qwen Code engine:**
- [DashScope](https://dashscope.console.aliyun.com) API key หรือใช้ Qwen OAuth (ฟรี 1,000 req/วัน)

**Codex engine:**
- [OpenAI](https://platform.openai.com) API key หรือใช้ ChatGPT Plus/Pro login (ไม่ต้องมี API key)

**Copilot CLI engine:**
- [GitHub Copilot](https://github.com/settings/copilot) subscription + `gh auth login` หรือ PAT with Copilot Requests permission

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
    1) opencode    — Multi-model (Claude, GPT, Gemini, DeepSeek, Qwen, Groq)
    2) claude-code — Claude only (Agent SDK, simpler, cost control)
    3) gocode      — Go + OpenAI-compatible LLM
    4) adkcode     — Google ADK + Gemini multi-agent
    5) gemini-cli  — Google Gemini CLI (agentic, session support)
    6) qwen-code  — Alibaba Qwen Code CLI (agentic, free 1K req/day)
    7) codex       — OpenAI Codex CLI (agentic, ChatGPT login or API key)
    8) copilot-cli — GitHub Copilot SDK (Claude/GPT-5/o4-mini, GitHub OAuth)
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
- ต้องการใช้ได้หลาย model (Claude, GPT, Gemini, DeepSeek, Qwen, Groq)
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
- ต้องการ setup ง่ายๆ แค่ ANTHROPIC_API_KEY หรือ OAuth
- ต้องการคุม cost ด้วย `CLAUDE_MAX_BUDGET_USD`
- รองรับ system prompt จาก `workspace/CLAUDE.md` + `workspace/AGENTS.md` (auto-load)
- รองรับ MCP tools จาก `workspace/.mcp.json` (auto-load)

ตั้งค่า `.env` (API key):
```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
CLOUDFLARE_TUNNEL_TOKEN=...
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=sonnet
CLAUDE_MAX_TURNS=10
CLAUDE_MAX_BUDGET_USD=1.00
```

หรือใช้ OAuth (ไม่ต้องมี API key):
```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
CLOUDFLARE_TUNNEL_TOKEN=...
ANTHROPIC_API_KEY=
CLAUDE_MODEL=sonnet
CLAUDE_MAX_TURNS=10
CLAUDE_MAX_BUDGET_USD=1.00
```

ถ้า host มี `~/.claude` อยู่แล้ว → ใช้ได้เลย (mount เฉพาะ `.credentials.json` + `settings.json`)
ถ้าไม่มี → login ใน container: `docker exec -it <container>-server claude login`

### Gocode — Go + OpenAI-compatible LLM

เหมาะสำหรับ:
- ต้องการ self-host ใช้กับ LLM ที่รองรับ OpenAI format
- ต้องการ performance สูง (Go server)
- รองรับ DeepSeek, GPT, Qwen, Groq, Ollama

ตั้งค่า `.env`:
```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
CLOUDFLARE_TUNNEL_TOKEN=...
GOCODE_API_KEY=sk-...
GOCODE_BASE_URL=https://api.deepseek.com/v1
GOCODE_MODEL=deepseek-chat
```

### ADKcode — Google ADK + Gemini multi-agent

เหมาะสำหรับ:
- ต้องการ multi-agent workflow (orchestrator → coder, reviewer, tester)
- ใช้ Google Gemini เป็นหลัก
- ต้องการ Google ecosystem

ตั้งค่า `.env` (API key):
```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
CLOUDFLARE_TUNNEL_TOKEN=...
GOOGLE_API_KEY=AIza...
ADKCODE_MODEL_SMART=gemini-2.5-flash
ADKCODE_MODEL_FAST=gemini-2.0-flash
```

หรือใช้ Vertex AI + ADC (ไม่ต้องมี API key):
```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
CLOUDFLARE_TUNNEL_TOKEN=...
GOOGLE_API_KEY=
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
ADKCODE_MODEL_SMART=gemini-2.5-flash
ADKCODE_MODEL_FAST=gemini-2.0-flash
```

ต้อง login ADC บน host ก่อน: `gcloud auth application-default login`

### Gemini CLI — Google Gemini CLI agentic

เหมาะสำหรับ:
- ต้องการ agentic AI จาก Google (อ่าน/เขียนไฟล์, shell, Google Search)
- ต้องการ session support (คุยต่อเนื่อง)
- ใช้ OAuth login ได้เลย ไม่ต้องมี API key

ตั้งค่า `.env` (OAuth — แนะนำ):
```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
CLOUDFLARE_TUNNEL_TOKEN=...
GEMINI_HOME=~/.gemini
GEMINI_MODEL=gemini-2.5-flash
```

หรือใช้ API key:
```env
GEMINI_API_KEY=AIza...
GEMINI_HOME=
```

### Qwen Code — Alibaba Qwen Code CLI agentic

เหมาะสำหรับ:
- ต้องการ agentic AI จาก Alibaba (อ่าน/เขียนไฟล์, shell)
- ต้องการ session support (คุยต่อเนื่อง)
- ใช้ OAuth login ฟรี 1,000 req/วัน ไม่ต้องมี API key

ตั้งค่า `.env` (OAuth — แนะนำ):
```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
CLOUDFLARE_TUNNEL_TOKEN=...
QWEN_HOME=~/.qwen
QWEN_MODEL=qwen3-coder-plus
```

หรือใช้ API key:
```env
DASHSCOPE_API_KEY=sk-...
QWEN_HOME=
```

### Codex — OpenAI Codex CLI agentic

เหมาะสำหรับ:
- ต้องการ agentic AI จาก OpenAI (อ่าน/เขียนไฟล์, shell)
- ต้องการ session support (คุยต่อเนื่อง)
- ใช้ ChatGPT login ได้เลย ไม่ต้องมี API key (ใช้ plan ChatGPT Plus/Pro)

ตั้งค่า `.env` (ChatGPT login — แนะนำ):
```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
CLOUDFLARE_TUNNEL_TOKEN=...
CODEX_HOME=~/.codex
CODEX_MODEL=o4-mini
```

หรือใช้ API key:
```env
CODEX_API_KEY=sk-...
CODEX_HOME=
```

### Copilot CLI — GitHub Copilot SDK multi-model

เหมาะสำหรับ:
- ต้องการใช้ GitHub Copilot (Claude 4.5, GPT-5, o4-mini)
- มี GitHub Copilot subscription อยู่แล้ว
- ใช้ `gh auth login` ได้เลย mount จาก host
- รองรับ system prompt จาก `workspace/CLAUDE.md` + `workspace/AGENTS.md` (auto-load)
- รองรับ MCP tools จาก `workspace/.mcp.json` (auto-load)

ตั้งค่า `.env` (gh CLI OAuth — แนะนำ):
```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
CLOUDFLARE_TUNNEL_TOKEN=...
GH_CONFIG_DIR=~/.config/gh
COPILOT_MODEL=claude-sonnet-4.5
```

หรือใช้ GitHub Token:
```env
GITHUB_TOKEN=ghp_...
GH_CONFIG_DIR=
```

ถ้า host มี `~/.config/gh` อยู่แล้ว (จาก `gh auth login`) → ใช้ได้เลย
ถ้าไม่มี → login ใน container: `docker exec -it <container>-server copilot /login`

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

### วิธีที่ 1: ใช้ botforge-deploy (แนะนำ)

```bash
# ตั้งค่า Cloudflare API Token ครั้งแรก
./botforge-deploy tunnel init

# สร้าง tunnel + DNS อัตโนมัติ
./botforge-deploy tunnel setup my-bot
```

ระบบจะสร้าง tunnel + DNS 2 records ให้อัตโนมัติ:
- `my-bot.sumana.online` → LINE Bot webhook
- `my-bot-server.sumana.online` → AI Server

API Token ต้องมีสิทธิ์:
- Account > Cloudflare Tunnel > Edit
- Zone > DNS > Edit

สร้างได้ที่: https://dash.cloudflare.com/profile/api-tokens

### วิธีที่ 2: สร้างเองผ่าน Cloudflare Dashboard

1. เข้า https://one.dash.cloudflare.com → **Networks** → **Tunnels**
2. **Create a tunnel** → ตั้งชื่อ: `my-bot`
3. copy **Tunnel Token** → ใส่ใน `.env`
4. เพิ่ม **Public Hostname** 2 รายการ:
   - `my-bot.sumana.online` → `HTTP` → `my-bot-line-bot:3000`
   - `my-bot-server.sumana.online` → `HTTP` → `my-bot-server:4096`

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
| `/about` | แนะนำตัว bot |
| `/help` | คำสั่งทั้งหมด |

### Gocode engine

| คำสั่ง | หน้าที่ |
|--------|---------|
| `/new` | เริ่ม session ใหม่ |
| `/abort` | ยกเลิก prompt |
| `/sessions` | ดู session status |
| `/about` | แนะนำตัว bot |
| `/help` | คำสั่งทั้งหมด |

### ADKcode engine

| คำสั่ง | หน้าที่ |
|--------|---------|
| `/new` | เริ่ม session ใหม่ |
| `/abort` | ยกเลิก prompt |
| `/sessions` | ดู session status |
| `/about` | แนะนำตัว bot |
| `/help` | คำสั่งทั้งหมด |

### Gemini CLI engine

| คำสั่ง | หน้าที่ |
|--------|---------|
| `/new` | เริ่ม session ใหม่ |
| `/abort` | ยกเลิก prompt |
| `/sessions` | ดู session status |

### Qwen Code engine

| คำสั่ง | หน้าที่ |
|--------|---------|
| `/new` | เริ่ม session ใหม่ |
| `/abort` | ยกเลิก prompt |
| `/sessions` | ดู session status |
| `/about` | แนะนำตัว bot |
| `/help` | คำสั่งทั้งหมด |

### Codex engine

| คำสั่ง | หน้าที่ |
|--------|---------|
| `/new` | เริ่ม session ใหม่ |
| `/abort` | ยกเลิก prompt |
| `/sessions` | ดู session status |
| `/about` | แนะนำตัว bot |
| `/help` | คำสั่งทั้งหมด |

### Copilot CLI engine

| คำสั่ง | หน้าที่ |
|--------|---------|
| `/new` | เริ่ม session ใหม่ |
| `/abort` | ยกเลิก prompt |
| `/sessions` | ดู session + cost |
| `/cost` | ดูค่าใช้จ่าย |
| `/about` | แนะนำตัว bot |
| `/help` | คำสั่งทั้งหมด |

---

## คำสั่ง Botforge CLI

```bash
./botforge new <ชื่อ>           # สร้าง project ใหม่
./botforge sync <ชื่อ|all>      # sync infra files กับ template ล่าสุด
./botforge list                 # ดู projects ทั้งหมด
./botforge deploy <command>     # deploy & manage (ทางลัดของ botforge-deploy)
./botforge help                 # วิธีใช้
```

### กฎตั้งชื่อ

- ตัวพิมพ์เล็ก + ขีดกลาง เท่านั้น
- ขึ้นต้นด้วยตัวอักษร
- 2-50 ตัวอักษร
- ตัวอย่าง: `hr-bot`, `customer-support`, `sales-01`

---

## Botforge Deploy — จัดการหลาย Bot พร้อมกัน

เมื่อมีหลาย project ใน `projects/` ใช้ `botforge-deploy` จัดการทั้งหมดจากที่เดียว:

### Deploy commands

```bash
./botforge-deploy up                           # Start ทุก bot
./botforge-deploy up all --build               # Build & start ทุก bot
./botforge-deploy up dede-opencode             # Start bot เดียว
./botforge-deploy down all                     # หยุดทุก bot
./botforge-deploy down mtr-opencode            # หยุด bot เดียว
./botforge-deploy restart all                  # Restart ทุก bot
./botforge-deploy rebuild hct-opencode         # Rebuild & restart
./botforge-deploy rebuild dede-opencode line-bot  # Rebuild เฉพาะ service
```

### Monitoring commands

```bash
./botforge-deploy status                       # ดู status ทุก bot
./botforge-deploy ps                           # ดู containers
./botforge-deploy logs cowork-claudecode       # ดู logs
./botforge-deploy logs dede-opencode server 50 # 50 บรรทัดล่าสุดของ server
```

### Tunnel commands

```bash
./botforge-deploy tunnel init                  # ตั้งค่า Cloudflare API Token
./botforge-deploy tunnel setup all             # สร้าง tunnel ทุก project
./botforge-deploy tunnel setup dede-opencode   # สร้าง tunnel project เดียว
./botforge-deploy tunnel list                  # ดู tunnels ทั้งหมด
./botforge-deploy tunnel delete mtr-opencode   # ลบ tunnel
```

### ตัวอย่าง status output

```
  PROJECT                   ENGINE       SERVER     BOT        TUNNEL
  ─────────────────────────────────────────────────────────────────────
  cowork-claudecode         claude-code  running    running    running
  dede-opencode             opencode     running    running    running
  hct-opencode              opencode     running    running    running
  mtr-opencode              opencode     running    running    running
  nst-opencode              opencode     running    running    running
  willpower-opencode        opencode     running    running    running
```

---

## Customize Bot

### แก้พฤติกรรม bot

แก้ `workspace/AGENTS.md` — bot อ่านไฟล์นี้ทุกครั้งที่เริ่ม session

### แก้ code bot

แก้ `bot-service/src/index.ts` แล้ว rebuild:
```bash
docker compose up -d --build line-bot
# หรือใช้ botforge-deploy:
./botforge-deploy rebuild my-bot line-bot
```

### เปลี่ยน AI provider (OpenCode)

แก้ `bot-service/opencode.json`

### เปลี่ยน Claude model (Claude Code)

แก้ `CLAUDE_MODEL` ใน `.env` → `sonnet`, `opus`, หรือ `haiku`

### เปลี่ยน LLM provider (Gocode)

แก้ `GOCODE_BASE_URL` และ `GOCODE_MODEL` ใน `.env` (รองรับ DeepSeek, OpenAI, Qwen, Groq, Together, Ollama)

### เปลี่ยน Gemini model (ADKcode)

แก้ `ADKCODE_MODEL_SMART` และ `ADKCODE_MODEL_FAST` ใน `.env`

### เปลี่ยน Gemini model (Gemini CLI)

แก้ `GEMINI_MODEL` ใน `.env` → `gemini-2.5-flash`, `gemini-2.5-pro`, หรือ `gemini-2.0-flash`

### เปลี่ยน Qwen model (Qwen Code)

แก้ `QWEN_MODEL` ใน `.env` → `qwen3-coder-plus`, `qwen3.5-plus`, หรือ `qwen3-coder-next`

### เปลี่ยน Codex model (Codex)

แก้ `CODEX_MODEL` ใน `.env` → `o4-mini`, `o3`, หรือ `gpt-4.1`

### เปลี่ยน Copilot model (Copilot CLI)

แก้ `COPILOT_MODEL` ใน `.env` → `claude-sonnet-4.5`, `gpt-5`, หรือ `o4-mini`

---

## Troubleshooting

| ปัญหา | วิธีแก้ |
|--------|--------|
| Bot ไม่ตอบ | ตรวจ `.env` → ดู `./botforge-deploy logs <ชื่อ> line-bot` |
| Tunnel ไม่เชื่อม | `./botforge-deploy tunnel list` ดู status + ตรวจ token |
| AI ไม่ตอบ | ตรวจ API key ของ provider ที่ใช้ |
| Webhook 403 | `LINE_CHANNEL_SECRET` ผิด |
| Timeout | เพิ่ม `PROMPT_TIMEOUT_MS` ใน `.env` |
| Container ไม่ start | `./botforge-deploy logs <ชื่อ>` ดู error |
| Containers ชนกัน | ใช้ `./botforge-deploy` แทน `docker compose` ตรง (project name isolation) |

---

## Links

- **GitHub:** https://github.com/monthop-gmail/botforge
- **Issues:** https://github.com/monthop-gmail/botforge/issues
- **LINE Developers:** https://developers.line.biz
- **Cloudflare:** https://cloudflare.com

---

*Botforge — สร้าง LINE Bot + AI Coding Agent แค่คำสั่งเดียว*
