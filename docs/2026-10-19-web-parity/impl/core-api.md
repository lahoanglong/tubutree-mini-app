# Lane core-api (đợt 0b)

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Miền mua sắm (catalog, giỏ, checkout kèm Idempotency-Key, đơn, đánh giá, flash sale, home, groupbuy, brand, gói, thanh toán, geo, nhận mã) | 8b6c146f | `packages/app-core/src/api/*.ts`, `src/queries/*.ts`, `queries/queries.spec.ts` |
| Wishlist làm module mẫu, `wishlist-api.ts` của Mini App gọi app-core qua `coreHttp` | d30546e4 | `api/wishlist.ts`, `queries/wishlist.ts`, `apps/miniapp/src/services/wishlist-api.ts` |
| Miền tài khoản, điểm, ví, đổi rác, hoàn vỏ, cashback, AI | d980f38b | `api/{account,loyalty,wallet,external-points,cashback,refill,waste,ai}.ts`, `queries/` tương ứng |
| Miền cộng đồng, học viện, CTV, gian hàng, game | a0e71a0b | `api/{feed,academy,affiliate,storefront,game}.ts`, `queries/queries-community.spec.ts` |
| Miền nội bộ (đại lý, nhân viên, ca, chấm công, lương, chủ nhãn) | 8ca5f750 | `api/{dealer,staff,shifts,attendance,payroll,brand-owner}.ts`, `api/internal.spec.ts` |
| Review 1: `ordersListQuery` nhận `pageParam` | 18026ca0 | `queries/orders.ts` |
| Review 1: `browseQuery`, `wasteByOrderQuery` | b3dd1ba3 | `queries/catalog.ts`, `queries/waste.ts` |
| Review 1: `externalClaimRejectCode`, tập khoá invalidate đổi rác | a7957cf0 | `api/external-points.ts`, `api/waste.ts` |
| Review 1: xoá `api/aste.ts` rỗng | 33a54538 | |
| Review 2: `myRedemptionsQuery`, `fetchFaqs`/`fetchSupportContact` kèm `faqsQuery`/`supportContactQuery`, gõ đúng `notifications`/`newCustomerOffer` | 09dae9bc | `queries/loyalty.ts`, `api/config.ts`, `api/home.ts` |
| Sửa kiểu phản hồi `/faqs` (có lớp `data`) để tsc qua | b0908c75 | `api/config.ts` |

Route web đã bỏ pending: không có. Lane này chỉ nộp lớp API và queryKey dùng chung trong app-core, chưa có giao diện web; các lane trang sẽ dùng.
Test thêm: app-core 48 -> 419; Mini App giữ 4259 (không sửa test nào).

## 2. Kiểm chứng (gate cuối, xanh)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  34 passed (34)  Tests  419 passed (419)
web-typecheck rc=0
web-lint rc=0 No ESLint warnings or errors
web-test rc=0  Test Files  195 passed (195)  Tests  3044 passed (3044)
web-test-utc rc=0  Test Files  195 passed (195)  Tests  3044 passed (3044)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  282 passed (282)  Tests  4259 passed (4259)
lint-vars rc=0 OK
lint-parity skip (chưa có)
web-build rc=0 Compiled successfully
miniapp-build rc=0
DONE
```

## 3. Review

Lượt 1 (Opus):
- MAJOR `ordersListQuery` bỏ qua pageParam, "Xem thêm" tải lại trang 1: đã sửa ở 18026ca0 (spec trang 3 kèm bộ lọc).
- MINOR thiếu factory `browseQuery`, `wasteByOrderQuery`: đã sửa ở b3dd1ba3.
- MINOR thiếu `externalClaimRejectCode` và tập khoá invalidate: đã sửa ở a7957cf0.
- MINOR `api/aste.ts` rỗng: đã xoá ở 33a54538.
Lượt 2 (Opus): không BLOCKER/MAJOR; đã đối chiếu 260 lời gọi API Mini App với app-core, mọi hàm có Idempotency-Key khớp từng ký tự.
- MINOR thiếu factory `getMyRedemptions`: đã sửa ở 09dae9bc.
- MINOR thiếu `/faqs` và liên hệ hỗ trợ: đã sửa ở 09dae9bc, kiểu `/faqs` chỉnh ở b0908c75.
- MINOR `HomeMeDTO` gõ `unknown`: đã sửa ở 09dae9bc.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Cố ý không chép: cơ chế gộp request Trang chủ (`takePublicBlock`/`takeMeBlock`), `cartStorefrontSlug()` (giỏ nhận `storefrontSlug` qua tham số), phần chặn báo lặp của `reportLaunchLinkClick` (đổi thành `reportLinkClick`, chặn lặp ở nơi gọi), `acquireLocationPayload`, `rewardClaimView`, `vnLastDayLabel`, các hàm hiển thị thuần của điểm/hạng, `invalidateAfter*` cần QueryClient.
- Chưa chuyển Mini App sang gọi app-core (trừ wishlist); `getNewCustomerOffer`/`getNotifications` của app-core là GET thẳng, không qua khối gộp `/home/me`.
- Đường dẫn nối chuỗi (`/feed/${id}`, `/game/quiz/${id}/answer`...) giữ nguyên không encode như Mini App. `getFeed` truyền khoá undefined trong query; adapter web cần bỏ khoá undefined (chưa kiểm).
- Việc 2, 3, 4, 5: spec viết sau hoặc cùng lúc với code, không có lần chạy đỏ trước (sai TDD). Spec dealer/attendance tự viết bảng từ mã nguồn vì Mini App không có bảng để chép.
- Playwright không chạy (đúng luật lane). Không push, không deploy.
- Một lần gate run3 bị dừng vì tsc lỗi, thư mục đổi tên `run3-aborted`.

## 5. Câu hỏi cho chủ dự án

1. Các hàm hiển thị thuần còn ở Mini App (pointsReasonLabel, rewardCardState, checkInView, tierProgressPercent, rewardClaimView...): chuyển sang app-core ở lane nào? Mặc định: để từng lane trang tự chép, không chuyển trong lane này.
2. Chuyển các service Mini App còn lại sang gọi app-core qua `coreHttp` khi nào? Mặc định: không làm, chỉ wishlist.
3. Có encode path param (`/feed/${id}`...) ở app-core không? Mặc định: giữ y Mini App, không encode.
