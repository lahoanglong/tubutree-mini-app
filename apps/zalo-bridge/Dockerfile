# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────
# Cầu nối Zalo (zca-js) cho chat CSKH — build từ ROOT của monorepo.
#   docker build -f apps/zalo-bridge/Dockerfile -t tubutree-zalo-bridge .
# ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/zalo-bridge ./apps/zalo-bridge

RUN pnpm install --frozen-lockfile --filter @tubutree/zalo-bridge...
RUN pnpm --filter @tubutree/zalo-bridge build

# ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Ho_Chi_Minh

COPY --from=builder /app ./

# Phiên Zalo mã hoá, cấu hình nhóm, hộp thư đi và sổ chống gửi trùng nằm ở /data (volume): mất là phải quét QR lại.
RUN mkdir -p /data && chown node:node /data
ENV ZALO_BRIDGE_DATA_DIR=/data
USER node

WORKDIR /app/apps/zalo-bridge
EXPOSE 3110
CMD ["node", "dist/main.js"]
