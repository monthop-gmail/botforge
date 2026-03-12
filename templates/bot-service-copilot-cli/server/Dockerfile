FROM node:22-slim

# Install system deps + git (needed by copilot CLI)
RUN apt-get update && apt-get install -y curl unzip git && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install bun globally
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash

# Install GitHub Copilot CLI globally (for OAuth login inside container)
RUN npm install -g @github/copilot

# Git config for Copilot
RUN git config --global user.name "Copilot" && \
    git config --global user.email "copilot@github.com" && \
    git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'

# Create non-root user with UID 1000 to match host user (for OAuth mount)
RUN userdel -r node 2>/dev/null; useradd -m -s /bin/bash -u 1000 copilot

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY src/ src/

RUN chown -R copilot:copilot /app /home/copilot

# Ensure mounted volumes have correct ownership at startup
RUN printf '#!/bin/sh\nchown -R copilot:copilot /home/copilot/.config 2>/dev/null\nexec su copilot -c "bun run src/index.ts"\n' > /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 4096

CMD ["/entrypoint.sh"]
