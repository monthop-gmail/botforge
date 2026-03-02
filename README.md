# Botforge

**Create AI-powered LINE Bots in seconds.** One command to generate a fully working LINE Bot with multi-model AI support, ready to deploy with Docker. Choose your engine: **OpenCode** (40+ models) or **Claude Code** (Anthropic Agent SDK).

```bash
./botforge new my-bot
```

---

## Features

- **One-command setup** — Generate a complete LINE Bot project with a single command
- **2 AI engines** — OpenCode (40+ models) or Claude Code (Agent SDK, simpler)
- **Docker-ready** — 3-container architecture: Bot + AI Server + Tunnel
- **Self-hosted** — Run on your own server, full control, no vendor lock-in
- **Customizable** — Edit bot behavior via `AGENTS.md`, swap AI providers, add MCP tools
- **Open Source** — MIT License, 100% free, forever

## Engines

Choose your AI engine when creating a project:

| | **OpenCode** | **Claude Code** |
|---|---|---|
| **AI Models** | 40+ (Claude, GPT, Gemini, DeepSeek, Qwen) | Claude only (Sonnet, Opus, Haiku) |
| **Middleware** | OpenCode Server | Claude Agent SDK (direct) |
| **Complexity** | More features, more config | Simpler, lighter |
| **Cost control** | Per-provider | Built-in `CLAUDE_MAX_BUDGET_USD` |
| **Best for** | Multi-model flexibility | Claude-focused, simple setup |

## How It Works

Each project generates two components:

| Component | Description |
|-----------|-------------|
| **bot-service** | LINE Bot + AI Server + Cloudflare Tunnel (Docker Compose) |
| **workspace** | Knowledge base — bot instructions, skills, memory, docs |

### Architecture

**OpenCode engine:**
```
LINE App → Tunnel → LINE Bot (Bun) → OpenCode Server (port 4096)
                                        |--- Claude, GPT, Gemini
                                        |--- DeepSeek, Qwen
                                        '--- 40+ models
```

**Claude Code engine:**
```
LINE App → Tunnel → LINE Bot (Bun) → Claude Code Server (Hono + Agent SDK)
                                        '--- Anthropic API (Sonnet/Opus/Haiku)
```

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Bash shell
- [LINE Developers Account](https://developers.line.biz)
- [Cloudflare Account](https://cloudflare.com) with a domain
- At least 1 AI API key:
  - **OpenCode engine:** [Qwen](https://dashscope.console.aliyun.com) or [DeepSeek](https://platform.deepseek.com) (free/cheap tiers)
  - **Claude Code engine:** [Anthropic](https://console.anthropic.com) API key

### 1. Clone & Create

```bash
git clone https://github.com/monthop-gmail/botforge.git
cd botforge
./botforge new my-bot
```

### 2. Configure

```bash
cd projects/my-bot/bot-service
cp .env.example .env
# Edit .env with your credentials
```

### 3. Deploy

```bash
docker compose up -d --build
```

Your bot is live at `https://my-bot.yourdomain.com/webhook`

---

## Commands

| Command | Description |
|---------|-------------|
| `./botforge new <name>` | Create a new project |
| `./botforge list` | List all projects |
| `./botforge help` | Show help |

### Example

```
$ ./botforge new customer-support

  Engine:
    1) opencode    — Multi-model (Claude, GPT, Gemini, DeepSeek, Qwen)
    2) claude-code — Claude only (Agent SDK, simpler, cost control)
  Select [1]: 2

  GitHub org/user [monthop-gmail]:
  Domain suffix [sumana.online]:

  Summary:
    Project:    customer-support
    Engine:     claude-code
    ...

  Generating bot-service... done
  Generating workspace...   done

  Webhook URL: https://customer-support.sumana.online/webhook
```

### Naming Rules

- Lowercase letters, numbers, and hyphens only
- Must start with a letter
- 2-50 characters
- Examples: `hr-bot`, `customer-support`, `sales-assistant`

---

## Generated Project Structure

**OpenCode engine:**
```
projects/<name>/
├── bot-service/
│   ├── src/index.ts              # Bot logic (TypeScript/Bun)
│   ├── docker-compose.yml        # 3 services: opencode, line-bot, cloudflared
│   ├── Dockerfile                # LINE bot container
│   ├── Dockerfile.opencode       # OpenCode AI server container
│   ├── opencode.json             # AI provider configuration
│   ├── .env.example
│   └── workspace/AGENTS.md
└── workspace/
    ├── AGENTS.md
    └── docs/
```

**Claude Code engine:**
```
projects/<name>/
├── bot-service/
│   ├── src/index.ts              # Bot logic (TypeScript/Bun)
│   ├── docker-compose.yml        # 3 services: server, line-bot, cloudflared
│   ├── Dockerfile                # LINE bot container
│   ├── server/                   # Claude Code API server
│   │   ├── Dockerfile            # Node 22 + Bun + Agent SDK
│   │   ├── package.json          # hono, @anthropic-ai/claude-agent-sdk
│   │   └── src/
│   │       ├── index.ts          # Hono REST API
│   │       ├── claude.ts         # Agent SDK wrapper
│   │       ├── session.ts        # Session manager
│   │       └── events.ts         # SSE event bus
│   ├── .env.example
│   └── workspace/AGENTS.md
└── workspace/
    ├── AGENTS.md
    └── docs/
```

---

## LINE Bot Commands

**OpenCode engine:**

| Command | Description |
|---------|-------------|
| `/new` | Start a new conversation |
| `/abort` | Cancel current prompt |
| `/sessions` | View session status |
| `/model` | View/switch AI model (40+ options) |
| `/about` | About this bot |
| `/help` | Show all commands |

**Claude Code engine:**

| Command | Description |
|---------|-------------|
| `/new` | Start a new conversation |
| `/abort` | Cancel current prompt |
| `/sessions` | View session info + cost |
| `/cost` | Show total cost |

---

## Customization

### Change bot behavior

Edit `workspace/AGENTS.md` — the bot reads this file at the start of every session.

### Change bot code

Edit `bot-service/src/index.ts` then rebuild:

```bash
docker compose up -d --build line-bot
```

### Add/change AI providers (OpenCode engine)

Edit `bot-service/opencode.json`

### Change Claude model (Claude Code engine)

Set `CLAUDE_MODEL` in `.env` to `sonnet`, `opus`, or `haiku`

### Add MCP tools

Create `workspace/opencode.jsonc` with your MCP server configuration.

### Modify templates

Edit files in `templates/bot-service/`, `templates/bot-service-claude-code/`, or `templates/workspace/`. Use these placeholders:

| Placeholder | Replaced with |
|-------------|--------------|
| `{{PROJECT_NAME}}` | Project name (e.g. `hr-bot`) |
| `{{CONTAINER_PREFIX}}` | Container name prefix |
| `{{DOMAIN}}` | Full domain (e.g. `hr-bot.sumana.online`) |
| `{{GITHUB_ORG}}` | GitHub org/user |

---

## Self-Hosted vs Cloud

| | Self-Hosted (Now) | Cloud / SaaS (Coming Soon) |
|---|---|---|
| **Software** | Full access | Full access |
| **Hosting** | You manage | We manage |
| **Updates** | Manual | Automatic |
| **Support** | Community | Priority |
| **Price** | Free forever | Subscription |

Botforge is and will always be **100% open source**. The Cloud option is for teams who prefer a managed service.

---

## Roadmap

- [x] CLI generator (`botforge new`)
- [x] Multi-model AI support via OpenCode (40+ models)
- [x] Claude Code engine via Agent SDK (Sonnet/Opus/Haiku)
- [x] Engine selection during project creation
- [x] Docker Compose deployment
- [x] Cloudflare Tunnel integration
- [ ] Plugin system for custom bot behaviors
- [ ] Web dashboard for bot management
- [ ] Cloud/SaaS platform (managed hosting)
- [ ] Multi-platform support (Discord, Telegram, WhatsApp)
- [ ] Analytics & monitoring dashboard

---

## Contributing

We welcome contributions from everyone! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Ways to contribute:**
- Report bugs or request features via [Issues](https://github.com/monthop-gmail/botforge/issues)
- Submit Pull Requests
- Improve documentation
- Create new templates
- Share your bot projects

---

## Community

- [GitHub Issues](https://github.com/monthop-gmail/botforge/issues) — Bug reports & feature requests
- [GitHub Discussions](https://github.com/monthop-gmail/botforge/discussions) — Questions & ideas

---

## License

[MIT License](LICENSE) — free for personal and commercial use.

---

## Thai Community

สำหรับชุมชนคนไทย — Botforge เป็น open source 100% สร้าง LINE Bot ได้ฟรีไม่จำกัด

```bash
git clone https://github.com/monthop-gmail/botforge.git
cd botforge
./botforge new my-bot
```

ดูคู่มือภาษาไทยฉบับเต็มได้ที่ [docs/guide-th.md](docs/guide-th.md)

---

**Built with [OpenCode](https://opencode.ai) + [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk) + [LINE Messaging API](https://developers.line.biz) + [Cloudflare Tunnel](https://cloudflare.com)**
