# Đợt 1028i: luật riêng cho worker (02/11 trưa)

Đọc `docs/2026-10-28-review/tools/gd3-worker-brief.md` trước (ở worktree `review-1028`): mọi luật chung ở đó vẫn áp dụng. File này chỉ ghi chỗ khác.

## Gốc và nhánh
- Gốc: `origin/main` a3842b551 (PROD đang chạy cây mã giống hệt). Mỗi gói một worktree `.claude/worktrees/r1028i-<gói>`, nhánh `review/1028i-<gói>`, đã `pnpm install`, `prisma generate`, build `@tubutree/shared-types`.
- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.
- Đổi màn ở `apps/miniapp` hoặc `apps/web`: gọi skill `tubu-ui` trước khi sửa giao diện.
- Phiên shop (48) sắp merge PR #120 vào main. PR đó chạm `apps/web/src/app/tai-khoan/yeu-thich/*`, `apps/miniapp/src/components/ui/bottom-sheet.tsx`, `apps/web/src/components/mini/bottom-sheet.tsx` và spec cùng tên. KHÔNG đụng các file này. Phần shop/PDP/giỏ/thanh toán/gian hàng cũng không đụng.
- Không đổi luật điểm, giá, phí, thể lệ, chữ pháp lý.
- Commit kết thúc bằng dòng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Không push, không mở PR, không merge: phiên điều phối (9b) làm.
- Không `git stash` trần, không `--no-verify`, không giết tiến trình không do mình tạo.

## Ảnh trước/sau
- Ảnh TRƯỚC chụp ở chính worktree của gói TRƯỚC commit đầu tiên, lưu vào `<thư mục ảnh>/before`. Ảnh SAU chụp lại rồi so bằng `tools/before-after.mjs`.
- Thư mục ảnh: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-1028i-<gói>/`.

## Lane và cổng
| Gói | Lane (API / web / Mini App) | Khối cổng e2e | Race Postgres |
|---|---|---|---|
| mautin | 1 (3211 / 3212 / 3213) | 3940–3949 (e2e API 3941, web 3942, Mini App 3943, gate PG 3944, gate Redis 3945) | 46040 |
| thanhday | 2 (3221 / 3222 / 3223) | 3950–3959 (3951, 3952, 3953, 3954, 3955) | 46050 |
| tomtat | 3 (3231 / 3232 / 3233) | 3960–3969 (3961, 3962, 3963, 3964, 3965) | 46060 |

- Postgres 25432 và Redis 26379 dùng chung đã bật. Không dừng chúng.
- DB lane copy từ mẫu rồi `npx prisma migrate deploy`.
- Gate cuối: `docs/2026-10-28-review/tools/gate.sh <worktree> --base a3842b551 --out <file>`. Gói đổi API thì chạy cả jest (bỏ `--no-jest`).

## Gói mautin (R-112): bỏ emoji trong mẫu tin cộng đồng
- Chủ đã duyệt (02/11): bỏ emoji trong thân mẫu tin `COMMUNITY_*`, có migration sửa mẫu tin trên PROD.
- Nguồn: `apps/api/prisma/seed.ts` khoảng dòng 843 và 864–874 (`COMMUNITY_EVENT_WINNER`, `COMMUNITY_NEW_ANSWER`, `COMMUNITY_EXPERT_REPLIED`, `COMMUNITY_BEST_ANSWER`, `COMMUNITY_POST_APPROVED`, `COMMUNITY_POST_REJECTED`, `COMMUNITY_POST_LIKED`, `COMMUNITY_POST_COMMENTED`, `COMMUNITY_POST_HIDDEN`), migration gốc `20261018100100_lr_community_templates_config`. Rà toàn bộ mẫu `COMMUNITY_*` (kể cả trong migration cũ, có thể có mẫu không nằm trong seed).
- Chỉ bỏ emoji và khoảng trắng thừa đi kèm. Không đổi chữ nào khác. Ví dụ: `'🌱 Bài viết của bạn đã được duyệt…'` thành `'Bài viết của bạn đã được duyệt…'`; `'…hay nhất! 🌿{{reward_note}}'` thành `'…hay nhất!{{reward_note}}'`, nhưng kiểm `reward_note` có tự mở đầu bằng khoảng trắng không để câu không dính chữ.
- Migration mới `apps/api/prisma/migrations/20261102120000_community_templates_no_emoji/migration.sql`:
  - `UPDATE` từng mẫu theo `code`, CHỈ khi thân (và tiêu đề nếu có) còn đúng bản mặc định cũ. Admin đã sửa tay thì giữ nguyên.
  - Idempotent: chạy lại không đổi gì.
  - Không đổi `schema.prisma`.
- `seed-reference.ts` dùng `createMany skipDuplicates`, nên không ghi đè PROD. Vẫn sửa `seed.ts` để DB mới có bản không emoji.
- Rà nơi khác dựng chữ cộng đồng có emoji ngoài mẫu tin (service cộng đồng, `packages/app-core`, ZNS). Chỉ báo lại nếu thấy, không sửa ngoài phạm vi mẫu tin `COMMUNITY_*`.
- Test:
  - jest cho migration: áp lên DB có mẫu cũ thì đổi; có mẫu admin đã sửa thì giữ.
  - Spec đang kiểm chuỗi emoji thì cập nhật.
  - Chạy `prisma migrate deploy` trên DB lane từ trạng thái main.

## Gói thanhday (R-94): canh nhãn tab giữa thanh đáy
- Nhãn "Vườn Xanh" ở tab giữa thấp hơn các nhãn khác khoảng 2,5 px. Cỡ chữ đã khớp (Mini 13 px, web cùng token).
- File: `apps/miniapp/src/components/bottom-nav.tsx`, `apps/web/src/components/bottom-nav.tsx`, có thể `nav-config.ts` và CSS liên quan.
- Đo trước: ở 375×812, `getBoundingClientRect().bottom` của từng nhãn tab trên Mini và web, khách đã đăng nhập ở Trang chủ. Ghi số trước và sau vào báo cáo.
- Sửa để mọi nhãn cùng đường chân chữ, lệch tối đa 0,5 px. Giữ nguyên:
  - chiều cao thanh, safe-area;
  - cỡ và vị trí icon tab giữa (nút nổi nếu có);
  - badge đơn đang xử lý và chấm đỏ Ưu đãi.
- Phiên khác (gói tomtat) có thể sửa phần dữ liệu badge của cùng file. Chỉ sửa phần class/markup của nhãn, không đổi hook hay query.
- Test: thêm ca Playwright đo đường chân chữ cho Mini và web (đặt cạnh spec thanh đáy có sẵn trong `apps/e2e`, nếu có). Vitest bottom-nav vẫn xanh.
- Ảnh 375 trước/sau Mini và web: Trang chủ, và một tab có badge.

## Gói tomtat (R-114): `GET /me/summary`
- Chủ đã duyệt (02/11): thêm `GET /me/summary` dùng chung cho trang Cá nhân và thanh đáy, ở cả Mini và web.
- Hiện trạng: mở Cá nhân, Mini gọi khoảng 10 lời gọi API, phần lớn có điều kiện. Đã bỏ `/orders/status-counts` và `/notifications/unread-count`. Thanh đáy gọi `/orders/active-count` và dữ liệu chấm Ưu đãi.
- Bước 1, kiểm kê (ghi vào báo cáo trước khi sửa): liệt kê mọi lời gọi khi mở Cá nhân (Mini `apps/miniapp/src/pages/profile*.tsx`, web `apps/web/src/app/tai-khoan/page.tsx` hoặc tương đương) và thanh đáy. Ghi cho mỗi lời gọi: lấy gì, chỉ để đếm/hiện số hay cần dữ liệu đầy đủ, mutation nào đang làm mới nó. Đo số lời gọi hiện tại bằng Playwright (Mini 375 và web 375, khách cũ).
- Bước 2, thiết kế: `/me/summary` trả các số mà Cá nhân và thanh đáy chỉ dùng để đếm hoặc hiện nhanh, ví dụ đơn theo trạng thái, đơn đang xử lý, tin chưa đọc, số mã giảm giá/sắp hết hạn, số dư Ví nếu chỉ hiện số. Chọn đúng theo kiểm kê, không thêm số không ai dùng. Lời gọi cần dữ liệu đầy đủ thì giữ.
  - Một module API, có guard đăng nhập như `/me` hiện có, chỉ trả dữ liệu của chính khách.
  - Mỗi phần đọc song song, có giới hạn. Một phần lỗi thì cả lời gọi lỗi, không trả số giả 0.
  - Kiểu trả về đặt ở `packages/shared-types` hoặc `packages/app-core`, hai app dùng chung.
  - Cập nhật `staff-permissions.matrix.spec.ts` hoặc bảng route nếu spec đòi.
  - GIỮ mọi endpoint cũ (`/orders/active-count`, …): bản Mini đang Live và Testing V28 vẫn gọi chúng.
- Bước 3, dùng ở hai app:
  - Một query key `['me', 'summary']` (hoặc đặt dưới tiền tố đang được làm mới, nếu hợp hơn).
  - Mọi mutation đang làm mới các query bị thay (đặt đơn, huỷ đơn, đọc tin, nhận mã, chuyển Ví, …) phải làm mới summary. Liệt kê đủ trong báo cáo, có test cho ít nhất: đặt/huỷ đơn làm badge thanh đáy đổi, đọc tin làm số chưa đọc giảm.
  - Badge thanh đáy và số trên Cá nhân phải luôn khớp nhau (cùng nguồn).
  - Khách chưa đăng nhập: không gọi.
- Gói thanhday sửa phần nhãn của `bottom-nav.tsx`. Chỉ đổi phần lấy dữ liệu badge, không đổi markup nhãn.
- Không thêm migration. Cần index mới thì dừng, báo lại.
- Test:
  - jest API: guard, chỉ dữ liệu của mình, đúng số theo trạng thái.
  - vitest hai app: số từ summary hiện đúng; khi summary lỗi thì không hiện số sai.
  - Playwright đo lại số lời gọi khi mở Cá nhân (Mini và web 375). Ghi trước và sau.
- Ảnh 375 trước/sau Mini và web: Cá nhân (khách cũ, có đơn đang xử lý, có tin chưa đọc), thanh đáy có badge.

## Báo cáo khi xong
Ghi vào `docs/2026-10-28-review/reports/1028i-<gói>.md` (worktree `review-1028`, không commit):
- commit đã làm;
- số đo trước/sau;
- test đã chạy và kết quả, có số dòng pass/fail;
- kết quả gate;
- việc còn lại hoặc rủi ro.
