# Gói refseed: nạp dữ liệu tham chiếu cho prod (D4-001, D4-021)

Nhánh `lr/refseed`. Lệnh mới: `npm run prisma:seed:reference` (trong `apps/api`), tức `tsx prisma/seed-reference.ts`.

## 1. Đã làm gì

- `apps/api/prisma/seed-reference.ts` (mới): nạp nhóm (R) lên DB ngay sau `prisma migrate deploy`. CREATE-ONLY: mỗi nhóm là một câu `INSERT ... ON CONFLICT DO NOTHING` (`createMany({ skipDuplicates })`), nên dòng đã có (theo khoá chính hoặc khoá duy nhất như `code`, `slug`) không bao giờ bị ghi đè, chạy lại không đổi gì, hai tiến trình chạy cùng lúc không tạo trùng. Không có cổng `assertSeedAllowed`: nó an toàn trên production nên chạy được với `NODE_ENV=production`. In 10 dòng `[seed-reference] <bảng>: +N mới | đủ sẵn`, thoát 1 khi lỗi.
- `apps/api/prisma/reference-data/config-selection.ts` (mới): khoá `SystemConfig` nào được nạp. Danh sách cho phép theo tiền tố (tiền tố mới chưa duyệt thì không lên prod), danh sách loại có lý do, và 5 khoá `community.rep_*` mà `seed.ts` chưa có (D4-021).
- `apps/api/prisma/reference-data/garden.ts` (mới): mốc cộng đồng và mùa, tách khỏi thân `main()` của `seed.ts` để hai nơi dùng chung một nguồn.
- `seed.ts` (phiên đổi-rác cũng đang sửa file này), diff tối thiểu: thêm `export` cho 6 hằng số (`SYSTEM_CONFIGS`, `TIERS`, `DEALER_TIERS`, `NOTIFICATION_TEMPLATES`, `MISSIONS`, `PLANT_SPECIES`); một dòng import; hai khối `create: { ... }` của mốc cộng đồng và mùa thành `create: COMMUNITY_GOAL_SEED` / `create: SEASON_SEED`; lời gọi `main()` cuối file bọc trong `if (require.main === module)` để import không tự chạy. `seed.ts` chạy y hệt (kiểm ở mục 2). Khi rebase lên nhánh đổi-rác, chỗ có thể xung đột chỉ là các dòng này.
- `seed-game-quiz.ts`: thêm `export` cho `QUIZZES` và `SeedQuiz`.
- `tier-perks-seed.spec.ts`: hai test đọc chữ mốc cộng đồng từ `seed.ts` nay đọc từ `reference-data/garden.ts` (đổi một dòng nguồn đọc, không đổi khẳng định).
- Runbook: bước 7b mới trong `docs/launch/deploy-rollback-runbook.md` (tài liệu deploy đang dùng: `ops/README-vietnix-deploy.md` trỏ tới nó), một dòng vào bảng điểm dừng, một đoạn trong `ops/README-vietnix-deploy.md`, một dòng trong `docs/2026-10-review/99-release-readiness.md`.

## 2. Kiểm chứng

Postgres 16 throwaway, cổng 5562, `tubutree_it`.

| Lệnh | Kết quả |
|---|---|
| `npx prisma migrate deploy` (DB trống) rồi đếm | 186 migration; trước seed-reference: `system_configs 50`, `notification_templates 72`, `membership_tiers 0`, `dealer_tiers 0`, `community_categories 0`, `game_quizzes 0`, `missions 0`, `plant_species 0`, `community_goals 0`, `seasons 0` |
| `NODE_ENV=production npm run prisma:seed:reference` (DB vừa migrate) | thoát 0; `system_configs +90 (126 dòng nạp, 36 đã có)`, `membership_tiers +4`, `dealer_tiers +4`, `notification_templates +28`, `community_categories +7`, `game_quizzes +43`, `missions +4`, `plant_species +10`, `community_goals +1`, `seasons` bỏ qua. Sau đó: `system_configs 140`, `notification_templates 100`; `products 44`, `coupons 3`, `users 0` không đổi |
| Chạy lần 2 | mọi nhóm `đủ sẵn`, ảnh chụp toàn bộ dòng các bảng (kể cả `updatedAt`) trước và sau bằng nhau |
| Sửa tay 10 dòng (khoá cấu hình, hạng, bậc đại lý, mẫu tin, chủ đề tắt `isActive`, quiz, nhiệm vụ, loài cây, mốc chốt `DONE`) rồi chạy lại | mọi chỉnh sửa còn nguyên, `created = 0` mọi nhóm, không có mốc ACTIVE mới thay mốc đã chốt |
| Xoá 1 nhiệm vụ và 1 khoá cấu hình rồi chạy lại | đúng 2 dòng được tạo lại, giá trị mặc định |
| `seed.ts` gốc trên DB trống khác | thoát 0, `Seed done.`, `game_quizzes 49 (43 + 6 quiz thương hiệu)`; chạy seed-reference sau đó chỉ thêm 5 khoá `community.rep_*` (seed.ts không có chúng) |
| `npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/reference-seed.race-spec.ts` | `Tests: 6 passed, 6 total` (~36 s; spec tự tạo 3 DB `tubutree_it_refseed_*`, migrate, rồi `DROP DATABASE ... WITH (FORCE)`, nên không phụ thuộc dữ liệu của spec khác và cần quyền CREATE DATABASE) |
| `npx jest src/modules/system-config src/modules/loyalty src/modules/notifications/notification-templates-seed.spec.ts src/modules/admin/config-redaction.spec.ts src/modules/vouchers/vouchers.service.spec.ts src/modules/affiliate/affiliate-notifications.spec.ts src/modules/game/game.service.spec.ts src/modules/feed/community-categories-seed.spec.ts` (không `DATABASE_URL`) | mọi suite PASS (các spec đọc chữ `seed.ts` vẫn xanh) |
| `npx tsc --noEmit -p tsconfig.json`; `npx eslint <file đã sửa> --max-warnings=0` | không lỗi |

Spec race gồm: lệnh prod thật qua `spawnSync` với `NODE_ENV=production` (kèm kiểm sản phẩm, biến thể, người dùng, mã giảm giá, đối tác cashback, `RoleGrant` và `payment.bank_account_no` đặt sẵn giá trị lạ đều không đổi), chạy lại, sửa tay, xoá một dòng, ba tiến trình cùng chạy trên DB trống (mỗi dòng tạo đúng một lần), `seed.ts` rồi seed-reference. Spec đơn vị `reference-config-selection.spec.ts` (12 test, không DB) khoá việc phân loại khoá.

Đã thử phá để chắc test bắt được: đổi nhóm `system_configs` sang upsert ghi đè thì 5/6 test race đỏ; thêm khoá `newfeature.flag` vào `seed.ts` thì test phân loại đỏ; thêm `payment` vào danh sách nạp thì test trùng danh sách đỏ. Sau mỗi lần đã khôi phục. Test viết sau mã, không đỏ trước (chưa có `seed-reference.ts` thì import đã lỗi).

Chưa kiểm: chạy lệnh trong image Docker thật (không build theo luật của đợt). Image copy nguyên `/app` gồm `tsx` và `prisma/*.ts`, và `go-live:check` đang chạy bằng `tsx` cùng cách đó, nhưng lệnh `$DC run --rm --no-deps api pnpm run prisma:seed:reference` ở bước 7b chưa được chạy qua compose. Chưa chạy service thật (API) trên DB đã nạp: chỉ kiểm ở mức dòng trong DB.

## 3. Bảng phân loại: mọi thứ `seed.ts` ghi

R = tham chiếu bắt buộc; R? = nạp nhưng giá trị là quyết định kinh doanh cần chủ dự án xác nhận; D = dữ liệu demo/dev; X = loại vì lý do khác; ? = mơ hồ.

| Bảng / nhóm | Dòng | Lớp | Nạp? | Ghi chú |
|---|---|---|---|---|
| `notification_templates` | 100 | R | có | DB chỉ migrate thiếu 28: `ORDER_CONFIRMED/SHIPPING/DELIVERED/CANCELLED/PACKED/RETURNED`, `INVOICE_ISSUED`, `RETURN_REQUESTED/APPROVED`, `WELCOME/BIRTHDAY/WINBACK/MILESTONE_VOUCHER`, `CASHBACK_PAID`, `REORDER_REMINDER`, `SUBSCRIPTION_ORDER`, `CART_ABANDONED`, `VOUCHER_EXPIRING`, `COMMISSION_NEW/APPROVED/PAYOUT_PAID`, 3 `GAME_*`, 4 `COMMUNITY_*`. Thiếu mẫu thì khách nhận câu chung "Tubu Tree có cập nhật mới cho bạn" (`notifications.service.ts:13,79`) |
| `community_categories` | 7 | R | có | Danh mục cây cảnh cũ (4 slug) không còn trong `COMMUNITY_CATEGORIES`; bước "ẩn danh mục cũ" của `seed.ts` là cập nhật nên không chạy ở đây |
| `game_quizzes` (nature `nq_*`) | 43 | R | có | D4-001 ghi 46; đếm mảng thật là 43 (3 dòng còn lại là chữ `id:` trong hàm seed) |
| `plant_species` | 10 | R | có | Sổ tay loài cây |
| `membership_tiers` | 4 | R? | có | Mầm Xanh, Lộc Biếc, Đại Thụ, Cổ Thụ. Bảng trống thì không ai có hạng, không có freeship/sinh nhật theo hạng, trang Loyalty không có thang. Kèm khoá `shipping.tier_freeship_overrides` (nạp cùng, spec khoá cặp này) |
| `dealer_tiers` | 4 | R? | có | Không có bậc thì duyệt hồ sơ đại lý lỗi ("bậc không tồn tại", `admin.service.ts:242`) |
| `missions` | 4 | R? | có | Điểm thưởng 20/30/15/50 |
| `community_goals` | 1 | R? | có, nếu chưa có mốc nào ACTIVE | Mốc "Cùng Tubu góp quỹ trồng cây", 100.000 giọt, 200 cây. Không có mốc thì 💧 thu hoạch không góp vào đâu |
| `seasons` | 1 | X | không | Mùa hè 2026 đã hết hạn 2026-08-31; nạp chỉ thêm dòng chết. Code chỉ nạp khi `endAt` còn ở tương lai. Season Pass đã ẩn (PD-1); banner mùa tự ẩn khi không có mùa |
| `system_configs` | 132 trong seed | R / R? | 121 + 5 mới = 126 | Xem mục 3.1 |
| `system_configs` `payment.*` | 4 | D | không | Số tài khoản mẫu `9984606774`. Migration `20260625070000` đã chèn 4 dòng này vào mọi DB mới (go-live check `db.bank_account` cảnh báo). Chủ shop nhập số thật ở Quản trị |
| `system_configs` `refill.*`, `shipping.gomdon.*` | 5 + 2 | X | không | Thuộc gói đổi vỏ/đổi rác (phiên khác); migration đã chèn dòng |
| `categories` (sản phẩm) | 7 | D | không | Migration `20260616000000_demo_catalog_multibrand` đã tạo cùng id |
| `products`, `variations` | 44, 48 | D | không | Nằm trong cùng migration demo (xem mục 6) |
| `coupons` WELCOME30, FREESHIP, XANH10 | 3 | D | không | Cũng do migration demo chèn; hết hạn 2026-12-31 / 2027-01-01 |
| `game_quizzes` thương hiệu `q1`–`q6` | 6 | ? | không | Bộ quiz cũ trước bộ nature, nêu sự thật về Fuwa3e/Pơ Lang chưa ai xác nhận, đáp án sai nêu Shopee/Lazada/Tiki. 43 câu nature đủ cho 5 câu/ngày |
| `cashback_merchants` | 3 | D | không | Hoàn tiền sàn ngoài đã ẩn khỏi hub (PD-1, Q-15); deeplink AccessTrade cần tài khoản riêng |
| `role_grants` (từ env `SEED_ADMIN_PHONES`) | n | D | không | Prod cấp admin bằng `scripts/grant-admin.js` |

### 3.1 SystemConfig: khoá nào cần, khoá nào có mặc định

Quét tĩnh: 115 khoá mã đọc bằng `config.get('<khoá>', mặc định)` (ghép thêm các lần đọc qua hằng số khoá hay hàm phụ như `positiveConfig`, kiểm tay): không lần đọc nào thiếu giá trị mặc định (không có `get` nào ném `NotFoundException`). Nên KHÔNG khoá nào "thiếu thì hỏng". Nạp để (a) admin thấy ở tab Cấu hình (tab chỉ liệt kê dòng có trong DB; `setConfig` cũng từ chối khoá chưa có dòng và chưa có luật ghi, `admin.service.ts:1253`), (b) các cặp đi cùng nhau không lệch.

Số khoá nạp theo nhóm (126; DB chỉ migrate đã có sẵn 36, nạp mới 90): loyalty 11, voucher 6, affiliate 5, cashback 4, wallet 2, referral 4, support 3, community 12 (7 từ seed + 5 `rep_*`), game 20, subscribe 3, wishlist 2, flashsale 4, orders 2, merchant 7, ops 6, storefront 1, dealer 2, seasonpass 2, groupbuy 4, shipping 5, returns 1, remarketing 3, reorder 2, attendance 11, retention 4.

Trừ 6 khoá ở bảng dưới (và `payment.*`, không nạp), mọi khoá còn lại có mặc định trong mã bằng đúng giá trị seed: 75 khoá đối chiếu tự động với chữ trong mã; các khoá đọc qua hằng số hoặc hàm phụ (`DEFAULT_POINT_EXPIRE_MONTHS`, `DEFAULT_CHECKIN_POINTS`, `DEFAULT_PIT_WITHHOLD_*`, `POS_DEFAULTS`, `CART_ABANDON_DEFAULT_*`, `FLASH_MAX_*`, `DEFAULT_MERCHANT_*`, `ops-alerts`, `RETENTION_POLICY`, v.v.) đối chiếu tay. Nạp chúng là dòng "chỉ để thấy", không đổi hành vi.

Khoá mà giá trị seed KHÁC mặc định trong mã (nạp dòng này là đổi hành vi so với DB không có dòng; đây là các mục "R?" cần chủ dự án xác nhận):

| Khoá | Seed | Mặc định mã (không có dòng) |
|---|---|---|
| `game.spin_prizes` | 8 giải, trọng số 30/22/12/10/15/4/5/2, tối đa 50 điểm. Trung bình mỗi lượt trả 8,6 điểm (8.600đ) cộng 4.000đ mệnh giá voucher cộng 4,5 💧 cho lượt mua 10 điểm | `[]`: "Vòng quay chưa cấu hình" |
| `shipping.tier_freeship_overrides` | Lộc Biếc freeship từ 99.000đ, Đại Thụ và Cổ Thụ freeship hết | `{}`: không hạng nào được freeship (lời hứa trên thẻ hạng sẽ không thực hiện) |
| `referral.milestones_points` | mốc 3/5/10 bạn → thưởng 20/40/100 điểm | `[]`: không có thưởng mốc |
| `subscribe.discount_tiers` | 12% / 14% / 15% ở 1 / 3 / 5 gói định kỳ | một bậc 12% |
| `game.streak_7_bonus` | `{ seeds: 10, free_spins: 1 }` (`free_spins` không có code nào đọc) | `{ seeds: 20 }` |
| `seasonpass.tiers` | 5 bậc | `[]` (Season Pass đã ẩn) |

Khoá mã đọc nhưng `seed.ts` không có (không nằm trong DB sau migrate, admin không thấy):

| Khoá | Xử lý |
|---|---|
| `community.rep_post`, `rep_answer`, `rep_best`, `daily_rep_cap`, `rep_thresholds` | NẠP (D4-021), đúng mặc định trong `community-feed.service.ts`; spec đối chiếu chữ mã nguồn nên đổi mặc định trong mã mà quên đổi ở đây sẽ đỏ |
| `voucher.second_order_amount`, `_min_order`, `_delay_days`, `_min_remaining_days` | KHÔNG nạp. Chúng là tiền (mã giảm giá 30.000đ phát cho mọi khách sau đơn đầu) mà `RANGES` của `SystemConfigService` chưa có luật biên, khác `voucher.welcome_*`. Hiện chúng sửa được trên tab thì một lần gõ nhầm số 0 phát mã triệu đồng. Cần thêm luật biên trước (`system-config.service.ts`, gói tiền), rồi mới nạp. `99-release-readiness` nói chỉnh được "trong SystemConfig" nhưng chưa đúng với DB mới |
| `dealer.quarterly_bonus_tiers`, `storefront.max_combo_pct`, `review.invite_delay_hours`, `review.invite_max_age_days`, `loyalty.earn_points_on_xu` | Không nạp, chưa ai yêu cầu; cùng vấn đề thiếu luật biên nếu nạp |
| `game.wilt_days`, `death_days`, `harvest_coupon_amount`, `gift_water_amount` | Không nạp: file do phiên đổi-rác đang sửa (`modules/game`), và dòng nạp sẽ ghim mặc định hiện tại |
| `attendance.office_lat/lng` | Cố ý không seed (admin nhập toạ độ thật) |

## 4. Chưa làm, cố ý để lại

- `deploy.sh` chưa gọi seed-reference. Khuyên: gọi sau `migrate deploy` ở mọi lần deploy (an toàn, idempotent), vì gốc rễ lỗi là mẫu thông báo và khoá cấu hình thêm vào `seed.ts` mà migration không theo. Việc đổi script deploy là quyết định của điều phối viên/chủ dự án.
- Chưa có check trong `go-live:check` cho dữ liệu tham chiếu (vd cảnh báo khi `membership_tiers`, `community_categories`, `game_quizzes` rỗng). Gợi ý gói sau, `src/config/go-live/db-checks.ts`.
- Chưa có màn admin sửa hạng thành viên, bậc đại lý, mùa; chỉnh bằng SQL, lần chạy sau không ghi đè.
- Chưa thêm luật biên cho `community.rep_*` (không phải tiền; điểm uy tín) và `voucher.second_order_*`.
- Dòng bị xoá tay sẽ được tạo lại ở lần chạy sau (create-only không phân biệt "chưa từng tạo" và "đã xoá"). Các màn admin hiện có chỉ cho sửa/tắt chứ không xoá những bảng này nên chấp nhận.
- Dòng nạp ghim giá trị mặc định hôm nay: đổi mặc định trong mã về sau không tới DB đã có dòng (giống mọi khoá `createOnly` sẵn có).

## 5. Câu hỏi cho chủ dự án (kèm mặc định đã dùng)

Mặc định chung: nạp đúng bản `seed.ts` đã chạy ở môi trường thử, vì đây là hành vi đã kiểm thử và duyệt qua các đợt trước; muốn khác thì sửa ở tab Cấu hình trước khi mở app (hạng, bậc đại lý chưa có màn: SQL).

1. Thang hạng thành viên: giữ ngưỡng hiện tại (Lộc Biếc 500 điểm hoặc 5 triệu/12 tháng, Đại Thụ 2.000 hoặc 20 triệu, Cổ Thụ 5.000 hoặc 50 triệu) không? D2-09 gợi ý hạ Lộc Biếc xuống khoảng 1,5 triệu. Mặc định: giữ.
2. Bảng giải vòng quay (8 giải; một lượt giá 10 điểm trả trung bình 8,6 điểm, chưa tính voucher và 💧): mở ngay hay đóng tới khi duyệt? Mặc định: mở với bản seed. Muốn đóng: đặt `game.spin_prizes` = `[]` ở tab Cấu hình (luật ghi cho phép mảng rỗng; vòng quay báo "chưa cấu hình" trước khi trừ điểm).
3. Bốn bậc đại lý (chiết khấu 20/30/38/45%, hạn mức công nợ 0/20/50/150 triệu, PREPAID/NET 15/NET 30/NET 30): giữ không? Mặc định: giữ.
4. Mốc quỹ trồng cây (100.000 giọt tương đương 200 cây, vùng "Cộng đồng Tubu", không nêu địa điểm): đây là con số công khai trên màn Vườn Xanh. Mặc định: giữ.
5. Mùa: chưa có mùa nào còn hạn (mùa hè 2026 đã hết), Vườn Xanh không hiện banner mùa. Cần mùa mới (tên, vùng, ngày) và chưa có màn admin tạo mùa. Mặc định: không có mùa.
6. Thưởng mốc giới thiệu (3/5/10 bạn → 20/40/100 điểm), bậc Subscribe & Save 12/14/15%, thưởng chuỗi 7 ngày (seed 10💧, mã mặc định 20💧): giữ bản seed? Mặc định: giữ bản seed, tức khác mặc định trong mã.
7. Bốn nhiệm vụ (20/30/15/50 điểm) và hotline/email CSKH đang hiển thị (`0899 149 229`, `tubutree@gmail.com`): đúng và giữ? Mặc định: giữ.
8. Sáu quiz thương hiệu cũ (q1–q6): bỏ hay xác nhận đáp án (vd Pơ Lang ở Đắk Lắk?) rồi nạp? Mặc định: không nạp.

## 6. Phát hiện ngoài phạm vi

- D4-001 nói thiếu 6 mẫu thông báo; thực tế DB chỉ migrate thiếu 28, trong đó có cả vòng đời đơn hàng (`ORDER_DELIVERED`, `ORDER_CANCELLED`...) và mã giảm giá chào mừng. Đã nạp hết.
- Migration `20260616000000_demo_catalog_multibrand` chèn 44 sản phẩm demo (ảnh `picsum.photos`), 48 biến thể, 7 danh mục, 3 mã giảm giá công khai vào MỌI DB mới, kể cả prod. Mã `seed.ts` còn ghi chú "KHÔNG dùng ảnh picsum". Cần quy trình ẩn/xoá trước ngày mở bán (ngoài gói này).
- Các migration PD-1/PC-8 chỉ `UPDATE` quyền lợi và mức voucher sinh nhật của hạng đã có: trên DB mới (bảng hạng trống) chúng không làm gì, nên hạng từ seed-reference lấy từ hằng số `seed.ts` (đã mang chữ mới).
- Hai mẫu ZNS (`ORDER_CONFIRMED`, `ORDER_SHIPPING`) không có `zaloTemplateId`; sau khi nạp, `go-live:check` mục `db.zns_templates` sẽ WARN đúng như dự kiến, khách nhận bản trong app.
