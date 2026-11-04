# webperf vòng 2 (reviewer Opus)
Nhánh gl/1103-webperf, commit sửa nằm sau 0391127d0 (chưa push).

| Phát hiện | Xử lý |
|---|---|
| P1 Playwright pdp-mobile đỏ do prefetch PDP | Sửa, hướng 2: `prefetch={false}` ở Link của ProductTile (cách tải như cũ, không kéo ~58 KB RSC mỗi thẻ). pdp-mobile.web 11 passed / 1 skipped (ca "khung chờ chi tiết SP" xanh); shop.web + home-merged.web 99 passed / 1 skipped. Lưu ý: các Link khác tới trang ISR mới (brand, chiến dịch...) vẫn prefetch mặc định, chưa đo. |
| P1 trần slug 120 làm 404 SP thật | Sửa. Trần 256 cho san-pham/s/brand, 80 cho chien-dich/chinh-sach, thêm ký tự `[A-Za-z0-9_-]`. Test slug 209 ký tự (tên 200 ký tự) đi thẳng 200; đỏ với mã cũ (4/12 ca đỏ). |
| P2 ISR ghi cache mọi đường dẫn lạ | Sửa: mua-chung/[id], hoc-vien/[courseId] bỏ generateStaticParams (về ƒ như gốc); chinh-sach lọc `isLegalSlug` ở middleware; san-pham/s/brand/chien-dich lọc ký tự + trần. Rủi ro còn lại (slug đúng dạng nhưng không tồn tại vẫn ghi ~53 KB) và cách dọn ghi ở docs/launch/deploy-rollback-runbook.md mục 10. Không dùng dynamicParams=false vì build cần API. |
| P2 thiếu test | Sửa: middleware.spec (slug dài nhất, quá trần, ký tự, legal, route khác) + isr-pages.spec.ts (5 trang ISR có generateStaticParams, không import next/headers; 2 trang khung không có). |
| P3 404 chữ trần | Sửa (rẻ): rewrite sang `/_slug-not-found` status 404, no-store. Kiểm `next start`: 404, có not-found.tsx của site ("Về trang chủ"). |

Số thật: vitest middleware+isr 19/19; vitest web toàn bộ 153 file / 2864 test xanh (410 "unhandled error webidl.util.markAsUncloneable" là nhiễu môi trường jsdom/undici lúc đóng, không liên quan); tsc sạch; next build: /san-pham/[slug] và /s/[slug] vẫn ● , mua-chung/[id] ƒ.
Chưa đo: byte JS/RSC Trang chủ khổ 375 so perf-main.json (không cần vì prefetch về như cũ).
