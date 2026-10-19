# Kế hoạch points-1d: Điểm Xanh đổi sang 1 điểm = 1đ

Quyết định của chủ dự án: `03-cau-hoi-sang.md`, mục "Điểm Xanh kiểu mới" (B6, B6a–B6e) và Nhóm C (Lộc Biếc 1,5 triệu/12 tháng). Thiết kế do agent Plan đọc mã; số dòng là lúc thiết kế, kiểm lại trước khi sửa.

## Quyết định thiết kế

- Khoá mới `loyalty.earn_pct` (phần trăm, 2 = 2%), RANGES {min 0.1, max 20}, là số lẻ được (FRACTION_KEYS). `loyalty.vnd_per_point` vào `dead-config-keys.ts` và bỏ khỏi RANGES. `loyalty.vnd_per_point_redeem` khoá cứng 1 (RANGES min = max = 1), seed createOnly.
- Hạng xét theo chi tiêu 12 tháng. Đường "đủ điểm" chỉ còn cho hạng không có minSpending (Mầm Xanh). `minPoints` = minSpending / 50, chỉ để bản app cũ hiển thị. Lý do: điểm đã gồm hệ số hạng (Lộc Biếc ×1,2 sẽ lên Đại Thụ ở ~16,7 triệu thay vì 20 triệu) và ngưỡng hạng không được dính vào `earn_pct`.
- Một migration `20261018210000_points_1d` (sau `20261018200000_launch_owner_config`), trọn trong một khối `DO $$`, nhân 1.000 mọi cột điểm. Dấu "đã chạy": dòng `loyalty.vnd_per_point_redeem = 1`.
- Hook đơn sàn: file mới `apps/api/src/modules/loyalty/earn-rates.ts` export `EARN_PCT_KEY`, `DEFAULT_EARN_PCT = 2`, `MARKETPLACE_EARN_PCT_KEY = 'loyalty.marketplace_earn_pct'`, `DEFAULT_MARKETPLACE_EARN_PCT = 1`. Chưa thêm RANGES/seed cho khoá đơn sàn (gói đơn sàn thêm khi đọc khoá thật).
- Commit gom theo yêu cầu phiên đổi rác (họ cherry-pick C1 và C2 làm nền): C1 số + khoá cấu hình (API, seed, hai bản points-earn); C2 migration + race spec + guard file hoàn tác PD-3; C3 hạng theo chi tiêu; C4 chữ hiển thị miniapp/web; C5 (tuỳ chọn) nhóm nghìn cho số điểm trong tin nhắn.
- Ràng buộc với phiên đổi rác: KHÔNG xoá DEFAULT_REWARD_CATALOG, KHÔNG đổi cấu trúc `redeemReward`; chỉ đổi số tại chỗ.

## 1. Khoá SystemConfig (RANGES/JSON_RULES ở `system-config.service.ts`, viết tắt scs)

| Khoá | Chỗ đang nằm | Giá trị mới |
|---|---|---|
| `loyalty.vnd_per_point` | seed.ts:23 (10000); RANGES scs:140; mặc định pricing.service.ts:93, loyalty.service.ts:602 và :1221, public-config.ts:80 | Bỏ, thay bằng `loyalty.earn_pct` = 2 |
| `loyalty.vnd_per_point_redeem` | seed.ts:24; RANGES scs:147-149 (min = max = 1000); mặc định pricing.service.ts:110, :136, loyalty.service.ts:603, public-config.ts:81 | 1, RANGES {1,1}, seed createOnly |
| `loyalty.checkin_points` | seed:30 [1,1,1,1,1,1,2]; DEFAULT_CHECKIN_POINTS loyalty.service.ts:1417; trần loyalty.service.ts:1419 và admin-config-rules.ts:26 (100); web admin-config-forms.ts:19, :90-98; loyalty-config-card.tsx:156 | [1000 ×6, 2000]; trần 100_000 |
| `loyalty.pos_staff_daily_points_cap`, `loyalty.pos_member_daily_points_cap` | seed:33-34 (3000/1000); POS_DEFAULTS loyalty.service.ts:1450-1457; POS_POINTS_CAP_MAX admin-config-rules.ts:30 (10_000_000); web admin-config-forms.ts:21-23, loyalty-config-card.tsx:39, :41 | 3_000_000 / 1_000_000; trần ghi 1_000_000_000 (không ×1000 vì vượt INT4) |
| `referral.referrer_reward_points` | seed:76 (5); RANGES scs:122 (max 100); reward-points.service.ts:223 | 5_000; max 100_000 |
| `referral.milestones_points` | seed:86-88 (20/40/100); REFERRAL_MILESTONE_POINTS_MAX scs:230 (500) | ×1000; max 500_000 |
| `community.post_reward_points` / `answer_reward_points` / `best_answer_reward_points` | seed:95, :97, :99 (1/0/1); RANGES scs:123-125 (max 20); community-reward.service.ts:84, :96, :117 | 1000 / 0 / 1000; max 20_000 |
| `game.tree_points_price` | seed:105 (50); RANGES scs:132 (max 500); game.service.ts:73, :435 | 50_000; max 500_000 |
| `game.spin_buy_cost_points` | seed:158 (10); RANGES scs:133 (max 1000); game.service.ts:75, :117 | 10_000; max 1_000_000 |
| `game.spin_prizes` | seed:204-206, :210 (POINTS 5/10/20/50, tên "5 điểm Xanh"); SPIN_POINTS_PRIZE_MAX spin-prizes.ts:14 (100) | ×1000, đổi tên giải ("5.000 điểm Xanh"); max 100_000 |
| `seasonpass.tiers` | seed:179-183 (POINTS 5/8/12/20/30); SEASONPASS_POINTS_MAX scs:228 (100) | ×1000; max 100_000 |

Đi kèm: note "(1 điểm = 1.000đ)" ở scs:119-125 và :132; lý do khoá kinh doanh ở `prisma/reference-data/config-selection.ts:69-70`; APPROVED_LOADED_KEYS ở `reference-config-selection.spec.ts`; `config-numeric-ranges.spec.ts` FRACTION_KEYS thêm `loyalty.earn_pct`.

Không đổi: `pos_max_order_total` (đồng), `max_redeem_pct`, `voucher.*`, các khoá xu đã chết (`coins.*`, `community.*_reward`, `game.tree_xu_price`).

## 2. Hằng số viết cứng

- `reward-points.service.ts:32` POINTS_GRANT_HARD_MAX 2000 → 2_000_000.
- `feed/community-limits.ts:2` EVENT_REWARD_MAX_POINTS 1000 → 1_000_000 (dùng ở community-feed.controller.ts:62 và public-config.ts:123).
- `admin-engagement.controller.ts:12` MISSION_REWARD_POINTS_MAX 500 → 500_000; web engagement-tab.tsx:15 sửa cùng (file phiên khác, diff tối thiểu).
- `affiliate/ctv-milestones.ts:83/90/97/104` 50/200/600/2_000 → ×1000 (sửa cả comment :73).
- `storefront-quest.service.ts:31/39/47/55/63` 2/2/2/1/5 → ×1000.
- `reviews.service.ts:183` 15/10/5 → 15_000/10_000/5_000; chữ ở miniapp `reviews-section.tsx:548-551` và web `lib/reviews-client.ts:117-119`.
- DEFAULT_REWARD_CATALOG `loyalty.service.ts:1534/1544/1554/1564` 20/50/100/75 → 20_000/50_000/100_000/75_000 (chỉ đổi số).
- `orders/order-reversal.service.ts:59` XU_PER_POINT 1000 → 1. `wallet/referral-reward.ts:82-84` `legacyXuToPoints` → `Math.max(xu, 0)`.
- Seed MISSIONS `seed.ts:861-864` 20/30/15/50 → ×1000. TIERS seed.ts:319-343: mục 4.
- Không đổi: `GameQuiz.rewardPts` (không code nào đọc), 💧 của game/refill (không phải Điểm Xanh), `web/lib/loyalty-pos.ts`.

## 3. Công thức

- Hai bản `apps/api/src/modules/pricing/points-earn.ts` và `apps/miniapp/src/utils/points-earn.ts`:
  `pointsForGoods(goods, earnPct, mult = 1) = Math.floor(goods × round(earnPct×100) × round(mult×100) / 1_000_000)`. Toàn số nguyên; lớn nhất 2e9 × 2000 × 200 = 8e14 < 2^53. Kiểm: 199.000 ×1 → 3.980; ×1,2 → 4.776; ×1,5 → 5.970; ×2 → 7.960; 199.999 ×1 → 3.999; pct ≤ 0 hoặc hàng ≤ 0 → 0.
- `pricing.service.ts`: :93 đọc `loyalty.earn_pct`; :110 và :136 mặc định redeem 1; sửa comment :75-77. Phần trừ điểm giữ nguyên.
- POS `loyalty.service.ts:1229-1230` gọi `pointsForGoods`.
- `public-config.ts:80-81, :113-118` và `getOverview` (`loyalty.service.ts:601-612`) trả `earnPct`, giữ `vndPerPoint = 100/earnPct` cho app cũ.

## 4. Hạng theo chi tiêu

- `loyalty.service.ts:337`: `const byPoints = t.minSpending == null && earned12m >= t.minPoints`. Tách phần chi tiêu (:304-324) thành `spending12m()`. `getOverview` trả thêm `spent12m` và `nextTier.spendingToGo`; giữ `tierPoints`, `pointsToGo` (ghi chú: cho app cũ). Sửa comment :396-418.
- Seed + migration: LOC_BIEC minSpending 5.000.000 → 1.500.000; minPoints = minSpending / 50 (Đại Thụ 20tr → 400.000, Cổ Thụ 50tr → 1.000.000, Lộc Biếc → 30.000).
- Miniapp `account-api.ts:324-334` tiến độ theo chi tiêu; `pages/loyalty.tsx:301-303` (file phiên khác, diff tối thiểu): "Còn {moneyShort(spendingToGo)} mua hàng để lên hạng X".
- Grep `1500000` trước khi commit (có thể phiên khác đã đổi).

## 5. Migration `20261018210000_points_1d` (một khối DO $$, không đổi `updatedAt`, không đổi schema)

1. `LOCK TABLE` các bảng ở bước 4 + `system_configs` + `membership_tiers` `IN SHARE ROW EXCLUSIVE MODE`.
2. `r := system_configs['loyalty.vnd_per_point_redeem']`: r = 1 → `RAISE NOTICE` rồi `RETURN`; có dòng mà r ≠ 1000 → `RAISE EXCEPTION` (hướng dẫn đối soát tay rồi `migrate resolve --rolled-back`); không có dòng hoặc r = 1000 → chạy tiếp.
3. Chặn tràn: đếm dòng `abs(col::bigint)*1000 > 2147483647` ở mọi cột bước 4; có thì RAISE kèm bảng và cột.
4. Nhân 1.000 (`WHERE col <> 0`):

| Bảng | Cột ×1000 | Không đổi |
|---|---|---|
| `users` | `pointsBalance`, `pointsConvertedBalance` | |
| `points_transactions` | `delta` (`expiresAt` giữ nguyên) | |
| `orders` | `pointsEarned`, `pointsUsed`, `pointsUsedConverted` | `pointsDiscount`, `total` |
| `return_requests` | `pointsRefunded`, `convertedPointsRefunded`, `pointsReversed` | `refundAmount`, `commissionReversed` |
| `reviews` | `pointsEarned` | |
| `loyalty_check_ins` | `points` | |
| `pos_point_credits` | `points` | `orderTotal` |
| `community_events` | `rewardPoints` | `rewardXu` |
| `ctv_milestone_claims` | `rewardPoints` | `rewardXu`, `revenue` |
| `game_spins` | `prizeValue` khi `rewardType = 'POINTS'` | |
| `missions` | `rewardPoints` | |

5. `membership_tiers`: `minSpending` = 1.500.000 cho `id = 'LOC_BIEC'` chỉ khi còn 5.000.000; `minPoints = minSpending / 50` cho hạng có minSpending.
6. `system_configs`: chụp khoá liên quan vào bảng tạm `_pts1d_cfg` (`ON COMMIT DROP`); chỉ ×1000 khi giá trị còn trong trần cũ (checkin ≤ 100; referrer ≤ 100; community ≤ 20; tree ≤ 500; spin cost ≤ 1000; mỗi `bonusPoints` ≤ 500; giải POINTS ≤ 100, đổi tên giải khi tên khớp `^[0-9]+ điểm Xanh$` bằng `replace(to_char(v,'FM999,999,999'),',','.')`; seasonpass POINTS ≤ 100; POS caps `LEAST(v*1000, 1e9)`). Ghi `system_config_history` cho mỗi khoá đổi: id `'sch_pts1d_'||md5(key)`, `changedBy = 'migration:points_1d'`.
7. `INSERT 'loyalty.vnd_per_point_redeem' = 1 ON CONFLICT DO UPDATE` + một dòng history.

Không đổi: `xu_points_conversions` (sửa comment schema.prisma:1188), `coin_transactions`, `coinsBalance`, ví, `order_items.pointsDiscount`, chữ lịch sử (`game_spins.prizeName`, `notification_logs`, analytics), `system_config_history` cũ, `game_quizzes.rewardPts`.

Khác: file hoàn tác PD-3 `prisma/manual/pd3_xu_to_points_rollback.sql` thêm RAISE ở đầu khi redeem = 1. Runbook: sau points_1d không quay lại image cũ; thứ tự deploy dừng API → `migrate deploy` → `seed-reference` → khởi động API. Tuỳ chọn: thêm vào `HEAVY_MIGRATIONS` với `ordersLock: false`; `prisma/manual/points_1d_rollback.sql`.

## 6. Guard `points-unit-guard.spec.ts`

- POINTS_NUMBER_KEYS max mới (×1000).
- Câu ở :142 bỏ hằng 1_000_000; chỉ giữ kiểm tương đối theo max từng khoá (từ chối max+1 và max×1000, như :102-106). Phiên đổi rác sẽ thêm 4 khoá `waste.*` (max 1_000_000 / 1_000_000 / 2_000_000 / 20_000_000) sau khi nền có.
- OQ-11 (:153): khoá cứng 1, từ chối 1000 và 2.
- POINTS_GRANT_HARD_MAX = 2_000_000; CTV 50_000…2_000_000; QUESTS ×1000.
- Spec đi kèm: `spin-prizes.spec`, `system-config.service.spec`, `config-numeric-ranges.spec`, `dead-config-keys.spec`, `reference-config-selection.spec`.

## 7. File của phiên song song (diff tối thiểu)

`prisma/seed.ts` (số tại chỗ, redeem thêm createOnly, TIERS); `modules/game/game.service.ts` (4 số mặc định + spec); `components/admin/engagement-tab.tsx` (:15); `pages/loyalty.tsx` (:301-303); `modules/checkout/*` chỉ số trong spec nếu ghim tỉ giá. Không chạm `admin/page.tsx`, `app.tsx`, `checkout.tsx`, `game.tsx`, `modules/refill`.

## 8. Tràn số

INT4 max 2.147.483.647. Điểm mỗi đơn tối đa 2 tỷ × 4% = 80 triệu; `pointsUsed` ≤ giá trị hàng; số dư/khách ~2 triệu/năm; POS tối đa 40 triệu/hoá đơn. `points-reconcile.ts:71, :77` nên đổi `SUM(delta)::int` → `::bigint` (tuỳ chọn).

## 9. Thứ tự làm (TDD) và lệnh kiểm

- T1 (C1) guard đỏ rồi xanh (mục 6), rồi hằng số mục 1–2. `cd apps/api && npx jest src/modules/system-config prisma/reference-data` rồi `npx jest src/modules/wallet src/modules/affiliate src/modules/storefront src/modules/feed src/modules/admin src/modules/reviews src/modules/orders src/modules/game`.
- T2 (C1) công thức: spec trước (hai points-earn, pricing.service.spec, loyalty POS/rates, system-config.controller.spec public config). `npx jest src/modules/pricing src/modules/loyalty src/modules/subscriptions src/modules/system-config`; `cd apps/miniapp && npx vitest run src/utils/points-earn.spec.ts`.
- T3 (C1) seed + reference. `npx jest src/modules/system-config src/modules/loyalty/tier-perks-seed.spec.ts prisma/reference-data`; `npx tsc --noEmit -p tsconfig.json`. Commit C1.
- T4 (C2) race spec mới `test/integration-race/points-1d-migration.race-spec.ts` trước (mẫu `pd3-xu-migration.race-spec.ts`: schema nháp `LIKE public.* INCLUDING ALL`, `runSqlScriptIn`): mọi cột ×1000, cột không đổi giữ nguyên, `updatedAt` giữ, chạy lần hai không làm gì, redeem = 500 thì RAISE, số dư 3.000.000 điểm cũ thì RAISE tràn, khoá đã ở đơn vị mới không bị nhân lần nữa, có history, Lộc Biếc 1,5 triệu. Rồi migration + guard PD-3. `npx prisma migrate deploy`; race spec mới + `pd3-xu-migration.race-spec.ts`; drift `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`.
- T5 (C2) sửa ~10 race spec gắn đơn vị cũ: pd3-checkout-points, checkout-points-cap-split, checkout-reversal-lock-order, loyalty, partner-goods-rules, pf6-locked-window-outside-tx, r9-return-earned-points, buyer-totals-regression, reference-seed (:154, :167), pd3-xu-migration. Chạy từng file `--runInBand`; `npx tsx prisma/seed-reference.ts --with-business-defaults` trên `tubutree_it` rồi `reference-seed.race-spec`. Commit C2.
- T6 (C3) hạng theo chi tiêu: test recalcTier ở `loyalty.service.spec.ts` (~:707-812) trước; rồi `loyalty.race-spec`, miniapp account-api/loyalty spec. `npx jest src/modules/loyalty`; `cd apps/miniapp && npx vitest run src/services src/pages/loyalty-behavior.spec.tsx`. Commit C3.
- T7 (C4) chữ: miniapp `utils/loyalty-copy.ts` (earnRuleLine "Tích 2% tiền hàng thành Điểm Xanh (hạng ×1,2 = 2,4%)"), `pages/about-data.ts:33-43`, `components/home/new-customer-gift.tsx:39`, `i18n/vi.ts` newGift.points, `services/shop-api.ts:231-234` (kiểu `earnPct`), `services/account-api.ts`, comment `services/feed-api.ts:81, :100`; web `lib/admin-config-forms.ts`, `components/admin/loyalty-config-card.tsx`, `lib/reviews-client.ts`, `test-utils/fixtures/admin-config-rows.ts`; docs `docs/launch/so-tay-van-hanh/cskh.md:67`, `marketing.md:41`, `impl/refseed.md` mục 3.2. Thêm dòng "Mua trong Mini App được tích gấp đôi" ở trang sản phẩm và trang chủ/ví điểm khi đơn sàn bật (đọc cờ `loyalty.marketplace_claim_enabled` từ public config nếu có, mặc định ẩn). Vitest các spec liên quan + tsc + eslint hai app. Commit C4.
- T8 (C5, tuỳ chọn) nhóm nghìn vi-VN cho số điểm trong tin nhắn: `order-status.service.ts:385`, `loyalty-expiry.service.ts:506`, `loyalty.service.ts` :565, :835-839, :1065, :1258, :1268, `community-feed.service.ts:1481`.
- T9 báo cáo `docs/2026-10-18-launch-review/impl/points-1d.md`.

## 10. Rủi ro

- Phiên đổi rác: khoá `waste.*` max tới 20.000.000 > POINTS_GRANT_HARD_MAX 2.000.000; họ phải nâng trần hoặc đi đường khác. Migration của họ phải đứng sau points_1d.
- DB dev: bắt buộc `migrate deploy` trước rồi mới seed.
- `/config/public` cache tới 5 phút sau deploy.
- localStorage `tubu_last_tier_min` (loyalty.tsx:195) có thể hiện màn chúc mừng lên hạng một lần trên máy test cũ.
- Giá trị tích điểm thật giảm từ 10% xuống 2% × hệ số hạng: đúng quyết định chủ dự án.
