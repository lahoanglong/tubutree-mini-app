# CHANGELOG_OVERNIGHT — đêm 2026-06-15 → 16

Branch: `overnight/2026-06-15` → đã merge `main` (`5302752`). Backup tag: `pre-overnight-2026-06-15`.

---

## 0. Kết luận audit (quan trọng nhất) — "claim cũ vs thực tế"
**Giả định của đề bài (mất work / cần rebuild) KHÔNG đúng với thực tế.** Quét toàn bộ repo + prod:
- Work các phiên trước **đã commit lên `main`, build sạch, có test, đã deploy LIVE**. Không có branch `overnight/*` cũ kẹt, không stash, working tree sạch.
- Baseline đêm nay (máy mới): `pnpm install` ok → **244 unit test PASS (35 suite)** → **4 app build sạch** (sau `prisma generate` + build shared-types — đúng như Docker/CI làm).
- Prod LIVE thật: `GET /api/health = {"status":"ok","db":"up"}`, web 200, `/api/products` có **101 SP** trước khi làm.
- App đã **rất hoàn chỉnh & polished** (home, loyalty, browse, product-card có skeleton/empty/error/fallback ảnh, immersive, đúng 5 màu brand). → KHÔNG đập đi xây lại; chỉ **nâng chất + bổ sung + deploy/verify**.

→ Đêm nay tập trung giá trị thật, an toàn, verify được — không bịa "feature" vào app đã đủ.

## 1. Thay đổi đã làm (đều test trên Postgres thật + build/test xanh)

### [P1] Catalog demo đa thương hiệu — `apps/api/prisma/seed.ts` + migration `20260616000000_demo_catalog_multibrand`
- **6 SP / 3 brand (ảnh rỗng) → 44 SP / 8 thương hiệu, 100% có ảnh.** Brands: Visante(8), Pơ Lang(6), Fuwa3e(6), Cobote(5), Le Plateau Coffee(5), BH.Nong(5), Sokfram(5), Hector(4).
- Thêm 3 category (Chăm sóc cá nhân, Cà phê & Đồ uống, Nông sản & Thực phẩm), ~12 SP flash-deal (salePrice), 2 coupon (FREESHIP, XANH10) + WELCOME30.
- Ảnh demo ổn định theo slug (picsum) — sync Pancake thật sẽ ghi đè ảnh/giá/tồn.
- **Migration idempotent + chống xung đột** (`INSERT … WHERE NOT EXISTS` theo unique + backfill ảnh `UPDATE`). Tự áp khi container API khởi động → đẩy catalog lên prod **mà KHÔNG đụng 95 SP Pancake**. Đã test trên PG thật: fresh→44 SP/8 brand; re-run delta 0, 0 trùng slug, backfill ảnh 6 SP cũ.

### [P1] Loyalty — `apps/api/src/modules/loyalty/loyalty.service.ts`
- `getOverview`: user chưa có `tierId` (mọi user trước đơn DELIVERED đầu tiên) **mặc định hạng nền Mầm Xanh** thay vì `tier=null`; tính đúng "còn X điểm lên hạng kế". Phát hiện qua E2E thật.

### [P2] Auth chống treo — `apps/miniapp/src/services/zmp-bridge.ts`
- `zmpLogin`/`getAccessToken` bọc **timeout 3s** + bail nhanh khi timeout → ngoài Zalo (hoặc cầu nối native không phản hồi) app **không còn kẹt màn loading**, rơi xuống đăng nhập khách. (Deploy theo lần `zmp deploy` Mini App kế tiếp.)

## 2. Kiểm thử thực thi đêm nay (không chỉ "claim")
- **Dựng Postgres thật KHÔNG cần Docker** (embedded-postgres, UTF8) → chạy `prisma migrate deploy` (tất cả migration áp sạch) + `prisma:seed` (44 SP).
- **Boot API thật** local (Nest, Redis vắng mặt → BullMQ retry nền, không chặn boot).
- **E2E 19/19 PASS** trên stack thật theo hành trình B2C: health · brands(8) · products(44 có ảnh) · lọc brand · đăng nhập khách · /me · chi tiết SP · thêm giỏ · áp FREESHIP (ship→0) · địa chỉ · báo giá · **đặt đơn COD `CONFIRMED`** · **idempotency (gọi lại cùng key = cùng đơn)** · danh sách đơn · game profile/check-in/quiz · loyalty.

## 3. Deploy + Verify (BẮT BUỘC — đã làm tới nơi)
- **Merge `main` + push** → GitHub Actions `deploy.yml` SSH vào VM, `docker compose up --build api web`, migration tự áp.
- **Verify tận mắt qua API prod** (`https://api.tubutree.com`) sau deploy:
  - `health = {"status":"ok","db":"up"}`.
  - `/api/brands` = **9 brand**: Visante(8), Pơ Lang(6), Fuwa3e(6), Cobote(5), Le Plateau Coffee(5), BH.Nong(5), Sokfram(5), Hector(4), Tubu Tree(95). Tổng **139 SP**.
  - Ảnh: 100 SP đầu chỉ 13 SP thiếu ảnh — **tất cả đều là brand "Tubu Tree" (Pancake)**; mọi SP demo đều có ảnh.
  - **Backfill xác nhận:** 6 SP seed cũ (serum Visante, rửa chén Fuwa3e, dầu gội Pơ Lang, …) nay `thumbnail = CÓ` (trước null).
  - `/api/products/arabica-cau-dat-le-plateau` = 200, đúng tên, 1 ảnh, 2 biến thể; lọc 5 brand mới đều ra SP.
- **Verify qua Web (app.tubutree.com — cùng catalog, đã rebuild):** `GET /san-pham/arabica-cau-dat-le-plateau` = **200**, HTML render đúng "Arabica" + brand "Le Plateau" + ảnh picsum → catalog mới hiển thị thật trên web.

## 4. Còn lại buổi sáng (1 việc duy nhất) — xem `DEPLOY_ZALO.md`
- **`zmp login` + `zmp deploy`** để đẩy Mini App lên Zalo. Máy này KHÔNG có `zmp` CLI/phiên login → agent không tự làm được (đúng blocker đề bài lường trước).
- **Bundle production đã sẵn sàng 100%**: `apps/miniapp/www/` (937 KB), API base đã trỏ `https://api.tubutree.com/api`, typecheck + build xanh.

## 5. Giới hạn môi trường (trung thực)
- **Không pixel-screenshot được Mini App**: không có Docker; Preview MCP (headless) không render được app zmp-ui/zmp-sdk (vốn cần runtime Zalo); Chrome MCP không có browser kết nối; computer-use chặn thao tác trình duyệt. → Verify đã làm ở mức **API thật + E2E 19/19 + web SSR HTML + build xanh + 0 lỗi console khi app load**, là mức cao nhất khả thi ở đây. Verify hình ảnh đầy đủ cần Zalo simulator (sau `zmp deploy`).
- **Lint nợ cũ**: repo còn 3 error `no-explicit-any` + 146 warning `consistent-type-imports` **có từ trước** (ở file không đụng tới); deploy không chạy lint nên không chặn. File mình sửa: lint sạch. Để lại (ngoài scope, tránh đụng code đang chạy).

## 6. Không làm (có chủ đích)
- Không thêm "feature" hình thức vào app đã đủ chức năng (sẽ là busywork không verify được khi chưa deploy Mini App). Giá trị net-new thực = catalog đa thương hiệu (deploy+verify) + 2 fix đúng đắn/robust.
- Không sửa lint nợ cũ / không đụng 95 SP Pancake / không đổi kiến trúc — đúng nguyên tắc "không đập đi xây lại".
