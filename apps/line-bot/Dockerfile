# LINE bot ของ V2 — ประกอบจาก workspace ทั้งก้อน
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ติดตั้งจาก manifest ก่อน เพื่อให้ layer cache ทำงานตอนแก้โค้ด
COPY package.json ./
COPY packages/core/package.json             packages/core/
COPY packages/channel-line/package.json     packages/channel-line/
COPY packages/adapter-opencode/package.json packages/adapter-opencode/
COPY packages/adapter-codex/package.json    packages/adapter-codex/
COPY packages/adapter-claude/package.json   packages/adapter-claude/
COPY packages/adapter-adkcode/package.json  packages/adapter-adkcode/
COPY apps/line-bot/package.json             apps/line-bot/
RUN npm install --omit=dev --workspaces --include-workspace-root

COPY packages/ packages/
COPY apps/line-bot/ apps/line-bot/

EXPOSE 3000
# --experimental-strip-types รัน TypeScript ตรง ๆ ไม่ต้องมี build step
CMD ["node", "--experimental-strip-types", "apps/line-bot/src/main.ts"]
