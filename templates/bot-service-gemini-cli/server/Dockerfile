FROM node:22-slim

# Install system deps + git (needed by gemini cli tools)
RUN apt-get update && apt-get install -y curl unzip git && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install bun globally
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash

# Install Gemini CLI globally
RUN npm install -g @google/gemini-cli

# Create non-root user
RUN useradd -m -s /bin/bash gemini && \
    mkdir -p /home/gemini/.gemini && \
    chown -R gemini:gemini /home/gemini/.gemini

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY src/ src/

RUN chown -R gemini:gemini /app /home/gemini

USER gemini

EXPOSE 4096

CMD ["bun", "run", "src/index.ts"]
