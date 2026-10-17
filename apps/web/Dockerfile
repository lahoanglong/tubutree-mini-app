# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────
# Tubu Tree Web (Next.js 14 standalone) — pnpm monorepo.
# Build context = ROOT monorepo:
#   docker build -f apps/web/Dockerfile -t tubutree-web \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.<domain>/api \
#     --build-arg NEXT_PUBLIC_ZALO_APP_ID=<id> .
# NEXT_PUBLIC_ZALO_APP_ID bắt buộc: build dừng nếu rỗng (xem bước kiểm tra bên dưới).
# ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
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
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_ZALO_APP_ID=$NEXT_PUBLIC_ZALO_APP_ID
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_STANDALONE=1

# Thiếu App ID thì bundle bị nhúng chuỗi rỗng: build vẫn xanh nhưng mọi nút đăng nhập Zalo trên web đều hỏng. Dừng ở đây
# để lỗi hiện lúc deploy, không đợi tới khi khách không đăng nhập được. Bản thử không dùng Zalo mới đặt
# ALLOW_EMPTY_ZALO_APP_ID=1 (khi đó web hiện thông báo "chưa cấu hình" thay cho nút đăng nhập).
ARG ALLOW_EMPTY_ZALO_APP_ID
RUN if [ -z "$NEXT_PUBLIC_ZALO_APP_ID" ]; then \
      if [ "$ALLOW_EMPTY_ZALO_APP_ID" = "1" ]; then \
        echo "CANH BAO: NEXT_PUBLIC_ZALO_APP_ID rong - web se khong dang nhap duoc bang Zalo." >&2; \
      else \
        echo "LOI: NEXT_PUBLIC_ZALO_APP_ID rong. Dat secret ZALO_APP_ID (docs/GO-LIVE-KEYS.md muc 2, buoc E) roi build lai; chi bo qua bang ALLOW_EMPTY_ZALO_APP_ID=1 cho ban thu khong dung Zalo." >&2; \
        exit 1; \
      fi; \
    fi
RUN pnpm --filter @tubutree/web build

# ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Standalone output (rooted ở monorepo) + static assets.
# (web hiện không có thư mục public/ — thêm COPY public nếu sau này có.)
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

# Không chạy bằng root. Next ghi Data Cache của fetch vào .next/cache lúc chạy: thư mục phải thuộc user node, nếu không
# mọi lần ghi cache lỗi EACCES (log đầy cảnh báo, trang nào cũng gọi API lại). Đây là chỗ DUY NHẤT web ghi ra đĩa.
RUN mkdir -p apps/web/.next/cache && chown -R node:node apps/web/.next
USER node

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
