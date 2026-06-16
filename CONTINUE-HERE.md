# ▶️ CONTINUE-HERE — tiếp tục trên máy khác (cập nhật 2026-06-16)

> Mọi thứ đã **push lên `main`**. Trên máy mới chỉ cần `git clone` (hoặc `git pull`) là có đủ.

## 1. Trạng thái hiện tại (đã verify)
- **Prod đang LIVE & khoẻ**: `https://api.tubutree.com` (health ok) + `https://app.tubutree.com` (200).
- **Catalog đa thương hiệu đã LIVE trên prod**: `/api/brands` = **9 brand** (Visante, Pơ Lang, Fuwa3e, Cobote, Le Plateau Coffee, BH.Nong, Sokfram, Hector + Tubu Tree/Pancake), 44 SP demo đều có ảnh.
- **Đã merge `main`** (`0140dff`), backup tag **`pre-overnight-2026-06-15`** để rollback.
- Build + 244 test + E2E 19/19: **xanh**. Chi tiết: `CHANGELOG_OVERNIGHT.md`.

## 2. Việc CÒN LẠI duy nhất ⚠️
**Đẩy Mini App lên Zalo** (máy đêm qua không có `zmp` CLI/login):
```bash
cd apps/miniapp
zmp login        # 1 lần/máy
zmp deploy       # = pnpm --filter @tubutree/miniapp deploy
```
Bundle production đã build sẵn (`apps/miniapp/www/`, trỏ API prod). Chi tiết + checklist: **`DEPLOY_ZALO.md`**.

## 3. Test tiếp trên máy mới (KHÔNG cần Docker)
Bộ test local + hướng dẫn từng bước: **`tools/local-test/README.md`** (Postgres nhúng UTF8 → migrate → seed → boot API → E2E B2C). Verify prod nhanh: `cd tools/local-test && npm i && npm run verify-prod`.

## 4. Bản đồ tài liệu
| File | Nội dung |
|---|---|
| `CONTINUE-HERE.md` | (file này) điểm vào nhanh |
| `CHANGELOG_OVERNIGHT.md` | Toàn bộ thay đổi đêm 2026-06-16 + kết quả audit + verify prod |
| `DEMO_SCRIPT.md` | Kịch bản demo ~7–10' (tiếng Việt), điểm nhấn Vườn Xanh + lên hạng + checkout |
| `DEPLOY_ZALO.md` | 2 lệnh đưa Mini App lên Zalo |
| `OVERNIGHT_PLAN.md` | Audit + backlog + trạng thái từng phase |
| `docs/SESSION-HANDOFF.md` | Bàn giao tổng thể (keys go-live còn thiếu, vận hành VM) |
| `tools/local-test/README.md` | Test local không cần Docker |

## 5. Thay đổi code đêm qua (tóm tắt)
- `apps/api/prisma/seed.ts` + migration `20260616000000_demo_catalog_multibrand` — catalog 8 thương hiệu, 44 SP có ảnh (migration idempotent, an toàn, KHÔNG đụng SP Pancake).
- `apps/api/src/modules/loyalty/loyalty.service.ts` — user mới mặc định hạng nền Mầm Xanh.
- `apps/miniapp/src/services/zmp-bridge.ts` — timeout chống treo màn loading khi SDK Zalo không phản hồi.

## 6. Lưu ý môi trường (gặp lại trên máy mới)
- Node/pnpm có thể không nằm trên PATH của shell non-interactive → thêm `C:\Program Files\nodejs` + `%APPDATA%\npm` (Windows).
- `prisma generate` + build `@tubutree/shared-types` phải chạy trước khi typecheck/build FE (turbo/Docker tự lo; nếu chạy tay thì nhớ).
- Keys go-live còn thiếu (ZaloPay/OA-ZNS/Accesstrade) — xem `docs/SESSION-HANDOFF.md` mục 5. Demo dùng COD/Ví đầy đủ.
