# Báo cáo gói ctv, lượt 1 (nhánh gl/1103-ctv, gốc 52fd5cd65)

## Commit (chưa push)
- 3835f9f59 `fix(ctv): hàng huy hiệu bậc ở trình dựng gian hàng giữ chỗ bằng dòng gợi ý, không thu lại khi bậc về muộn`

## Mục 1: hàng huy hiệu bậc CTV (CLS)
Gốc lỗi: khung chờ huy hiệu (`TierBadgeSkeleton`) chiếm một hàng ~30px. Bậc về là bậc thấp nhất, lỗi, hoặc hết hạn chờ thì nơi gọi trả `null`, hàng biến mất và phần dưới nhích lên. Chỉ lộ khi không có "CTV tuyển chọn" giữ hàng (ctv_pending, ctv chưa duyệt).
Cách chọn (theo yêu cầu "nếu giữ chỗ thì chỗ đó phải có nội dung"): gian hàng loại CTV luôn có đúng một ô ở hàng huy hiệu: khung chờ -> huy hiệu "CTV {bậc}" hoặc `TierBadgeHint` (Badge trung tính, chữ "Huy hiệu bậc hiện từ bậc 2", `shop.tierHint`, ngân sách 30 ký tự). Cùng `Badge` nên cùng chiều cao, không nhích. Chỉ chủ shop thấy ở trình dựng; trang khách `/s/:slug` không đổi (vẫn ẩn bậc 1). MERCHANT không có ô này.
Chỗ chọn khác: dòng gợi ý đúng cho cả ca "bậc lỗi/mất mạng" (không biết bậc thật), nên chữ nói "từ bậc 2" chung, không nêu tên bậc.
File: `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts`; `tier-badge.tsx` (Mini + web `components/mini`); `storefront-builder.tsx` (Mini `pages/`, web `components/affiliate/`).
Test:
- vitest cập nhật 6 ca mỗi app (bậc 1, lỗi, lỗi 500 về muộn, thấp nhất về muộn, paused, MERCHANT không có gợi ý).
- e2e mới `apps/e2e/tests/builder-tier-cls.miniapp.spec.ts` (Chromium ép, đo layout-shift + y khối đầu) và `builder-tier-cls.web.spec.ts`: ma trận {ctv đã duyệt, ctv_pending} x {thấp nhất, Đồng, Kim Cương, lỗi 500}, vào thẳng URL, bậc về chậm.
- Đỏ với mã cũ (chạy Mini với `storefront-builder.tsx` gốc): ctv_pending + thấp nhất và ctv_pending + lỗi 500 đỏ "CLS lúc bậc về 0.0252"; 2 ca ctv đã duyệt + thấp nhất/lỗi đỏ ở khẳng định có dòng gợi ý. Web: không chạy lại với mã cũ (build web ~10 phút lúc tải 100+), logic dùng chung.

## Mục 2: R-140 phần còn lại
- Kiểu chữ mã giới thiệu: đối chiếu mã. Mini `Text price-lg tone brand letterSpacing 1`; web trang CTV `max-md:` cùng cỡ `--type-price-lg-*`, bold, tracking 1px, màu brand. Đã khớp, không sửa.
- Gạch đầu dòng: đo Mini thật (Playwright): `ul` điều khoản CTV `list-style: none`, `padding-left: 18px`. Web `ul pl-[18px]` + preflight Tailwind = không chấm. Khớp. Đại lý: cả hai `disc` + 18px. Khớp.
- KHÔNG làm: soát ảnh 375 hai nền (ctv, ctv_pending, dealer, guest ở `/s/<slug>`) bằng lane 4 và `capture.mjs`. Lý do: tải máy 100 đến 150 suốt phiên (docker pg tạm mất kết nối, build/Nest quá hạn 180s), dựng lane (build API, copy DB) không khả thi. Việc còn lại của R-140 nếu có chỉ lộ ra từ ảnh; đề nghị chạy lại ảnh khi máy rảnh.

## Kiểm
- tsc `--noEmit`: app-core, miniapp, web, e2e: sạch.
- eslint: miniapp (3 file), `next lint` web (2 file): sạch.
- vitest app-core: 166 file, 2598 test xanh.
- vitest miniapp (TZ=UTC) toàn bộ: lần 1 11 đỏ / 6530, lần 2 4 đỏ / 6530 (khác bộ, đều "Test timed out in 5000ms" ở flash-sale, suggest-feed, shop-products-tab, loyalty-behavior, không phải file tôi sửa); chạy lại 4 file với `--testTimeout=60000`: 110/110 xanh. Ghi cho gói flaky.
- vitest web toàn bộ: 9565 xanh, 10 đỏ cùng loại timeout (suggest-feed 7, shop-products-tab 3); hai file đó với `--testTimeout=60000`: 29/29 xanh. Không chạy TZ khác (không đụng giờ).
- Playwright Mini: `builder-tier-cls.miniapp` 9/9 xanh; `builder-polish.miniapp` xanh (chạy chung lần đầu: 15 passed, 4 đỏ chỉ là ca ctv_pending của spec mới do tôi dựng sai mock status, đã sửa).
- Playwright web (Web Customer): `builder-tier-cls` + `builder-polish` + `ctv-375`: 17 passed, 11 skipped (ca 1280/project khác), 0 failed.
  Lệch brief: `web-gate.sh` thất bại 5 lần (docker pg mất kết nối sau migrate, rồi Nest dev/next build quá hạn). Chạy bằng bản sao ở scratchpad `web-gate-native.sh`: Postgres nhúng 25432 với DB riêng `tubutree_gate_ctv` (đã xoá), Redis 26379 db 4, API `node dist/main.js` đã build sẵn, web `next start` đã build sẵn, cùng khối biến rỗng chặn khoá thật; cổng 3931/3932/3933.
- `pnpm lint:parity`: xanh (px-ratchet 3769/399 file, max-md 1014/103 file, không đổi).
- Race spec / jest API: không đụng API, không chạy.

## Bundle Mini (vite build, bundle-report.mjs, gốc 52fd5cd65 so nhánh)
- Entry: 659 KB raw / 205 KB gzip cả hai (không tăng). JS 1922/681 KB, tổng 2214/862 KB gzip cả hai. Chênh < 0,5 KB (dưới độ phân giải số đo).
- Web First Load: không đo (thay đổi ~12 dòng trong trình dựng, chưa chạy next build có đo).

## Ảnh (`docs/2026-11-03-golive/screens-ctv/`, đã mở xem)
- `mini375-ctv_pending-tanbinh-before.png` / `-after.png`: trước không có hàng huy hiệu, sau có dòng gợi ý (hàng giữ chỗ).
- `mini375-ctv-dong-after.png` (và `-before`): ctv đã duyệt bậc Đồng, không đổi (tick, "CTV tuyển chọn", "CTV Đồng").
- Web 375/1280 chưa chụp (cùng thành phần dùng chung; e2e web đo 0 CLS). Thiếu ảnh web là điều chưa làm.

## Còn lại / rủi ro
- Soát ảnh R-140 chưa làm (xem trên).
- Chữ "Huy hiệu bậc hiện từ bậc 2" là chữ mới cho khách CTV: cần chủ/phiên điều phối duyệt giọng nếu muốn đổi.
- Dừng tiến trình: không còn gì nghe 3931 đến 3933; lane 4 chưa bật.
