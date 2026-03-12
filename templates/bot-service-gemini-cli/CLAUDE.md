# CLAUDE.md

## Project Overview

{{PROJECT_NAME}} — LINE Bot powered by Gemini CLI (Google AI). Three Docker services: server (Hono + Gemini CLI), LINE bot (Bun), Cloudflare tunnel.

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
server (Hono + Gemini CLI, port 4096)
  ↕ spawn: gemini -p "..." --output-format json --resume <id>
Gemini (gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash)
```

- **`src/index.ts`** — LINE bot: webhook, signature validation, message chunking, commands, group chat support, user/group context enrichment, Thai error hints, image handling, /about HTML page
- **`server/src/index.ts`** — Hono API server (routes, SSE, auth)
- **`server/src/gemini.ts`** — Gemini CLI child process wrapper
- **`server/src/session.ts`** — In-memory session manager
- **`server/src/events.ts`** — Event bus for SSE

## Environment Variables

### Bot
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` — LINE credentials
- `SERVER_URL` — Server API URL (default: `http://server:4096`)
- `SERVER_PASSWORD` — Server auth (optional)
- `PROMPT_TIMEOUT_MS` — Timeout per prompt (default: `300000`)

### Server (choose one auth method)
- `GEMINI_HOME` — Path to host `~/.gemini` dir for OAuth login (default: `~/.gemini`, no API key needed)
- `GEMINI_API_KEY` — Google AI API key (alternative to OAuth)
- `API_PASSWORD` — API auth password (optional)
- `GEMINI_MODEL` — Model (default: `gemini-2.5-flash`)
- `GEMINI_TIMEOUT_MS` — Max time per prompt (default: `300000`)

## Webhook URL

`https://{{DOMAIN}}/webhook`

## GitHub

- Repo: `{{GITHUB_ORG}}/{{PROJECT_NAME}}`
- Workspace: `{{GITHUB_ORG}}/{{PROJECT_NAME}}-workspace`
