# Lane mv-uat6: lô 6 UAT web khách (làn U6)

| Mã UAT | File web | Sửa gì | Test | Còn gì chưa kiểm chứng |
|---|---|---|---|---|
| U6-B01 | `app/san-pham/[slug]/page.tsx`, `pdp-extras.tsx` | Lưới `grid-cols-1 md:grid-cols-2` (cột `minmax(0,1fr)`), cột thông tin `min-w-0`, thẻ mã `max-md:min-w-0 max-md:shrink`. Không dùng `overflow-x:hidden`. | `page.spec.tsx`, `pdp-extras.spec.tsx` kiểm lớp (jsdom không đo layout) | scrollWidth == 390 thật ở 3 vai cần Playwright (orchestrator chạy). Khối khác (hàng giá, biến thể, chip chứng nhận) đã có `flex-wrap`/`min-w-0`, không đổi. |
| U6-B03 | `lib/friendly-error.ts` (mới), 9 file `components/recycle/*` | Một hàm chung `friendlyError`/`isAuthError`: 401 và chữ thô Unauthorized/Forbidden (hoặc 403 rỗng) đổi sang tiếng Việt; 403 kèm câu nghiệp vụ tiếng Việt giữ nguyên như Mini App; thể lệ: khách (guest) gặp 401 thì thấy LoginRequired, không còn Thử lại khi lỗi phiên/quyền. Thay 9 bản `errText` trùng lặp. | `friendly-error.spec.ts`, `recycle-rules-view.spec.tsx` | Phần API `@Public()` cho `/waste/rules` do phiên UAT làm. `recycle-desk.tsx` giữ `errText` riêng (đã xử lý 403 bằng câu của nó). |
| U6-B04 | `components/recycle/recycle-requests.tsx` | Chờ `/waste/me`; `eligibility !== 'OK'` thì `MiniAppOnlyNotice`, không gọi `/waste/requests`. `/waste/me` lỗi thì vẫn cho tải danh sách như trước. Lỗi 401/403 không có Thử lại. | `recycle-requests.spec.tsx` (GUEST, NEED_PHONE, 403); sửa ca "lỗi tải" để lỗi nằm ở `/waste/requests` vì thứ tự gọi đổi | Danh sách nay đợi `/waste/me` xong mới tải (thêm một vòng request cho khách đủ điều kiện). |
| U6-B09 | `app/hoc-vien/course-list.tsx`, `app/hoc-vien/[courseId]/course-detail.tsx` | 403 (cả danh sách và chi tiết, `CtvOnlyNotice`): khối "CTV Academy dành cho cộng tác viên" + nút `/ctv`, không Thử lại. Lỗi khác dùng `friendlyError`. Mini App hiện lỗi API thô; web chủ ý khác theo yêu cầu lane. | `course-list.spec.tsx`, `course-detail.spec.tsx` (ca 403) | |
| U6-B05 | `app/tai-khoan/page.tsx` | Mini App cũng gọi `/brand/owner/me` rồi nuốt 404, và `/me` chưa có cờ chủ nhãn; web đã nuốt 404 với `retry:false`. Thêm `staleTime` 5 phút để quay lại hub không lặp request 404. Dòng "Failed to load resource 404" ở console là của trình duyệt, chỉ hết hẳn khi API thêm cờ `ownsBrand` vào `/me` (câu hỏi cho API). | `hub.spec.tsx` (gọi một lần qua hai lần mở hub); ca 404 và chủ nhãn sẵn có | |
| U6-B10 | `app/brand/[slug]/page.tsx`, `lib/api.ts` | `revalidate` 300 thành 60 cho cả trang và lần đọc `getBrand`; giữ server render. Chọn hạ hạn thay vì kiểm lại ở client: client chỉ sửa được người đã tải JS, bot và người mới vẫn thấy bản cache; trễ tối đa 60 giây. Cần ẩn tức thì thì admin phải gọi `revalidatePath` (quyết định của chủ). | `api-ssr.spec.ts`, `brand/[slug]/page.spec.tsx` | |
| Test thiếu | `app/thanh-toan/checkout-balances.spec.tsx` (mới) | Khoá đặt đơn thành công làm mới `me`, `wallet`, `wallet-txn`, `points-txn`; đơn lỗi thì không. Không đổi code thanh toán. | Kiểm đỏ: tạm comment `invalidateBalances(qc)` thì ca đầu ĐỎ, trả lại thì xanh. | |

## Kiểm chứng (gate cuối, tất cả rc=0)
```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files 42 passed (42)  Tests 496 passed (496)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files 400 passed (400)  Tests 6719 passed (6719)
web-test-utc rc=0  Test Files 400 passed (400)  Tests 6719 passed (6719)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files 283 passed (283)  Tests 4313 passed (4313)
lint-vars rc=0 OK
lint-parity rc=0 xanh (0 mục pending)
web-build rc=0 Compiled successfully
miniapp-build rc=0
DONE
```
Chưa kiểm chứng: layout thật 390px (U6-B01), cần Playwright do orchestrator chạy.

## Review
| Lượt | Mức | Phát hiện | Xử lý |
|---|---|---|---|
| 1 | MAJOR | `friendlyError` đổi mọi 403 thành câu chung, nuốt câu nghiệp vụ (SHIP_LOCKED, BLOCKED, PROGRAMME_OFF, NEED_PHONE, PERK_OWNER_ONLY) | Đã sửa `9ec20d67`: chỉ chữ Forbidden thô hoặc 403 rỗng mới đổi; thêm test SHIP_LOCKED và ca tạo yêu cầu 403 |
| 1 | MINOR | `course-detail` còn 403 kèm Thử lại | Đã sửa `d77e7709` (CtvOnlyNotice dùng chung, spec ca 403) |
| 1 | MINOR | Thể lệ: khách guest gặp 401 thấy "phiên hết hạn" không lối đi | Đã sửa `2c12a697`, spec `679d8108` (LoginRequired với returnTo) |
| 1 | MINOR | Commit B09 đứng trước commit tạo `friendly-error.ts` | Đã sửa bằng rebase đổi thứ tự (nay `friendly-error.ts` đứng trước B09) |
| 2 | MINOR | Báo cáo lane lỗi thời sau lượt sửa | Đã sửa `723969b1`, `d7426f14` |

## Chưa làm, cố ý để lại, chưa kiểm chứng
- Không làm U6-B06, U6-B08 (chờ chủ quyết), U6-B02, U6-B07 (việc API).
- U6-B05: dòng console "Failed to load resource 404" chỉ hết khi API thêm cờ `ownsBrand` vào `/me`.
- U6-B10: trễ tối đa 60 giây; ẩn tức thì cần admin gọi `revalidatePath`.
- U6-B03: `recycle-desk.tsx` giữ `errText` riêng; `@Public()` cho `/waste/rules` do phiên UAT.
- U6-B04: danh sách yêu cầu nay đợi `/waste/me` (thêm một vòng request).
- Chưa kiểm chứng: layout 390px (B01), Playwright chưa chạy theo luật lane.
- `packages/shared-types/dist` build cục bộ, bị gitignore, không commit.

## Câu hỏi cho chủ dự án
1. Nhãn bị gỡ có cần ẩn tức thì không? Mặc định: không, chấp nhận trễ 60 giây, không gọi `revalidatePath`.
2. API có thêm cờ `ownsBrand` vào `/me` để hết request 404 không? Mặc định: không, web nuốt 404 và cache 5 phút.
3. Học viện: web giải thích "dành cho CTV" khác Mini App (in lỗi thô); giữ khác hay đồng bộ? Mặc định: giữ khác.
