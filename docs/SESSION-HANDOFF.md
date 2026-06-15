# Tubu Tree — Session Handoff (cập nhật 2026-06-15, deploy verify đêm cùng ngày)

> Tài liệu bàn giao để tiếp tục làm trên máy khác. Mọi trạng thái quan trọng nằm ở đây + trong git history.
> Repo: https://github.com/lahoanglong/tubutree-mini-app · 1 nhánh duy nhất: `main`.

## 0. Tiếp tục trên máy mới — checklist
```bash
git clone https://github.com/lahoanglong/tubutree-mini-app.git tubutree && cd tubutree
pnpm install
pnpm dev:infra                 # Postgres(5434) + Redis(6381) qua Docker
cp apps/api/.env.example apps/api/.env   # điền key thật (xem mục 5)
cd apps/api && pnpm prisma:migrate deploy && pnpm prisma:seed
pnpm dev                       # chạy api + web + miniapp (turbo)
```
- Node ≥20, pnpm 9, Docker. Miniapp build & lên Zalo bằng `zmp deploy` riêng (không nằm trong VM).
- **Lưu ý môi trường cũ:** `prisma generate` có thể báo EPERM nếu API dev server đang chạy (khoá engine DLL) — vô hại, types vẫn sinh; tắt server rồi generate lại nếu cần.

## 1. Trạng thái tổng thể
- **Backend §6.1–6.14 (Build Spec v1.1): xong, user-facing đầy đủ.** Chi tiết: `docs/SPEC-COVERAGE.md`.
- **236+ unit test pass** (34 suite), 3 app build sạch (local + Docker).
- **Vườn Xanh 2.0: HOÀN TẤT 4 phase + social.** (xem mục 2)
- **Prod đang chạy LIVE trên GCP VM** (`api.tubutree.com` + `app.tubutree.com`, IP `34.142.194.160`) — CD wired qua GitHub Actions (xem mục 4).
- Code đã push hết lên `main`, working tree sạch.

## 2. Vườn Xanh 2.0 — đã làm gì (module `apps/api/src/modules/game/`)
7 service (đều TDD, có `.spec.ts`):
- `game-economy` — check-in 💧, streak, **vé giữ lửa**, **giọt sương**.
- `game-quiz` — quiz thiên nhiên→💧 (chủ đề/độ khó/reveal "Bạn có biết").
- `game-reminder` — cron 11h nhắc điểm danh + cây khát (in-app; ZNS gate).
- `game-community` — mốc cộng đồng cây thật (góp hồ khi thu hoạch, fulfil count-guard).
- `game-collection` — sổ tay loài (10 loài VN, sưu tập weighted theo rarity).
- `game-season` — mùa/sự kiện + BXH mùa.
- `game-gift` — **social: tặng nước bạn bè** (mạng giới thiệu, 1 lần/người/ngày).
- `game.service` — tree/water/harvest/spin/missions/leaderboard (gọi community+collection @Optional khi thu hoạch).

FE: `apps/miniapp/src/pages/game.tsx` + `services/game-api.ts` — đã wire toàn bộ (dew, vé giữ lửa, quiz reveal, CommunityMeter, SpeciesCodex, banner mùa, BXH mùa, card tặng nước).

Migrations game: `20260615130000_game_phase1` → `...170000_game_water_gift` (5 cái). Seed: ~40 câu quiz, 10 loài cây, 1 mùa, 1 mốc cộng đồng, template `GAME_*`.

Spec/plan: `docs/superpowers/specs/2026-06-15-vuon-xanh-game-retention-design.md`.

## 3. Còn lại (chưa làm) — ưu tiên khi quay lại
**Cần bạn cấp/quyết (gated):**
- 🔑 API keys go-live còn thiếu: **ZaloPay** (`ZALOPAY_APP_ID/KEY1/KEY2`), **Zalo OA + ZNS** (`ZALO_OA_ACCESS_TOKEN`, template ID — lead time duyệt 7–14 ngày), **Accesstrade** (`ACCESSTRADE_TOKEN/PUBLISHER_ID`). Pancake + Cloudinary **đã có** và đang chạy live.
- 🌳 Tích hợp **PanNature** trồng cây thật khi đủ mốc cộng đồng (webhook/batch — ai phụ trách?).
- 📊 Cách tính điểm-hạng cho cron tier-recalc §6.6 (lifetime vs balance).

**Hoãn có chủ đích (back-office / out-of-scope):** thưởng quý đại lý, admin upload Excel giá, AI tư vấn 24/7 (cần Claude key), group buy, review video (UGC), community feed.

## 4. Deploy — LIVE trên GCP VM
**Đang chạy production**, đã verify lại lúc 2026-06-15 (chi tiết cấu hình ban đầu: `docs/DEPLOY-GCP.md`):
- VM IP `34.142.194.160` — DNS `api.tubutree.com` + `app.tubutree.com` cùng trỏ về (root `tubutree.com` đang sau Cloudflare, để landing riêng).
- Caddy auto-HTTPS Let's Encrypt cho cả 2 sub.
- Live check: `GET https://api.tubutree.com/api/health` = `{"status":"ok","db":"up"}`, `app.tubutree.com` = 200, Swagger `/api/docs` mở được, mọi route `/api/game/*` mounted (public 200, protected 401), webhook `/api/webhooks/pancake` mounted (POST → 401 không có token).

**CI/CD đã wired** (`.github/workflows/`):
- `deploy.yml` — push `main` đụng `apps/api/**`, `packages/**`, `docker-compose.prod.yml`, `Caddyfile` → tự SSH vào VM `git pull && docker compose up -d --build api web` rồi prune image. Cần 3 secret: `VM_HOST`, `VM_USER`, `VM_SSH_KEY` (đã cấu hình).
- `smoke.yml` — chạy thủ công (`gh workflow run smoke.yml`): tạo token CUSTOMER+ADMIN thật trên VM, GET hết endpoint app dùng, in HTTP status để bắt 5xx.
- `logs.yml` — `gh workflow run logs.yml`: dump log API 20 phút gần nhất, lọc DIAG/error/zalo.

**Redeploy thường:** chỉ cần `git push main` (CD tự lo). Migration mới tự áp khi API restart.

**Vận hành SSH trực tiếp** (khi CD đỏ hoặc cần can thiệp tay): `cd ~/tubutree && docker compose -f docker-compose.prod.yml <logs|restart|exec> ...` — chi tiết `docs/DEPLOY-GCP.md` §9.

## 5. Config & keys
- Dev: `apps/api/.env` (Pancake đã có: SHOP_ID 20021276 + API_KEY + WEBHOOK_SECRET).
- Prod VM stack: `.env` ở root (mẫu `.env.production.example`).
- Miniapp: `apps/miniapp/.env.production` (Cloudinary `dciz7wmgg`, `VITE_WEB_BASE_URL`, `VITE_API_BASE_URL`). Zalo Mini App ID `2070857098114207963` ở `app-config.json`.

## 6. Quy ước làm việc (giữ khi tiếp tục)
- TDD cho logic nghiệp vụ; mỗi commit: typecheck + lint + build (BE+FE) xanh; migration kèm khi đổi schema.
- Tiền tệ thao tác atomic (`updateMany` + điều kiện `gte`), daily action idempotent theo `dayKey` (giờ VN UTC+7).
- UI: icon `lucide-react` cho chức năng, emoji cho game; immersive (actionBarHidden + back-button nổi).
- Migration SQL viết tay (tránh `migrate dev` EPERM trên Windows), đặt trong `apps/api/prisma/migrations/<ts>_<name>/migration.sql`.
