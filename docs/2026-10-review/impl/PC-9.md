# PC-9 — Nhân sự + câu chữ

Nhánh `hz6/PC-9` (tách từ `hardening/2026-10` @ `ee97986`). Báo cáo ghi theo từng mục; các mục sau (C-074, C-083, C-115, C-120, C-119) do lượt khác append bên dưới.

---

## C-056 — Chấm công: rớt vùng GPS một nhịp không còn tự chấm ra (XONG)

Commit `7a17cae`.

**Hành vi mới** (`apps/api/src/modules/staff/attendance/attendance.service.ts`, `heartbeat`):
- Heartbeat ngoài vùng (sai IP / ngoài bán kính / chưa cấu hình) chỉ tăng bộ đếm `outOfRangeCount` (UPDATE nguyên tử `increment`) và ghi `outOfRangeSince` ở nhịp đầu của chuỗi. Phiên vẫn mở, API trả `{ open: true, outOfRange: true, reason, missed, maxMissed }`.
- Đóng phiên (`closeReason = OUT_OF_RANGE`) khi: (a) `outOfRangeCount >= N` nhịp liên tiếp, hoặc (b) chuỗi ngoài vùng kéo dài `>= M` phút (trường hợp heartbeat thưa vì app bị cất vào túi).
- Heartbeat hợp lệ reset `outOfRangeCount = 0`, `outOfRangeSince = null`.
- Giờ ra ghi lùi về nhịp ngoài vùng ĐẦU TIÊN của chuỗi (`max(outOfRangeSince, checkinAt)`) — đúng mốc mà cách cũ (đóng ngay nhịp đầu) từng ghi, nên giờ ngoài vùng không được cộng vào công.
- Đóng bằng `updateMany({ where: { id, checkoutAt: null } })`: phiên đã bị checkout tay / QL đóng song song thì không bị ghi đè giờ ra và lý do đóng; `count = 0` trả `{ open: false }`.
- Giá trị cấu hình rác (0, âm, chuỗi) rơi về mặc định (0 nghĩa là "chấm ra ngay", đúng lỗi cần tránh).

**Cấu hình** (seed `createOnly`, admin chỉnh rồi deploy lại không reset):
- `attendance.out_of_range_max_count` = 3 (N). Miniapp gửi heartbeat 3 phút/nhịp nên 3 nhịp ≈ 6–9 phút ngoài vùng.
- `attendance.out_of_range_max_min` = 15 (M).

**Migration** `20261010180000_attendance_out_of_range_counter` (additive): `attendance_sessions` thêm `outOfRangeCount INTEGER NOT NULL DEFAULT 0`, `outOfRangeSince TIMESTAMP(3) NULL`. Phiên đang mở lúc deploy coi như đang trong vùng. Không cần backfill, không đụng unique. Đã áp thử bằng `prisma migrate deploy` trên Postgres riêng; `prisma migrate diff --from-url ... --to-schema-datamodel` báo "No difference detected".

**Test (đỏ → xanh)**
- Unit `attendance.service.spec.ts`: thay test cũ "heartbeat rớt vùng → đóng OUT_OF_RANGE" bằng 10 test mới (nhịp đầu không đóng, nhịp 2 không ghi đè mốc, đủ N đóng với giờ ra = nhịp đầu, N/M đọc từ config, cấu hình rác, checkin bị sửa lệch, đóng song song `count=0`, reset khi hợp lệ). Trước khi sửa: `Tests: 10 failed, 27 passed, 37 total`. Sau khi sửa: cả thư mục `staff/attendance` `Tests: 59 passed, 59 total`.
- Race `test/integration-race/attendance-out-of-range.race-spec.ts` (Postgres thật, cổng 5579): 7 test, gồm 10 heartbeat song song (N=100) → bộ đếm đúng 10 không mất nhịp; 8 heartbeat song song (N=3) → đóng đúng một lần, giờ ra không đổi ở lần gọi sau; nhịp hợp lệ cắt chuỗi thì đếm lại; chuỗi quá M phút; phiên đã đóng bởi QL không bị ghi đè. `Tests: 7 passed, 7 total`.

**Kiểm chứng đã chạy**
```
cd apps/api && npx jest --maxWorkers=1 src/modules/staff            -> các suite staff PASS
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5579/tubutree_it?schema=public \
  npx jest -c test/integration-race/jest.config.js --runInBand attendance-out-of-range   -> Tests: 7 passed, 7 total
cd apps/api && npx tsc --noEmit -p tsconfig.json                    -> exit 0
cd apps/api && npx eslint <file đã sửa>                              -> sạch
seed chạy thật trên DB riêng: attendance.out_of_range_max_count = 3 / max_min = 15; sửa tay max_count = 7 rồi seed lại -> vẫn 7 (createOnly)
```

**Giả định**
- Giờ ra ghi lùi về nhịp ngoài vùng đầu tiên (không phải nhịp thứ N): giữ nguyên ngữ nghĩa tiền công của cách cũ, không trả công cho thời gian đã rời vùng.
- `NOT_CONFIGURED` (admin xoá cấu hình giữa ca) cũng đếm như ngoài vùng và đóng sau N nhịp, như cách cũ đóng ngay.
- Cron `AttendanceJob` vẫn chỉ đóng khi quá giờ hết ca (không cắt theo heartbeat cũ) — không đổi.

**Còn lại / không làm**
- `apps/miniapp/src/pages/staff.tsx` (ngoài nhóm file của gói) chưa hiển thị cảnh báo "bạn đang ngoài vùng, sẽ tự checkout nếu không quay lại"; FE hiện chỉ xử lý `closed`, nên phản hồi mới `open: true, outOfRange: true` chạy bình thường nhưng im lặng. Nên làm ở gói FE nhân sự.
- `attendance.heartbeat_stale_min` vẫn là khoá chưa dùng (không thuộc mục này).

---

## C-073 — Cộng đồng nói về hàng đang bán, không phải cây cảnh (XONG)

Commit `a357651` (miniapp) và `547c985` (api/seed).

**Lời (miniapp)** — `apps/miniapp/src/i18n/vi.ts` khối `community`:
- `subtitle`: "Hỏi đáp cách dùng, chia sẻ trải nghiệm, cổ vũ nhau 🌿" (trước: "Hỏi đáp chăm cây, khoe vườn…").
- `kindShowcase`: "Trải nghiệm" (trước: "Khoe vườn").
- `titlePlaceholder`: "Tiêu đề câu hỏi (vd: Nước rửa chén sinh học dùng được cho bình sữa không?)" (trước: "Lá cây lưỡi hổ bị vàng?").
- `buyThis`: "Mua sản phẩm này" (trước: "Mua cây này"); `viewSolution`: "Xem sản phẩm gợi ý".
- `tagsPlaceholder`: "vd: da nhạy cảm, đồ cho bé …" (trước: "sen đá, tưới nước").
- `apps/miniapp/src/pages/profile.tsx` (một dòng, ngoài nhóm file nhưng chính bằng chứng của C-073 nêu): mô tả lối vào Cộng đồng "Hỏi cách dùng · chia sẻ trải nghiệm" (trước: "Hỏi chăm cây · khoe vườn"). Không nhánh hz6 nào khác đang sửa file này.

**Danh mục cộng đồng (seed)** — dữ liệu tách ra `apps/api/src/modules/feed/community-categories-seed.ts` để test được; `prisma/seed.ts` chỉ gọi:
- Mới: `my-pham-ca-nhan` (Mỹ phẩm & cá nhân), `tay-rua-nha-cua` (Tẩy rửa & nhà cửa), `me-va-be` (Mẹ & bé), `ca-phe-thuc-pham` (Cà phê & thực phẩm), `review-trai-nghiem` (Review & trải nghiệm); giữ `hoi-mua-gi`, `meo-hay` cùng slug.
- Bốn danh mục cây cảnh cũ (`cham-soc`, `sau-benh`, `phoi-canh`, `khoe-vuon`) chỉ bị ẩn `isActive = false`, KHÔNG xoá, không đổi tên, không gán lại bài: `feed_posts.categoryId` là `ON DELETE SET NULL` nên xoá sẽ làm bài mồ côi; bài đã đăng vẫn hiện ở "Tất cả" với nhãn cũ.
- Seed không ghi `isActive` cho danh mục đang dùng: admin tắt tay một danh mục thì deploy sau không bật lại.

**Test (đỏ → xanh)**
- `apps/miniapp/src/i18n/community-copy.spec.ts` (mới) + một test thêm vào `pages/profile.spec.ts`: trước khi sửa `Tests 3 failed | 5 passed (8)` (5 chuỗi vi phạm); sau khi sửa với `profile-hub.spec.tsx`: `Test Files 3 passed, Tests 10 passed`.
- `apps/api/src/modules/feed/community-categories-seed.spec.ts` (mới, 6 test): trước khi có module → suite lỗi "Cannot find module"; sau: `Tests: 6 passed`. Cùng `src/modules/feed` + `src/modules/staff`: `Test Suites: 16 passed, Tests: 394 passed`.
- Seed chạy thật trên Postgres riêng (`tubu_it_pc9`) sau khi giả lập dữ liệu cũ (6 danh mục cũ + 1 bài ở `cham-soc`): kết quả 7 danh mục active, 4 danh mục cũ `isActive=f`, bài cũ vẫn `categoryId = legacy1 / cham-soc`; seed lần 2 idempotent, danh mục `meo-hay` admin tắt tay vẫn tắt. Dữ liệu giả lập đã dọn.

**Kiểm chứng đã chạy**
```
cd apps/miniapp && npx vitest run src/i18n/community-copy.spec.ts src/pages/profile.spec.ts src/pages/profile-hub.spec.tsx  -> 3 files, 10 tests passed
cd apps/miniapp && npx tsc --noEmit                                  -> exit 0
cd apps/miniapp && npx eslint src/i18n/vi.ts src/i18n/community-copy.spec.ts src/pages/profile.spec.ts  -> sạch
cd apps/miniapp && npx eslint src/pages/profile.tsx  -> 3 lỗi tubu-ds/no-raw-color ở dòng 210/226/249, CÓ SẴN từ trước, không thuộc dòng đã sửa (dòng 32)
cd apps/api && npx tsc --noEmit -p tsconfig.json                     -> exit 0
```

**Giả định**
- Tên bậc uy tín (Mầm / Cây non / Cây trưởng thành / Cổ thụ), loại bài tự động "Thu hoạch / Sưu tập loài / Mốc cộng đồng" và tên "Cộng đồng Vườn Tubu" được giữ: là ẩn dụ thương hiệu Tubu Tree và tính năng game Vườn Xanh, không phải lời hỏi đáp về cây cảnh bán trong shop.
- Chọn ẩn danh mục cũ thay vì đổi tên tại chỗ: đổi tên giữ slug sẽ gán nhầm bài cũ về cây cảnh sang chủ đề mỹ phẩm.

**Còn lại / ghi chú cho gói khác**
- "Chăm cây ảo / Mua cây thật" ở `game.tsx`, `loyalty.tsx:370`, `refill.tsx:204`, `wallet.tsx:196` là khái niệm game Vườn Xanh (trồng cây thật góp rừng), không đụng ở mục này. Gom vào C-074 / quyết định game nếu muốn đổi.
- `community.eventRewardLabel` = "Thưởng TubuXu" (màn admin kiểm duyệt, gắn logic xu): để Đợt D gộp TubuXu theo đúng phạm vi C-074.
- Comment trong `components/community/post-composer.tsx:56` và `schema.prisma` (comment "6 danh mục cố định") còn nhắc tên cũ, không ảnh hưởng chạy.
- Khi deploy: chạy `prisma migrate deploy` (1 migration, additive) rồi seed để có khoá chấm công mới + danh mục mới. Cả hai idempotent.

---

## C-074 — Thuật ngữ Q-26 + kho mã giảm giá lên đầu /loyalty (XONG)

Commit `8ee545d` (thuật ngữ) và `ab6831a` (bố cục /loyalty).

**Thuật ngữ** (một chữ cho một khái niệm):
- "Mã ưu đãi" -> "Mã giảm giá": `vi.cart.couponPlaceholder`, `voucher-sheet.tsx` (4 chỗ), `cart.tsx`, `checkout.tsx` (ô chọn mã + dòng tổng "Giảm giá voucher" -> "Mã giảm giá"), `brand-view.tsx`.
- "voucher" hiển thị cho khách -> "mã giảm giá": `edit-profile.tsx` (quà sinh nhật), `game.tsx` (nút "Dùng mã giảm giá ngay"), nhãn sổ điểm `LOYALTY_REDEEM_VOUCHER` ("Đổi điểm lấy mã giảm giá", `services/account-api.ts`), toàn bộ /loyalty.
- "Tubu Xu" -> "TubuXu" (một dạng duy nhất): `milestone-copy.ts` ("Đã cộng vào TubuXu"), `affiliate.tsx` (nhãn bảng bậc CTV), kèm comment/JSDoc. Chỉ đổi chữ, không đụng logic xu.
- Backend, một chuỗi duy nhất: `apps/api/src/modules/affiliate/affiliate.service.ts:1060` thông điệp nhận thưởng mốc ("... TubuXu từ ..."); ngoài nhóm file của gói nhưng miniapp hiển thị nguyên văn `res.message` nên không đổi thì khách vẫn thấy "Tubu Xu". Chỉ một dòng, không có spec nào khẳng định chuỗi cũ.
- "Ví Tubu", "Điểm Xanh", "giọt nước" đã đúng ở các màn còn lại; /loyalty còn chữ "hạt giống Vườn Xanh" -> "giọt nước".

**Bố cục /loyalty**: khối "Mã giảm giá của tôi" (trước là "Kho voucher", khối thứ 7) nay nằm ngay dưới thẻ hạng, trước điểm danh / các hạng / đổi quà / lịch sử. Thêm trạng thái tải (Skeleton) và trạng thái lỗi kèm nút "Thử lại" (DS Button) thay cho việc lỗi tải mã bị hiển thị như "chưa có voucher". Câu trống: "Chưa có mã giảm giá khả dụng — đổi Điểm Xanh ở mục bên dưới để nhận mã." Tiêu đề khối đổi quà: "Đổi Điểm Xanh nhận mã giảm giá"; snackbar đổi quà: "... đã vào mục Mã giảm giá của tôi."

**Test**
- `i18n/terminology.spec.ts` (mới, 4 test): quét `apps/miniapp/src` (không tính spec) cấm "mã ưu đãi", "Tubu Xu", các cụm "Kho voucher / Nhận voucher / Chưa có voucher / giá voucher / Dùng voucher / lấy voucher..."; ô nhập mã nói "Nhập mã giảm giá".
- `pages/loyalty-layout.spec.tsx` (mới, 6 test): thứ tự khối (kho mã sau thẻ hạng, trước điểm danh / các hạng / đổi quà / lịch sử), số mã + nhãn + điều kiện đơn tối thiểu + `HSD dd/MM/yyyy`, câu trống, lỗi + thử lại, không còn chữ "voucher"/"hạt giống" và có "giọt nước".
- `services/account-api.spec.ts`: đổi kỳ vọng nhãn `LOYALTY_REDEEM_VOUCHER`; ĐỎ trước khi sửa (`1 failed | 30 passed`), XANH sau (`31 passed`).
- `components/affiliate/milestone-copy.spec.ts`, `utils/format.spec.ts` cập nhật chữ "TubuXu".
- e2e (chỉ cập nhật chữ, KHÔNG chạy Playwright theo quy định máy): `loyalty.miniapp.spec.ts`, `affiliate-ctv.miniapp.spec.ts`.
- Hai spec mới `terminology` và `loyalty-layout` được dựng ở lượt trước chưa kịp commit; lượt này chỉ xác nhận XANH, trạng thái ĐỎ ban đầu của chúng không được ghi lại.

**Còn lại (ghi theo yêu cầu, không sửa vì gắn logic xu hoặc ngoài nhóm file)**
- Chữ "TubuXu" còn ở các nơi gắn logic xu: `wallet.tsx` (đổi Ví -> TubuXu), `checkout.tsx`/`vi.ts` (`paymentXu`, nhãn phương thức XU), `game.tsx:550` ("Mua bằng TubuXu"), `profile.tsx:278`, `community-events.tsx`, `community-moderation.tsx`, `storefront-builder.tsx`, `about-data.ts`, `vi.community.eventRewardLabel`. Tất cả cùng MỘT dạng viết "TubuXu"; khi Đợt D gộp TubuXu vào Điểm Xanh thì đổi hàng loạt, guard `terminology.spec.ts` giữ cho không phát sinh dạng "Tubu Xu".
- `apps/web/src/app/gio-hang/page.tsx:267` placeholder "Nhập mã ưu đãi" (web, ngoài nhóm file): đổi thành "Nhập mã giảm giá" ở gói web.
- Mã chủ đề thông báo `VOUCHER*` trong `notifications.tsx` chỉ là khoá kỹ thuật, tiêu đề hiện "Ưu đãi cho bạn" (giữ).

---

## C-083 — Định dạng số nhất quán (XONG)

Commit `7906e46` (helper) và `1d57c3f` (thay chỗ dùng); phần còn lại của /loyalty nằm trong `ab6831a`.

- `apps/miniapp/src/utils/format.ts`: thêm `formatNumber` (dấu phân cách nghìn vi-VN, `NaN/Infinity` -> 0), `formatDrops` (giọt nước), `formatDate`/`formatDateTime` (dd/MM/yyyy cố định, không phụ thuộc ICU của webview); `formatVnd`/`formatPoints`/`formatXu` đi qua `formatNumber` nên không còn in `NaN`.
- Thay `toLocaleString`/số trần ở `game.tsx` (giọt nước, xu, mục tiêu cộng đồng), `i18n/vi.ts` (hàm thông điệp), `order-detail.tsx`, `loyalty.tsx`, `admin.tsx`, `ai-advisor.tsx`, `group-buy.tsx`, `notifications.tsx`, `profile.tsx`, `storefront-builder.tsx`, `account-api.ts`.
- Test: `utils/format.spec.ts` (28 test), `pages/game-numbers.spec.tsx` ("1.250.000" / "65.000 xu", không số trần), `pages/format-guard.spec.ts` (mới: pages + i18n không được gọi `.toLocaleString(`; /loyalty, /game, /order-detail, /not-found không gọi `toLocale(Date|Time)String`). Kiểm chứng bằng grep: `grep -rn toLocaleString src/pages src/i18n` (không spec) -> 0 dòng.
- Ngoại lệ còn lại: `utils/checkout-rules.ts:49` (`groupThousands`, ngoài `pages/`, cùng dáng vi-VN) và bản thân `format.ts`.

## C-115 — Màn đơn trống nói đúng mã chào mừng (XONG)

Commit `d811364`. `vi.orders.emptyBody`: "Mua đơn đầu — nhận 30k voucher" -> "Đơn đầu từ 199.000đ dùng được mã giảm giá chào mừng 30.000đ" (đúng với voucher chào mừng 30k, đơn tối thiểu 199k: mã cấp trước đơn đầu, không phải sau khi mua). Test `i18n/orders-empty-copy.spec.ts` (2 test). `grep -n 'Mua đơn đầu' src/i18n/vi.ts` -> không còn.

## C-120 — Lịch sử vận chuyển bằng tiếng Việt (XONG)

Commit `abca3a4`. `utils/format-shipping.ts` `shippingEventLabel`: rỗng -> `null` (trang hiện "—"); mã hãng đã biết (`delivering`, `ready_to_pick`...) -> nhãn tiếng Việt trong `vi.shippingEvent.labels`; chuỗi đã có dấu tiếng Việt (Gomdon/BestExpress) giữ nguyên; mã lạ -> "Đang cập nhật" (không in mã gốc). `order-detail.tsx` dùng cho `shippingStatus` và từng mốc `events`. Test `utils/format-shipping.spec.ts` (mới) + `pages/order-detail.spec.tsx` (đơn `status: 'delivering'` hiện nhãn tiếng Việt).

## C-119 — Trang 404 không bị tiêu đề đè lên hình (XONG)

Commit `820ac0d`. Nguyên nhân: emoji 72px đặt trong `Text` của ZaUI (line-height cố định ~20px) tràn xuống dòng tiêu đề. `pages/not-found.tsx` nay dùng `EmptyState art="search"` (SVG 120x96 có chiều cao cố định, tiêu đề + lời giải thích + nút DS v2 "Về trang chủ" `navigate('/', { replace: true })`), căn giữa trong khối cao 80vh. Test `pages/not-found.spec.tsx` (mới, 2 test): ĐỎ trước (`1 failed | 1 passed`: chưa có SVG, còn chữ cỡ lớn), XANH sau (`2 passed`). Chưa chụp lại `not-found__normal__390.png` (không chạy Playwright theo quy định máy) — nên chụp lại ở lượt UAT.

## Kiểm chứng của mục 2/2 (lượt này)

```
cd apps/miniapp && npx vitest run <16 file: format, format-shipping, game-numbers, order-detail, i18n/*, format-guard,
  loyalty-layout, not-found, account-api, components/affiliate/*, profile, profile-hub>   -> Test Files 16 passed, Tests 120 passed
cd apps/miniapp && npx tsc --noEmit                                  -> exit 0
cd apps/miniapp && npx eslint <file đã sửa>                          -> 0 lỗi mới
  (loyalty/game/edit-profile/affiliate: 13 lỗi trước và sau, `Button` từ zmp-ui + rgba thô CÓ SẴN, đo bằng cách lint bản HEAD; not-found.tsx và các spec mới sạch)
cd apps/api && npx jest --maxWorkers=1 src/modules/affiliate/affiliate.service  -> Tests: 91 passed, 91 total
```

**Giả định**
- "TubuXu" là dạng viết duy nhất cho tiền tệ xu cho tới Đợt D (catalog: "còn đúng một dạng"); không đổi sang "Điểm Xanh" vì xu và Điểm Xanh là hai số dư khác nhau về logic (xu tiêu trong app, Điểm Xanh xét hạng).
- Mã chào mừng 30.000đ / đơn từ 199.000đ lấy theo đặc tả gói; con số nằm trong chuỗi i18n, nếu cấu hình voucher chào mừng ở backend đổi thì chuỗi phải đổi theo.
