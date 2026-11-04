# Báo cáo gói ctv, lượt 3 (nhánh gl/1103-ctv)

Commit: 02810dbd7 (chữ, ngân sách, ca web 320), cùng commit sau đó (viền thin + size sm). Chưa push.

## P1 R-140 soát bằng ảnh: đã chụp lane 4 (API build lại, migrate deploy cho DB l4)
Chụp Mini 375 / web 375 / web 1280: affiliate (ctv, returning), storefront (ctv, returning), s-slug (returning, new, guest), dealer (dealer, returning); thêm storefront ctv trạng thái lỗi 500. Đã xem từng cặp mini375 so web375:
- Trình dựng gian hàng (storefront ctv) s1/s2: khớp (hero, tên shop, chip, thẻ, thống kê, quest, khối bố cục, nút dính đáy). Lệch nhỏ còn lại: web nút "Sửa hồ sơ/Cài đặt" thấp hơn Mini ~8px vì chiều cao nút của Mini AppButton 44 (web 44 + font), và thanh dính đáy web nằm trong khung có chân trang (footer web hiển thị, Mini không có): đó là chân trang web, giữ.
- Trang CTV (affiliate ctv) s1/s2: khớp. Mã giới thiệu: Mini affiliate.tsx:694 và web ctv/page.tsx:563 cùng price-lg, bold, tracking; khớp. Danh sách "Việc đầu tiên" (gạch đầu dòng): khớp. Chip "Tân binh" ở thẻ bậc: khớp màu.
- s-slug guest/returning: khớp (chỉ khác 4px dòng "Muốn có gian hàng như này?").
- dealer: Mini tiêu đề tên SP/biến thể hơi cao hơn (dòng 2 "150g" lớn hơn) và ô tìm có viền nhạt hơn so với web: lệch nhỏ P3, không thuộc phạm vi gói ctv này (dealer.tsx là vùng phiên db), KHÔNG sửa; ghi lại.
- Không dựng được bằng seed lane: trạng thái rỗng có hình, ô CCCD, nút dính đáy bước 1 (cần persona chưa đăng ký CTV hoặc form đăng ký), nút thêm SP: chưa xác nhận bằng ảnh ở lượt này, KHÔNG đánh dấu khớp. Mục này vẫn mở trong R-140.
- Ảnh lưu: screens-ctv/{mini375,web375}-ctv-tanbinh-hint-final.png, -storefront-s2.png, -storefront-error500.png; ảnh lỗi thời `mini375-ctv_pending-tanbinh-after.png` đã xoá.
- Lưu ý seed: seed-data.mjs lane 4 lỗi ở bước "extra" (waste), tôi tự điền params-l4.json tạm; các file tạm đã xoá khỏi worktree.

## P2 chữ "Lên Đồng có huy hiệu" (đã sửa)
`shop.tierHintNext` = "Huy hiệu từ bậc {name}" (20 ký tự với "Đồng"); ngân sách `shop.tierHintNext` = 22; spec shop-copy kiểm giá trị xấu nhất name="Đồng". Cập nhật khẳng định chữ ở vitest Mini, vitest web, hai e2e. Test đỏ với mã cũ: ngân sách 22 chặn chữ dài, khẳng định chữ đổi nên đỏ với chữ cũ (so chuỗi).

## P2 e2e web (đã chạy)
Thêm ca web 320px (ctv đã duyệt + Tân binh) vào builder-tier-cls.web.spec.ts. web-gate.sh KHÔNG dựng nổi (Timeout webServer 180s rồi 600s do `next build`, tải máy 80-93); chạy thay bằng lane 4 (next dev 3242) với `E2E_SCOPE=web`: 9/9 xanh (lần đầu 8/9 + 1 flaky do timeout 30s lúc tải nặng, xanh khi chạy lại với --timeout=90000). Mini builder-tier-cls.miniapp: 10/10. Chưa chạy trên gốc 52fd5cd65 để thấy đỏ (không làm được lượt này).

## P2 ảnh thiết kế cuối / viền khó thấy (đã sửa)
Viền chuyển sang `--color-border-default`. Xem ảnh web 375/1280 và Mini 375: viền đứt thấy rõ, nền trong, đọc là ô giữ chỗ. Ảnh web 375 pending: tên "Cửa hàng Xanh" + chip. 

## P3 outline vs border (đã sửa)
Dùng `border: thin dashed` + Badge size="sm" (padding 2px 6px + viền 1px = đúng chiều cao md), không thêm px viết tay (lint:parity px-ratchet 3769 giữ; phiên bản đầu dùng 1px/2px 7px làm px-ratchet đỏ, đã bắt được và sửa).

## P3 không sửa
- Dòng "chỉ bạn thấy" ở đầu xem trước: để phiên điều phối/chủ duyệt giọng chữ.
- `nextTierName` null khi bảng bậc rỗng: bảng CTV_TIERS cố định 5 bậc, không xảy ra; bỏ qua.
- bundle-report: không chạy (tải máy); thay đổi chỉ là một chuỗi và vài style.

## Kiểm (TZ=UTC, Node 22.23.3)
- vitest app-core shop-copy + shop-page: 73/73. Mini storefront-builder.spec 137/137. Web ctv/gian-hang page.spec 169/169.
- Playwright web builder-tier-cls.web (lane 4): 9/9. Mini builder-tier-cls.miniapp: 10/10.
- `pnpm lint:parity`: xanh (px-ratchet 3769/399).
