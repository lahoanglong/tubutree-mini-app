# Lane pro — báo cáo

## 1. Đã làm
| Mục | Commit | File chính |
|---|---|---|
| dealer-pricing chuyển sang app-core (Mini App re-export) | 9887a087 | `packages/app-core/src/dealer-pricing.ts` |
| Cổng đại lý `/dai-ly` (đăng ký, chờ duyệt, bảng giá, đơn, công nợ, báo cáo quý) | cd125a28 | `apps/web/src/app/dai-ly/`, `components/dealer/*`, `lib/dealer-view.ts` |
| `/nhan-vien` (lịch ca, đăng ký, chép tuần, huỷ ca; chấm công chỉ dẫn sang Mini App) | a7076915 | `app/nhan-vien/`, `components/staff/*`, `lib/week.ts` |
| `/nhan-vien/bang-luong` | 402324b2 | `app/nhan-vien/bang-luong/`, `components/staff/payroll-hub.tsx` |
| `/chu-thuong-hieu` (hồ sơ, khuyến mãi, doanh thu) | 6f6ee3f8 | `app/chu-thuong-hieu/`, `components/brand-owner/*` |
| Admin: tab Nhân sự & quyền | cf2cabd7 | `components/admin/staff-roster-tab.tsx` |
| Admin: tab Duyệt ca | 3c475550 | `components/admin/shift-approval-tab.tsx` |
| Admin: tab Lương (+ CSV) | 2f009c97, 24b94286 | `components/admin/payroll-admin-tab.tsx`, `payroll-csv.ts` |
| Nối ba tab vào `/admin`, e2e (chưa chạy) | 89e1939b | `app/admin/page.tsx`, `apps/e2e/tests/pro.web.spec.ts` |
| Sửa theo review | ef307c25, 3317a77a, 69fd04fd, 6f7029a9, b4278f20, 54fb6555 | xem mục 3 |

Route hết pending: `/dealer`, hai dòng nhân viên và bảng lương, `/chu-thuong-hieu` (brand-owner). `/admin` vốn không pending. Bỏ "Duyệt đổi vỏ": tab Refill đã bị nhánh đổi rác gỡ.

## 2. Kiểm chứng
Gate cuối (run4) xanh, DONE:
```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  39 passed (39)  Tests  467 passed (467)
web-typecheck rc=0
web-lint rc=0 No ESLint warnings or errors
web-test rc=0  Test Files  309 passed (309)  Tests  4826 passed (4826)
web-test-utc rc=0  Test Files  309 passed (309)  Tests  4826 passed (4826)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  282 passed (282)  Tests  4214 passed (4214)
lint-vars rc=0 OK
lint-parity rc=0 xanh (19 mục pending)
web-build rc=0 Compiled successfully
miniapp-build rc=0
```
Test Mini App 4214, không giảm. Playwright chưa chạy (đúng luật).

## 3. Review
Vòng 1:
- MINOR payroll: nút Thông tin nhận lương mở được trước khi tải xong, Lưu gửi ô rỗng đè tài khoản: sửa ở 3317a77a.
- MINOR duyệt ca: TIME_RE nhận "8:00" làm RangeError im lặng: sửa ở ef307c25.
- MINOR đại lý: giữ khoá sau lỗi rồi redirect theo biến, không theo đơn trả về: sửa ở 69fd04fd (chỉ chuyển trang khi đơn trả về PENDING_PAYMENT + BANK_TRANSFER).
- MINOR thanh đặt hàng tự viết thay StickyActionBar: sửa ở 69fd04fd.
Vòng 2:
- MAJOR đổi khoá khi đổi phương thức tạo đơn thứ hai: sửa ở 6f7029a9 (bỏ phương thức khỏi dấu vân tay).
- MINOR ca chuẩn không nhận 24:00: sửa ở b4278f20.
Vòng 3:
- MAJOR đổi khoá khi đổi giỏ vẫn tạo đơn công nợ thứ hai: sửa ở 54fb6555 (giữ khoá tới khi thành công như Mini App; đơn trả về khác giỏ thì không xoá giỏ, báo rõ, đổi khoá). Chỉ so khi mọi dòng đơn có variationId; máy chủ thật luôn trả.
- MINOR comment price-tab lệch code: sửa ở 54fb6555.
- MINOR shift-sheets bỏ kiểm giờ khi không có ca chuẩn: sửa ở 54fb6555.
Không còn phát hiện mở. Chưa có vòng 4 sau 54fb6555 (gate xanh).

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng
- Playwright (`pro.web.spec.ts`, 12 ca) chỉ viết, chưa chạy.
- Chấm công, heartbeat: chỉ MiniAppOnlyNotice, không POST.
- Chưa có lối vào `/dai-ly` từ hub `/tai-khoan` (lane account).
- MiniAppOnlyNotice cao (py-16) trong thẻ chấm công: cần prop compact ở lane core.
- `apps/e2e/tests/support/mock-api.ts` thiếu `put` (dùng `api.on('PUT')`).
- Chữ lệch Mini App cố ý: bỏ emoji/ký hiệu (ds-palette-pc11), nhãn trạng thái đơn dùng `orderStatusLabel` web; màu ink B2B thay bằng stone/forest.
- Dán đơn chặn tổng một dòng ở 9999.
- `csvField` ở payroll-csv trùng ý `escapeCsvCell` của lib/export-csv.ts (chỉ lặp, không lỗi).
- TDD không có bước đỏ riêng ở dealer-view, page.spec đại lý, chu-thuong-hieu.
- Ảnh chứng cứ/QR gửi data URL như đường fallback Mini App; chưa kiểm giới hạn body phía API.

## 5. Câu hỏi cho chủ dự án
1. Giữ công tắc bật/tắt khuyến mãi (PATCH `{isActive}`, Mini App không có)? Mặc định: giữ.
2. Bấm "Chốt" lương và "Duyệt tất cả" có cần hộp xác nhận? Mặc định: không, như Mini App.
3. Thẻ đơn ở tab Đơn hàng đại lý dẫn tới chi tiết đơn, chỉ PREPAID mới sang chuyển khoản? Mặc định: đúng vậy.
4. Cho phép web ghi ảnh chứng cứ dạng data URL khi chưa có Cloudinary? Mặc định: có, như Mini App.
