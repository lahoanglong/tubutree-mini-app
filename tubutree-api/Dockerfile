# Multi-stage build cho Tubu Tree API
# - Base: node:20-bookworm-slim (Debian) thay vì alpine vì Prisma 5 cần
#   glibc + openssl-3, alpine dùng musl + openssl-1.1.x → schema engine fail
# - Build: TypeScript compile + Prisma generate
# - Runtime: chỉ chạy dist + production node_modules

FROM node:20-bookworm-slim AS builder

# Prisma cần openssl runtime + dev tooling
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps (cache layer)
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Build
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate && npx tsc

# ---------- Runtime ----------
FROM node:20-bookworm-slim AS runtime

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Production deps only
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

# Built code
COPY --from=builder /app/dist ./dist

# Folder cho uploads (KYC photos). Railway KHÔNG support docker VOLUME directive —
# dùng Railway Volume mount vào /app/uploads qua dashboard Settings → Volumes.
RUN mkdir -p /app/uploads/kyc

EXPOSE 3001

# Migrate DB on every boot (idempotent) then start server
CMD npx prisma db push --skip-generate && node dist/index.js
