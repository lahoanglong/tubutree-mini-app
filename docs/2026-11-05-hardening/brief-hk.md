# Gói hk (đợt 4): checkout mobile 375px gọn, lỗi rõ (Mini App + web)

Worktree: `.claude/worktrees/hard-1105-hk`, nhánh `hard/1105-hk`, gốc `hard/1105-w4` (tip lúc giao). PG race: cổng 46542. Cổng Playwright gốc: 3990 (API 3991, web 3992, Mini App 3993, PG 3994, Redis 3995). Luật chung: `hard-1105-rules.md`. Gọi skill `tubu-ui` trước khi sửa giao diện.

## Vì sao
Checkout đã có nhiều lớp an toàn (spec sticky, errors, offline, total-changed, idempotency…). Việc còn lại là trải nghiệm thật ở điện thoại 375px: khách nhìn một màn phải hiểu ngay phải trả bao nhiêu, còn thiếu gì, lỗi ở đâu, và không mất dữ liệu đã nhập. Web khổ điện thoại phải giống Mini App cả giao diện lẫn chức năng.

## Cách làm (bắt buộc theo thứ tự)
1. **Chụp hiện trạng.** Dùng visual tour có sẵn (`apps/e2e/tests/visual-tour.*.spec.ts`, ghép cặp bằng `apps/e2e/scripts/visual-pairs.mjs`) hoặc spec chụp riêng.
   - Màn: Mini App `checkout` và web `/thanh-toan`, cả hai ở 375×812; web thêm 1280.
   - Trạng thái: bình thường; giỏ nhiều dòng; địa chỉ dài; chưa có địa chỉ; nhập sai SĐT/tên; mã giảm giá lỗi; giá đổi (PRICE_CHANGED); hết hàng một dòng; mất mạng khi đặt; đang gửi (nút bận); ví/điểm áp dụng; chuyển khoản.
   - Chạy Playwright `--workers=1`, chỉ các spec chụp này. Lưu ảnh ở `apps/e2e/visual-out/hk-before` (không commit ảnh).
2. **Liệt kê vấn đề** trong `docs/2026-11-05-hardening/hk-findings.md`, mỗi dòng: màn, trạng thái, ảnh, vấn đề, mức (cao/vừa/thấp), cách sửa. Tiêu chí:
   - CTA "Đặt hàng" + tổng tiền luôn thấy ở đáy (safe-area), không che ô nhập khi bàn phím mở.
   - Lỗi ô nhập hiện ngay dưới ô (blur + khi bấm đặt), cuộn và focus tới ô lỗi đầu tiên, có `aria-invalid` và `aria-describedby`.
   - Tóm tắt phí: tạm tính, giảm giá từng nguồn, phí ship, điểm/ví, tổng. Không tràn dòng, số canh phải, đơn vị "đ" nhất quán.
   - Lỗi giá đổi, hết hàng, mã hết hạn: báo đúng dòng hàng/đúng ô, có nút sửa nhanh (bỏ dòng hết hàng, nhận giá mới), không xoá dữ liệu đã nhập.
   - Mất mạng: giữ nguyên form, nút "Thử lại", không đặt đôi.
   - Vùng chạm ≥ 44px. Chữ không dưới 13px. Không cuộn ngang.
   - Mini App và web 375px khớp nhau (thứ tự khối, chữ, màu, trạng thái).
3. **Sửa** các mục cao + vừa (mục thấp: sửa nếu rẻ, còn lại ghi lại). Logic dùng chung đưa vào `packages/app-core` (được phép THÊM hàm/hằng thuần, không đổi chữ ký có sẵn; ghi rõ trong báo cáo) để hai nền tảng không lệch.
4. **Chụp lại** cùng bộ trạng thái vào `hk-after`. Ghi cặp trước/sau vào `hk-findings.md`.

## Test bắt buộc (đỏ trước cho từng sửa)
- vitest Mini App + web cho từng hành vi: lỗi ô, focus ô lỗi đầu, giữ dữ liệu khi lỗi mạng, khối lỗi theo dòng hàng, CTA dính đáy có tổng.
- Playwright (miniapp + web, 375): một luồng đặt hàng có lỗi ô → sửa → đặt thành công; một luồng giá đổi → nhận giá mới → đặt. Chạy `--workers=1`, chỉ spec của gói.
- Không đổi API trừ khi thiếu dữ liệu để báo lỗi theo dòng. Nếu đổi: test API + race đầy đủ như luật chung.

## Ngoài phạm vi
- Không đổi luồng thanh toán ZaloPay/chuyển khoản, không đổi cách tính tiền.
- Không đụng trang chi tiết đơn (gói `hl`).
