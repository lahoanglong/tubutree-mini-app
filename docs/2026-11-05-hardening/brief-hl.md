# Gói hl (đợt 4): trang theo dõi đơn của khách (Mini App + web)

Worktree: `.claude/worktrees/hard-1105-hl`, nhánh `hard/1105-hl`, gốc `hard/1105-w4` (tip lúc giao). PG race: cổng 46543. Cổng Playwright gốc: 4090 (API 4091, web 4092, Mini App 4093, PG 4094, Redis 4095). Luật chung: `hard-1105-rules.md`. Gọi skill `tubu-ui` trước khi sửa giao diện.

## Vì sao
Sau khi đặt, khách mở chi tiết đơn để biết: đơn đang ở đâu, bao giờ tới, và làm được gì lúc này. Mini App (`apps/miniapp/src/pages/order-detail.tsx`) và web (`apps/web/src/app/tai-khoan/don-hang/[code]/`) đã có timeline, mã vận đơn, huỷ, mua lại, liên hệ, trả hàng. Việc còn lại là trình bày rõ, nhất quán hai nền tảng, desktop gọn, và đúng nút đúng lúc.

## Cách làm (bắt buộc theo thứ tự)
1. **Chụp hiện trạng.** Màn chi tiết đơn ở 375×812 (Mini App + web) và 1280 (web).
   - Mỗi trạng thái một ảnh: chờ thanh toán (chuyển khoản), đã xác nhận, đã đóng gói, đang giao (có mã vận đơn + sự kiện vận chuyển), đã giao, đã huỷ (có lý do), trả hàng/hoàn tiền đang xử lý, đơn định kỳ, đơn nhiều dòng.
   - Chạy Playwright `--workers=1`. Lưu ở `apps/e2e/visual-out/hl-before` (không commit ảnh).
2. **Liệt kê vấn đề** trong `docs/2026-11-05-hardening/hl-findings.md` (màn, trạng thái, ảnh, vấn đề, mức, cách sửa). Đích cần đạt:
   - Đầu trang: trạng thái hiện tại bằng một câu dễ hiểu + mốc dự kiến (ETA nếu có) + bước kế tiếp.
   - Dòng thời gian: các bước với giờ thật; bước hiện tại nổi bật; sự kiện vận chuyển (Pancake/Gomdon) gom dưới bước "Đang giao", mới nhất trên cùng.
   - Vận chuyển: tên hãng + mã vận đơn có nút chép.
   - Nút đúng lúc, một nút chính mỗi trạng thái:
     - chờ thanh toán: thanh toán ngay + hạn còn lại;
     - trước bàn giao: huỷ;
     - đang giao: liên hệ;
     - đã giao: đánh giá / mua lại / trả hàng trong hạn.
     Các nút phụ vào menu. Điều kiện nút lấy từ API/app-core hiện có, không tự đoán.
   - Desktop 1280: hai cột gọn (trái: trạng thái + timeline + hàng; phải: tóm tắt tiền + địa chỉ + nút), không kéo dãn hết màn.
   - Mini App và web 375px khớp nhau. Chạm ≥ 44px, không cuộn ngang, có `aria-current` ở bước hiện tại.
3. **Sửa** các mục cao + vừa. Logic dùng chung (chọn câu trạng thái, nút chính theo trạng thái, gom sự kiện) đặt ở `packages/app-core` (được phép THÊM hàm/hằng thuần, không đổi chữ ký có sẵn; ghi rõ báo cáo).
4. **Chụp lại** vào `hl-after`, ghi cặp trước/sau vào `hl-findings.md`.

## Test bắt buộc (đỏ trước)
- vitest app-core: bảng trạng thái → câu + nút chính + điều kiện từng nút.
- vitest Mini App + web: render từng trạng thái (nút chính đúng, nút cấm không hiện), chép mã vận đơn, desktop hai cột.
- Playwright (miniapp + web 375, web 1280): mở đơn đang giao thấy timeline + mã vận đơn; đơn chờ thanh toán thấy hạn + nút thanh toán. Chạy `--workers=1`, chỉ spec của gói.
- Đổi API (nếu thiếu dữ liệu như ETA, hãng vận chuyển) thì test API + race đầy đủ.

## Ngoài phạm vi
- Không đổi luồng huỷ/trả hàng/hoàn tiền ở API (chỉ trình bày).
- Không đụng checkout (gói `hk`).
