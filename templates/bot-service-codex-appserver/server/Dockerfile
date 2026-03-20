FROM node:22-slim

# Install system deps + git (needed by codex for workspace ops)
RUN apt-get update && apt-get install -y curl unzip git && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install bun globally
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash

# Install Codex CLI globally (includes app-server)
RUN npm install -g @openai/codex

# Git config for Codex
RUN git config --global user.name "Codex" && \
    git config --global user.email "codex@openai.com" && \
    git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'

# Use node user (UID 1000, matches typical host user for OAuth mount)
RUN mkdir -p /home/node/.codex && \
    chown -R node:node /home/node/.codex

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY src/ src/
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN chown -R node:node /app

USER node

ENV HOME=/home/node

EXPOSE 4096

CMD ["./entrypoint.sh"]
