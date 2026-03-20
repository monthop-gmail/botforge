# CLAUDE.md

## Project Overview

{{PROJECT_NAME}} — LINE Bot powered by OpenAI Codex App Server. Three Docker services: server (Hono + Codex App Server via WebSocket JSON-RPC), LINE bot (Bun), Cloudflare tunnel.

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
server (Hono + Codex App Server, port 4096)
  ↕ WebSocket JSON-RPC 2.0 → codex app-server (ws://localhost:4500)
OpenAI (o4-mini, o3, gpt-4.1, gpt-5.4-mini)
```

- **`src/index.ts`** — LINE bot: webhook, signature validation, message chunking, commands, group chat support, user/group context enrichment, Thai error hints, image handling, /about HTML page
- **`server/src/index.ts`** — Hono API server (routes, SSE, auth)
- **`server/src/codex-appserver.ts`** — Codex App Server WebSocket JSON-RPC client
- **`server/src/session.ts`** — In-memory session manager
- **`server/src/events.ts`** — Event bus for SSE

## Environment Variables

### Bot
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` — LINE credentials
- `SERVER_URL` — Server API URL (default: `http://server:4096`)
- `SERVER_PASSWORD` — Server auth (optional)
- `PROMPT_TIMEOUT_MS` — Timeout per prompt (default: `300000`)

### Server (choose one auth method)
- `CODEX_HOME` — Path to host `~/.codex` dir for ChatGPT login (default: `~/.codex`, no API key needed)
- `CODEX_API_KEY` — OpenAI API key (alternative to ChatGPT login)
- `API_PASSWORD` — API auth password (optional)
- `CODEX_MODEL` — Model (default: `o4-mini`)
- `CODEX_TIMEOUT_MS` — Max time per prompt (default: `300000`)
- `CODEX_APPSERVER_PORT` — App Server WebSocket port (default: `4500`)

## Webhook URL

`https://{{DOMAIN}}/webhook`

## GitHub

- Repo: `{{GITHUB_ORG}}/{{PROJECT_NAME}}`
- Workspace: `{{GITHUB_ORG}}/{{PROJECT_NAME}}-workspace`
