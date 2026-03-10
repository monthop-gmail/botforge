FROM node:22-slim

# Install system deps + git (needed by gemini cli tools)
RUN apt-get update && apt-get install -y curl unzip git && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install bun globally
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash

# Install Gemini CLI globally
RUN npm install -g @google/gemini-cli

# Git config for Gemini
RUN git config --global user.name "Gemini" && \
    git config --global user.email "gemini@google.com" && \
    git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'

# Use node user (UID 1000, matches typical host user for OAuth mount)
RUN mkdir -p /home/node/.gemini && \
    chown -R node:node /home/node/.gemini

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY src/ src/

RUN chown -R node:node /app

USER node

ENV HOME=/home/node

EXPOSE 4096

CMD ["bun", "run", "src/index.ts"]
