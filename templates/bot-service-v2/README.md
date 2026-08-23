# {{PROJECT_NAME}}

LINE Bot บน **Botforge V2** — webhook: `https://{{DOMAIN}}/webhook`

## ไม่มีโค้ดใน project นี้

นี่คือความต่างหลักจาก V1:

| | V1 | V2 |
| --- | --- | --- |
| โค้ดของ bot | `src/index.ts` ~900 บรรทัด **copy มาไว้ทุก project** | อยู่ใน image `botforge/line-bot:v2` |
| อัปเดต | `botforge sync --full` — **copy ทับไฟล์** | `docker compose pull` |
| แก้ bug หนึ่งจุด | แตะ 23 ไฟล์ ใน 15 repo | แตะที่เดียว build image ใหม่ |
| เปลี่ยน engine | เปลี่ยน template = สร้าง project ใหม่ | เปลี่ยน `BOTFORGE_RUNTIME` ใน `.env` |

project นี้มีแค่ **config** — `.env` · `docker-compose.yml` · `botforge.yaml` · `workspace/`

## เริ่มใช้

```bash
cp .env.example .env      # เติม LINE_CHANNEL_SECRET / ACCESS_TOKEN
COMPOSE_PROFILES=opencode,tunnel docker compose up -d
```

| `BOTFORGE_RUNTIME` | `COMPOSE_PROFILES` ที่ต้องใส่ |
| --- | --- |
| `opencode` | `opencode` |
| `adkcode` | `adkcode` |
| `codex` · `claude` | ไม่ต้องใส่ profile ของ engine |

เติม `,tunnel` เมื่อต้องการให้ LINE เข้าถึงได้จากอินเทอร์เน็ต

## เปลี่ยน engine

```bash
# .env
BOTFORGE_RUNTIME=claude
```

```bash
docker compose down && COMPOSE_PROFILES=claude docker compose up -d
```

**ไม่ต้องสร้าง project ใหม่** — เป็นสิ่งที่ V1 ทำไม่ได้เพราะ engine ผูกกับ template

## อัปเดตโค้ดของ bot

```bash
docker compose pull && docker compose up -d
```

image build จาก repo ของ botforge (`npm run image` ที่ root ของ repo นั้น)

## UI ของ engine (opencode / adkcode)

LINE ต้อง reply เร็ว งานที่กินเวลานาน ๆ จึงสั่งผ่าน LINE ไม่ไหว — ให้เปิด UI ของ engine แทน

`botforge-deploy tunnel setup` เปิด 2 hostname ให้ project นี้:

```
https://{{DOMAIN}}/webhook          → line-bot  (LINE webhook)
https://{{PROJECT_NAME}}-server.<domain>/   → UI ของ engine
```

| runtime | UI | port |
| --- | --- | --- |
| `opencode` | ✅ | 4096 |
| `adkcode` | ✅ | 8000 |
| `codex` · `claude` | ❌ ไม่มี container ของ engine แยก | — |

ไม่ต้อง publish port ออกเครื่อง — `cloudflared` อยู่ในเครือข่าย compose เดียวกัน

> ⚠️ container ของ engine **ต้องชื่อ `{{CONTAINER_PREFIX}}-server`** เพราะ ingress ของ tunnel
> ชี้ไปที่ชื่อนี้ตายตัว เปลี่ยนชื่อแล้ว UI จะ 502

> ⚠️ **ตั้ง `OPENCODE_PASSWORD` ด้วย** — โดยค่าเริ่มต้น server ของ opencode ไม่มีรหัสผ่าน
> ใครเดา hostname ถูกก็เข้าถึง workspace ได้

## credential จาก host

`~/.claude` · `~/.codex` · `~/.config/gcloud` ใส่ใน `docker-compose.override.yml`
compose อ่านอัตโนมัติเมื่ออยู่โฟลเดอร์เดียวกัน

```yaml
services:
  line-bot:
    volumes:
      - ${HOME}/.claude:/root/.claude
```

## workspace

`../workspace/` เป็น repo แยก (private) — `AGENTS.md` กำหนด role และกติกาของ agent
mount เข้าทั้ง `line-bot` และ container ของ engine ที่ path `/workspace`

## audit event

bot เขียน `event/v1` ลง stdout เป็น JSON บรรทัดละใบ

```bash
docker compose logs -f line-bot | grep '^{'
```

`BOTFORGE_TENANT_ID` และ `BOTFORGE_WORKSPACE_ID` **บังคับ** — ขาดแล้ว container จบด้วย exit 2
ไม่ใช่สตาร์ทแล้วปล่อย event ที่ระบุ tenant ไม่ได้
