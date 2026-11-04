# pdp c1 (sửa theo reviewer), nhánh gl/1103-pdp, commit 711d03063

- P1 (gói chưa đạt): web-gate flash-sheet-price.web.spec.ts 20/20 xanh (2 project, workers=1), gồm 4 ca CLS từng đỏ. Mini pdp-flash-note-cls.miniapp.spec.ts 3/3 xanh. Ảnh trước/sau: 375 (375x2372) và 1280 (1280x2224), 0 px lệch, toạ độ mọi khối [data-section^=pdp-] trùng khớp. "Trước" = cùng cây mã nhưng `tubu-pdp-order-N` đổi lại thành `max-md:order-N`; "sau" = HEAD. Ảnh/JSON ở /private/tmp/claude-501/pdp-c1/{before,after} (không commit; before-after.mjs không viết, dùng spec chụp tạm đã gỡ).
- P2 margin collapse 1280: đã sửa (`mt-2` -> `md:pt-2`, đệm nằm trong 28px giữ chỗ). Ca 1280 xanh.
- P2 CLS cả trang và neo theo DOM: đã sửa. `anchorBelow` chọn khối theo vị trí màn hình (top nhỏ nhất >= đáy vùng ghi chú); `readShiftBelow` chỉ cộng layout-shift có nguồn từ vùng ghi chú trở xuống và dịch khác độ dịch của chính vùng (khối phía trên như dòng Điểm Xanh đổi theo pha đăng nhập không tính). Test kiểm vị trí tương đối khối neo so với vùng ghi chú.
- P2 dưới 1px ở 375: đã sửa, min-height +1px ở web (mini.css) và Mini (product-detail.tsx). CLS = 0 ở cả hai.
- P2 nền xám 52px web 375: đã sửa, `max-md:bg-[var(--color-bg-surface)]` trên div pdp-flash-limit.
- P3 pha unavailable/guest co dải một lần: không đổi hành vi, ghi comment chấp nhận ở add-to-cart.tsx.
- P3 mục 2 mới xong một phần: ghi nhận. Chỉ `order` (13 chỗ) chuyển sang lớp riêng PDP; px viết tay, pdp-extras, pdp-sections chưa đụng. Chưa phải lớp dùng chung.

Test thật: vitest web add-to-cart.spec + san-pham/[slug]/page.spec 159/159; vitest miniapp product-detail-flash 30/30; tsc web và e2e sạch; Playwright như trên. Lane/cổng 3921-3925 đã đóng. Node 22.23.3 cần cho vitest (PATH).
