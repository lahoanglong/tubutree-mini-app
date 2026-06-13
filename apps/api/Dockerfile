# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────
# Tubu Tree API (NestJS) — multi-stage build cho pnpm monorepo.
# Build context = ROOT của monorepo (d:/tubutree-mini-app).
#   docker build -f apps/api/Dockerfile -t tubutree-api .
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# Manifests trước để tận dụng cache layer khi cài deps.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile
# shared-types (api phụ thuộc) → prisma client → build nest
RUN pnpm --filter @tubutree/shared-types build
RUN pnpm --filter @tubutree/api exec prisma generate
RUN pnpm --filter @tubutree/api build

# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
ENV NODE_ENV=production

# Copy nguyên cây đã build (node_modules pnpm symlink giữ nguyên trong /app).
COPY --from=builder /app ./

WORKDIR /app/apps/api
EXPOSE 3001

# Áp migration (idempotent) rồi khởi động API.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
