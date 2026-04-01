# syntax=docker/dockerfile:1.7

ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM node:18-alpine AS base
RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
WORKDIR /app/modules/provider-service

FROM base AS deps
WORKDIR /app
COPY packages/persistence/package.json packages/persistence/package-lock.json ./packages/persistence/
COPY packages/persistence/index.js packages/persistence/index.d.ts packages/persistence/time.js packages/persistence/traffic.js packages/persistence/relationship-memory.js ./packages/persistence/
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
COPY packages/persistence/index.js packages/persistence/index.d.ts packages/persistence/time.js packages/persistence/traffic.js packages/persistence/relationship-memory.js ./packages/persistence/
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
RUN apk add --no-cache tzdata
WORKDIR /app/modules/provider-service
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
RUN mkdir -p /app/logs
COPY modules/provider-service/package.json modules/provider-service/package-lock.json ./
COPY --from=prod-deps /app/packages/persistence /app/packages/persistence
COPY --from=prod-deps /app/modules/provider-service/node_modules ./node_modules
COPY --from=build /app/modules/provider-service/dist ./dist

ENV NODE_ENV=production
ENV HTTP_PORT=8091
ENV LOG_LEVEL=info

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "const port=process.env.HTTP_PORT||'8091';fetch('http://127.0.0.1:' + port + '/health',{cache:'no-store'}).then(res=>{if(!res.ok){process.exit(1);}return res.text();}).then(()=>process.exit(0)).catch(()=>process.exit(1));"

CMD ["node", "dist/index.js"]
