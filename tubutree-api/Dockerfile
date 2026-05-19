# Multi-stage build cho Tubu Tree API
# Build: TypeScript compile + Prisma generate
# Runtime: chỉ chạy dist + node_modules production

FROM node:20-alpine AS builder

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
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Production deps only
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

# Built code
COPY --from=builder /app/dist ./dist

# Volume cho uploads (KYC photos persistent)
RUN mkdir -p /app/uploads/kyc
VOLUME /app/uploads

EXPOSE 3001

# Migrate DB on every boot (idempotent) then start server
CMD npx prisma db push --skip-generate && node dist/index.js
