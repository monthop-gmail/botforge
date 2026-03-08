# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Botforge — CLI tool that generates LINE Bot + AI projects from templates. Each project creates a 3-container Docker setup: LINE bot (Bun), AI server (engine-specific), Cloudflare tunnel.

## Commands

```bash
# Generate a new project
./botforge new <name>         # Interactive: select engine, GitHub org, domain
./botforge list               # List all projects with detected engines

# Deploy and manage multiple bots
./botforge-deploy up all --build          # Build & start all projects
./botforge-deploy down <name>             # Stop specific project
./botforge-deploy rebuild <name> [service] # Rebuild specific service
./botforge-deploy status                  # Status table: all projects
./botforge-deploy logs <name> [service] [lines]

# Cloudflare tunnel management
./botforge-deploy tunnel init             # Configure CF API token (first time)
./botforge-deploy tunnel setup <name|all> # Create tunnel + DNS records
./botforge-deploy tunnel list             # List all tunnels
./botforge-deploy tunnel delete <name>    # Delete tunnel + DNS
```

## Architecture

### 5 Engine Templates (`templates/bot-service-*/`)

| Engine | Server | Port | Language | AI Provider |
|--------|--------|------|----------|-------------|
| `opencode` | OpenCode serve | 4096 | TS | 40+ models (Claude, GPT, Gemini, DeepSeek, Qwen) |
| `claude-code` | Hono + Agent SDK | 4096 | TS | Anthropic (Sonnet, Opus, Haiku) |
| `gocode` | Go + chi | 4096 | Go | OpenAI-compatible (DeepSeek, GPT, Qwen, Groq) |
| `adkcode` | FastAPI + Google ADK | 8000 | Python | Gemini (multi-agent: orchestrator → coder, reviewer, tester) |
| `gemini-cli` | Hono + Gemini CLI spawn | 4096 | TS | Gemini (2.5-flash, 2.5-pro, 2.0-flash) |

### Generated Project Structure
```
projects/<name>/
├── bot-service/          # Separate git repo
│   ├── src/index.ts      # LINE bot (webhook, commands, session mgmt)
│   ├── server/           # AI server (claude-code, gocode, adkcode, gemini-cli)
│   ├── docker-compose.yml
│   ├── .env              # Credentials (gitignored)
│   └── CLAUDE.md         # Per-project guide
└── workspace/            # Separate git repo, mounted into server at /workspace
    └── AGENTS.md         # Bot behavior instructions
```

### Template Variable Substitution
Templates use `{{PLACEHOLDER}}` syntax, replaced by `botforge new`:
- `{{PROJECT_NAME}}`, `{{CONTAINER_PREFIX}}`, `{{DOMAIN}}`, `{{GITHUB_ORG}}`, `{{TUNNEL_NAME}}`

## Key Files

- **`botforge`** — Project generator CLI (Bash). Engine selection (lines ~86-101), template copy + sed replacement, git init.
- **`botforge-deploy`** — Multi-bot manager (Bash). Uses `docker compose --project-name "$name"` for isolation. Cloudflare API integration for tunnel CRUD + DNS.
- **`templates/bot-service-*/`** — Engine templates. Each has: `docker-compose.yml`, `Dockerfile`, `src/index.ts` (LINE bot), `server/` (AI backend), `.env.example`, `CLAUDE.md`.
- **`templates/workspace/`** — Shared workspace template with `AGENTS.md` (bot instructions in Thai).
- **`.botforge-deploy.env`** — Cloudflare credentials (`CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_ZONE_ID`, `CF_DOMAIN`). Gitignored.

## Engine Detection

Used by both `botforge list` and `botforge-deploy`:
```
server/api.py exists        → adkcode
server/go.mod exists        → gocode
GEMINI in docker-compose    → gemini-cli
server/ dir exists          → claude-code
opencode.json exists        → opencode
```

## Port Convention

- LINE bot: always port 3000
- AI server: port 4096 (all engines except adkcode which uses 8000)
- Tunnel hostnames: `{name}.{domain}` (bot), `{name}-server.{domain}` (server)

## Defaults

- GitHub org: `monthop-gmail`
- Domain: `sumana.online`
- Project naming: lowercase + hyphens, 2-50 chars, starts with letter
