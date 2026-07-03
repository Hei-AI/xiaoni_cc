# syntax=docker/dockerfile:1.7

ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM node:18-alpine AS base
RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai
# binaries.prisma.sh is unreachable from this network; fetch the engines from the
# npmmirror binary mirror (same host npm ci already uses) so `prisma generate` works.
# Force IPv4-first: Prisma's node-fetch downloader otherwise tries IPv6 and the TLS
# handshake gets dropped ("socket disconnected before TLS"), while npm (IPv4) works.
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
WORKDIR /app/modules/agent-service

FROM base AS deps
WORKDIR /app
COPY packages/persistence/package.json packages/persistence/package-lock.json ./packages/persistence/
COPY packages/persistence/index.js packages/persistence/index.d.ts packages/persistence/time.js packages/persistence/traffic.js packages/persistence/self-evolution.js packages/persistence/feedback-reflection.js packages/persistence/identity-lineage.js packages/persistence/topic-lab.js packages/persistence/image-lab.js packages/persistence/agent-media.js packages/persistence/agent-tasks.js packages/persistence/agent-queue.js packages/persistence/inbound-inbox.js packages/persistence/agent-runtime.js packages/persistence/agent-presence.js packages/persistence/agent-life-events.js packages/persistence/agent-recovery-sessions.js packages/persistence/xiaoni-agent-stack.js packages/persistence/xiaoni-activity.js packages/persistence/xiaoni-passive-recall-extractor.js packages/persistence/xiaoni-recall-bandpass.js packages/persistence/xiaoni-recall-file-chunker.js packages/persistence/xiaoni-recall-store.js packages/persistence/ab-experiment.js packages/persistence/relationship-trust.js packages/persistence/agent-memory.js packages/persistence/qq-usage.js packages/persistence/qq-group-notification-aggregation.js packages/persistence/qq-attention-lease.js packages/persistence/agent-runtime-control.js packages/persistence/cc-usage.js ./packages/persistence/
COPY packages/persistence/prisma ./packages/persistence/prisma
RUN --mount=type=cache,target=/root/.npm \
  npm --prefix ./packages/persistence ci --no-audit --no-fund \
  && npm --prefix ./packages/persistence run generate
WORKDIR /app/modules/agent-service
COPY modules/agent-service/package.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm config set registry ${NPM_REGISTRY} \
  && npm install --include=dev --no-audit --no-fund \
  && npm config delete registry

FROM base AS build
WORKDIR /app
COPY --from=deps /app/packages/persistence ./packages/persistence
COPY --from=deps /app/modules/agent-service/node_modules ./modules/agent-service/node_modules
WORKDIR /app/modules/agent-service
COPY modules/agent-service/package.json ./
COPY modules/agent-service/src/ ./src/
COPY modules/agent-service/tsconfig.json ./
RUN npm run build

FROM base AS prod-deps
WORKDIR /app
COPY packages/persistence/package.json packages/persistence/package-lock.json ./packages/persistence/
COPY packages/persistence/index.js packages/persistence/index.d.ts packages/persistence/time.js packages/persistence/traffic.js packages/persistence/self-evolution.js packages/persistence/feedback-reflection.js packages/persistence/identity-lineage.js packages/persistence/topic-lab.js packages/persistence/image-lab.js packages/persistence/agent-media.js packages/persistence/agent-tasks.js packages/persistence/agent-queue.js packages/persistence/inbound-inbox.js packages/persistence/agent-runtime.js packages/persistence/agent-presence.js packages/persistence/agent-life-events.js packages/persistence/agent-recovery-sessions.js packages/persistence/xiaoni-agent-stack.js packages/persistence/xiaoni-activity.js packages/persistence/xiaoni-passive-recall-extractor.js packages/persistence/xiaoni-recall-bandpass.js packages/persistence/xiaoni-recall-file-chunker.js packages/persistence/xiaoni-recall-store.js packages/persistence/ab-experiment.js packages/persistence/relationship-trust.js packages/persistence/agent-memory.js packages/persistence/qq-usage.js packages/persistence/qq-group-notification-aggregation.js packages/persistence/qq-attention-lease.js packages/persistence/agent-runtime-control.js packages/persistence/cc-usage.js ./packages/persistence/
COPY packages/persistence/prisma ./packages/persistence/prisma
RUN --mount=type=cache,target=/root/.npm \
  npm --prefix ./packages/persistence ci --omit=dev --no-audit --no-fund \
  && npm --prefix ./packages/persistence run generate
WORKDIR /app/modules/agent-service
COPY modules/agent-service/package.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm config set registry ${NPM_REGISTRY} \
  && npm install --omit=dev --no-audit --no-fund \
  && npm config delete registry

FROM node:18-alpine AS runtime
# libwebp-tools 提供 cwebp:qq-send-image 出站把图转 webp 省传输(docs/XIAONI_SEND_IMAGE_WEBP_PLAN.md)。
# alpine 主仓包,确定性安装;缺了也只是回退发原图,不致命。
RUN apk add --no-cache tzdata python3 py3-pip ca-certificates libwebp-tools
WORKDIR /app/modules/agent-service
ENV TZ=Asia/Shanghai
ENV VIRTUAL_ENV=/opt/agent-tokenizer-venv
ENV PATH="/opt/agent-tokenizer-venv/bin:$PATH"
ENV AGENT_TOKENIZER_PYTHON=/opt/agent-tokenizer-venv/bin/python
ENV TIKTOKEN_CACHE_DIR=/opt/tiktoken-cache
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
RUN mkdir -p /app/logs
COPY modules/agent-service/requirements-tokenizer.txt ./requirements-tokenizer.txt
RUN python3 -m venv "$VIRTUAL_ENV" \
  && "$VIRTUAL_ENV/bin/pip" install --no-cache-dir -r requirements-tokenizer.txt
RUN python3 - <<'PY'
import hashlib
import os
import ssl
import urllib.request

url = "https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken"
cache_dir = "/opt/tiktoken-cache"
os.makedirs(cache_dir, exist_ok=True)
cache_path = os.path.join(cache_dir, hashlib.sha1(url.encode()).hexdigest())
context = ssl._create_unverified_context()
with urllib.request.urlopen(url, context=context) as response, open(cache_path, "wb") as output:
    output.write(response.read())
PY
COPY modules/agent-service/package.json ./
COPY modules/agent-service/scripts ./scripts
COPY modules/agent-service/skills ./skills
COPY docs/xiaoni_prompt /app/docs/xiaoni_prompt
COPY --from=prod-deps /app/packages/persistence /app/packages/persistence
COPY --from=prod-deps /app/modules/agent-service/node_modules ./node_modules
COPY --from=build /app/modules/agent-service/dist ./dist
COPY modules/http-traffic-monitor/transparent-proxy/install-ca-from-volume.sh /usr/local/bin/install-ca-from-volume.sh
COPY modules/agent-service/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/install-ca-from-volume.sh /app/docker-entrypoint.sh

ENV NODE_ENV=production
ENV HTTP_PORT=8092
ENV LOG_LEVEL=info
# IPv4-first: this network's IPv6 path drops TLS handshakes (see build stage note).
ENV NODE_OPTIONS=--dns-result-order=ipv4first

EXPOSE 8092

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "const port=process.env.HTTP_PORT||'8092';fetch('http://127.0.0.1:' + port + '/health',{cache:'no-store'}).then(res=>{if(!res.ok){process.exit(1);}return res.text();}).then(()=>process.exit(0)).catch(()=>process.exit(1));"

ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
