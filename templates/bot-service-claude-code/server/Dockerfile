FROM node:22-slim

# Install system deps + git (needed by claude code)
RUN apt-get update && apt-get install -y curl unzip git && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install bun globally
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash

# Install Claude Code CLI (for OAuth login inside container)
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user with UID 1000 to match host user (for OAuth mount)
# node:22-slim already has 'node' user at UID 1000, so remove it first
RUN userdel -r node 2>/dev/null; useradd -m -s /bin/bash -u 1000 claude

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY src/ src/

RUN chown -R claude:claude /app /home/claude

USER claude

EXPOSE 4096

CMD ["bun", "run", "src/index.ts"]
