# CLAUDE.md — {{PROJECT_NAME}}

## Project Overview

LINE Bot บน **Botforge V2** · **project นี้ไม่มีโค้ดของ bot** — มีแต่ config
โค้ดอยู่ใน image `botforge/line-bot:v2` ที่ build จาก repo ของ botforge (`apps/line-bot`)

## Commands

```bash
COMPOSE_PROFILES=opencode,tunnel docker compose up -d
docker compose logs -f line-bot
docker compose logs -f line-bot | grep '^{'     # audit event (event/v1)
docker compose pull && docker compose up -d     # อัปเดตโค้ดของ bot
docker compose down
```

## Architecture

```
LINE → Cloudflare Tunnel → line-bot (image, port 3000)
                             ↕ RuntimePort
                    opencode / codex / claude / adkcode
```

- `botforge.yaml` — บอกว่าเป็น V2 · runtime ไหน · tenant/workspace อะไร
- `.env` — credential และ config ทั้งหมด
- `docker-compose.yml` — profile ต่อ runtime
- `../workspace/` — `AGENTS.md` และไฟล์ที่ agent ทำงานด้วย (repo แยก)

## แก้โค้ดของ bot ที่ไหน

**ไม่ใช่ที่นี่** — ที่ `packages/` หรือ `apps/line-bot` ใน repo ของ botforge แล้ว build image ใหม่
ถ้าแก้ในโฟลเดอร์นี้จะหายตอน pull ครั้งถัดไป

## GitHub

- Bot config: `{{GITHUB_ORG}}/{{PROJECT_NAME}}`
- Workspace: `{{GITHUB_ORG}}/{{PROJECT_NAME}}-workspace` (Private)
