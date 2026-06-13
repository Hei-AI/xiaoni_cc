# syntax=docker/dockerfile:1.7

ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG DOCKER_COMPOSE_VERSION=v2.40.3

FROM node:20-bookworm-slim AS build
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /opt/xiaoni-executor
COPY modules/xiaoni-executor/package.json modules/xiaoni-executor/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
  npm config set registry ${NPM_REGISTRY} \
  && npm install --include=dev --no-audit --no-fund \
  && npm config delete registry
COPY modules/xiaoni-executor/tsconfig.json ./
COPY modules/xiaoni-executor/src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
ARG DOCKER_COMPOSE_VERSION=v2.40.3
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    docker.io \
    git \
    jq \
    procps \
    python3 \
    ripgrep \
    tini \
  && mkdir -p /usr/local/lib/docker/cli-plugins \
  && curl -fsSL "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-linux-$(uname -m)" -o /usr/local/lib/docker/cli-plugins/docker-compose \
  && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/xiaoni-executor
ENV NODE_ENV=production
ENV HTTP_PORT=8093
ENV WORKSPACE_ROOT=/workspace/qq_bot
ENV XIAONI_RUNTIME_ROOT=/xiaoni-runtime
COPY modules/xiaoni-executor/package.json ./
COPY --from=build /opt/xiaoni-executor/node_modules ./node_modules
COPY --from=build /opt/xiaoni-executor/dist ./dist
COPY modules/xiaoni-executor/scripts/xiaoni-session /usr/local/bin/xiaoni-session
COPY modules/xiaoni-executor/scripts/start-xiaoni-executor /usr/local/bin/start-xiaoni-executor
RUN chmod +x /usr/local/bin/xiaoni-session /usr/local/bin/start-xiaoni-executor \
  && mkdir -p /workspace /xiaoni-runtime \
  && ln -sfn /workspace/qq_bot /app
EXPOSE 8093 3458
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const port=process.env.HTTP_PORT||'8093';fetch('http://127.0.0.1:' + port + '/health',{cache:'no-store'}).then(res=>{if(!res.ok){process.exit(1);}return res.text();}).then(()=>process.exit(0)).catch(()=>process.exit(1));"
ENTRYPOINT ["tini", "--"]
CMD ["start-xiaoni-executor"]
