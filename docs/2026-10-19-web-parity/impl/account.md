# Lane account (nhánh web/account)

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Hub tài khoản và sửa hồ sơ | 4ba43d00, 3e8a55a3, 38adc609, 7aae6f37, e78e782b | `app/tai-khoan/page.tsx`, `app/tai-khoan/ho-so/`, `components/account/{cloudinary-upload.ts,avatar-crop-sheet.tsx,account-menu.ts}` |
| Cài đặt và thông báo | dff65457, 5fb48c6f, 918406d5, ac10caa4 | `app/tai-khoan/cai-dat/`, `app/tai-khoan/thong-bao/`, `components/account/{notification-view.ts,font-scale.ts}`, `FontScaleApplier` trong `app-gates.tsx` |
| Giới thiệu, nhận mã, onboarding | 110b9476, 7a296bc9, d1885fff, eb1a7b57 | `app/gioi-thieu/`, `lib/faq-fallback.ts`, `components/{coupon-claim-gate,onboarding-gate}.tsx`, `components/account/{coupon-claim.ts,onboarding-rules.ts}` |
| Sửa theo review | ff83fd19, e31fc628, 79fe3b80, 8f047d91 (và các commit sửa vòng 1) | `ho-so/page.tsx`, `tai-khoan/page.tsx`, `gioi-thieu/page.tsx` |

Route web đã bỏ pending: `/tai-khoan/ho-so` (edit-profile), `/tai-khoan/cai-dat`, `/tai-khoan/thong-bao`, `/gioi-thieu` (about), feature `coupon-claim`, feature `onboarding`. Hub `/tai-khoan` hoàn chỉnh; mục trỏ route còn pending tự ẩn.

File ngoài lane đã sửa (cần integrator xác nhận khi gộp):
- `packages/app-core/src/api/config.ts`: `fetchFaqs` đọc thẳng mảng (API `/faqs` trả mảng; bản cũ ném `rows.map is not a function`).
- `packages/app-core/src/api/account.ts`: `MeProfile` thêm `phone?` (chỉ kiểu).
- `apps/web/src/lib/zalo-mini-app.ts`: thêm `miniAppPathLink` (/points/scan không có trang web để tra ngược).
- `apps/web/src/components/mini-app-only-notice.tsx`: thêm prop `miniappPath`; không truyền thì hành vi cũ.
- `apps/web/src/lib/auth-context.tsx`: `updateProfile` nhận thêm `avatarUrl`.
- `apps/web/src/lib/route-map.spec.ts`: assert dùng `/gioi-thieu` làm ví dụ pending đã đổi sang kiểm theo dữ liệu route map.

## 2. Kiểm chứng (summary.txt của gate cuối)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  34 passed (34)       Tests  429 passed (429)
web-typecheck rc=0
web-lint rc=0 ✔ No ESLint warnings or errors
web-test rc=0  Test Files  225 passed (225)       Tests  3499 passed (3499)
web-test-utc rc=0  Test Files  225 passed (225)       Tests  3499 passed (3499)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  282 passed (282)       Tests  4214 passed (4214)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 xanh (34 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0
DONE
```

## 3. Review

Vòng 1 (3 MAJOR, 4 MINOR): đã sửa cả bảy, vòng 2 xác nhận.
- MAJOR: sheet đăng nhập của CouponClaimGate không đóng khi bấm link, che trang /dang-nhap. Đã sửa: link đóng sheet, sheet ẩn ở /dang-nhap.
- MAJOR: hồ sơ gửi lại `dob` mỗi lần lưu, API chỉ cho đặt một lần nên 400. Đã sửa: chỉ gửi khi `me.dob` null, ô ngày sinh chỉ đọc khi đã có.
- MAJOR: REORDER_REMINDER chỉ dẫn sang trang sản phẩm, không mở ReorderSheet. Không sửa vì ReorderSheet thuộc lane order, chưa gộp; đã ghi vào PROGRESS.md.
- MINOR: Cài đặt ép cỡ chữ 16px khi khách chưa chọn: đã sửa (chỉ áp khi có giá trị đã lưu). Mở trên Zalo của /points/scan về trang chủ: đã sửa bằng `miniAppPathLink`. FAQ /gioi-thieu không có trong HTML ISR: đã sửa (server nạp). `?claim=` còn trong hash: đã sửa.

Vòng 2 (4 MINOR): đã sửa cả bốn.
- dob lỗi thời khi cache `/me` cũ: ff83fd19 (setQueryData khi thành công, invalidate cả khi lỗi).
- `aria-labelledby` nhóm menu có dấu cách: e31fc628 (id theo chỉ số).
- File core đã sửa chưa ghi lại: 8f047d91 (mục file ngoài lane ở trên).
- Khối liên hệ /gioi-thieu chỉ ở client: 79fe3b80 (server nạp vào HTML ISR).

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Chưa chạy Playwright: các ca trong `apps/e2e/tests/account.web.spec.ts` (hub/hồ sơ, cài đặt, thông báo, giới thiệu, xoá tài khoản, nhận mã, onboarding) chỉ mới viết. Vòng đăng nhập Zalo OAuth thật cũng chưa kiểm.
- Đường tải ảnh Cloudinary chỉ có test đơn vị.
- REORDER_REMINDER: nút "Mua lại ngay" chỉ điều hướng, chờ ReorderSheet của lane order (nối tại `notification-view.ts`, kind `reorder`).
- Không chép: sự kiện analytics `notification_opened`, dòng phiên bản, hoạt ảnh/popstate của overlay chi tiết, `settings-legacy-sync`.
- Hàng "Theo dõi Zalo OA" luôn hiện "Theo dõi" (web không đọc được trạng thái theo dõi).
- Nút hành động thông báo và mục menu trỏ route lane khác sẽ ẩn cho tới khi route bỏ pending.
- Tiêu đề/noindex spec: `/gioi-thieu` là trang công khai nên không đưa vào page-titles, guest-auth-gate, session-unavailable.
- Mini App có cùng lỗi gửi lại `dob` (edit-profile.tsx); không sửa theo luật lane.
- Mục Mã giảm giá ở hub dẫn tới `/tai-khoan/diem-xanh`; lane loyalty cần đảm bảo trang đó có phần mã giảm giá.
- Thông báo spec in một dòng stderr jsdom "Not implemented: navigation", test vẫn xanh.

## 5. Câu hỏi cho chủ dự án

1. Sàn test Mini App là 4214 hay 4243? Gate cho 4214; commit 35ef41ee ghi sàn 4214 sau khi nhánh đổi rác gỡ Refill. Mặc định: coi 4214 là đúng, lane không đụng file Mini App.
2. Sau khi lưu hồ sơ web ở lại trang và báo "Đã cập nhật hồ sơ" thay vì quay lại như Mini App? Mặc định: ở lại.
3. Sau khi lane order gộp, thông báo nhắc mua lại mở ReorderSheet hay giữ điều hướng? Mặc định: giữ điều hướng.
4. Tin OPS_* và tin chỉ gửi admin có lọc hẳn khỏi danh sách thông báo web không? Mặc định: giống Mini App (còn trong danh sách, không có nút).
5. Phím Esc trong quiz onboarding coi là "Để sau"? Mặc định: có.
6. Đăng nhập để nhận mã: web quay lại đúng trang, bỏ `?claim=`, giữ mã trong localStorage, chỉ tự gọi POST /coupons/claim một lần mỗi mã. Mặc định: như vậy.
7. Có sửa lỗi gửi lại `dob` của Mini App (edit-profile.tsx) ở lane khác không? Mặc định: không đụng.
8. Cho phép sửa `lib/zalo-mini-app.ts` (core-shell) để `miniAppLink('/points/scan')` tra ngược được thay vì dùng `miniAppPathLink`? Mặc định: giữ `miniAppPathLink`.
9. Ảnh đã cắt đổi sang Blob bằng atob (không fetch data:) vì CSP connect-src web không mở data:. Mặc định: giữ atob, không nới CSP.
