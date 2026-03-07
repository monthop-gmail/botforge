# CLAUDE.md

## Project Overview

{{PROJECT_NAME}} — bridges LINE Messaging API to ADKcode AI coding agent (Google ADK + Gemini). Three Docker services: LINE bot (Bun), ADKcode server (Python/FastAPI), Cloudflare tunnel.

## Commands

```bash
# Docker deployment
docker compose up -d --build

# Logs
docker logs {{CONTAINER_PREFIX}}-server --tail 30
docker logs {{CONTAINER_PREFIX}}-line-bot --tail 30
docker logs {{CONTAINER_PREFIX}}-tunnel

# Health check
curl http://localhost:8000/health
```

## Architecture

```
LINE app → Cloudflare Tunnel → line-bot (Bun, port 3000)
  ↕ REST fetch
server (FastAPI + Google ADK, port 8000)
  ↕ Multi-agent (orchestrator → coder, reviewer, tester)
Gemini API (gemini-2.5-flash, gemini-2.0-flash)
```

- **`src/index.ts`** — LINE bot: webhook, signature validation, message chunking, commands, session management
- **`server/api.py`** — FastAPI REST wrapper around ADK runner
- **`server/adkcode/agent.py`** — Multi-agent system: orchestrator, coder, reviewer, tester
- **`server/adkcode/tools.py`** — Coding tools: read/write/edit files, shell, grep, web search/fetch, semantic search
- **`server/adkcode/guardrails.py`** — Safety checks and audit logging
- **`server/adkcode/rag.py`** — Semantic search with Gemini embeddings
- **`server/plugins/`** — Plugin system (engineering, data, productivity)

## Environment Variables

### Bot
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` — LINE credentials
- `ADKCODE_URL` — Server API URL (default: `http://server:8000`)
- `PROMPT_TIMEOUT_MS` — Timeout per prompt (default: `120000`)

### Server
- `GOOGLE_API_KEY` — Google AI API key (required)
- `ADKCODE_MODEL_SMART` — Smart model for orchestrator/reviewer (default: `gemini-2.5-flash`)
- `ADKCODE_MODEL_FAST` — Fast model for coder/tester (default: `gemini-2.0-flash`)

## Server API Endpoints

- `GET /health` — Health check
- `POST /session` — Create session
- `GET /session/{id}` — Get session info
- `DELETE /session/{id}` — Delete session
- `POST /session/{id}/message` — Send prompt, returns `{ result, session_id, is_error, duration_ms }`
- `POST /session/{id}/abort` — Abort

## Webhook URL

`https://{{DOMAIN}}/webhook`

## GitHub

- Repo: `{{GITHUB_ORG}}/{{PROJECT_NAME}}`
- Workspace: `{{GITHUB_ORG}}/{{PROJECT_NAME}}-workspace`
