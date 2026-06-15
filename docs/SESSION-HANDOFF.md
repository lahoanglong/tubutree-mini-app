# Tubu Tree — Session Handoff (cập nhật 2026-06-15)

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
- **236+ unit test pass** (34 suite), 3 app build sạch (local + Docker). Prod stack đã smoke-test OK (xem mục 4).
- **Vườn Xanh 2.0: HOÀN TẤT 4 phase + social.** (xem mục 2)
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
- 🔑 API keys go-live còn thiếu: **ZaloPay** (`ZALOPAY_APP_ID/KEY1/KEY2`), **Zalo OA + ZNS** (`ZALO_OA_ACCESS_TOKEN`, template ID — lead time duyệt 7–14 ngày), **Accesstrade** (`ACCESSTRADE_TOKEN/PUBLISHER_ID`). Pancake + Cloudinary **đã có**.
- 🖥️ Deploy production lên VM GCP (xem mục 4) — cần VM + domain + DNS.
- 🌳 Tích hợp **PanNature** trồng cây thật khi đủ mốc cộng đồng (webhook/batch — ai phụ trách?).
- 📊 Cách tính điểm-hạng cho cron tier-recalc §6.6 (lifetime vs balance).

**Hoãn có chủ đích (back-office / out-of-scope):** thưởng quý đại lý, admin upload Excel giá, AI tư vấn 24/7 (cần Claude key), group buy, review video (UGC), community feed.

## 4. Deploy (đã verify build + smoke-test container, chưa lên VM thật)
Đã chứng minh prod stack chạy được: API image build sạch, `prisma migrate deploy` tự áp khi start, `/api/health` = `{"status":"ok","db":"up"}`, mọi route game mapped.

**Lên VM thật** (chi tiết: `docs/DEPLOY-GCP.md`):
```bash
# trên VM Ubuntu đã cài Docker:
git clone ... tubutree && cd tubutree
cp .env.production.example .env && nano .env   # WEB_DOMAIN, POSTGRES_PASSWORD, JWT secrets, các key
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api pnpm prisma:seed   # lần đầu
```
Caddy auto-HTTPS. Redeploy: `git pull && docker compose ... up -d --build` (migration tự áp).

## 5. Config & keys
- Dev: `apps/api/.env` (Pancake đã có: SHOP_ID 20021276 + API_KEY + WEBHOOK_SECRET).
- Prod VM stack: `.env` ở root (mẫu `.env.production.example`).
- Miniapp: `apps/miniapp/.env.production` (Cloudinary `dciz7wmgg`, `VITE_WEB_BASE_URL`, `VITE_API_BASE_URL`). Zalo Mini App ID `2070857098114207963` ở `app-config.json`.

## 6. Quy ước làm việc (giữ khi tiếp tục)
- TDD cho logic nghiệp vụ; mỗi commit: typecheck + lint + build (BE+FE) xanh; migration kèm khi đổi schema.
- Tiền tệ thao tác atomic (`updateMany` + điều kiện `gte`), daily action idempotent theo `dayKey` (giờ VN UTC+7).
- UI: icon `lucide-react` cho chức năng, emoji cho game; immersive (actionBarHidden + back-button nổi).
- Migration SQL viết tay (tránh `migrate dev` EPERM trên Windows), đặt trong `apps/api/prisma/migrations/<ts>_<name>/migration.sql`.
