# webperf-1 (nhánh gl/1103-webperf, gốc 52fd5cd65)

Commit (chưa push):
- f57128ecf perf(web): khai sideEffects để bỏ export barrel không dùng khỏi First Load JS
- c7ef905b1 perf(web): ISR cho các trang theo [slug] và chặn slug dài vô lý
- 0391127d0 perf(web): dùng chung staleTime cho /config/public, hết gọi hai lần

## HIEUNANG-01
`apps/web/package.json`: sideEffects = ["*.css","**/*.css","./src/lib/nav-depth.ts"]. nav-depth.ts giữ riêng vì đóng dấu history ngay khi nạp.
`next build` trước (bỏ sideEffects) và sau, First Load: giảm mạnh ở nhiều trang, vd /ban-chay 210->179, /cong-dong 222->172, /doi-rac 220->167, /tu-van 207->149, /thanh-toan 245->205, /tai-khoan 225->174, /tai-khoan/don-hang/[code] 244->198, /san-pham 222->193, /gio-hang 224->186, /ds-gallery 206->146 kB. Shared 104 kB.
Tăng nhẹ (nhiễu chia chunk): /san-pham/[slug] 231->233, /s/[slug] 197->199, /brand/[slug] 192->193, /nhan-vien +1, /dang-nhap +1 kB (trong ngưỡng +2 KB).

## HIEUNANG-02
generateStaticParams() trả [] ở 7 route (san-pham, brand, chinh-sach, s, mua-chung, chien-dich, hoc-vien). Cây SSR của 7 trang này không đọc cookies/headers/searchParams phía server (useSearchParams chỉ ở client component; build đánh ●).
`next start` (API giả trả 404): lượt 1 x-nextjs-cache MISS, lượt 2 HIT, cache-control s-maxage=300 (brand, chien-dich 60) + stale-while-revalidate. Trang có dữ liệu (mua-chung, hoc-vien) cũng MISS->HIT.
404 của slug lạ cũng bị cache: 300 giây (san-pham, s) hoặc 60 giây (brand, chien-dich), rồi dựng lại ở lượt sau.
Giới hạn: middleware trả 404 `cache-control: no-store` cho slug dài hơn 120 ký tự ở 7 route (kiểm: slug 130 ký tự -> 404 no-store, không vào cache). Có test trong middleware.spec.ts. Slug ngắn lạ vẫn tạo mục cache (mỗi đường dẫn một mục): chưa giới hạn số lượng, rủi ro nhỏ bộ nhớ nếu bot dò nhiều slug.
Dữ liệu cá nhân (giá Giờ vàng, suất, tim, giỏ) vẫn lấy ở client, không đổi.
Lưu ý: khi API chết lúc dựng trang, lượt đầu trả 500 no-store (không bị cache), đúng như cũ.

## HIEUNANG-10
`query-client.ts`: setQueryDefaults(['public-config'], staleTime 5 phút) cho mọi trang dùng chung khoá; test thêm ở query-client.spec.ts.

## Kiểm
- tsc web: sạch. eslint 4 file đã sửa: sạch.
- vitest web toàn bộ (TZ=UTC): chạy 2 lần dưới tải máy 70-90: lần 1 19 fail, lần 2 104 fail, đều là timeout ở 4 file (admin/page, browse-view, suggest-feed, pdp-extras), khác nhau giữa 2 lần. Chạy lại riêng 4 file: 412/412 pass. Các file còn lại 9577 - 412 xanh trong cả 2 lần.
- pnpm lint:parity: xanh (ds-ratchet, px, max-md không đổi).
## Chưa làm
- Playwright web-gate chưa chạy (máy tải 70-90, không đủ ổn định); chỉ kiểm bằng next build + next start + curl. Điều phối nên chạy web-gate trên /san-pham/[slug] và /tai-khoan trước khi merge.
- Không đổi Mini, không chụp ảnh (không đổi giao diện). Chưa đo thời gian thật trên PROD.
