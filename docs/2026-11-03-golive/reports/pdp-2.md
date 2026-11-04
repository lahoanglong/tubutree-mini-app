# pdp-2 (nhánh gl/1103-pdp, commit 7bc177dd2)

- P2 test CLS Mini: viết lại. Allowance treo bằng cổng do test mở (support/pdp-cls.ts), neo là khối đầu tiên bên dưới vùng ghi chú, cuộn vào giữa màn hình. Kiểm đỏ khi tắt giữ chỗ (`reserveFlashNote=false`): ca perUserLeft 0 đỏ, "khối bên dưới dịch 52.03px". Bật lại: 3/3 xanh. Ca perUserLeft 3 (không có ghi chú) xanh cả hai.
- P2 web đặt giữ chỗ muộn: đúng. Thêm `useAuthRestoring()` vào `reserveFlashNote` (add-to-cart.tsx). vitest mới đỏ trước, xanh sau; add-to-cart.spec 98/98. Thêm ca Playwright web 375 và 1280 (hold /auth/refresh, đo dịch và CLS), và ca allowance treo; CHƯA CHẠY.
- P1: (a) web-gate.sh không dựng được máy chủ: lần 1-2 API quá 180s, lần 3 `next build` quá 600s (load máy 60-200). Spec web (flash-sheet-price.web, voucher-ticket-height.web) CHƯA XANH, tsc e2e sạch. (b) ảnh trước/sau và before-after.mjs CHƯA làm (cần web-gate/lane 3 mà máy quá tải). (c) Bundle Mini đo xong (vite build, 52fd5cd65 vs nhánh): JS 1.967.705 -> 1.967.880 B (+175 B), gzip tổng 701.279 -> 701.216 B (-63 B). Không đáng kể.
- P3 spec 320 web: thêm `expectNarrowTickets` dùng chung (voucher-ticket-checks.ts), Mini và web cùng gọi. Mini 4/4 xanh; ca web chưa chạy.
- P3 media query: đổi sang `not all and (min-width: 768px)` khớp max-md. lint:parity xanh (max-md 1003 chỗ).
- Số thật: vitest add-to-cart 98/98, miniapp product-detail-flash 30/30, Playwright Mini pdp-flash-note-cls 3/3, voucher-ticket-height.miniapp 4/4, tsc web + e2e sạch.
- Còn nợ trước khi merge: chạy web-gate (2 spec trên) khi máy rảnh + ảnh 375/1280 trước/sau.
