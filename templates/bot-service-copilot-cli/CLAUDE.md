# CLAUDE.md

## Project Overview

{{PROJECT_NAME}} — LINE Bot powered by GitHub Copilot SDK (Copilot CLI). Three Docker services: server (Hono + Copilot SDK), LINE bot (Bun), Cloudflare tunnel.

## Commands

```bash
# Docker deployment
docker compose up -d --build

# Logs
docker logs {{CONTAINER_PREFIX}}-server --tail 30
docker logs {{CONTAINER_PREFIX}}-line-bot --tail 30
docker logs {{CONTAINER_PREFIX}}-tunnel

# Health check
curl http://localhost:4096/health
```

## Architecture

```
LINE app → Cloudflare Tunnel → line-bot (Bun, port 3000)
  ↕ HTTP fetch
server (Hono + Copilot SDK, port 4096)
  ↕ CopilotClient → GitHub Copilot API
Models (Claude Sonnet 4.5, GPT-5, o4-mini)
```

- **`src/index.ts`** — LINE bot: webhook, signature validation, message chunking, commands, group chat support
- **`server/src/index.ts`** — Hono API server (routes, SSE, auth)
- **`server/src/copilot.ts`** — GitHub Copilot SDK wrapper
- **`server/src/session.ts`** — In-memory session manager
- **`server/src/events.ts`** — Event bus for SSE

## Environment Variables

### Bot
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` — LINE credentials
- `SERVER_URL` — Server API URL (default: `http://server:4096`)
- `SERVER_PASSWORD` — Server auth (optional)
- `PROMPT_TIMEOUT_MS` — Timeout per prompt (default: `300000`)

### Server (choose one auth method)
- `GITHUB_TOKEN` — GitHub PAT with "Copilot Requests" permission
- `GH_CONFIG_DIR` — Path to host `~/.config/gh` for gh CLI OAuth (default: `~/.config/gh`)
- `API_PASSWORD` — API auth password (optional)
- `COPILOT_MODEL` — Model: claude-sonnet-4.5/gpt-5/o4-mini (default: `claude-sonnet-4.5`)
- `COPILOT_MAX_TURNS` — Max agentic turns (default: `10`)
- `COPILOT_TIMEOUT_MS` — Timeout per prompt (default: `300000`)

## Auth Methods

### 1. GitHub Token (recommended)
Set `GITHUB_TOKEN` with a fine-grained PAT that has "Copilot Requests" permission.

### 2. gh CLI OAuth (from host)
If you have `gh auth login` on host, mount `~/.config/gh`:
```bash
GH_CONFIG_DIR=~/.config/gh
```

### 3. Login inside container
```bash
docker exec -it {{CONTAINER_PREFIX}}-server copilot /login
```

## Webhook URL

`https://{{DOMAIN}}/webhook`

## GitHub

- Repo: `{{GITHUB_ORG}}/{{PROJECT_NAME}}`
- Workspace: `{{GITHUB_ORG}}/{{PROJECT_NAME}}-workspace`
