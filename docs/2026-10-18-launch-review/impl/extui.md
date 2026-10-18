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

## Tab admin (NHÁP, chưa xong)

Đã có bản nháp (`components/admin/external-claims-tab.tsx`, `lib/external-claims.ts`, hàm trong `lib/admin-client.ts`, menu "Tích điểm đơn sàn" trong `page.tsx`, khoá `externalPoints` ở ops-inbox, spec đếm menu 37 sang 38) theo API hiện tại. Chưa có test vitest cho tab. Chờ commit mới của `lr2/extclaim` (attach thêm `note` và chỉ ADMIN khi mã không khớp, không tự thao tác claim của mình, "giữ điểm, gỡ cờ", audit, mã lỗi mới) rồi gộp (merge) và hoàn thiện.

## Chưa chụp ảnh

Chưa chạy bộ chụp UI.
