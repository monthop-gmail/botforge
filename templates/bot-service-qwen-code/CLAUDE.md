# CLAUDE.md

## Project Overview

{{PROJECT_NAME}} — LINE Bot powered by Qwen Code CLI (Alibaba Cloud). Three Docker services: server (Hono + Qwen Code CLI), LINE bot (Bun), Cloudflare tunnel.

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
server (Hono + Qwen Code CLI, port 4096)
  ↕ spawn: qwen -p "..." --output-format json --resume <id>
Qwen (qwen3-coder-plus, qwen3.5-plus, qwen3-coder-next)
```

- **`src/index.ts`** — LINE bot: webhook, signature validation, message chunking, commands
- **`server/src/index.ts`** — Hono API server (routes, SSE, auth)
- **`server/src/qwen.ts`** — Qwen Code CLI child process wrapper
- **`server/src/session.ts`** — In-memory session manager
- **`server/src/events.ts`** — Event bus for SSE

## Environment Variables

### Bot
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` — LINE credentials
- `SERVER_URL` — Server API URL (default: `http://server:4096`)
- `SERVER_PASSWORD` — Server auth (optional)
- `PROMPT_TIMEOUT_MS` — Timeout per prompt (default: `300000`)

### Server (choose one auth method)
- `QWEN_HOME` — Path to host `~/.qwen` dir for OAuth login (default: `~/.qwen`, no API key needed)
- `DASHSCOPE_API_KEY` — DashScope API key (alternative to OAuth)
- `API_PASSWORD` — API auth password (optional)
- `QWEN_MODEL` — Model (default: `qwen3-coder-plus`)
- `QWEN_TIMEOUT_MS` — Max time per prompt (default: `300000`)

## Webhook URL

`https://{{DOMAIN}}/webhook`

## GitHub

- Repo: `{{GITHUB_ORG}}/{{PROJECT_NAME}}`
- Workspace: `{{GITHUB_ORG}}/{{PROJECT_NAME}}-workspace`
