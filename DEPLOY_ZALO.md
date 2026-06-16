# DEPLOY_ZALO.md — Đưa Mini App lên Zalo (việc DUY NHẤT còn lại buổi sáng)

> Backend đã tự deploy qua CI/CD (push `main`). **Chỉ còn bước đẩy Mini App lên Zalo** —
> bước này cần đăng nhập `zmp` (phiên login nằm trên máy của Long, agent không có).

## TL;DR (2 lệnh)
```bash
cd apps/miniapp
zmp login      # mở trình duyệt, đăng nhập tài khoản Zalo dev (chỉ cần 1 lần/máy)
zmp deploy     # đẩy bản production lên Zalo Mini App 2070857098114207963
```
> Đã có sẵn script: `pnpm --filter @tubutree/miniapp deploy` (chạy `zmp deploy -M production`).

## Bundle đã sẵn sàng 100%
- Đã `vite build` (production) → output `apps/miniapp/www/` (937 KB), **API base đã trỏ `https://api.tubutree.com/api`** (xác nhận trong bundle).
- `app-config.json`: appId `2070857098114207963`, headerColor `#509018` — đúng brand.
- Typecheck + build FE: **xanh**.
- Nếu cần build lại cho chắc: `cd apps/miniapp && pnpm build` (chạy `tsc --noEmit && vite build`).

## Vì sao agent không tự `zmp deploy` được đêm nay
- Máy này **chưa cài `zmp` CLI toàn cục** và **không có phiên đăng nhập Zalo** (`~/.zmp` trống).
- `zmp deploy` cần OAuth tài khoản Zalo dev → không thể tự động hoá khi không có phiên.
- Mọi thứ khác (code, bundle, backend, DB) đã sẵn sàng — chỉ thiếu cú `zmp login` + `zmp deploy`.

## Cài `zmp` nếu chưa có
```bash
npm i -g zmp-cli
zmp -v
```

## Sau khi deploy — kiểm tra nhanh trên Zalo
1. Mở Mini App trên Zalo (hoặc quét QR từ Zalo Mini App Studio).
2. Trang chủ: dải thương hiệu hiện **8 brand**, có ảnh sản phẩm.
3. Bộ lọc thương hiệu (trang Khám phá) đủ 8 brand, lọc ra sản phẩm có ảnh.
4. Vào 1 sản phẩm → thêm giỏ → checkout COD → đơn `CONFIRMED`.
5. Vườn Xanh: điểm danh, quiz, tưới cây hoạt động.

## Backend & catalog — đã LIVE (CI/CD đêm nay)
- API `https://api.tubutree.com` + web `https://app.tubutree.com` đã rebuild qua GitHub Actions.
- Migration `20260616000000_demo_catalog_multibrand` tự áp khi container API khởi động →
  catalog 8 thương hiệu + ảnh đã lên prod (kiểm chứng: `GET /api/brands`).
- Mini App production trỏ thẳng API này nên deploy xong là dùng được ngay, không cần đổi gì.
