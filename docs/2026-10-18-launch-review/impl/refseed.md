# Gói refseed: nạp dữ liệu tham chiếu cho prod (D4-001, D4-021)

Nhánh `lr/refseed`. Lệnh mới: `npm run prisma:seed:reference` (trong `apps/api`), tức `tsx prisma/seed-reference.ts`.

Hai chế độ. Không cờ: chỉ nạp phần tham chiếu an toàn (mẫu thông báo, chủ đề cộng đồng, quiz, loài cây, mốc quỹ, 118 khoá cấu hình có giá trị bằng mặc định trong mã). Cờ `--with-business-defaults`: nạp thêm "nhóm giá trị kinh doanh" (4 hạng thành viên, 4 bậc đại lý, 4 nhiệm vụ có điểm, 6 khoá cấu hình có giá trị khác mặc định trong mã). Nhóm đó là các con số tiền, điểm, xác suất chủ dự án chưa quyết, nên chỉ chạy có cờ sau khi duyệt bảng ở mục 3.2. Chưa duyệt thì DB giữ hành vi như bảng trống.

## 1. Đã làm gì

- `apps/api/prisma/seed-reference.ts` (mới): nạp nhóm (R) lên DB ngay sau `prisma migrate deploy`. CREATE-ONLY: mỗi nhóm là một câu `INSERT ... ON CONFLICT DO NOTHING` (`createMany({ skipDuplicates })`), nên dòng đã có (theo khoá chính hoặc khoá duy nhất như `code`, `slug`) không bao giờ bị ghi đè, chạy lại không đổi gì, hai tiến trình chạy cùng lúc không tạo trùng. Không có cổng `assertSeedAllowed`: nó an toàn trên production nên chạy được với `NODE_ENV=production`. In mỗi nhóm một dòng `[seed-reference] <nhóm>: +N mới | đủ sẵn`, thoát 1 khi lỗi. Cờ gõ sai (vd `--with-business-default`) báo lỗi và không ghi gì, để người chạy không tưởng đã nạp.
- `apps/api/prisma/reference-data/config-selection.ts` (mới): khoá `SystemConfig` nào được nạp. Danh sách cho phép theo tiền tố (tiền tố mới chưa duyệt thì không lên prod), danh sách loại có lý do (`payment`, `refill`, họ `shipping.gomdon.` theo tiền tố, hai khoá phí ship), `BUSINESS_CONFIG_KEYS` (6 khoá chỉ nạp có cờ) và 5 khoá `community.rep_*` mà `seed.ts` chưa có (D4-021).
- `apps/api/src/modules/system-config/system-config.service.ts`: luật ghi (`RANGES`, `JSON_RULES`) cho `community.rep_post/rep_answer/rep_best/daily_rep_cap`, `community.rep_thresholds` và `game.streak_7_bonus`, vì seed-reference làm các khoá này hiện ở tab Cấu hình (luật ghi nằm ở file này, không ở `admin.service.ts`).
- `apps/api/prisma/reference-data/garden.ts` (mới): mốc cộng đồng và mùa, tách khỏi thân `main()` của `seed.ts` để hai nơi dùng chung một nguồn.
- `seed.ts` (phiên đổi-rác cũng đang sửa file này), diff tối thiểu: thêm `export` cho 6 hằng số (`SYSTEM_CONFIGS`, `TIERS`, `DEALER_TIERS`, `NOTIFICATION_TEMPLATES`, `MISSIONS`, `PLANT_SPECIES`); một dòng import; hai khối `create: { ... }` của mốc cộng đồng và mùa thành `create: COMMUNITY_GOAL_SEED` / `create: SEASON_SEED`; lời gọi `main()` cuối file bọc trong `if (require.main === module)` để import không tự chạy. `seed.ts` chạy y hệt (kiểm ở mục 2). Khi rebase lên nhánh đổi-rác, chỗ có thể xung đột chỉ là các dòng này.
- `seed-game-quiz.ts`: thêm `export` cho `QUIZZES` và `SeedQuiz`.
- `tier-perks-seed.spec.ts`: hai test đọc chữ mốc cộng đồng từ `seed.ts` nay đọc từ `reference-data/garden.ts` (đổi một dòng nguồn đọc, không đổi khẳng định).
- Runbook: bước 7b mới trong `docs/launch/deploy-rollback-runbook.md` (tài liệu deploy đang dùng: `ops/README-vietnix-deploy.md` trỏ tới nó), một dòng vào bảng điểm dừng, một đoạn trong `ops/README-vietnix-deploy.md`, một dòng trong `docs/2026-10-review/99-release-readiness.md`.

## 2. Kiểm chứng

Postgres 16 throwaway, cổng 5562, `tubutree_it`.

| Lệnh | Kết quả |
|---|---|
| `npx prisma migrate deploy` (DB trống) rồi đếm | 186 migration; trước seed-reference: `system_configs 50`, `notification_templates 72`, `membership_tiers 0`, `dealer_tiers 0`, `community_categories 0`, `game_quizzes 0`, `missions 0`, `plant_species 0`, `community_goals 0`, `seasons 0`; `products 44`, `coupons 3` (từ migration demo) |
| `NODE_ENV=production npm run prisma:seed:reference` (KHÔNG cờ, DB vừa migrate) | thoát 0; `system_configs +82 (118 dòng nạp, 36 đã có)`, `notification_templates +28`, `community_categories +7`, `game_quizzes +43`, `plant_species +10`, `community_goals +1`, `seasons` bỏ qua; một dòng cuối "chưa nạp: business_configs, membership_tiers, dealer_tiers, missions". Sau đó `system_configs 132`, `membership_tiers 0`, `dealer_tiers 0`, `missions 0`; `products 44`, `coupons 3`, `users 0` không đổi; `shipping.free_threshold` và `flat_fee_below_threshold` vẫn vắng |
| Chạy lần 2 (không cờ) | mọi nhóm `đủ sẵn`, ảnh chụp toàn bộ dòng các bảng (kể cả `updatedAt`) trước và sau bằng nhau |
| `npm run prisma:seed:reference -- --with-business-defaults` (và `pnpm run prisma:seed:reference --with-business-defaults`, cả hai dạng chạy được) | thoát 0; `business_configs +6`, `membership_tiers +4`, `dealer_tiers +4`, `missions +4`; sau đó `system_configs 138`. Chạy lại: mọi nhóm `đủ sẵn` |
| Cờ gõ sai `--with-business-default` | thoát khác 0, thông báo "Tham số không hợp lệ", không ghi gì |
| Sửa tay 7 dòng tham chiếu (khoá cấu hình, mẫu tin, chủ đề tắt `isActive`, quiz, loài cây, mốc chốt `DONE`) rồi chạy lại; sau đó sửa tay hạng, bậc đại lý, nhiệm vụ, bảng giải vòng quay và chạy lại có cờ | mọi chỉnh sửa còn nguyên, `created = 0` mọi nhóm, không có mốc ACTIVE mới thay mốc đã chốt |
| Xoá 1 khoá cấu hình + 1 mẫu tin (không cờ), rồi 1 nhiệm vụ + 1 khoá giá trị kinh doanh (có cờ) | mỗi lần đúng 2 dòng được tạo lại, giá trị mặc định |
| Ba tiến trình `tsx prisma/seed-reference.ts --with-business-defaults` chạy cùng lúc trên DB trống | cả ba thoát 0; tổng số dòng "+N mới" của ba tiến trình bằng đúng số dòng thiếu trước khi chạy ở mọi nhóm. Chạy tay thấy hai tiến trình tranh nhau thật: nhóm quiz do một tiến trình thắng hết, các nhóm cấu hình, hạng, mẫu tin do tiến trình khác |
| `seed.ts` gốc trên DB trống khác | thoát 0, `Seed done.`, `game_quizzes 49 (43 + 6 quiz thương hiệu)`; chạy seed-reference có cờ sau đó chỉ thêm 5 khoá `community.rep_*` (seed.ts không có chúng) |
| `npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/reference-seed.race-spec.ts` | `Tests: 10 passed, 10 total` (~31 s; spec tự tạo 3 DB `tubutree_it_refseed_*`, migrate, rồi `DROP DATABASE ... WITH (FORCE)`, nên không phụ thuộc dữ liệu của spec khác và cần quyền CREATE DATABASE) |
| `npx jest src/modules/system-config src/modules/loyalty src/modules/feed src/modules/game src/modules/notifications/notification-templates-seed.spec.ts src/modules/admin/admin-config-rules.spec.ts src/modules/admin/config-redaction.spec.ts src/modules/vouchers/vouchers.service.spec.ts src/modules/affiliate/affiliate-notifications.spec.ts` (không `DATABASE_URL`) | `Test Suites: 47 passed, 47 total`, `Tests: 1286 passed, 1286 total` (các spec đọc chữ `seed.ts` vẫn xanh) |
| `npx tsc --noEmit -p tsconfig.json`; `npx eslint <file đã sửa> --max-warnings=0` | không lỗi |

Spec race gồm: lệnh prod thật qua `spawnSync` với `NODE_ENV=production` không cờ (kèm kiểm nhóm giá trị kinh doanh VẮNG, hai khoá phí ship vắng, và sản phẩm, biến thể, người dùng, mã giảm giá, đối tác cashback, `RoleGrant`, `payment.bank_account_no` đặt sẵn giá trị lạ, các khoá `shipping.*` còn lại đều không đổi), chạy lại, sửa tay, xoá một dòng, cờ gõ sai, chạy có cờ (nhóm kinh doanh có mặt, phần tham chiếu đã sửa tay không đổi), sửa tay và xoá nhóm kinh doanh, ba tiến trình thật cùng chạy, `seed.ts` rồi seed-reference.

Spec đơn vị `reference-config-selection.spec.ts` (không DB) khoá việc phân loại khoá: mọi khoá của `seed.ts` phải được phân loại; danh sách khoá nạp mặc định và danh sách khoá giá trị kinh doanh phải khớp danh sách đã duyệt nằm ngay trong spec (khoá mới nào cũng buộc người thêm quyết định nạp hay loại); họ `shipping.gomdon.` loại theo tiền tố kể cả khoá thêm sau; phí ship không nạp; hạng trong `shipping.tier_freeship_overrides` là hạng có thật trong `TIERS`; mọi khoá bổ sung và khoá kinh doanh đều có luật ghi và giá trị nạp tự hợp lệ với luật đó. `seed-reference-cli.spec.ts` kiểm cờ và dòng báo.

Đã thử phá để chắc test bắt được: đổi nhóm `system_configs` sang upsert ghi đè thì 5/6 test race đỏ (bản trước đợt sửa); thêm khoá `newfeature.flag` vào `seed.ts` thì test phân loại đỏ; thêm `payment` vào danh sách nạp thì test trùng danh sách đỏ; bỏ tiền tố `shipping.gomdon` thì 2 test đỏ; đặt mặc định `withBusinessDefaults = true` thì 2 test race đỏ; trả `system-config.service.ts` về bản trước khi thêm luật ghi thì 7 test đỏ. Sau mỗi lần đã khôi phục. Test viết sau mã, không đỏ trước (chưa có `seed-reference.ts` thì import đã lỗi).

Chưa kiểm: chạy lệnh trong image Docker thật (không build theo luật của đợt). Image copy nguyên `/app` gồm `tsx` và `prisma/*.ts`, và `go-live:check` đang chạy bằng `tsx` cùng cách đó, nhưng lệnh `$DC run --rm --no-deps api pnpm run prisma:seed:reference` ở bước 7b chưa được chạy qua compose (chỉ chạy `pnpm run` trực tiếp trong worktree). Chưa chạy service thật (API) trên DB đã nạp: chỉ kiểm ở mức dòng trong DB.

## 3. Bảng phân loại: mọi thứ `seed.ts` ghi

R = tham chiếu bắt buộc, nạp mặc định; B = giá trị kinh doanh chưa duyệt, chỉ nạp với `--with-business-defaults` (mục 3.2); R? = nạp mặc định nhưng là con số công khai cần chủ dự án xem; D = dữ liệu demo/dev; X = loại vì lý do khác; ? = mơ hồ.

| Bảng / nhóm | Dòng | Lớp | Nạp? | Ghi chú |
|---|---|---|---|---|
| `notification_templates` | 100 | R | có | DB chỉ migrate thiếu 28: `ORDER_CONFIRMED/SHIPPING/DELIVERED/CANCELLED/PACKED/RETURNED`, `INVOICE_ISSUED`, `RETURN_REQUESTED/APPROVED`, `WELCOME/BIRTHDAY/WINBACK/MILESTONE_VOUCHER`, `CASHBACK_PAID`, `REORDER_REMINDER`, `SUBSCRIPTION_ORDER`, `CART_ABANDONED`, `VOUCHER_EXPIRING`, `COMMISSION_NEW/APPROVED/PAYOUT_PAID`, 3 `GAME_*`, 4 `COMMUNITY_*`. Thiếu mẫu thì khách nhận câu chung "Tubu Tree có cập nhật mới cho bạn" (`notifications.service.ts:13,79`) |
| `community_categories` | 7 | R | có | Danh mục cây cảnh cũ (4 slug) không còn trong `COMMUNITY_CATEGORIES`; bước "ẩn danh mục cũ" của `seed.ts` là cập nhật nên không chạy ở đây (DB bản thử cũ phải ẩn tay, runbook bước 7b) |
| `game_quizzes` (nature `nq_*`) | 43 | R | có | D4-001 ghi 46; đếm mảng thật là 43 (3 dòng còn lại là chữ `id:` trong hàm seed) |
| `plant_species` | 10 | R | có | Sổ tay loài cây |
| `membership_tiers` | 4 | B | chỉ có cờ | Bảng trống thì không ai có hạng, không freeship/giảm giá/voucher sinh nhật theo hạng; trang Loyalty không có thang nhưng không lỗi (`loyalty.service.ts:588`, `tiers[0] ?? null`). Cổ Thụ giảm 5% mọi đơn, ba hạng trên có voucher sinh nhật 50k/150k/300k do cron cấp: đây là tiền thật |
| `dealer_tiers` | 4 | B | chỉ có cờ | Bảng trống thì admin KHÔNG duyệt được hồ sơ đại lý và không cấp được vai trò DEALER ("Bậc đại lý không tồn tại", `admin.service.ts:242,479`); chưa có màn tạo bậc. Chiết khấu 20 đến 45% và hạn mức công nợ tới 150 triệu |
| `missions` | 4 | B | chỉ có cờ | Điểm thưởng 20/30/15/50. Bảng trống thì Vườn Xanh không có nhiệm vụ nào để hiện (`game.service.ts:569` đọc bảng này) |
| `community_goals` | 1 | R? | có, nếu chưa có mốc nào ACTIVE | Mốc "Cùng Tubu góp quỹ trồng cây", 100.000 giọt, 200 cây. Không có mốc thì 💧 thu hoạch không góp vào đâu |
| `seasons` | 1 | X | không | Mùa hè 2026 đã hết hạn 2026-08-31; nạp chỉ thêm dòng chết. Code chỉ nạp khi `endAt` còn ở tương lai. Season Pass đã ẩn (PD-1); banner mùa tự ẩn khi không có mùa |
| `system_configs` | 132 trong seed | R / B / X | 118 mặc định (113 từ seed + 5 mới), 6 chỉ có cờ, 13 loại | Xem mục 3.1 và 3.2 |
| `system_configs` `payment.*` | 4 | D | không | Số tài khoản mẫu `9984606774`. Migration `20260625070000` đã chèn 4 dòng này vào mọi DB mới (go-live check `db.bank_account` cảnh báo). Chủ shop nhập số thật ở Quản trị |
| `system_configs` `refill.*`, họ `shipping.gomdon.` | 5 + 2 | X | không | Thuộc gói đổi vỏ/đổi rác (phiên khác); migration đã chèn dòng. Họ Gomdon loại theo tiền tố nên khoá Gomdon thêm sau cũng không lọt |
| `system_configs` `shipping.free_threshold`, `shipping.flat_fee_below_threshold` | 2 | X | không | Phí ship là quyết định của chủ shop: vắng thì `go-live:check` mục `db.shipping_rates` WARN (`db-checks.ts:257`) buộc xác nhận, mã dùng 200.000đ và 19.000đ (`pricing.service.ts:15,53`). Nạp thì WARN biến mất khi chưa ai xác nhận |
| `categories` (sản phẩm) | 7 | D | không | Migration `20260616000000_demo_catalog_multibrand` đã tạo cùng id |
| `products`, `variations` | 44, 48 | D | không | Nằm trong cùng migration demo (xem mục 6) |
| `coupons` WELCOME30, FREESHIP, XANH10 | 3 | D | không | Cũng do migration demo chèn; hết hạn 2026-12-31 / 2027-01-01 |
| `game_quizzes` thương hiệu `q1`–`q6` | 6 | ? | không | Bộ quiz cũ trước bộ nature, nêu sự thật về Fuwa3e/Pơ Lang chưa ai xác nhận, đáp án sai nêu Shopee/Lazada/Tiki. 43 câu nature đủ cho 5 câu/ngày |
| `cashback_merchants` | 3 | D | không | Hoàn tiền sàn ngoài đã ẩn khỏi hub (PD-1, Q-15); deeplink AccessTrade cần tài khoản riêng |
| `role_grants` (từ env `SEED_ADMIN_PHONES`) | n | D | không | Prod cấp admin bằng `scripts/grant-admin.js` |

### 3.1 SystemConfig: khoá nào cần, khoá nào có mặc định

Quét tĩnh: 115 khoá mã đọc bằng `config.get('<khoá>', mặc định)` (ghép thêm các lần đọc qua hằng số khoá hay hàm phụ như `positiveConfig`, kiểm tay): không lần đọc nào thiếu giá trị mặc định (không có `get` nào ném `NotFoundException`). Nên KHÔNG khoá nào "thiếu thì hỏng". Nạp để (a) admin thấy ở tab Cấu hình (tab chỉ liệt kê dòng có trong DB; `setConfig` cũng từ chối khoá chưa có dòng và chưa có luật ghi, `admin.service.ts:1253`), (b) giá trị đang chạy hiện ra thay vì ẩn trong mã.

Số khoá nạp mặc định theo nhóm (118; DB chỉ migrate đã có sẵn 36, nạp mới 82): loyalty 11, voucher 6, affiliate 5, cashback 4, wallet 2, referral 3, support 3, community 12 (7 từ seed + 5 `rep_*`), game 18, subscribe 2, wishlist 2, flashsale 4, orders 2, merchant 7, ops 6, storefront 1, dealer 2, seasonpass 1, groupbuy 4, shipping 2, returns 1, remarketing 3, reorder 2, attendance 11, retention 4.

Trừ 6 khoá của nhóm giá trị kinh doanh (mục 3.2), `payment.*` và hai khoá phí ship (không nạp), mọi khoá còn lại có mặc định trong mã bằng đúng giá trị seed: 75 khoá đối chiếu tự động với chữ trong mã; các khoá đọc qua hằng số hoặc hàm phụ (`DEFAULT_POINT_EXPIRE_MONTHS`, `DEFAULT_CHECKIN_POINTS`, `DEFAULT_PIT_WITHHOLD_*`, `POS_DEFAULTS`, `CART_ABANDON_DEFAULT_*`, `FLASH_MAX_*`, `DEFAULT_MERCHANT_*`, `ops-alerts`, `RETENTION_POLICY`, v.v.) đối chiếu tay. Nạp chúng là dòng "chỉ để thấy", không đổi hành vi. Còn lại 6 khoá khác mặc định nên nằm riêng ở nhóm có cờ: không có chúng thì mã chạy theo mặc định, nạp vào là đổi hành vi.

Khoá mã đọc nhưng `seed.ts` không có (không nằm trong DB sau migrate, admin không thấy):

| Khoá | Xử lý |
|---|---|
| `community.rep_post`, `rep_answer`, `rep_best`, `daily_rep_cap`, `rep_thresholds` | NẠP (D4-021), đúng mặc định trong `community-feed.service.ts`; spec đối chiếu chữ mã nguồn nên đổi mặc định trong mã mà quên đổi ở đây sẽ đỏ. Đã thêm luật ghi trong `SystemConfigService` (điểm 0 đến 100 mỗi lần, trần ngày 0 đến 1.000, `rep_thresholds` đúng 4 mốc tăng dần bắt đầu từ 0) |
| `voucher.second_order_amount`, `_min_order`, `_delay_days`, `_min_remaining_days` | KHÔNG nạp. Chúng là tiền (mã giảm giá 30.000đ phát cho mọi khách sau đơn đầu) mà `RANGES` của `SystemConfigService` chưa có luật biên, khác `voucher.welcome_*`. Hiện chúng sửa được trên tab thì một lần gõ nhầm số 0 phát mã triệu đồng. Cần thêm luật biên trước (`system-config.service.ts`, gói tiền), rồi mới nạp. `99-release-readiness` nói chỉnh được "trong SystemConfig" nhưng chưa đúng với DB mới |
| `dealer.quarterly_bonus_tiers`, `storefront.max_combo_pct`, `review.invite_delay_hours`, `review.invite_max_age_days`, `loyalty.earn_points_on_xu` | Không nạp, chưa ai yêu cầu; cùng vấn đề thiếu luật biên nếu nạp |
| `game.wilt_days`, `death_days`, `harvest_coupon_amount`, `gift_water_amount` | Không nạp: file do phiên đổi-rác đang sửa (`modules/game`), và dòng nạp sẽ ghim mặc định hiện tại |
| `attendance.office_lat/lng` | Cố ý không seed (admin nhập toạ độ thật) |

### 3.2 Bảng giá trị kinh doanh để chủ dự án duyệt một lần (chỉ nạp với `--with-business-defaults`)

Quy tắc: chủ dự án chưa quyết thì giữ hành vi như bảng trống. Nhóm này là các con số tiền, điểm, xác suất lấy từ `seed.ts` (bản đang chạy ở môi trường thử). Duyệt = đọc bảng dưới, báo "duyệt" hoặc số cần sửa; rồi chạy một lần `pnpm run prisma:seed:reference --with-business-defaults` (runbook bước 7b). Muốn đổi số TRƯỚC khi nạp thì sửa hằng số trong `seed.ts` (cần commit); nạp rồi sửa thì khoá cấu hình và nhiệm vụ sửa ở Quản trị, còn hạng và bậc đại lý chỉ sửa bằng SQL (chưa có màn).

A. Sáu khoá cấu hình (giá trị khác mặc định trong mã):

| Khoá | Giá trị nạp | Mặc định mã nếu không nạp | Ảnh hưởng |
|---|---|---|---|
| `game.spin_prizes` | 8 giải, tổng trọng số 100: 5 điểm Xanh (30), 10 điểm (22), 20 điểm (12), voucher 20k (10), 30 💧 (15), voucher 50k (4), 50 điểm (5), "Chúc may mắn" (2). Một lượt mua giá 10 điểm Xanh (`game.spin_buy_cost_points`) | `[]`: "Vòng quay chưa cấu hình" | Trung bình mỗi lượt trả 8,6 điểm (8.600đ) cộng 4.000đ mệnh giá voucher cộng 4,5 💧. Muốn đóng sau khi nạp: đặt khoá này = `[]` (luật ghi cho phép) |
| `referral.milestones_points` | mốc 3 / 5 / 10 bạn giới thiệu thành công thưởng 20 / 40 / 100 điểm Xanh | `[]`: không thưởng mốc | Tổng tối đa 160 điểm (160.000đ) cho một người giới thiệu đủ 10 bạn |
| `subscribe.discount_tiers` | 1 gói định kỳ đang chạy 12%, 3 gói 14%, 5 gói 15% | một bậc 12% (bằng `subscribe.discount_pct`) | Giảm giá đơn định kỳ cho khách có nhiều gói |
| `shipping.tier_freeship_overrides` | Lộc Biếc freeship từ đơn 99.000đ; Đại Thụ và Cổ Thụ freeship mọi đơn | `{}`: không hạng nào freeship sớm | Đi cùng 4 hạng thành viên bên dưới: lời hứa "Freeship" trên thẻ hạng chỉ thực hiện khi có khoá này |
| `game.streak_7_bonus` | `{ seeds: 10, free_spins: 1 }` | `{ seeds: 20 }` | Thưởng 💧 mỗi chuỗi điểm danh 7 ngày. Seed ít hơn mặc định mã (10 so với 20); `free_spins` không có code nào đọc |
| `seasonpass.tiers` | 5 bậc, XP 30/70/120/200/300: miễn phí 20/30/40/60/80 💧; trả phí 5/8/12/20/30 điểm Xanh | `[]` | Season Pass đang ẩn trong miniapp (`SEASON_PASS_ENABLED=false`), nạp chưa hiện gì |

B. Bốn hạng thành viên (`membership_tiers`):

| Hạng | Điểm tối thiểu (12 tháng) | hoặc chi tiêu 12 tháng | Nhân điểm | Giảm mọi đơn | Voucher sinh nhật | Quyền lợi ghi trên thẻ |
|---|---|---|---|---|---|---|
| Mầm Xanh (`MAM_XANH`) | 0 | không | x1 | 0 | không | Tích Điểm Xanh x1 |
| Lộc Biếc (`LOC_BIEC`) | 500 | 5.000.000đ | x1,2 | 0 | 50.000đ | x1,2; freeship đơn từ 99k; voucher sinh nhật 50k |
| Đại Thụ (`DAI_THU`) | 2.000 | 20.000.000đ | x1,5 | 0 | 150.000đ | x1,5; freeship toàn shop; voucher sinh nhật 150k |
| Cổ Thụ (`CO_THU`) | 5.000 | 50.000.000đ | x2 | 5% | 300.000đ | x2; freeship và giảm 5% mọi đơn; voucher sinh nhật 300k |

C. Bốn bậc đại lý (`dealer_tiers`):

| Bậc | Doanh số đơn tối thiểu | Chiết khấu mặc định | Hạn mức công nợ | Thanh toán |
|---|---|---|---|---|
| Đại lý Cấp 1 (`DEALER_1`) | 10.000.000đ | 20% | 0 | PREPAID |
| Đại lý Cấp 2 (`DEALER_2`) | 30.000.000đ | 30% | 20.000.000đ | NET 15 |
| Đại lý Cấp 3 (`DEALER_3`) | 80.000.000đ | 38% | 50.000.000đ | NET 30 |
| Đại lý VIP (`DEALER_VIP`) | 200.000.000đ | 45% | 150.000.000đ | NET 30 |

D. Bốn nhiệm vụ (`missions`), đều làm một lần:

| Mã | Tên | Điều kiện | Thưởng |
|---|---|---|---|
| `FIRST_ORDER` | Đơn hàng đầu tiên | nhận thành công 1 đơn | 20 điểm Xanh |
| `CHECKIN_7` | Chăm chỉ 7 ngày | điểm danh Vườn Xanh 7 ngày liên tiếp | 30 điểm Xanh |
| `REVIEW_3` | Nhà phê bình | viết 3 đánh giá có ảnh | 15 điểm Xanh |
| `INVITE_3` | Lan tỏa sống xanh | mời 3 bạn mua hàng thành công | 50 điểm Xanh |

Hệ quả nếu KHÔNG nạp nhóm này (hành vi mặc định): không có hạng thành viên; không duyệt được hồ sơ đại lý hay cấp vai trò DEALER (cần có ít nhất một bậc); vòng quay báo "chưa cấu hình"; không thưởng mốc giới thiệu; Vườn Xanh không có nhiệm vụ; chiết khấu Subscribe & Save chỉ một bậc 12%.

## 4. Chưa làm, cố ý để lại

- `deploy.sh` chưa gọi seed-reference. Khuyên: gọi (không cờ) sau `migrate deploy` ở mọi lần deploy (an toàn, idempotent), vì gốc rễ lỗi là mẫu thông báo và khoá cấu hình thêm vào `seed.ts` mà migration không theo. Lưu ý thứ tự: `deploy.sh` migrate rồi bật API ngay trong cùng một lần chạy (`tools/deploy/deploy.sh:96,102`), nên không có chỗ xen vào giữa; gọi ngay sau cuối script. Việc đổi script deploy là quyết định của điều phối viên/chủ dự án.
- Chưa có check trong `go-live:check` cho dữ liệu tham chiếu (vd cảnh báo khi `community_categories`, `game_quizzes` rỗng, hay khi hạng/bậc đại lý rỗng mà đã mở đăng ký đại lý). Gợi ý gói sau, `src/config/go-live/db-checks.ts`.
- Chưa có màn admin sửa hạng thành viên, bậc đại lý, mùa, chủ đề cộng đồng, quiz, loài cây. Chỉ nhiệm vụ (`admin-engagement.service.ts:39`) và mẫu thông báo (`notification-templates-admin.service.ts:107`) có đường sửa. Chỉnh bằng SQL, lần chạy sau không ghi đè.
- `voucher.second_order_*` vẫn chưa có luật biên (gói tiền) nên chưa nạp.
- Dòng bị xoá tay bằng SQL sẽ được tạo lại ở lần chạy sau (create-only không phân biệt "chưa từng tạo" và "đã xoá"). Muốn ẩn một chủ đề hay mẫu thì tắt (`isActive`), đừng xoá.
- Dòng nạp ghim giá trị mặc định hôm nay: đổi mặc định trong mã về sau không tới DB đã có dòng (giống mọi khoá `createOnly` sẵn có).
- Khoá cấu hình nạp sau khi API đã chạy có hiệu lực trong tối đa 60 giây (cache của `SystemConfigService`), không cần khởi động lại; bảng hạng, nhiệm vụ, mẫu tin đọc thẳng DB.

## 5. Câu hỏi cho chủ dự án (kèm mặc định đã dùng)

Mặc định chung: KHÔNG nạp nhóm giá trị kinh doanh (chạy không cờ). Phần tham chiếu an toàn (mẫu thông báo, chủ đề, quiz, loài cây, mốc quỹ, 118 khoá cấu hình bằng mặc định mã) nạp đủ.

1. Duyệt bảng ở mục 3.2? Câu này chặn: chưa duyệt thì chưa có hạng thành viên và CHƯA DUYỆT ĐƯỢC ĐẠI LÝ/CTV (cần ít nhất một bậc đại lý). Khuyên: duyệt trước ngày mở đăng ký đại lý; duyệt xong chạy có cờ một lần. Mặc định: không nạp.
2. Thang hạng thành viên (bảng B): giữ ngưỡng hiện tại không? D2-09 gợi ý hạ Lộc Biếc xuống khoảng 1,5 triệu. Cổ Thụ giảm 5% mọi đơn và voucher sinh nhật 50k/150k/300k có phải đúng ý? Mặc định: không nạp.
3. Bảng giải vòng quay (8 giải; trả trung bình 8,6 điểm cho lượt giá 10 điểm, chưa tính voucher và 💧): mở ngay hay đóng tới khi duyệt? Mặc định: không nạp (vòng quay "chưa cấu hình"). Nếu duyệt nạp mà vẫn muốn đóng: đặt `game.spin_prizes` = `[]`.
4. Bốn bậc đại lý (bảng C: chiết khấu 20/30/38/45%, công nợ 0/20/50/150 triệu, PREPAID/NET 15/NET 30/NET 30): giữ không? Mặc định: không nạp.
5. Thưởng mốc giới thiệu (3/5/10 bạn thưởng 20/40/100 điểm), bậc Subscribe & Save 12/14/15%, thưởng chuỗi 7 ngày (seed 10 💧, mã mặc định 20 💧): dùng giá trị nào? Mặc định: không nạp, mã chạy theo mặc định của nó (không thưởng mốc, một bậc 12%, 20 💧).
6. Bốn nhiệm vụ (20/30/15/50 điểm Xanh): giữ không? Mặc định: không nạp.
7. Mốc quỹ trồng cây (100.000 giọt tương đương 200 cây, vùng "Cộng đồng Tubu", không nêu địa điểm): đây là con số công khai trên màn Vườn Xanh và là phần nạp mặc định. Giữ không? Mặc định: nạp, vì không có tiền; chủ dự án đổi được sau bằng SQL.
8. Mùa: chưa có mùa nào còn hạn (mùa hè 2026 đã hết), Vườn Xanh không hiện banner mùa. Cần mùa mới (tên, vùng, ngày) và chưa có màn admin tạo mùa. Mặc định: không có mùa.
9. Hotline và email CSKH đang hiển thị (`0899 149 229`, `tubutree@gmail.com`, bằng mặc định trong mã): đúng không? Mặc định: nạp như vậy; sai thì sửa ở tab Cấu hình.
10. Sáu quiz thương hiệu cũ (q1–q6): bỏ hay xác nhận đáp án (vd Pơ Lang ở Đắk Lắk?) rồi nạp? Mặc định: không nạp.
11. Phí ship (`shipping.free_threshold` 200.000đ, `shipping.flat_fee_below_threshold` 19.000đ): mã đang chạy hai số này nhưng DB không có dòng; chủ shop xác nhận hai số ở tab Cấu hình trước go-live (check `db.shipping_rates` sẽ WARN tới khi có dòng). Mặc định: không nạp.

## 6. Phát hiện ngoài phạm vi

- D4-001 nói thiếu 6 mẫu thông báo; thực tế DB chỉ migrate thiếu 28, trong đó có cả vòng đời đơn hàng (`ORDER_DELIVERED`, `ORDER_CANCELLED`...) và mã giảm giá chào mừng. Đã nạp hết.
- Migration `20260616000000_demo_catalog_multibrand` chèn 44 sản phẩm demo (ảnh `picsum.photos`), 48 biến thể, 7 danh mục, 3 mã giảm giá công khai vào MỌI DB mới, kể cả prod. Mã `seed.ts` còn ghi chú "KHÔNG dùng ảnh picsum". Cần quy trình ẩn/xoá trước ngày mở bán (ngoài gói này).
- Các migration PD-1/PC-8 chỉ `UPDATE` quyền lợi và mức voucher sinh nhật của hạng đã có: trên DB mới (bảng hạng trống) chúng không làm gì, nên hạng nạp bằng cờ `--with-business-defaults` lấy từ hằng số `seed.ts` (đã mang chữ mới).
- Hai mẫu ZNS (`ORDER_CONFIRMED`, `ORDER_SHIPPING`) không có `zaloTemplateId`; sau khi nạp, `go-live:check` mục `db.zns_templates` sẽ WARN đúng như dự kiến, khách nhận bản trong app.
