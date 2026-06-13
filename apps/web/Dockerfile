# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────
# Tubu Tree Web (Next.js 14 standalone) — pnpm monorepo.
# Build context = ROOT monorepo:
#   docker build -f apps/web/Dockerfile -t tubutree-web \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.<domain>/api \
#     --build-arg NEXT_PUBLIC_ZALO_APP_ID=<id> .
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tubutree/shared-types build

# NEXT_PUBLIC_* phải có lúc BUILD (nhúng vào client bundle).
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_ZALO_APP_ID
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_ZALO_APP_ID=$NEXT_PUBLIC_ZALO_APP_ID
RUN pnpm --filter @tubutree/web build

# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Standalone output (rooted ở monorepo) + static assets.
# (web hiện không có thư mục public/ — thêm COPY public nếu sau này có.)
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
