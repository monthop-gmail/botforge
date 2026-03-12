# CLAUDE.md

## Project Overview

{{PROJECT_NAME}} — bridges LINE Messaging API to Gocode AI coding agent. Three Docker services: LINE bot (Bun), Gocode server (Go), Cloudflare tunnel.

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
  ↕ REST fetch
server (Go + chi, port 4096)
  ↕ OpenAI-compatible API
LLM (DeepSeek, OpenAI, Qwen, Groq, Ollama, etc.)
```

- **`src/index.ts`** — LINE bot: webhook, signature validation, message chunking, commands, session management, group chat support, user/group context enrichment, Thai error hints, image handling, /about HTML page
- **`server/main.go`** — Go server entry point (cobra CLI: serve + chat commands)
- **`server/internal/server/`** — HTTP server (chi router, WebSocket, REST endpoints)
- **`server/internal/agent/`** — Agent loop (LLM ↔ tools), session store
- **`server/internal/provider/`** — OpenAI-compatible LLM provider
- **`server/internal/tools/`** — Tool registry (shell, read/write files, grep, web search/fetch)
- **`server/internal/config/`** — YAML config loader

## Environment Variables

### Bot
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` — LINE credentials
- `GOCODE_URL` — Server API URL (default: `http://server:4096`)
- `SERVER_PASSWORD` — Server auth (optional)
- `PROMPT_TIMEOUT_MS` — Timeout per prompt (default: `120000`)

### Server
- `GOCODE_API_KEY` — LLM API key
- `GOCODE_BASE_URL` — LLM API base URL (e.g. `https://api.deepseek.com/v1`)
- `GOCODE_MODEL` — LLM model name (e.g. `deepseek-chat`)
- `API_PASSWORD` — API auth password (optional)

## Server API Endpoints

- `GET /health` — Health check
- `POST /api/sessions` — Create session
- `GET /api/sessions` — List sessions
- `DELETE /api/sessions/{id}` — Delete session
- `POST /api/sessions/{id}/message` — Send prompt, returns `{ result, session_id, is_error }`
- `GET /ws/{id}` — WebSocket streaming

## Webhook URL

`https://{{DOMAIN}}/webhook`

## GitHub

- Repo: `{{GITHUB_ORG}}/{{PROJECT_NAME}}`
- Workspace: `{{GITHUB_ORG}}/{{PROJECT_NAME}}-workspace`
