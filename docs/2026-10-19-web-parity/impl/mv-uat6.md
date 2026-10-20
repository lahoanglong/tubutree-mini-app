# Lane mv-uat6: lô 6 UAT web khách (làn U6)

| Mã UAT | File web | Sửa gì | Test | Còn gì chưa kiểm chứng |
|---|---|---|---|---|
| U6-B01 | `app/san-pham/[slug]/page.tsx`, `pdp-extras.tsx` | Lưới `grid-cols-1 md:grid-cols-2` (cột `minmax(0,1fr)`), cột thông tin `min-w-0`, thẻ mã `max-md:min-w-0 max-md:shrink`. Không dùng `overflow-x:hidden`. | `page.spec.tsx`, `pdp-extras.spec.tsx` kiểm lớp (jsdom không đo layout) | scrollWidth == 390 thật ở 3 vai cần Playwright (orchestrator chạy). Khối khác (hàng giá, biến thể, chip chứng nhận) đã có `flex-wrap`/`min-w-0`, không đổi. |
| U6-B03 | `lib/friendly-error.ts` (mới), 9 file `components/recycle/*` | Một hàm chung `friendlyError`/`isAuthError`: 401/403 và message thô Unauthorized/Forbidden thành câu tiếng Việt; thể lệ không còn Thử lại khi lỗi phiên/quyền. Thay 9 bản `errText` trùng lặp. | `friendly-error.spec.ts`, `recycle-rules-view.spec.tsx` | Phần API `@Public()` cho `/waste/rules` do phiên UAT làm. `recycle-desk.tsx` giữ `errText` riêng (đã xử lý 403 bằng câu của nó). |
| U6-B04 | `components/recycle/recycle-requests.tsx` | Chờ `/waste/me`; `eligibility !== 'OK'` thì `MiniAppOnlyNotice`, không gọi `/waste/requests`. `/waste/me` lỗi thì vẫn cho tải danh sách như trước. Lỗi 401/403 không có Thử lại. | `recycle-requests.spec.tsx` (GUEST, NEED_PHONE, 403); sửa ca "lỗi tải" để lỗi nằm ở `/waste/requests` vì thứ tự gọi đổi | Danh sách nay đợi `/waste/me` xong mới tải (thêm một vòng request cho khách đủ điều kiện). |
| U6-B09 | `app/hoc-vien/course-list.tsx` | 403: khối "CTV Academy dành cho cộng tác viên" + nút `/ctv`, không Thử lại. Lỗi khác dùng `friendlyError`. Mini App hiện lỗi API thô; web chủ ý khác theo yêu cầu lane. | `course-list.spec.tsx` | |
| U6-B05 | `app/tai-khoan/page.tsx` | Mini App cũng gọi `/brand/owner/me` rồi nuốt 404, và `/me` chưa có cờ chủ nhãn; web đã nuốt 404 với `retry:false`. Thêm `staleTime` 5 phút để quay lại hub không lặp request 404. Dòng "Failed to load resource 404" ở console là của trình duyệt, chỉ hết hẳn khi API thêm cờ `ownsBrand` vào `/me` (câu hỏi cho API). | `hub.spec.tsx` (gọi một lần qua hai lần mở hub); ca 404 và chủ nhãn sẵn có | |
| U6-B10 | `app/brand/[slug]/page.tsx`, `lib/api.ts` | `revalidate` 300 thành 60 cho cả trang và lần đọc `getBrand`; giữ server render. Chọn hạ hạn thay vì kiểm lại ở client: client chỉ sửa được người đã tải JS, bot và người mới vẫn thấy bản cache; trễ tối đa 60 giây. Cần ẩn tức thì thì admin phải gọi `revalidatePath` (quyết định của chủ). | `api-ssr.spec.ts`, `brand/[slug]/page.spec.tsx` | |
| Test thiếu | `app/thanh-toan/checkout-balances.spec.tsx` (mới) | Khoá đặt đơn thành công làm mới `me`, `wallet`, `wallet-txn`, `points-txn`; đơn lỗi thì không. Không đổi code thanh toán. | Kiểm đỏ: tạm comment `invalidateBalances(qc)` thì ca đầu ĐỎ, trả lại thì xanh. | |

## Kiểm chứng
- vitest web: 400 file, 6715 test xanh (cả `TZ=UTC` và không). vitest Mini App: 283 file, 4313 test xanh (không đổi).
- `tsc --noEmit` web sạch (sau khi build `packages/shared-types`), `next lint` 0 lỗi, `next build` thành công.
- Chưa kiểm chứng: layout thật 390px (B01), cần Playwright.
- Commit B09 đứng trước commit tạo `friendly-error.ts`, nên riêng commit B09 không tự build; cả nhánh thì đủ.
