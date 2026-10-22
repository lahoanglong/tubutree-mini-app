# Lane mv-pro: web điện thoại giống Mini App (đổi rác, đại lý, nhân viên, bảng lương, chủ thương hiệu)

Nhánh `web/mv-pro`, tip `903de5bf`. Ảnh chụp cuối: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-logs/visual/mv-pro-3/` (`web/tour/*.jpg` so với `miniapp/tour/*.jpg`, 51/51 cặp).

Cách làm: lớp phủ `max-md:` trong `components/pro-shared/mini-skin.ts` (nút phụ secondary xanh nhạt không viền, thẻ raised không viền, tiêu đề serif, kéo tiêu đề ngang hàng nút lùi nổi). Từ md giữ giao diện máy tính. Chữ khác Mini App thì sửa ở mọi khổ.

| Màn | Khác biệt đã sửa | Commit | Còn lại và vì sao |
|---|---|---|---|
| Đại lý | Nền #f4f6f9, thẻ tổng quan navy #1f2a44 (màu ở `dealer-theme.css`), nút Dán đơn secondary, giá đại lý navy, "-20%" màu brand, nút primary navy, khung bảng giá không viền | 4a4c1a0d, e4c77df6, 44cd3a48, 903de5bf | Ô tìm kiếm là ô chữ nhật bo nhỏ, Mini App là ô bo tròn (SearchField); nút Dán đơn thấp hơn 4px. Dòng SKU của Mini App xuống hàng vì cỡ chữ lớn hơn một chút |
| Ca làm nhân viên | Dòng "Cần ở đúng mạng WiFi công ty & trong vùng để chấm công." luôn hiện (chữ theo Mini App ở mọi khổ, thay câu cũ), Copy tuần trước secondary, thẻ ngày không viền, tiêu đề thẻ title-sm | 34ce4ab1 | Nút "Đăng ký n..." bị cắt chữ ở Mini App là lỗi phía Mini App, web không chép |
| Bảng lương | Thẻ tổng kết gradient xanh, số tiền sans đậm price-xl, nút Thông tin nhận lương secondary, trạng thái trống dùng EmptyState có hình hộp (mọi khổ) | 34ce4ab1 | Khoảng cách dòng "Giờ công/Lương gộp" hẹp hơn Mini App vài px |
| Chủ thương hiệu | Nút Xem trang nhãn secondary, tiêu đề thẻ serif, nhãn Logo/Ảnh bìa đậm, khung đứt 1.5px nền canvas, ô Tagline/Nguồn gốc cỡ body-lg | 32c63bb8, 1eb2a517, 903de5bf | Nhãn các ô nhập (Tagline...) vẫn nhỏ hơn Text label của Mini App; khối Khuyến mãi dưới ảnh không so được vì ảnh Mini App chỉ bằng khung nhìn |
| Đổi rác lấy quà | Icon lịch sử hiện lại (bỏ `btnSecondary w-11 px-0` chồng px-5), thẻ điểm không viền, hàng Kho quà/Thể lệ trơn trên nền, chữ khối "Tubu nhận những món này" đúng bậc | fc1509f2, 75710bde, 903de5bf | Nút lịch sử ở Mini App không khung, web giữ khung từ md |
| Thể lệ | Đoạn thể lệ cỡ body-md | fc1509f2, 75710bde, 903de5bf | |
| Tạo yêu cầu | Ảnh món là lá xanh nhạt (ProductThumb), chữ phụ cỡ caption, thanh dính đáy xếp dọc | fc1509f2, 75710bde, 903de5bf | Chân trang gọn (hotline, Điều khoản) vẫn hiện trên điện thoại, đó là vỏ trang của lane mshell |
| Điểm nhận rác | Cùng bộ sửa với tạo yêu cầu (waste-item-step, nút phụ) | fc1509f2, 75710bde, 903de5bf | Không so được: tour chụp `/recycle/points` nhưng cả hai bên dừng ở bước 1 "Chọn món" (cần state từ bước chọn điểm). Màn chọn điểm chưa có ảnh đối chiếu |
| Chi tiết yêu cầu | Sửa món, Huỷ yêu cầu, nút phụ secondary | fc1509f2, 75710bde, 903de5bf | |
| Sửa yêu cầu | Thanh dính đáy xếp dọc (chú thích trên, nút full-width dưới), Đổi điểm nhận secondary, ảnh món lá xanh | fc1509f2, 75710bde, 903de5bf | Web hiện thêm dòng "Ước tính mới 3.000 điểm" trong ảnh chụp, Mini App chưa (preview mock về muộn); cả hai code đều có dòng này |
| Yêu cầu của tôi | Hàng yêu cầu trơn trên nền, sát mép 16px | fc1509f2, 75710bde, 903de5bf | |
| Đổi rác hoàn tất | Nút Đổi thêm rác secondary, thẻ không viền | fc1509f2, 75710bde, 903de5bf | |
| Quầy nhận rác | Thẻ Hạn mức/Báo cáo không viền, đệm 12px, chữ body-md, nút Chỉnh sửa secondary | fc1509f2, 75710bde, 903de5bf | |
| Tất cả | Tiêu đề nằm ngang hàng nút lùi nổi (kéo thân lên 48px khi `body.with-back-btn`) | cbc7e5b3 | Thanh đầu trắng của Mini App không có bản web (nền trong suốt); đó là vỏ trang của lane mshell |

Bỏ qua: `/admin`, `/admin?tab=community` (phiên UAT giữ).

Route web đã bỏ pending: /dai-ly, /nhan-vien (ca), /my-payroll, /chu-thuong-hieu, /doi-rac và các màn con (rules, new, request, requests, done, desk, points).

## Kiểm chứng

Gate cuối (summary.txt):

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  41 passed (41)  Tests  489 passed (489)
web-typecheck rc=0
web-lint rc=0
web-test rc=0    Test Files  368 passed (368)  Tests  6324 passed (6324)
web-test-utc rc=0  Test Files  368 passed (368)  Tests  6324 passed (6324)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  283 passed (283)  Tests  4313 passed (4313)
lint-vars rc=0 OK
lint-parity rc=0 lint:parity xanh (0 mục pending)
web-build rc=0 Compiled successfully
miniapp-build rc=0
DONE
```

Không đụng `apps/miniapp`, `apps/api`, `packages`, `components/mini`. Playwright chỉ chạy ở lượt chụp 3 (51/51 cặp); sau đó không chạy lại.

## Review

Lượt 1:
- MAJOR tiêu đề /doi-rac bị nút lùi nổi che (mainUp không có pl-12): sửa ở 75710bde; 903de5bf đổi sang padding thay vì backHref để máy tính không có link lùi mới.
- MINOR hàng Kho quà/Thể lệ/Yêu cầu còn bóng (`[box-shadow]` thắng `shadow-none`): sửa ở 75710bde (skin.plain).
- MINOR thẻ Cách đổi mất viền: sửa ở 75710bde; viền đúng token stone-200 ở 903de5bf.
- MINOR navy đại lý mới áp nửa: 5 nút còn lại và thẻ doanh số quý navy ở 44cd3a48.
- MINOR hover navy đè nút khoá: dùng `enabled:` ở 44cd3a48.
- MINOR chủ thương hiệu: nút khuyến mãi secondary, ô ngày min-w-0 (chống tràn ngang, chưa xác nhận bằng ảnh), tiêu đề thẻ giữ sans ở máy tính: 1eb2a517.

Lượt 2:
- MAJOR nút Lưu mẫu/Thêm vào đơn trong suốt vì Sheet portal ra body ngoài `[data-dealer-theme]`: biến navy khai ở `:root` kèm màu dự phòng, 903de5bf.
- MINOR outlineCard sai token viền: 903de5bf. MINOR thiếu navy ở tổng giỏ, tổng đơn, mẫu đơn, Kỳ trước: 903de5bf. MINOR Huỷ xoá khuyến mãi: 903de5bf. MINOR backHref thêm link lùi ở máy tính: 903de5bf.
- MINOR báo cáo và ảnh cũ hơn vòng 2: báo cáo cập nhật ở đây; ảnh chưa chụp lại (xem dưới).

## Chưa làm, cố ý để lại, chưa kiểm chứng

- Chưa có ảnh chụp sau vòng 2 (luật cấm chạy Playwright): chưa xác nhận bằng mắt /doi-rac, brand-owner.full (tràn ngang ô ngày), dai-ly, hai sheet đại lý ở điện thoại. Cần phiên được chạy Playwright (N=4).
- Màn chọn điểm nhận rác không có ảnh đối chiếu (tour dừng ở bước 1).
- Dòng "Kỳ trước" ở rewards-card có lớp navy nhưng chưa có test riêng (cần dữ liệu thưởng kỳ trước).
- Thanh đầu trắng và chân trang gọn: thuộc lane mshell.
- Sai lệch nhỏ: ô tìm của Dán đơn bo nhỏ (Mini App bo tròn), nhãn ô nhập chủ thương hiệu nhỏ hơn, khoảng cách dòng thẻ lương hẹp vài px.
- Đổi ở mọi khổ (kể cả máy tính): EmptyState có hình ở bảng lương trống, dòng WiFi luôn hiện, ProductThumb lá xanh ở thẻ món.
- Test lớp CSS chỉ khoá chuỗi lớp, không tính được CSS thật; mini-skin.spec.ts viết sau code. Test cũ assert nút navy đổi sang tiền tố `max-md:enabled:bg-[var(--color-dealer-ink,` do lớp có màu dự phòng.

## Câu hỏi cho chủ dự án

1. Có muốn web máy tính (từ md) cũng có EmptyState hình, dòng WiFi, lá xanh như điện thoại không? Mặc định: giữ (đã áp mọi khổ).
2. Ảnh chụp N=4 chạy ở phiên nào? Mặc định: để phiên có quyền Playwright chạy sau khi gộp.
