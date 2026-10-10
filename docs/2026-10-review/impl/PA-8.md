# PA-8 - Vệ sinh test

## C-031 - XONG
- `analytics.controller.ts`: `getTracker` nhận `Record<string, unknown>` và ép kiểu hẹp (headers, user.sub, ip) thay cho `any`; hành vi giữ nguyên (X-Device-Id, rồi user.sub, rồi ip).
- `community-feed.service.spec.ts`: bỏ import type thừa `AnalyticsEventsService`.
- Kiểm chứng (apps/api): `npx eslint src --ext .ts` 0 lỗi (trước: 2), `tsc --noEmit` sạch, `jest src/modules/analytics src/modules/feed` 8 suite / 248 test xanh.

## C-111 - XONG
- Nguyên nhân: JWT E2E có `sub` không tồn tại trong DB, API trả "tham chiếu không hợp lệ" (P2003).
- `apps/e2e/global-setup.ts` upsert user cố định `e2e-test-user-00000000` (Prisma client lấy từ apps/api qua createRequire, DB = `DATABASE_URL` của process hoặc apps/api/.env); seed lỗi thì E2E_API_TOKEN rỗng, test skip như trước.
- `api.spec.ts` quote: với user thật và addressId giả, API trả đúng 400 "Địa chỉ giao hàng không hợp lệ." (địa chỉ kiểm trước giỏ trống trong `compute()`); test giờ assert chặt 400 + message đó (bỏ nhánh `if status===400` và regex lỏng).
- Playwright `--project=API --workers=2 --retries=0`: trước 1 pass / 1 fail; sau 2 pass / 0 fail.

## C-063 - XONG
- UI (`DealersTab`) gửi `order=asc` cho hàng chờ: trang 1 là hồ sơ cũ nhất, phần chưa tải là hồ sơ MỚI hơn, thông báo "Còn N hồ sơ mới hơn chưa tải". Test cũ mock thứ tự desc và tìm "cũ hơn" nên đỏ; đó là test cũ, không phải lỗi UI.
- `admin.spec.ts` "Hàng chờ quá 1 trang": mock phục vụ theo asc, assert `order=asc` ở cả hai lần gọi, "mới hơn chưa tải", hồ sơ chờ lâu nhất đứng đầu và hồ sơ mới tải thêm đứng cuối.
- Playwright `--project="Web Admin" --workers=2 --retries=0`: sau sửa 4 pass / 0 fail (trước: 1 fail theo catalog, spec dealer pagination).

## Môi trường E2E
Postgres `tubu_it_pa8` cổng 5548 DB `tubutree_it` (đã migrate; `prisma/seed.ts` chạy), `REDIS_URL=redis://localhost:6381/7`. Không đụng tubu_pg:5434. Playwright tự spawn server và dọn khi kết thúc; sau lượt chạy không còn cổng 3001/3112/3113 LISTEN.

## Giả định / việc còn lại
- C-062 (miniapp E2E) do lượt khác làm.
