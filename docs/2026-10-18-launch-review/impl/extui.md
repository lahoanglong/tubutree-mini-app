# extui: UI của B6 bước 2 (tích điểm đơn sàn)

Nhánh `lr2/extui` (từ `lr2/extclaim` 3d333fb7). Trạng thái: miniapp và dải "gấp đôi" xong; tab admin mới là bản nháp, chờ API của `lr2/extclaim` đổi theo review.

## Miniapp

- Trang `/points/scan` (`pages/external-points.tsx`, `services/external-points-api.ts`, route ở `components/app.tsx`). Ô nhập tay là đường chính; nút "Quét mã" gọi `scanQRCode` qua `scanCode()` ở `zmp-bridge.ts`, quét lỗi hay không đọc được thì gợi ý nhập tay.
- Kết quả gửi mã: sàn, mã che, điểm chờ, mốc dự kiến cộng. Lỗi hiện theo `code` bằng câu trong `vi.externalPoints.reject`; lỗi không có `code` (mạng, 5xx) dùng `getErrorMessage`.
- Danh sách "Đơn ngoài app của bạn": phân trang Trước/Sau, phần "Đang tìm đơn" ở trang 1. Nhãn: Chờ giao hàng (PENDING, chưa có mốc), Chờ cộng điểm (PENDING có mốc, kèm "Dự kiến dd/MM/yyyy"), Cần duyệt (REVIEW, HELD_NO_MEMBER), Đã cộng, Đã huỷ, Đã thu hồi, Hết hạn. Không viết cứng "14 ngày": số ngày chờ không có trong public config.
- Lối vào ở `profile.tsx`, nhóm "Tài sản", chỉ khi `loyalty.marketplaceClaimEnabled === true`. Vào thẳng URL khi cờ tắt: "Chưa mở".
- Kiểu `PublicConfig.loyalty` thêm `marketplaceClaimEnabled`, `marketplaceEarnPct`.

## Dải "Mua trong Mini App tích nhiều hơn"

Một component `components/loyalty/points-boost-strip.tsx` (logic thuần `pointsBoostOf` ở `utils/loyalty-copy.ts`). Số lấy từ `earnPct` và `marketplaceEarnPct`; "Gấp đôi" khi earnPct = 2 x marketplaceEarnPct, còn lại "nhiều hơn"; dòng phụ "Đơn sàn {m}% · Mua trong Mini App từ {e}%, nhân theo hạng". Nếu đơn app không cao hơn đơn sàn thì không so sánh.

Chỗ đặt:
- Màn quét mã: đầu trang (dải đầy đủ).
- Trang sản phẩm: ngay dưới dòng "Nhận … Điểm Xanh" có sẵn, dạng gọn. Lý do: dòng đó đã là chỗ nói về điểm, dải bổ sung "so với sàn".
- Trang chủ: trong khối `orderStrip` (khối thứ 3, tự rỗng với khách mới) nên không đổi thứ tự khối `homeBlockOrder`. Chọn trang chủ thay vì Ví vì chủ dự án muốn thấy ở nơi khách mua.
- Cờ claim tắt: trang chủ chỉ hiện "Tích {e}% Điểm Xanh khi mua trong Mini App"; trang sản phẩm không thêm gì (dòng "Nhận … Điểm Xanh" đã có, không thêm dòng trùng; dòng đó không sửa chữ).

## Test

- vitest miniapp: `pages/external-points.spec.tsx`, `components/loyalty/points-boost-strip.spec.tsx`, thêm ca vào `profile-hub.spec.tsx` và `loyalty-copy.spec.ts`.
- Playwright (`apps/e2e/tests/external-points.miniapp.spec.ts`, mock ở `tests/support/external-points-mocks.ts`): gửi mã thành công, lỗi ALREADY_CLAIMED, cờ tắt. Chạy bằng `pnpm test:miniapp` (mock toàn bộ API, không cần DB).

## Tab admin "Tích điểm đơn sàn"

Đã gộp `lr2/extclaim` (ac4b0a9b) vào nhánh bằng merge. Menu "Tích điểm đơn sàn" (nhóm Đơn hàng & giao vận, tổng menu 38), khoá hộp việc `externalPoints` mở thẳng tab này. Quyền: ADMIN và CSKH thao tác, KE_TOAN chỉ xem, KHO không thấy.

- Danh sách lọc theo trạng thái và tìm kiếm; "Chi tiết" tải `AdminExternalClaimDetail` và hiện lịch sử thao tác (`events`).
- Nút: Duyệt (xác nhận), Huỷ và Huỷ và mở lại mã (bắt buộc lý do), Đảo điểm (chỉ ADMIN, bắt buộc lý do, báo số điểm thực thu hồi), Giữ điểm gỡ cờ (chỉ ADMIN, chỉ khi claim đã cộng đang có cờ, bắt buộc note). Claim đã cộng mà đơn đã đóng có nhãn "cần đảo điểm".
- Lần gửi mã chưa ghép được: Gắn đơn (hỏi mã đơn Pancake rồi ghi chú) và Từ chối. Kết quả REVIEW báo "đang chờ người khác duyệt".
- Ẩn trước khi gọi API: mọi nút trên claim và lần gửi mã của chính mình (SELF_ACTION); nút Gắn đơn với CSKH khi lần gửi mã đã thấy đơn nhưng nguồn lạ (chỉ ADMIN); nút Duyệt bị vô hiệu khi lịch sử cho thấy chính bạn đã gắn đơn hoặc đưa claim vào chờ duyệt (SAME_INTRODUCER, chỉ biết sau khi mở Chi tiết).
- Không biết trước (mã không khớp đơn khi gắn, thiếu note, claim không còn cờ): hiện câu tiếng Việt theo `code` (`adminClaimErrorText`), mã lạ thì nguyên văn message API.
- Test: `components/admin/external-claims-tab.spec.tsx`, `lib/external-claims.spec.ts`, ca mới ở `app/admin/page.spec.tsx`.

## Ảnh chụp

`extui-img/extui-scan.png` (màn quét mã) và `extui-img/extui-home.png` (dải ở trang chủ; các thẻ "Chưa mock" trong ảnh là do mock e2e). Chưa chụp trang sản phẩm và tab admin (cần mock sản phẩm / chạy Next).
