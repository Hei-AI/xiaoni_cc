# syntax=docker/dockerfile:1.7

ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG CODEX_CLI_VERSION=0.125.0

FROM node:18-alpine AS base
RUN apk add --no-cache tzdata ca-certificates
ENV TZ=Asia/Shanghai
# binaries.prisma.sh is unreachable from this network; fetch the engines from the
# npmmirror binary mirror (same host npm ci already uses) so `prisma generate` works.
# Force IPv4-first: Prisma's node-fetch downloader otherwise tries IPv6 and the TLS
# handshake gets dropped ("socket disconnected before TLS"), while npm (IPv4) works.
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
WORKDIR /app/modules/provider-service

FROM base AS deps
WORKDIR /app
COPY packages/persistence/package.json packages/persistence/package-lock.json ./packages/persistence/
COPY packages/persistence/index.js packages/persistence/index.d.ts packages/persistence/time.js packages/persistence/traffic.js packages/persistence/self-evolution.js packages/persistence/feedback-reflection.js packages/persistence/identity-lineage.js packages/persistence/topic-lab.js packages/persistence/image-lab.js packages/persistence/agent-media.js packages/persistence/agent-tasks.js packages/persistence/agent-queue.js packages/persistence/inbound-inbox.js packages/persistence/agent-runtime.js packages/persistence/agent-presence.js packages/persistence/agent-life-events.js packages/persistence/agent-recovery-sessions.js packages/persistence/xiaoni-agent-stack.js packages/persistence/xiaoni-activity.js packages/persistence/xiaoni-passive-recall-extractor.js packages/persistence/xiaoni-recall-bandpass.js packages/persistence/xiaoni-recall-file-chunker.js packages/persistence/xiaoni-recall-store.js packages/persistence/xiaoni-recall-ingest.js packages/persistence/xiaoni-open-loops.js packages/persistence/xiaoni-diary-events.js packages/persistence/xiaoni-recall-association.js packages/persistence/ab-experiment.js packages/persistence/relationship-trust.js packages/persistence/agent-memory.js packages/persistence/qq-usage.js packages/persistence/qq-group-notification-aggregation.js packages/persistence/qq-attention-lease.js packages/persistence/agent-runtime-control.js packages/persistence/cc-usage.js ./packages/persistence/
COPY packages/persistence/prisma ./packages/persistence/prisma
RUN --mount=type=cache,target=/root/.npm \
  npm --prefix ./packages/persistence ci --no-audit --no-fund \
  && npm --prefix ./packages/persistence run generate
WORKDIR /app/modules/provider-service
COPY modules/provider-service/package.json modules/provider-service/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm config set registry ${NPM_REGISTRY} \
  && npm ci --include=dev --no-audit --no-fund \
  && npm config delete registry

FROM base AS build
WORKDIR /app
COPY --from=deps /app/packages/persistence ./packages/persistence
COPY --from=deps /app/modules/provider-service/node_modules ./modules/provider-service/node_modules
WORKDIR /app/modules/provider-service
COPY modules/provider-service/package.json modules/provider-service/package-lock.json ./
COPY modules/provider-service/src/ ./src/
COPY modules/provider-service/tsconfig.json ./
RUN npm run build

FROM base AS prod-deps
WORKDIR /app
COPY packages/persistence/package.json packages/persistence/package-lock.json ./packages/persistence/
COPY packages/persistence/index.js packages/persistence/index.d.ts packages/persistence/time.js packages/persistence/traffic.js packages/persistence/self-evolution.js packages/persistence/feedback-reflection.js packages/persistence/identity-lineage.js packages/persistence/topic-lab.js packages/persistence/image-lab.js packages/persistence/agent-media.js packages/persistence/agent-tasks.js packages/persistence/agent-queue.js packages/persistence/inbound-inbox.js packages/persistence/agent-runtime.js packages/persistence/agent-presence.js packages/persistence/agent-life-events.js packages/persistence/agent-recovery-sessions.js packages/persistence/xiaoni-agent-stack.js packages/persistence/xiaoni-activity.js packages/persistence/xiaoni-passive-recall-extractor.js packages/persistence/xiaoni-recall-bandpass.js packages/persistence/xiaoni-recall-file-chunker.js packages/persistence/xiaoni-recall-store.js packages/persistence/xiaoni-recall-ingest.js packages/persistence/xiaoni-open-loops.js packages/persistence/xiaoni-diary-events.js packages/persistence/xiaoni-recall-association.js packages/persistence/ab-experiment.js packages/persistence/relationship-trust.js packages/persistence/agent-memory.js packages/persistence/qq-usage.js packages/persistence/qq-group-notification-aggregation.js packages/persistence/qq-attention-lease.js packages/persistence/agent-runtime-control.js packages/persistence/cc-usage.js ./packages/persistence/
COPY packages/persistence/prisma ./packages/persistence/prisma
RUN --mount=type=cache,target=/root/.npm \
  npm --prefix ./packages/persistence ci --omit=dev --no-audit --no-fund \
  && npm --prefix ./packages/persistence run generate
WORKDIR /app/modules/provider-service
COPY modules/provider-service/package.json modules/provider-service/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm config set registry ${NPM_REGISTRY} \
  && npm ci --omit=dev --no-audit --no-fund \
  && npm config delete registry

FROM node:18-alpine AS runtime
RUN apk add --no-cache tzdata ca-certificates
WORKDIR /app/modules/provider-service
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
ARG NPM_REGISTRY
ARG CODEX_CLI_VERSION
RUN npm config set registry ${NPM_REGISTRY} \
  && npm install -g @openai/codex@${CODEX_CLI_VERSION} --no-audit --no-fund \
  && npm config delete registry
RUN mkdir -p /app/logs
COPY modules/provider-service/package.json modules/provider-service/package-lock.json ./
COPY --from=prod-deps /app/packages/persistence /app/packages/persistence
COPY --from=prod-deps /app/modules/provider-service/node_modules ./node_modules
COPY --from=build /app/modules/provider-service/dist ./dist
COPY modules/http-traffic-monitor/transparent-proxy/install-ca-from-volume.sh /usr/local/bin/install-ca-from-volume.sh
COPY modules/provider-service/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/install-ca-from-volume.sh /app/docker-entrypoint.sh

ENV NODE_ENV=production
ENV HTTP_PORT=8091
ENV LOG_LEVEL=info
# IPv4-first: this network's IPv6 path drops TLS handshakes (same issue as the prisma
# build). The Anthropic provider calls api.anthropic.com from here, so the runtime needs
# it too, not just the build stages.
ENV NODE_OPTIONS=--dns-result-order=ipv4first

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "const port=process.env.HTTP_PORT||'8091';fetch('http://127.0.0.1:' + port + '/health',{cache:'no-store'}).then(res=>{if(!res.ok){process.exit(1);}return res.text();}).then(()=>process.exit(0)).catch(()=>process.exit(1));"

ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
