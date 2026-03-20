#!/bin/bash
set -e

PORT="${CODEX_APPSERVER_PORT:-4500}"

echo "[entrypoint] Starting Codex App Server on ws://0.0.0.0:$PORT ..."
codex app-server --listen "ws://0.0.0.0:$PORT" &
APP_SERVER_PID=$!

# Wait for app server to be ready (max 15s)
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT" >/dev/null 2>&1 || [ -d /proc/$APP_SERVER_PID ]; then
    sleep 0.5
    echo "[entrypoint] App Server started (pid: $APP_SERVER_PID)"
    break
  fi
  sleep 0.5
done

echo "[entrypoint] Starting Hono server ..."
exec bun run src/index.ts
