# CLAUDE.md

## Project Overview

{{PROJECT_NAME}} — LINE Bot powered by Claude Agent SDK (Anthropic API direct). Three Docker services: server (Hono + Agent SDK), LINE bot (Bun), Cloudflare tunnel.

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
server (Hono + Claude Agent SDK, port 4096)
  ↕ query() → Anthropic API
Claude (sonnet, opus, haiku)
```

- **`src/index.ts`** — LINE bot: webhook, signature validation, message chunking, commands
- **`server/src/index.ts`** — Hono API server (routes, SSE, auth)
- **`server/src/claude.ts`** — Claude Agent SDK wrapper
- **`server/src/session.ts`** — In-memory session manager
- **`server/src/events.ts`** — Event bus for SSE

## Environment Variables

### Bot
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` — LINE credentials
- `SERVER_URL` — Server API URL (default: `http://server:4096`)
- `SERVER_PASSWORD` — Server auth (optional)
- `PROMPT_TIMEOUT_MS` — Timeout per prompt (default: `300000`)

### Server
- `ANTHROPIC_API_KEY` — Anthropic API key (required)
- `API_PASSWORD` — API auth password (optional)
- `CLAUDE_MODEL` — Model: sonnet/opus/haiku (default: `sonnet`)
- `CLAUDE_MAX_TURNS` — Max agentic turns (default: `10`)
- `CLAUDE_MAX_BUDGET_USD` — Max spend per prompt (default: `1.00`)

## Docker Volumes

- **`{{CONTAINER_PREFIX}}-data`** → `/home/claude/.claude` — Claude SDK state

## Webhook URL

`https://{{DOMAIN}}/webhook`

## GitHub

- Repo: `{{GITHUB_ORG}}/{{PROJECT_NAME}}`
- Workspace: `{{GITHUB_ORG}}/{{PROJECT_NAME}}-workspace`
