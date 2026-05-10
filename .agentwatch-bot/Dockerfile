# Base image: node 22 on debian bookworm-slim
FROM node:22-bookworm-slim

# Install OpenClaw sandbox dependencies + GitHub CLI
RUN apt-get update && apt-get install -y \
    bash \
    curl \
    git \
    jq \
    python3 \
    ripgrep \
    ca-certificates \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Add a non-root user matching typical host UID (1000) for bind mounts
RUN useradd -m -u 1000 agentwatch

USER agentwatch
WORKDIR /workspace
