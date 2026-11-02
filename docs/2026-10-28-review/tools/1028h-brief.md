# Đợt 1028h: luật riêng cho worker (02/11 sáng)

Đọc `docs/2026-10-28-review/tools/gd3-worker-brief.md` trước (ở worktree `review-1028`): mọi luật chung ở đó vẫn áp dụng. File này chỉ ghi chỗ khác.

## Gốc và nhánh
- Gốc: `origin/main` 4364ec325 (có shop redesign #109, #113, #114). Mỗi gói một worktree `.claude/worktrees/r1028h-<gói>`, nhánh `review/1028h-<gói>`, đã `pnpm install`, `prisma generate`, build `@tubutree/shared-types`.
- Rà ngày 02/11 cho thấy R-157, R-159, R-162, R-167, R-169, R-173–R-176 đã xong ở main. Không làm lại.
- Đổi màn ở `apps/miniapp` hoặc `apps/web`: gọi skill `tubu-ui` trước khi sửa giao diện.
- Phiên khác đang sửa, KHÔNG đụng:
  - PR #115 (`apps/miniapp`): `components/ui/auth-gate.tsx`, `hooks/use-login-notice.ts`, `components/wishlist-heart.tsx`, `components/game/game-states.tsx`, `pages/product-detail.tsx`, `pages/flash-sale.tsx`, `pages/feed.tsx`, `pages/game.tsx` và spec cùng tên.
  - Phiên shop: phần shop/PDP/giỏ/thanh toán/gian hàng ở hai app, `packages/app-core` nhóm commerce và merch, spec e2e shop. Phiên shop đã nhường `apps/web/src/components/ui/sheet.tsx`, hai file `flash-sale.tsx` ở Trang chủ và `packages/app-core/src/home-layout.ts` cho đợt này.
- Không có migration. Gói nào thấy cần đổi `schema.prisma` thì dừng, báo lại.

## Ảnh trước/sau
- Ảnh TRƯỚC chụp ở chính worktree của gói TRƯỚC commit đầu tiên (main đã khác bộ ảnh 28/10), lưu vào `<thư mục ảnh của gói>/before`. Ảnh SAU chụp lại rồi so bằng `before-after.mjs`.
- Thư mục ảnh: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-1028h-<gói>/`.

## Lane và cổng
| Gói | Lane (API / web / Mini App) | Khối cổng e2e | Race Postgres |
|---|---|---|---|
| khach | 1 (3211 / 3212 / 3213) | 3940–3949 (e2e API 3941, web 3942, Mini App 3943, gate PG 3944, gate Redis 3945) | 46040 |
| quantri | 2 (3221 / 3222 / 3223) | 3950–3959 (3951, 3952, 3953, 3954, 3955) | 46050 |
| giovang | 3 (3231 / 3232 / 3233) | 3960–3969 (3961, 3962, 3963, 3964, 3965) | 46060 |

- Postgres 25432 và Redis 26379 dùng chung đã bật. Không dừng chúng.
- DB lane copy từ mẫu rồi `npx prisma migrate deploy` (main có migration mới tới `bundle_item_ref_price`).

## Gói khach (R-185, R-190, R-193)
- **R-185** (`apps/miniapp/src/pages/affiliate.tsx` khoảng dòng 467 và 1001, `apps/web/src/app/ctv/page.tsx` khoảng dòng 421 và 428). Nút "Chuyển vào Ví" đang khoá theo `transferredStamp === dashQ.dataUpdatedAt`. Còn hai khe:
  1. Một lần tải lại bắt đầu trước khi chuyển xong nhưng trả về sau đó: `dataUpdatedAt` đổi, nút mở lại trong khi số dư còn cũ.
  2. Rời trang rồi quay lại: mốc bị xoá.
  - Sửa: ghi thời điểm chuyển xong; chỉ mở nút khi `dataUpdatedAt` lớn hơn mốc đó, hoặc khi có lỗi mới hơn mốc. Logic chung đặt ở `packages/app-core`, hai app dùng chung.
  - Test trước: ca tải lại bắt đầu trước khi chuyển xong, ca tải lại lỗi.
  - Không đổi API, không đổi luật tiền. Máy chủ vẫn từ chối lần chuyển thừa.
- **R-190** (`packages/app-core/src/dob-input.ts`, `apps/miniapp/src/pages/edit-profile.tsx`, `apps/web/src/app/tai-khoan/ho-so/page.tsx`). Khách dán hoặc trình duyệt tự điền ngày kiểu Mỹ "03/05/1990" thì ô đọc thành 3 tháng 5. Ngày sinh chỉ đặt được một lần.
  - Sửa: hộp xác nhận ngày sinh (`profileCopy.dobConfirm` hoặc nơi đang dựng câu đó) ghi tháng bằng chữ, ví dụ "5 tháng 3 năm 1990", để khách thấy ngay nếu ngày bị đảo. Hai nền cùng một câu, lấy từ app-core.
  - Không tự đảo ngày và tháng theo đoán locale: khách Việt dán dd/mm sẽ bị đảo sai.
  - Test: hàm định dạng câu xác nhận, và ca "03/05/1990" hiện "3 tháng 5 năm 1990".
- **R-193** (`apps/web/src/components/ui/sheet.tsx`): thanh kéo trên đầu sheet web ở khổ điện thoại, giống thanh kéo của sheet Mini (zmp-ui). Khổ máy tính giữ nguyên.
  - Không làm phần "liên kết Gửi đơn sàn": web chưa có trang gửi đơn sàn.
  - Chụp so ít nhất 3 sheet web 375 với Mini, ví dụ popup "Cách tính Điểm Xanh" ở trang sản phẩm, sheet chọn phân loại, tấm mã giảm giá ở thanh toán.

## Gói quantri (R-189)
- `apps/web/src/app/admin/page.tsx` (OrdersTab), `apps/web/src/components/admin/community-moderation-tab.tsx`, `packages/app-core/src/community-moderation-views.ts`.
- Đã có ở main: nút "Lọc (n)", ngăn kéo lọc, mỗi đơn một thẻ ở khổ hẹp (`page.tsx` khoảng dòng 1693–1696, 1768, 1923).
- Còn lại:
  1. Ở 375, trên danh sách đơn đang có ba nhóm chip: nhóm hàng đợi, tablist Gomdon (khoảng dòng 1526), chip trạng thái có số (khoảng dòng 1660). Gộp để ở 375 chỉ còn MỘT hàng chip nhìn thấy trên danh sách: chip trạng thái có số. Nhóm còn lại vào ngăn kéo "Lọc (n)", và số (n) đếm cả chúng khi đang bật.
     - Không bỏ bộ lọc nào.
     - Khổ máy tính (md trở lên) giữ nguyên.
     - Nếu tablist Gomdon là chuyển màn chứ không phải bộ lọc, giữ nó ngoài ngăn kéo và ghi lý do.
  2. Nhãn tab kiểm duyệt web "Báo cáo vi phạm (n)" khác Mini "Báo cáo n". Web theo Mini, lấy nhãn từ `community-moderation-views.ts`.
- Test: vitest cho số (n) và cho việc chip nằm trong ngăn kéo ở khổ hẹp. Web gate cho spec admin đơn nếu có.
- Ảnh: admin375 tab đơn (mặc định và khi mở ngăn kéo), tab kiểm duyệt, cả trước và sau. Thêm admin1280 tab đơn để chứng minh khổ máy tính không đổi.

## Gói giovang (R-164, R-165)
- **R-164** (`apps/web/src/components/home/flash-sale.tsx`, `apps/miniapp/src/components/flash-sale.tsx`, `packages/app-core/src/home-layout.ts`; có thể `apps/web/src/app/page.tsx`, `apps/web/src/lib/home-initial.ts`). Kệ Giờ vàng còn hai ca nhảy bố cục một lần:
  1. HTML ISR cũ (trang cache 300 s, `apps/web/src/app/page.tsx:7`) trả sau giờ hết suất. Web `flash-sale.tsx` khoảng dòng 79 coi mọi suất là đang chạy trước khi hydrate, nên kệ vẽ ra rồi biến mất.
  2. Lần đầu tải kệ rỗng thì máy nhớ "không có suất", khung chờ trả `null` (Mini `flash-sale.tsx` khoảng dòng 57, web khoảng dòng 107). Suất mới tới khi tải lại thì đẩy trang xuống.
  - Sửa ít nhất có thể, giữ CLS mở lần đầu như hiện tại. Đo trước/sau bằng `cls-probe` (tìm trong `docs/2026-10-28-review/tools/perf/` hoặc `apps/e2e`) cho cả hai ca, giả giờ bằng đồng hồ giả.
  - Không đổi API, không đổi giá hay suất. Kệ Giờ vàng vừa được shop redesign làm lại: đọc `docs/2026-10-31-shop-redesign/` phần Giờ vàng trước khi sửa, giữ đúng quyết định ở đó (cắt 8 món, Mua lại bỏ phân loại đang vẽ).
  - Nếu ca 1 chỉ sửa được bằng cách bỏ ISR hay đổi thời gian cache thì không làm, ghi lý do.
- **R-165**: chạy lại `node docs/2026-10-28-review/tools/build-routes.mjs --lane 5` KHÔNG được (lane 5 không phải của gói). Chỉ ghi vào báo cáo: `routes.json` cần dựng lại để browse-search có persona new và guest. Phiên điều phối sẽ dựng ở PR tài liệu.
