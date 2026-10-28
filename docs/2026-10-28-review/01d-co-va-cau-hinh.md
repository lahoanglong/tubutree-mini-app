# Kiểm kê cờ tính năng và system_configs (Phần B)

Commit: 77bf4676 (nhánh main, chỉ đọc)

Cách đọc: `SystemConfigService.get(key, fallback)` (apps/api/src/modules/system-config/system-config.service.ts:56-68) trả giá trị DB; khi không có dòng thì trả `fallback` truyền ở chỗ gọi (cache cả fallback). Cột "mặc định trong mã" là fallback ở chỗ gọi, không phải bảng hợp nhất.
seed-reference (apps/api/prisma/seed-reference.ts:76-88): không cờ thì nạp `REFERENCE_CONFIG_PREFIXES` (reference-data/config-selection.ts:12-46) và BỎ QUA nhóm `BUSINESS_CONFIG_KEYS` (config-selection.ts:73-80); có `--with-business-defaults` thì nạp thêm nhóm đó.
`seed.ts` là nguồn của `SYSTEM_CONFIGS`/`configSeedUpsertArgs` (seed.ts:947-950).

## Cờ bật/tắt (boolean) và cờ có giá trị

| Khoá | Loại | Seed (seed:reference, không cờ / có --with-business-defaults) | Khi không có dòng DB (mã) | Chức năng bị ảnh hưởng | File:dòng |
|---|---|---|---|---|---|
| loyalty.pos_credit_enabled | cờ | false (seed.ts:34) / false | false (loyalty.service.ts:1332, 1422) | Tích Điểm Xanh tại quầy (POS): /loyalty/staff/scan-member, /loyalty/staff/pos-credit; /me/loyalty/member-card | seed.ts:34 |
| chat.enabled | cờ | false (seed.ts:320) / false | false (support-chat.service.ts:71, 124) | Chat CSKH qua Zalo: /me/support-chat, bridge | seed.ts:320; support-chat.config.ts:1 |
| waste.enabled | cờ | false (seed.ts:325); prefix `waste` KHÔNG nạp (config-selection.ts:45-47) | false (waste-config.service.ts:115; waste-public-config.ts:14) | Toàn bộ gói Đổi rác lấy quà | seed.ts:325; waste-config.keys.ts:18 |
| waste.lane_dropoff_enabled | cờ | true (seed.ts:326) / true; không nạp (prefix waste) | chưa tra | Làn gửi rác tại điểm | seed.ts:326 |
| waste.lane_mailin_enabled | cờ | true (seed.ts:327) / true; không nạp | chưa tra | Làn gửi qua bưu điện | seed.ts:327 |
| waste.lane_pickup_enabled | cờ | false (seed.ts:328) / false; không nạp | chưa tra | Làn lấy rác tận nơi | seed.ts:328 |
| loyalty.marketplace_claim_enabled | cờ | false (config-selection.ts:121) / false | false (public-config.ts:95) | Tích điểm đơn sàn ngoài app (khách nhập mã đơn): /me/external-points/claims | external-claim.config.ts:5, :52 |
| loyalty.chat_order_points_enabled | cờ | false (config-selection.ts:129) / false | false (external-chat.config.ts:38, :59) | Tích điểm đơn chat/điện thoại (claim PHONE) | external-chat.config.ts:6, :38 |
| pancake.external_capture_enabled | cờ | true (config-selection.ts:119) / true | true (external-order.config.ts:5; pancake.processor.ts:339) | Lưu đơn Pancake không đặt trong app vào tab "Đơn ngoài app" (chưa cộng điểm) | external-order.config.ts:2 |
| pancake.external_lookup_enabled | cờ | false (config-selection.ts:137) / false | false (external-claim-lookup.service.ts:36) | Tra cứu đơn sàn theo mã khi khách nhập | external-claim.config.ts:13 |
| pancake.external_poll_enabled | cờ | false (config-selection.ts:138) / false | false (external-claim-poll.service.ts:36) | Thăm dò định kỳ đơn sàn qua Pancake | external-claim.config.ts:14 |
| pancake.total_mismatch_check | cờ | true (config-selection.ts:117) / true | chưa tra (fallback ở chỗ gọi) | So tổng tiền Pancake với đơn Tubu, lệch thì vào "Cần xử lý Pancake" | config-selection.ts:117 |
| attendance.enforce_ip | cờ | true (seed.ts:309) / true | chưa tra | Chấm công bắt buộc IP | seed.ts:309 |
| community.public_preview | cờ | true (config-selection.ts:110) / true | chưa tra | Khách chưa đăng nhập xem trước bài cộng đồng | config-selection.ts:110 |
| home.new_customer_layout | cờ | true (config-selection.ts:111) / true | chưa tra | Chỉ đổi thứ tự khối trang chủ cho khách mới | config-selection.ts:111 |
| storefront.require_approval | cờ | true (config-selection.ts:115) / true | chưa tra | Gian hàng CTV phải được duyệt lần đầu | config-selection.ts:115 |
| storefront.subdomain_enabled | cờ | false (config-selection.ts:116) / false | chưa tra | Hiện gian hàng qua <tên>.tubutree.com | config-selection.ts:116 |
| dealer.block_credit_when_overdue | cờ | true (seed.ts:170) / true | chưa tra | Chặn cấp tín dụng đại lý khi quá hạn | seed.ts:170 |
| affiliate.commission_eligible_roles | danh sách | ['AFFILIATE','DEALER'] (config-selection.ts:114) | chưa tra (affiliate/commission-eligibility.ts) | Vai trò được hưởng hoa hồng CTV | config-selection.ts:114 |

Cờ khác đọc từ biến môi trường, không phải SystemConfig: SEASON_PASS_ENABLED=false (theo config-selection.ts:76 ghi chú) — chưa tra file đọc.

## Nhóm chỉ nạp với --with-business-defaults (config-selection.ts:73-80)

| Khoá | Mã mặc định | Seed khi có cờ | File:dòng |
|---|---|---|---|
| game.spin_prizes | [] (tắt vòng quay) | 8 giải, có voucher và tới 50.000 điểm | game.service.ts:128 (fallback []) |
| game.streak_7_bonus | { seeds: 20 } | { seeds: 10, free_spins: 1 } | game-economy.service.ts:120; seed.ts:176 |
| referral.milestones_points | [] | 20.000/40.000/100.000 điểm ở mốc 3/5/10 bạn | config-selection.ts:75 |
| subscribe.discount_tiers | một bậc = subscribe.discount_pct (12%) | thêm 14% và 15% | config-selection.ts:77 |
| shipping.tier_freeship_overrides | {} | freeship từ 99k cho một hạng | config-selection.ts:78 |
| seasonpass.tiers | [] | 5 bậc (Season Pass đang ẩn) | config-selection.ts:81 |
Nhóm này cũng gồm hạng thành viên, bậc đại lý và nhiệm vụ (seed-reference.ts:80-84). Không cờ thì `missions` (nhiệm vụ) và `membership_tiers` không được nạp (seed-reference.ts:86-90).

## Game / vườn cây (nước, tưới, nhiệm vụ)

Không có khoá cấu hình cho nước khởi đầu. Số dư nước `totalSeeds` mặc định 0 (apps/api/prisma/schema.prisma:2027). Chưa thấy cấp nước lúc tạo tài khoản trong apps/api/src/modules/game.

| Khoá | Seed (seed.ts) | Mã fallback | Chức năng | Nơi tính (file:dòng) |
|---|---|---|---|---|
| game.daily_login_seeds | 10 (seed.ts:180) | 10 | Nước mỗi lần check-in (nước hằng ngày) | game-economy.service.ts:116 |
| game.dew_seeds | 15 (seed.ts:186) | 15 | Giọt sương sáng mỗi ngày | game-economy.service.ts:161 |
| game.streak_7_bonus | { seeds: 10, free_spins: 1 } (seed.ts:176) | { seeds: 20 } | Thưởng chuỗi 7 ngày (chỉ nạp khi có cờ) | game-economy.service.ts:120 |
| game.tank_capacity | 500 (seed.ts:181) | 500 | Sức chứa bình nước | game.service.ts:80, 141; game-economy.service.ts:46, 162; game-gift.service.ts:103; game-quiz.service.ts:99 |
| game.tree_default_target | 600 (seed.ts:182) | 600 | Nước cần để thu hoạch cây mặc định | game-profile.ts:18; game.service.ts:142; game-quiz.service.ts:101 |
| game.plot_target | 600 (seed.ts:193) | 600 | Mục tiêu nước mỗi lô | game-garden.service.ts:110 |
| game.max_plots | 5 (seed.ts:191) | 5 | Số lô đất | game-garden.service.ts:57, 108 |
| game.plot_unlock_seed_base | 100 (seed.ts:192) | 100 | Giá mở lô = số này × số thứ tự lô | game-garden.service.ts:58, 109 |
| game.spin_buy_cost_points | 10000 (seed.ts:177) | 10000 | Điểm mua lượt quay | game.service.ts:81, 123 |
| game.spin_buy_daily_limit | 5 (seed.ts:178) | 5 | Số lượt mua mỗi ngày (0 = khoá) | game.service.ts:124 |
| game.quiz_daily_count | 5 (seed.ts:179) | 5 | Số câu quiz mỗi ngày | game-quiz.service.ts:35, 74 |
| game.harvest_coupon_daily_cap | 3 (seed.ts:183) | 3 | Số coupon thu hoạch mỗi ngày | game.service.ts:261; game-garden.service.ts:161 |
| game.harvest_coupon_amount | không seed | 30000 | Giá trị coupon thu hoạch | game-garden.service.ts:156; game.service.ts:253 |
| game.harvest_coupon_min_order | 199000 (seed.ts:185) | HARVEST_COUPON_MIN_ORDER_DEFAULT | Đơn tối thiểu để dùng coupon thu hoạch | game.constants.ts:20 |
| game.spin_voucher_min_order_multiplier | 6 (seed.ts:184) | SPIN_VOUCHER_MIN_ORDER_MULTIPLIER_DEFAULT | Hệ số đơn tối thiểu của voucher quay | game.constants.ts:34 |
| game.streak_freeze_cost | 80 (seed.ts:187) | 80 | Vé giữ lửa | game.service.ts:78; game-economy.service.ts:239 |
| game.streak_repair_cost | 150 (seed.ts:188) | 150 | Hồi sinh chuỗi | game.service.ts:72; game-economy.service.ts:189 |
| game.streak_repair_window_hours | 48 (seed.ts:189) | 48 | Số giờ được hồi sinh chuỗi | game.service.ts:73; game-economy.service.ts:187 |
| game.streak_repair_cooldown_days | 30 (seed.ts:190) | 30 | Ngày chờ giữa hai lần hồi sinh | game.service.ts:74; game-economy.service.ts:188 |
| game.tree_points_price | 50000 (seed.ts:116) | 50000 | Điểm Xanh góp quỹ mua cây | game.service.ts:79, 441; loyalty.service.ts:858 |
| Nhiệm vụ (missions) | không trong seed.ts; nạp qua --with-business-defaults | — | Danh sách nhiệm vụ admin: /admin/engagement/missions | seed-reference.ts:84, 88 |

## Tích điểm đơn sàn (external points)

Khoá: loyalty.marketplace_claim_enabled (cờ tắt), loyalty.marketplace_claim_daily_attempts, _daily_max, _monthly_points_cap, _max_age_days, _review_above_vnd (external-claim.config.ts:5-10); loyalty.external_pending_days = 14 (config-selection.ts:128; external-claim.config.ts:11); pancake.external_capture_enabled (true), pancake.external_lookup_enabled (false), pancake.external_poll_enabled (false). Đơn chat: loyalty.chat_order_points_enabled (false), loyalty.chat_order_monthly_points_cap, chat_order_review_above_vnd, chat_order_require_carrier, chat_unclaimed_hold_days, chat_phone_verified_max_days, chat_order_creator_monthly_points (config-selection.ts:129-135).
Excluded khỏi seed-reference: loyalty.external_since, loyalty.chat_order_earn_pct (config-selection.ts:52-60 phần EXCLUDED_CONFIG_KEYS).

Endpoint:
- POST /me/external-points/claims, GET /me/external-points/claims: apps/api/src/modules/external-points/external-claims.controller.ts:25, :31 (class :21)
- Admin /admin/external-claims: GET :56, GET attempts :63, POST attempts/:id/attach :69, attempts/:id/reject :74, GET :id :79, POST :id/approve :85, :id/void :90, :id/void-and-reopen :95, :id/keep-points :100, :id/reverse :106 (external-claims-admin.controller.ts; class @Roles('ADMIN') :50)
- Admin /admin/external-orders (ADMIN, external-orders-admin.controller.ts:26)
- Webhook Pancake: POST /webhooks/pancake: pancake-webhook.controller.ts:37, :51
- Xử lý capture đơn sàn: apps/api/src/modules/integrations/pancake/pancake.processor.ts:339

## Chưa rõ / không kiểm

- Mặc định trong mã của các cờ đánh dấu "chưa tra" (cột "Khi không có dòng DB").
- Khoá khác trong SYSTEM_CONFIGS (seed.ts hơn 190 dòng) chưa liệt kê hết; bảng này chỉ gồm cờ bật/tắt và nhóm game/external theo yêu cầu.
- Cấp nước khởi đầu: chưa thấy khoá cấu hình; chỉ có default DB 0.
