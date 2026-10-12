# PD-3 — Gộp TubuXu vào Điểm Xanh: SPEC (giai đoạn kiến trúc, chưa sửa mã)

Nhánh `hz9/PD-3` tách từ `hardening/2026-10` @ `14a66119`. Mọi `file:dòng` dưới đây đọc ở commit đó (trừ khi ghi khác). Các file miniapp `wallet.tsx`, `tree-actions.tsx`, `use-game-actions.ts`, `garden-plots.tsx`, `profile.tsx` đang bị PD-1 (`hz8/PD-1`, chưa gộp vào nền này) sửa chữ: lượt FE của PD-3 phải làm sau khi PD-1 vào `hardening/2026-10`.

Quyết định chủ dự án áp dụng (ROADMAP mục 9, `docs/2026-10-review/00-ROADMAP.md:131-132,142,152`):

| Mã | Nội dung đã quyết |
|---|---|
| Q-03 | Gộp ngay. Khách chỉ còn Ví Tubu (VND thật, rút được), Điểm Xanh, Mã giảm giá. Bỏ đổi Ví -> Xu. |
| Q-03a | Số dư xu hiện có: 1.000 xu = 1 Điểm Xanh, làm tròn LÊN. Lô quy đổi: không hết hạn, không bị trần `loyalty.max_redeem_pct`, không ra tiền mặt (không rút, không về Ví). Giữ nguyên `coin_transactions`. |
| Q-26 | Thuật ngữ: "Điểm Xanh", "Ví Tubu", "Mã giảm giá", "giọt nước". Chữ "TubuXu"/"xu" biến mất khỏi mọi chỗ hướng khách. |
| Q-09 | Hạng chỉ tính mua hàng. |
| Q-02 / PA-5 / PA-7 / PD-1 | Đã bỏ mua giọt nước bằng xu (`game.service.ts:358-360` trả 410); PA-7 không tạo luồng xu mới; PD-1 ẩn Season Pass và đổi "cây thật" thành "góp quỹ trồng cây" (vẫn tiêu xu qua `POST /game/tree/buy`). |

Giá trị hiện hành: 1 xu = 1đ khi trả đơn (`checkout.service.ts:196`, `checkout-rules.ts:41`); 1 Điểm Xanh = `loyalty.vnd_per_point_redeem` = 1.000đ (`pricing.service.ts:63-74`). Quy đổi 1.000:1 làm tròn lên nên giữ giá trị, khách lời tối đa 999đ/người.

Chưa có trong mã: "Ví trả một phần đơn" (Q-03 phương án 1). Ví hiện chỉ trả TOÀN BỘ đơn (`checkout.service.ts:185-187` kiểm `walletBalance < total`, `:322-333` trừ `computed.total`). Không thuộc gói này (xem mục 11, OQ-12).

---

## 1. Kiểm kê

### 1.1 Dữ liệu và chốt chặn DB

| Đối tượng | Vị trí | Ghi chú |
|---|---|---|
| `users.coinsBalance Int @default(0)` | `schema.prisma:235`; migration `20260624000000_tubuxu/migration.sql:5` (`INTEGER NOT NULL DEFAULT 0`) | Không thể NULL. Không có CHECK >= 0; mọi đường trừ có guard `gte` (`coins.service.ts:114-118`, `referral-reward.ts:112-121`). |
| `coin_transactions` (id, userId, delta, reason, refType, refId, createdAt) | `schema.prisma:1013-1024`; `20260624000000_tubuxu/migration.sql:14-27` | Bất biến `coinsBalance == SUM(delta)` (`coins.service.ts:19`). FK RESTRICT về users. |
| `PaymentMethod.XU` | `schema.prisma:792-799`; `20260624000000_tubuxu/migration.sql:11`; `packages/shared-types/src/enums.ts:38` | Không xoá được giá trị enum khi còn đơn cũ. `order-transition.ts:95` coi XU là trả trước. |
| `WalletTxType.XU_CONVERT` | `20261010041004_wallet_ledger/migration.sql:8` | Giữ cho lịch sử Ví. |
| `CtvMilestoneClaim.rewardXu Int` | `schema.prisma:1210-1222` | Đơn vị xu. |
| `CommunityEvent.rewardXu Int @default(0)` | `schema.prisma:1905`; DTO `community-feed.controller.ts:43` `@Max(1000000)` | Admin nhập bằng xu. RỦI RO ĐƠN VỊ (mục 4). |
| `users.pointsBalance Int` | `schema.prisma:233` | Bất biến `pointsBalance == SUM(points_transactions.delta)` (`points-reconcile.ts:4-8`). |
| `points_transactions` (… `expiresAt DateTime?`) | `schema.prisma:928-950` | `expiresAt NULL` = không hết hạn (`loyalty-expiry.service.ts:78`). |

Partial unique index (chỉ sống trong SQL; `check-partial-indexes.ts:19-34` liệt kê 14):

| Tên | Bảng | Cột | Điều kiện | Migration |
|---|---|---|---|---|
| `coin_transactions_referral_unique` | coin | (reason) | `refType='REFERRAL'` | `20260624000000_tubuxu/migration.sql:31-33` |
| `coin_transactions_quest_unique` | coin | (userId, reason) | `refType='QUEST'` | `20260627020000_coin_quest_unique/migration.sql:4-6` |
| `coin_transactions_community_reason_key` | coin | (reason) | `refType='COMMUNITY'` | `20260703020000_community_phase1/migration.sql:85-86` |
| `coin_transactions_convert_ref_key` | coin | (refId) | `refType='CONVERT' AND refId IS NOT NULL` | `20260911030000_coin_convert_idempotency/migration.sql:8-9` |
| `points_transactions_reverse_unique` | points | (reason, refId) | `refType='ORDER' AND refId NOT NULL AND (reason LIKE 'ORDER_REVERSED:%' OR 'ORDER_REFUND_POINTS:%')` | `20260623000000_loyalty_reverse_unique/migration.sql:24-28` |
| `points_transactions_delivered_unique` | points | (reason, refId) | `refType='ORDER' AND refId NOT NULL AND reason LIKE 'ORDER_DELIVERED:%'` | `20260623010000_loyalty_credit_unique/migration.sql:30-34` |
| `points_transactions_checkin_day_key` | points | (userId, refId) | `refType='CHECKIN' AND refId NOT NULL` | `20260926120000_loyalty_checkin_pos/migration.sql:77-79` |
| `points_transactions_pos_ref_key` | points | (refId) | `refType='POS' AND refId NOT NULL` | `20260926120000_loyalty_checkin_pos/migration.sql:81-83` |

### 1.2 reason / refType đang ghi vào `coin_transactions`

| reason | refType | Dấu | Nơi ghi |
|---|---|---|---|
| `CONVERT_FROM_WALLET` (refId = Idempotency-Key) | `CONVERT` | + | `wallet.service.ts:126-134` |
| `REFERRAL_ORDER2:<refereeId>` (refId `<đơn1>:<đơn2>`) | `REFERRAL` | + | `coins.service.ts:178-191` |
| `REFERRAL_ORDER2_REVOKE:<refereeId>` | `REFERRAL` | − | `referral-reward.ts:199-206` qua `debitReferralReward` `:104-135` |
| `REFERRAL_MILESTONE:<referrerId>:<count>[#n]` | `REFERRAL` | + | `coins.service.ts:204-219`, tên ở `referral-reward.ts:94-96` |
| `REFERRAL_MILESTONE_REVOKE:<referrerId>:<count>#n` | `REFERRAL` | − | `referral-reward.ts:141-167` |
| `REFERRAL_ORDER2_DEBT:…:<thiếu>` / `REFERRAL_MILESTONE_DEBT:…` | `REFERRAL_DEBT` | 0 | `referral-reward.ts:123-133` |
| `REFERRAL_CASHBACK:<refereeId>` (luồng cũ đã gỡ, chỉ còn dữ liệu) | `REFERRAL` | + | đọc ở `referral-reward.ts:17,53-60`, `coins.service.ts:150-157` |
| `COMMUNITY_POST:<postId>` / `COMMUNITY_ANSWER:<commentId>` / `COMMUNITY_BEST:<postId>` | `COMMUNITY` | + | `community-reward.service.ts:25-87` |
| `COMMUNITY_EVENT_WIN:<eventId>:<userId>` | `COMMUNITY` | + | `community-reward.service.ts:90-93` |
| `STOREFRONT_QUEST:<code>` (có thể mang tiền tố `MERGED:<guestId>:`) | `QUEST` | + | `storefront-quest.service.ts:119`; đổi khoá khi gộp `auth.service.ts:347-351` |
| `CTV_MILESTONE:<milestoneId>:<YYYY-MM>` (refId = claim.id) | `AFFILIATE_MILESTONE` | + | `affiliate.service.ts:1041,1056` |
| `SEASONPASS:<seasonId>:<tier>:<track>` | `SEASONPASS` | + | `season-pass.service.ts:146-161` |
| `ORDER_PAY:<code>` (refId order.id) | `ORDER` | − | `checkout.service.ts:334-338` |
| `ORDER_REFUND:<code>` | `ORDER` | + | `order-reversal.service.ts:115-128` |
| `GARDEN_UNLOCK_PLOT:<slot>` | `GAME` | − | `game-garden.service.ts:118-121` |
| `GAME_BUY_TREE:<cert>` | `GAME` | − | `game.service.ts:363-372` |

### 1.3 Nơi cộng / trừ / đọc xu (API)

| file:dòng | Hành động | Đơn vị và số tiền hiện tại | Khoá config |
|---|---|---|---|
| `wallet/wallet.service.ts:79-147` (`convertToXu`), route `wallet.controller.ts:50-58` `POST /wallet/convert-xu` | convert (Ví -> xu) | `floor(VND × 1.2)` xu | `wallet.xu_convert_multiplier` = 1.2 (`seed.ts:67`, RANGES `system-config.service.ts:68`) |
| `wallet/wallet.service.ts:20-45` (`GET /me/wallet`) | read/display | trả `coinsBalance`, `xuConvertMultiplier` | như trên |
| `wallet/coins.service.ts:35-64` (`GET /me/coins`, `wallet.controller.ts:60-63`) | read/display | số dư, 50 dòng sổ, thống kê giới thiệu (`referralEarned` = SUM delta REFERRAL) | `coins.referral_milestones` |
| `wallet/coins.service.ts:76-98` `grantCoins` | grant (chung) | tuỳ caller | — |
| `wallet/coins.service.ts:104-123` `spendCoins` | spend (chung) | tuỳ caller | — |
| `wallet/coins.service.ts:131-196` `grantReferralOrderReward` | grant | 5.000 xu/người được mời có đơn 2 | `coins.referrer_reward` = 5000 (`seed.ts:70`), `referral.window_days` 30, `referral.min_order_amount` 200000 |
| `wallet/coins.service.ts:204-219` `awardReferralMilestones` | grant | 20.000 / 40.000 / 100.000 xu ở mốc 3/5/10 | `coins.referral_milestones` (`seed.ts:77-86`) |
| `wallet/referral-reward.ts:46-50,104-135,141-214` | refund ngược (thu hồi) + read | trừ tối đa số dư xu, phần thiếu ghi REFERRAL_DEBT | — |
| `wallet/referral-reward.ts:53-60,69-92,222-234` | read (đếm lượt, trạng thái mốc, đơn đã dùng) | — | — |
| `checkout/checkout.service.ts:188-189` | read (kiểm đủ) | `coinsBalance >= total` (1 xu = 1đ) | — |
| `checkout/checkout.service.ts:196-206` | quy tắc | đơn XU: CONFIRMED + PAID, `pointsEarned = 0` | `loyalty.earn_points_on_xu` = false |
| `checkout/checkout.service.ts:334-338` | spend | `total` xu | — |
| `checkout/dto/checkout.dto.ts:30` | nhận `paymentMethod='XU'` | — | — |
| `orders/order-reversal.service.ts:59-64,115-128` | refund | `+order.total` xu khi PAID→REFUNDED | — |
| `orders/order-reversal.service.ts:198-204` | thu hồi giới thiệu (log "xu") | — | — |
| `loyalty/loyalty.service.ts:218-228` | read (xét hạng bỏ đơn XU) | — | `loyalty.earn_points_on_xu` |
| `game/game-garden.service.ts:56-64,96-99` | display giá | `xuCost = 200 × slot` | `game.plot_unlock_xu_base` = 200 (`seed.ts:132`) |
| `game/game-garden.service.ts:103-121`; DTO `game.controller.ts:18`, route `:109-111` `POST /game/garden/unlock` | spend | `200 × slot` xu | như trên |
| `game/game.service.ts:66-72` (getProfile) | display giá | `xuPerSeed` 1, `treeXuPrice` 50.000 | `game.xu_per_seed` (`seed.ts:87`, chết từ PA-5), `game.tree_xu_price` (`seed.ts:88`) |
| `game/game.service.ts:363-372`; route `game.controller.ts:70-71` `POST /game/tree/buy` | spend (góp quỹ trồng cây) | 50.000 xu | `game.tree_xu_price` |
| `game/season-pass.service.ts:5-9,146-161` | grant | premium 5.000–30.000 xu/bậc | `seasonpass.tiers` (`seed.ts:134-146`, `type:'XU'`) |
| `feed/community-reward.service.ts:25-47,50-67` | grant (trần/ngày, Serializable) | đăng bài 200, trả lời 100 xu | `community.post_reward` 200, `community.daily_post_reward_cap` 3, `community.answer_reward` 100, `community.daily_answer_reward_cap` 10 |
| `feed/community-reward.service.ts:81-87` | grant | hay nhất 500 xu | `community.best_answer_reward` 500, `community.daily_best_answer_cap` 5 |
| `feed/community-reward.service.ts:90-93`, gọi từ `community-feed.service.ts:1121-1139` | grant | `CommunityEvent.rewardXu` (admin nhập, ≤ 1.000.000) | cột DB |
| `storefront/storefront-quest.service.ts:24-65,94-122` | grant + read (đã nhận) | 2.000 / 2.000 / 1.500 / 1.000 / 5.000 xu (cứng trong mã) | — |
| `affiliate/affiliate.service.ts:1017-1072`, mốc `ctv-milestones.ts:76-105` | grant | 50.000 / 200.000 / 600.000 / 2.000.000 xu | cứng trong mã |
| `affiliate/affiliate.service.ts:959`, `ctv-milestones.ts:122-128` | display | `milestoneRewardXu` | — |
| `auth/auth.service.ts:270-275,346-353,438-459` | convert (gộp khách -> tài khoản) | chuyển nguyên số dư + sổ, đổi khoá QUEST trùng | — |
| `auth/auth.service.ts:614`; `packages/shared-types/src/auth.ts:25` | read/display | `AuthUser.coinsBalance` | — |
| `users/account-deletion.service.ts:32,69,198` | read (chặn xoá) | "còn N xu chưa dùng" | — |

Không có cron nào đụng xu (`grep -rn "@Cron" apps/api/src` không có file wallet/coins). Không có nguồn xu ở auth/welcome (`grep grantCoins` chỉ ra 5 caller ở bảng trên). `cashback.module.ts:11` còn chú thích "thưởng xu giới thiệu khi cashback CONFIRMED" nhưng `cashback.service.ts` không còn gọi (PA-7 đã gỡ, `impl/PA-7.md:66`).

### 1.4 Nơi hiển thị xu cho khách / admin (FE, seed, e2e)

| file:dòng | Nội dung |
|---|---|
| `miniapp/src/pages/profile.tsx:277-281` | ô "TubuXu" trong hub (4 ô số dư: Điểm Xanh, Ví Tubu, TubuXu, Mã giảm giá) |
| `miniapp/src/pages/wallet.tsx:43,81-95,100-120,164,182,186-207,249-290,329,339-372,475` | thẻ TubuXu, nút/sheet "Đổi Ví → TubuXu (×1.2)", khối mời bạn đọc `/me/coins`, mẹo đổi xu |
| `miniapp/src/pages/checkout.tsx:122-148,292-302,593,731-734,867` | phương thức "TubuXu (số dư)", tự lùi COD, ẩn điểm khi XU |
| `miniapp/src/utils/checkout-rules.ts:24-46` | `shouldFallbackToCod`, `paymentUnavailableReason('XU')` |
| `miniapp/src/utils/format.ts:91-98` | `formatXu` → "N xu" |
| `miniapp/src/i18n/vi.ts:209,377,676,707-708` | `paymentXu`, nhãn `XU: 'TubuXu'`, "Thưởng TubuXu", phần thưởng Season Pass |
| `miniapp/src/pages/affiliate.tsx:240-241,279,449,497`; `components/affiliate/milestone-copy.ts:1-29` | thưởng mốc CTV "+N xu", "Đã cộng vào TubuXu" |
| `miniapp/src/pages/storefront-builder.tsx:606-657` | "+N TubuXu", "Đã nhận N TubuXu", "+N xu" |
| `miniapp/src/components/game/garden-plots.tsx:25-26,83-86`; `use-game-actions.ts:136,145`; `tree-actions.tsx:26-29`; `services/game-api.ts:16,108-112,199,214` | mở lô bằng xu, góp quỹ trồng cây bằng xu |
| `miniapp/src/pages/community-events.tsx:60`; `community-moderation.tsx:444`; `services/feed-api.ts:79` | "N TubuXu" thưởng sự kiện (admin miniapp tạo sự kiện nhập xu) |
| `miniapp/src/pages/about-data.ts:38` | FAQ "trả bằng Ví Tubu hoặc TubuXu" |
| `miniapp/src/services/account-api.ts:51,90,313-320`; `storefront-api.ts:104`; `affiliate-api.ts:62,91` | kiểu dữ liệu và gọi `/me/coins`, `/wallet/convert-xu` |
| `miniapp/src/utils/wallet-rules.ts:28,41` | `canConvertToXu`, nhãn sao kê `XU_CONVERT: 'Đổi sang TubuXu'` |
| `miniapp/src/components/ui/price-tag.tsx:54-55` | component `Xu` |
| `web/src/lib/order-view.ts:26` | nhãn đơn web khách `XU: 'TubuXu'` |
| `web/src/lib/export-csv.ts:38` | CSV admin `XU: 'Xu Tubu'` |
| `web/src/components/admin/account-deletion-panel.tsx:26,146` | "… · N xu" |
| `api/prisma/seed.ts:66-88,132,134-146,677,716` | khoá config xu, mẫu tin `CASHBACK_PAID` ("Đổi sang TubuXu để nhận thêm 20%"), `COMMUNITY_BEST_ANSWER` ("nhận thêm TubuXu") |
| `e2e/tests/support/checkout-mocks.ts:82,144`; `support/mock-api.ts:357`; `mock-api-routing.miniapp.spec.ts:28`; `features.miniapp.spec.ts:35` | mock `coinsBalance` |

Web PROD (`cb92dc8`): `git grep -n -iE "coinsBalance|convert-xu|me/coins|'XU'|TubuXu|Xu Tubu" cb92dc8 -- apps/web/src` chỉ ra `apps/web/src/lib/export-csv.ts:38: XU: 'Xu Tubu'`. Web PROD không gọi endpoint xu nào và không gửi `paymentMethod='XU'`. Miniapp chưa lên Zalo nên không có client cũ.

---

## 2. Mô hình Điểm Xanh sau gộp

### 2.1 Thiết kế: hai lô, hai cột số dư, một sổ

| Thành phần | Thay đổi | Lý do |
|---|---|---|
| `enum PointsLot { STANDARD, CONVERTED }` | mới | Phân loại từng dòng sổ. |
| `points_transactions.lot PointsLot NOT NULL DEFAULT 'STANDARD'` | cột mới | Mọi dòng cũ và mọi nơi ghi hiện có tự là STANDARD (không phải sửa 12 chỗ ghi). |
| `users.pointsBalance` | GIỮ NGUYÊN nghĩa = số dư lô STANDARD | Mọi guard hiện có (`gte pointsBalance`) tự động KHÔNG chạm được lô quy đổi: vòng quay `game.service.ts:121-126`, đổi voucher `loyalty.service.ts:589-597`, `creditPoints` âm `game.service.ts:546-553`, xoá đánh giá `reviews.service.ts:178-190`, hết hạn `loyalty-expiry.service.ts:178-181`, checkout `checkout.service.ts:296-300`. |
| `users.pointsConvertedBalance Int NOT NULL DEFAULT 0 CHECK (>= 0)` | cột mới | Số dư lô quy đổi (không hết hạn, không trần, không ra tiền). |
| `orders.pointsUsedConverted Int NOT NULL DEFAULT 0` | cột mới | `orders.pointsUsed` (`schema.prisma:829`) giữ tổng; phần STANDARD = `pointsUsed − pointsUsedConverted`. Cần để hoàn đúng lô. |

Bất biến sau gộp (thay cho `points-reconcile.ts:8`):

- `users.pointsBalance == SUM(delta) WHERE lot='STANDARD'`
- `users.pointsConvertedBalance == SUM(delta) WHERE lot='CONVERTED'`
- `users.coinsBalance == SUM(coin_transactions.delta) == 0` với mọi user (khoá bằng CHECK `users_coins_frozen`, mục 3.4).

Số khách nhìn thấy: "Điểm Xanh" = `pointsBalance + pointsConvertedBalance`; chi tiết hiện "trong đó N điểm không hết hạn". Không dùng chữ "xu".

Phương án đã loại: chung một cột `pointsBalance` (tổng) + suy lô từ sổ. Bị loại vì phải sửa guard ở 7 nơi tiêu điểm thường (bảng trên); quên một nơi là điểm quy đổi (tiền trả trước) chảy vào vòng quay/đổi voucher và lô STANDARD âm.

### 2.2 Hết hạn: không chạm lô quy đổi

- `computePointExpiry` (`loyalty-expiry.service.ts:44-89`) tính FIFO trên mọi dòng của user. Nếu dòng CONVERTED lọt vào: lô quy đổi (cũ hơn điểm mới thưởng) bị các dòng tiêu STANDARD ăn trước, nên lô STANDARD trông "còn nguyên" và cron trừ nhiều hơn số thật (khách mất điểm); ngược lại dòng tiêu CONVERTED ăn lô STANDARD cũ, cron trừ ít đi (Tubu mất). Bắt buộc: `loadTxns` (`:105-111`) thêm `where: { userId, lot: 'STANDARD' }`; ứng viên ở `:138-148` và `:220-230` thêm `lot: 'STANDARD'` (phòng thủ; dòng CONVERTED luôn `expiresAt NULL` nên vốn không khớp `expiresAt <= now`).
- Dòng CONVERTED luôn ghi `expiresAt = NULL`. Thêm CHECK DB: `CHECK (lot <> 'CONVERTED' OR "expiresAt" IS NULL)`.
- `expireUser` guard `pointsBalance gte expiredNow` (`:178-181`) đúng sẵn vì `pointsBalance` chỉ là STANDARD.

### 2.3 Tiêu ở checkout: thứ tự và trần

Đầu vào giữ nguyên `pointsToUse` (một số). BE chia:

```
redeemBase   = goodsAfterTierDiscount + flashSubtotal          (checkout.service.ts:599, không gồm phí ship)
vnd          = loyalty.vnd_per_point_redeem (1000)
stdUsable    = max(0, pointsBalance − locked)                  (checkout.service.ts:602-604, lockedOrderPoints)
s = min(pointsToUse, stdUsable, floor(floor(redeemBase × max_redeem_pct) / vnd))   // resolvePointsRedemption hiện có
c = min(pointsToUse − s, pointsConvertedBalance, floor((redeemBase − s × vnd) / vnd))
pointsUsed = s + c ; pointsUsedConverted = c ; pointsDiscount = (s + c) × vnd
```

Chứng minh không làm khách thiệt / lợi sai:
1. Tổng giảm `≤ redeemBase` (không âm, không trừ vào phí ship) vì `c ≤ floor((redeemBase − s·vnd)/vnd)`.
2. Với cùng `pointsToUse`, cách chia này cho mức giảm lớn nhất có thể: phần STANDARD bị trần, phần CONVERTED không; lấy STANDARD tới trần trước không bao giờ làm giảm tổng (CONVERTED bù phần còn lại tới `redeemBase`).
3. Tiêu STANDARD trước giữ lại lô không hết hạn; khách không bao giờ mất điểm vì hết hạn do hệ thống chọn tiêu lô quy đổi trước.
4. `pointsEarned` tính trên `goodsAfterAll` (`checkout.service.ts:619`) nên phần trả bằng điểm quy đổi không sinh điểm mới, giống đơn XU hôm nay (`:204-206`). Không cần cờ `loyalty.earn_points_on_xu` ở checkout nữa.
5. Phần lẻ dưới 1.000đ của `redeemBase` không trả được bằng điểm (trước đây xu trả đúng từng đồng). Đây là chi phí cho khách ≤ 999đ/đơn; ghi vào câu hỏi mở OQ-2.

Trong tx `placeOrder` (`checkout.service.ts:288-320`), sau `FOR UPDATE` dòng user:
- STANDARD: giữ nguyên `updateMany where pointsBalance gte s + locked` + dòng `ORDER_REDEEM:<code>` (lot STANDARD) khi `s > 0`.
- CONVERTED: `updateMany where pointsConvertedBalance gte c` decrement `c` + dòng `ORDER_REDEEM_CONVERTED:<code>` (lot CONVERTED, refType ORDER, refId order.id) khi `c > 0`. Không đủ → 400 "tải lại trang thanh toán", rollback cả đơn.
- Ghi `orders.pointsUsedConverted = c`.

Đơn tổng 0đ (điểm quy đổi phủ hết hàng + freeship): hôm nay chỉ đạt được bằng mã giảm giá; sau gộp dễ gặp hơn. `BANK_TRANSFER`/`ZALOPAY` với 0đ sẽ treo PENDING_PAYMENT rồi bị huỷ sau 24 giờ (PA-3). Quy tắc mới: `computed.total === 0` thì BE ép `paymentMethod='COD'`, status CONFIRMED (không thu tiền), FE ẩn chọn phương thức và ghi "Đơn đã được trả đủ bằng Điểm Xanh". Test bắt buộc.

### 2.4 Nơi tiêu khác

| Nơi | Lô được dùng | Cách làm |
|---|---|---|
| Vòng quay `game.service.ts:106-140` | chỉ STANDARD | không đổi mã (guard `pointsBalance`). |
| Đổi voucher catalog `loyalty.service.ts:583-640` | chỉ STANDARD | không đổi mã. Voucher có `minOrder` (`:1270-1315`), đổi lô quy đổi ra voucher là khách thiệt. |
| `creditPoints` âm, xoá đánh giá | chỉ STANDARD | không đổi mã. |
| Góp quỹ trồng cây `game.service.ts:363-372` | STANDARD trước, thiếu thì CONVERTED (đề xuất, OQ-5) | giá mới `game.tree_points_price` = 50 điểm. |
| Mở lô vườn bằng xu `game-garden.service.ts:118-121` | bỏ | xem mục 6. |

### 2.5 Hoàn khi đơn huỷ/trả: về đúng lô

`reverseOrderPoints` (`loyalty.service.ts:131-200`):
- Phần STANDARD `pointsUsed − pointsUsedConverted`: giữ dòng `ORDER_REFUND_POINTS:<code>` như cũ (lot STANDARD).
- Phần CONVERTED `pointsUsedConverted`: dòng mới `ORDER_REFUND_CONVERTED:<code>` lot CONVERTED, `expiresAt NULL`, cộng `pointsConvertedBalance`.
- Kiểm "đã đảo chưa" ở `:138-145` phải thêm `ORDER_REFUND_CONVERTED:<code>` vào danh sách `reason in`. Nếu không: đơn chỉ dùng điểm quy đổi (không có `ORDER_REVERSED`/`ORDER_REFUND_POINTS`) gọi lại sẽ thử hoàn lần 2; index mới (mục 3.1) chặn được nhưng không nên dựa một lớp.
- Khoá idempotency: index mới `points_transactions_converted_refund_unique` (mục 3.1).
- Đơn XU cũ (trước gộp) bị huỷ/trả: xem mục 6.2.

### 2.6 Xét hạng không tính điểm quy đổi

- `tierPoints` (`loyalty.service.ts:321-339`) là WHITELIST `reason LIKE 'ORDER_DELIVERED:%'` (hằng `:1160-1161`). Dòng quy đổi (`XU_TO_POINTS:*`), hoàn quy đổi, thưởng mới đều không khớp, nên tự động không tính hạng. Không đổi mã; thêm test khoá.
- Chi tiêu 12 tháng (`:222-230`) cộng `orders.total` (đã trừ giảm bằng điểm) nên phần trả bằng điểm quy đổi không tính hạng. Giữ bộ lọc `paymentMethod <> 'XU'` cho đơn XU cũ (cờ `loyalty.earn_points_on_xu` vẫn đọc ở đây).
- `lockedOrderPoints` (`:356-397`) chỉ xét `ORDER_DELIVERED` (STANDARD) nên không đụng lô quy đổi.

### 2.7 Điểm danh / thưởng khác

Điểm danh (`loyalty.service.ts:766-800`), POS (`:943-1050`), đánh giá (`reviews.service.ts:91-94`), vòng quay thắng điểm (`game.service.ts:554-557`): giữ nguyên, lot STANDARD, `expiresAt` như hiện tại. Thưởng mới thay xu (mục 4) cũng là STANDARD có hạn `loyalty.point_expire_months`.

### 2.8 Gộp phiên khách và xoá tài khoản

- `mergeGuestInto` (`auth.service.ts:262-461`): thêm `pointsConvertedBalance` vào `SELECT … FOR UPDATE` (`:270-275`), `increment` ở `:438-445`, đưa về 0 ở `:452-460`. Dòng sổ đã chuyển theo `pointsTransaction.updateMany` (`:352`). Thêm đổi khoá `MERGED:` cho dòng points `refType='QUEST'` trùng `(userId, reason)` y như coin ở `:347-351` (index QUEST mới ở points). Dòng `XU_MIGRATION` (refId = id khách) không trùng vì index theo `refId`.
- Xoá tài khoản (`account-deletion.service.ts:198`): đổi blocker `COINS_BALANCE` thành `CONVERTED_POINTS` khi `pointsConvertedBalance > 0` ("còn N Điểm Xanh không hết hạn chưa dùng"). Không quy ra tiền (Q-03a). Admin web `account-deletion-panel.tsx:146` đổi chữ.

---

## 3. Migration số dư

Hai migration, áp theo thứ tự bằng `prisma migrate deploy` (Dockerfile `apps/api/Dockerfile:39` chạy ngay khi container API khởi động, sau khi container cũ đã dừng; mục 10).

### 3.1 Migration A `<ts>_pd3_points_lot_schema` (chỉ thêm)

```sql
-- PD-3 (Q-03, Q-03a): Điểm Xanh hai lô. Chỉ THÊM kiểu/cột/index, không xoá, không đổi dữ liệu cũ.
CREATE TYPE "PointsLot" AS ENUM ('STANDARD', 'CONVERTED');

ALTER TABLE "points_transactions" ADD COLUMN "lot" "PointsLot" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_converted_no_expiry"
  CHECK ("lot" <> 'CONVERTED' OR "expiresAt" IS NULL);

ALTER TABLE "users" ADD COLUMN "pointsConvertedBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD CONSTRAINT "users_points_converted_nonneg" CHECK ("pointsConvertedBalance" >= 0);

ALTER TABLE "orders" ADD COLUMN "pointsUsedConverted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "community_events" ADD COLUMN "rewardPoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ctv_milestone_claims" ADD COLUMN "rewardPoints" INTEGER NOT NULL DEFAULT 0;

-- Sự kiện cộng đồng đã tạo bằng xu: quy sang điểm (làm tròn lên). Chỉ dòng chưa có rewardPoints.
UPDATE "community_events" SET "rewardPoints" = ("rewardXu" + 999) / 1000
 WHERE "rewardPoints" = 0 AND "rewardXu" > 0;

-- Khoá idempotency mới trên points_transactions (thay cho bản coin_transactions_*):
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_xu_migration_key"
  ON "points_transactions"("refId") WHERE "refType" = 'XU_MIGRATION' AND "refId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "coin_transactions_xu_migration_key"
  ON "coin_transactions"("refId") WHERE "refType" = 'XU_MIGRATION' AND "refId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_referral_unique"
  ON "points_transactions"("reason") WHERE "refType" = 'REFERRAL';
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_community_reason_key"
  ON "points_transactions"("reason") WHERE "refType" = 'COMMUNITY';
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_quest_unique"
  ON "points_transactions"("userId", "reason") WHERE "refType" = 'QUEST';
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_converted_refund_unique"
  ON "points_transactions"("reason", "refId")
  WHERE "refType" = 'ORDER' AND "refId" IS NOT NULL
    AND ("reason" LIKE 'ORDER_REFUND_CONVERTED:%' OR "reason" LIKE 'ORDER_REFUND_XU:%');
```

`ADD COLUMN … DEFAULT <hằng>` trên Postgres ≥ 11 chỉ sửa catalog, không viết lại bảng. Thêm 6 tên index vào `KNOWN_PARTIAL_UNIQUE_INDEXES` (`check-partial-indexes.ts:19-34`): `points_transactions_xu_migration_key`, `coin_transactions_xu_migration_key`, `points_transactions_referral_unique`, `points_transactions_community_reason_key`, `points_transactions_quest_unique`, `points_transactions_converted_refund_unique`. Danh sách thành 20 (đã đếm trên DB tạm: 14 trước, 20 sau migration A).

Đổi khoá config xu sang điểm (cùng lượt L2, migration riêng `<ts>_pd3_points_config_keys`). BẮT BUỘC dùng `CEIL(numeric / 1000)`: bản nháp đầu viết `((numeric + 999) / 1000)::int` cho ra 5.999 rồi ép kiểu làm tròn thành 6 (thưởng 5.000 xu thành 6 điểm thay vì 5), lỗi này bắt được khi chạy thử (phần "Kiểm chứng SQL"). Với cột INTEGER (migration B) thì `(x + 999) / 1000` là chia nguyên, đúng.

```sql
INSERT INTO "system_configs" ("key","value","description","category","updatedAt")
SELECT 'referral.referrer_reward_points', to_jsonb(CEIL((value #>> '{}')::numeric / 1000)::int),
       'Điểm Xanh thưởng người giới thiệu khi bạn được mời có đơn thứ 2 (thu hồi nếu trả hàng)', 'referral', now()
  FROM "system_configs" WHERE "key" = 'coins.referrer_reward'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "system_configs" ("key","value","description","category","updatedAt")
SELECT 'referral.milestones_points',
       COALESCE((SELECT jsonb_agg(jsonb_build_object('count', (m->>'count')::int,
                                                     'bonusPoints', CEIL((m->>'bonus')::numeric / 1000)::int)
                                  ORDER BY (m->>'count')::int)
                   FROM jsonb_array_elements(value) m), '[]'::jsonb),
       'Mốc số bạn giới thiệu thành công → thưởng thêm Điểm Xanh (1 lần/mốc)', 'referral', now()
  FROM "system_configs" WHERE "key" = 'coins.referral_milestones' AND jsonb_typeof(value) = 'array'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "system_configs" ("key","value","description","category","updatedAt")
SELECT 'game.tree_points_price', to_jsonb(CEIL((value #>> '{}')::numeric / 1000)::int),
       'Điểm Xanh cho 1 lượt góp quỹ trồng cây', 'game', now()
  FROM "system_configs" WHERE "key" = 'game.tree_xu_price'
ON CONFLICT ("key") DO NOTHING;

-- Season Pass: {type:'XU',amount:n} → {type:'POINTS',amount:ceil(n/1000)}; chỉ chạy khi còn phần tử XU.
UPDATE "system_configs" s
   SET "value" = (
     SELECT jsonb_agg(
              t || jsonb_build_object(
                'free',    CASE WHEN t->'free'->>'type' = 'XU'
                                THEN jsonb_build_object('type','POINTS','amount', CEIL((t->'free'->>'amount')::numeric / 1000)::int)
                                ELSE t->'free' END,
                'premium', CASE WHEN t->'premium'->>'type' = 'XU'
                                THEN jsonb_build_object('type','POINTS','amount', CEIL((t->'premium'->>'amount')::numeric / 1000)::int)
                                ELSE t->'premium' END)
              ORDER BY ord)
       FROM jsonb_array_elements(s."value") WITH ORDINALITY AS e(t, ord)),
       "updatedAt" = now()
 WHERE s."key" = 'seasonpass.tiers' AND jsonb_typeof(s."value") = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(s."value") t
                WHERE t->'free'->>'type' = 'XU' OR t->'premium'->>'type' = 'XU');
```

Khoá cộng đồng (`community.*_reward_points`) không chép từ giá trị cũ (200/100/500 xu cho ra phân số): seed `createOnly` theo giá trị đề xuất ở mục 4 (OQ-6).

### 3.2 Migration B `<ts>_pd3_xu_to_points` (dữ liệu, chạy một lần)

```sql
-- PD-3 Q-03a: 1.000 xu = 1 Điểm Xanh (làm tròn lên), lô CONVERTED không hết hạn.
-- Mỗi user coinsBalance > 0 nhận đúng 1 dòng points (+N, lot CONVERTED) và 1 dòng coin (−coinsBalance),
-- rồi coinsBalance = 0. Không xoá dòng nào của coin_transactions.
-- Ba lớp chặn chạy lại: PK bảng chụp theo userId, id dòng sổ cố định theo userId,
-- partial unique *_xu_migration_key theo refId = userId. Chạy lại = không làm gì.

CREATE TABLE IF NOT EXISTS "xu_points_conversions" (
  "userId"            TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "coinsBefore"       INTEGER NOT NULL,
  "pointsBefore"      INTEGER NOT NULL,
  "convertedBefore"   INTEGER NOT NULL,
  "pointsGranted"     INTEGER NOT NULL,
  "roundingVnd"       INTEGER NOT NULL,   -- pointsGranted*1000 - coinsBefore, 0..999
  "pointsTxId"        TEXT NOT NULL,
  "coinTxId"          TEXT NOT NULL,
  "convertedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "xu_points_conversions_rounding_chk" CHECK ("roundingVnd" BETWEEN 0 AND 999)
);

DO $$
DECLARE
  neg_users  INTEGER;
  drift_users INTEGER;
BEGIN
  -- Chặn mọi ghi users/coin_transactions trong lúc chụp và chuyển (code cũ đã dừng, đây là lớp thứ hai).
  LOCK TABLE "users" IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE "coin_transactions" IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO neg_users FROM "users" WHERE "coinsBalance" < 0;
  IF neg_users > 0 THEN
    RAISE EXCEPTION 'PD-3: % user có coinsBalance âm; đối soát tay trước (SELECT id, "coinsBalance" FROM users WHERE "coinsBalance" < 0)', neg_users;
  END IF;

  SELECT count(*) INTO drift_users
    FROM "users" u
   WHERE u."coinsBalance" <> COALESCE((SELECT SUM(c."delta") FROM "coin_transactions" c WHERE c."userId" = u."id"), 0);
  IF drift_users > 0 THEN
    RAISE EXCEPTION 'PD-3: % user có coinsBalance khác SUM(coin_transactions.delta); đối soát trước khi quy đổi', drift_users;
  END IF;

  INSERT INTO "xu_points_conversions"
    ("userId", "coinsBefore", "pointsBefore", "convertedBefore", "pointsGranted", "roundingVnd", "pointsTxId", "coinTxId")
  SELECT u."id", u."coinsBalance", u."pointsBalance", u."pointsConvertedBalance",
         (u."coinsBalance" + 999) / 1000,
         ((u."coinsBalance" + 999) / 1000) * 1000 - u."coinsBalance",
         'ptx_xu2pts_' || u."id", 'ctx_xu2pts_' || u."id"
    FROM "users" u
   WHERE u."coinsBalance" > 0
     AND NOT EXISTS (SELECT 1 FROM "xu_points_conversions" x WHERE x."userId" = u."id");

  INSERT INTO "points_transactions" ("id", "userId", "delta", "reason", "refType", "refId", "expiresAt", "lot", "createdAt")
  SELECT x."pointsTxId", x."userId", x."pointsGranted", 'XU_TO_POINTS:' || x."coinsBefore", 'XU_MIGRATION', x."userId",
         NULL, 'CONVERTED', x."convertedAt"
    FROM "xu_points_conversions" x
   WHERE NOT EXISTS (SELECT 1 FROM "points_transactions" p WHERE p."id" = x."pointsTxId");

  INSERT INTO "coin_transactions" ("id", "userId", "delta", "reason", "refType", "refId", "createdAt")
  SELECT x."coinTxId", x."userId", -x."coinsBefore", 'XU_TO_POINTS:' || x."pointsGranted", 'XU_MIGRATION', x."userId",
         x."convertedAt"
    FROM "xu_points_conversions" x
   WHERE NOT EXISTS (SELECT 1 FROM "coin_transactions" c WHERE c."id" = x."coinTxId");

  -- Chỉ user vừa chụp ở trên còn coinsBalance = coinsBefore > 0; user đã quy đổi trước đó có coinsBalance = 0.
  UPDATE "users" u
     SET "coinsBalance" = 0,
         "pointsConvertedBalance" = u."pointsConvertedBalance" + x."pointsGranted"
    FROM "xu_points_conversions" x
   WHERE x."userId" = u."id" AND u."coinsBalance" = x."coinsBefore" AND u."coinsBalance" > 0;
END $$;
```

Cố ý: số dư âm và lệch sổ làm migration DỪNG (cùng kiểu `20261010010000_commission_order_affiliate_unique/migration.sql:15`), vì quy đổi sai tiền trả trước không sửa ngược được êm. Lệnh đo trước (3.3) phải chạy trên bản sao PROD trước ngày deploy để không bị dừng giữa chừng. NULL không xảy ra (cột `NOT NULL DEFAULT 0`, mục 1.1).

### 3.3 Truy vấn đo (chỉ đọc; chạy trên bản sao PROD trước deploy, và lại sau deploy)

```sql
-- (a) Chi phí làm tròn lên và tổng giá trị quy đổi
SELECT count(*)                                                        AS users_with_xu,
       COALESCE(sum("coinsBalance"), 0)                                AS total_xu,          -- = VND giá trị hiện tại
       COALESCE(sum(("coinsBalance" + 999) / 1000), 0)                 AS total_points,
       COALESCE(sum(("coinsBalance" + 999) / 1000) * 1000 - sum("coinsBalance"), 0) AS rounding_cost_vnd,
       COALESCE(max(("coinsBalance" + 999) / 1000), 0)                 AS max_points_one_user
  FROM "users" WHERE "coinsBalance" > 0;

-- (b) Điều kiện chặn của migration B
SELECT count(*) AS negative_users FROM "users" WHERE "coinsBalance" < 0;
SELECT count(*) AS coin_drift_users FROM "users" u
 WHERE u."coinsBalance" <> COALESCE((SELECT sum(delta) FROM "coin_transactions" c WHERE c."userId" = u."id"), 0);

-- (c) Bất biến Điểm Xanh hiện tại (phải = 0 trước khi đổi nghĩa thành "lô STANDARD")
SELECT count(*) AS points_drift_users FROM "users" u
 WHERE u."pointsBalance" <> COALESCE((SELECT sum(delta) FROM "points_transactions" p WHERE p."userId" = u."id"), 0);

-- (d) Đơn XU còn có thể huỷ/trả sau gộp (sẽ hoàn bằng Điểm Xanh lô quy đổi, mục 6.2)
SELECT status, "paymentStatus", count(*), sum(total) AS total_xu,
       sum((total + 999) / 1000) AS refund_points_if_all_reversed
  FROM "orders" WHERE "paymentMethod" = 'XU' AND status NOT IN ('CANCELLED', 'RETURNED')
 GROUP BY 1, 2;

-- (e) Thưởng giới thiệu bằng xu còn có thể bị thu hồi (đơn trong cửa sổ trả hàng)
SELECT count(*), sum(delta) FROM "coin_transactions"
 WHERE "refType" = 'REFERRAL' AND "reason" LIKE 'REFERRAL_ORDER2:%' AND "createdAt" > now() - interval '30 days';
```

Sau migration B:

```sql
SELECT count(*), sum("pointsGranted"), sum("roundingVnd"), sum("coinsBefore") FROM "xu_points_conversions";
SELECT count(*) FROM "users" WHERE "coinsBalance" <> 0;                                   -- phải 0
SELECT count(*) FROM "users" u WHERE u."pointsConvertedBalance" <>
  COALESCE((SELECT sum(delta) FROM "points_transactions" p WHERE p."userId" = u."id" AND p."lot" = 'CONVERTED'), 0);  -- phải 0
SELECT count(*) FROM "users" u WHERE u."pointsBalance" <>
  COALESCE((SELECT sum(delta) FROM "points_transactions" p WHERE p."userId" = u."id" AND p."lot" = 'STANDARD'), 0);   -- phải 0
SELECT count(*) FROM "users" u WHERE u."coinsBalance" <>
  COALESCE((SELECT sum(delta) FROM "coin_transactions" c WHERE c."userId" = u."id"), 0);                               -- phải 0
```

Chi phí làm tròn trên số dư thật: KHÔNG đo được trong giai đoạn này (cấm đụng PROD; DB local chỉ có 13 user, `02-arch-data.md:7`). Trần lý thuyết = 999đ × `users_with_xu`. PROD hiện chưa có miniapp trên Zalo và web PROD không có đường nạp/tiêu xu (mục 1.4), nên số user có xu trên PROD dự kiến gần 0 (chỉ từ thưởng cộng đồng/nhiệm vụ/giới thiệu nếu có). Điều phối viên chạy (a) trên bản sao và ghi số vào báo cáo PD-3 trước deploy. Kiểm thử bản nháp SQL trên Postgres thật: xem mục 3.6.

### 3.4 Migration C `<ts>_pd3_freeze_coins` (lượt cuối BE, sau khi gỡ mọi đường ghi xu)

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_coins_frozen') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_coins_frozen" CHECK ("coinsBalance" = 0);
  END IF;
END $$;
```

Đây là chốt "tắt ghi xu" ở DB: mọi đường ghi xu còn sót (`grantCoins` cộng `coinsBalance`) nổ ngay trong tx và rollback cả thao tác, không âm thầm sinh xu mới. `auth.service.ts:441` (`increment: g.coinsBalance` = 0) và đặt 0 ở `:458` vẫn hợp lệ.

### 3.5 Hoàn tác (snapshot)

Điều kiện hoàn tác ĐẦY ĐỦ: chưa có đơn nào tiêu điểm quy đổi (`SELECT count(*) FROM orders WHERE "pointsUsedConverted" > 0` = 0) và đã dựng lại bản API trước PD-3. Sau khi khách bắt đầu tiêu lô quy đổi thì chỉ sửa tiến (code cũ không biết lô, `reverseOrderPoints` cũ sẽ hoàn tất cả về STANDARD).

```sql
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_coins_frozen";
DO $$ BEGIN
  LOCK TABLE "users" IN SHARE ROW EXCLUSIVE MODE;
  CREATE TEMP TABLE _rb ON COMMIT DROP AS
  SELECT x."userId", x."coinsBefore", x."pointsGranted",
         LEAST(x."pointsGranted", u."pointsConvertedBalance") AS pts_back
    FROM "xu_points_conversions" x JOIN "users" u ON u."id" = x."userId"
   WHERE NOT EXISTS (SELECT 1 FROM "points_transactions" p
                      WHERE p."refType" = 'XU_MIGRATION_ROLLBACK' AND p."refId" = x."userId");
  INSERT INTO "points_transactions" ("id","userId","delta","reason","refType","refId","expiresAt","lot","createdAt")
  SELECT 'ptx_xu2pts_rb_' || "userId", "userId", -pts_back, 'XU_TO_POINTS_ROLLBACK', 'XU_MIGRATION_ROLLBACK', "userId",
         NULL, 'CONVERTED', CURRENT_TIMESTAMP FROM _rb WHERE pts_back > 0;
  INSERT INTO "coin_transactions" ("id","userId","delta","reason","refType","refId","createdAt")
  SELECT 'ctx_xu2pts_rb_' || "userId", "userId",
         CASE WHEN pts_back = "pointsGranted" THEN "coinsBefore" ELSE LEAST("coinsBefore", pts_back * 1000) END,
         'XU_TO_POINTS_ROLLBACK', 'XU_MIGRATION_ROLLBACK', "userId", CURRENT_TIMESTAMP FROM _rb WHERE pts_back > 0;
  UPDATE "users" u
     SET "pointsConvertedBalance" = u."pointsConvertedBalance" - r.pts_back,
         "coinsBalance" = u."coinsBalance" +
           CASE WHEN r.pts_back = r."pointsGranted" THEN r."coinsBefore" ELSE LEAST(r."coinsBefore", r.pts_back * 1000) END
    FROM _rb r WHERE u."id" = r."userId" AND r.pts_back > 0;
END $$;
```

Lô còn nguyên thì trả đúng `coinsBefore` (khách không giữ phần làm tròn). Không xoá bảng chụp, không xoá dòng sổ nào. Cột/enum mới để nguyên (additive, code cũ bỏ qua).

### 3.6 Kiểm chứng bản nháp SQL trên Postgres thật

Xem phần "Kiểm chứng SQL" ở cuối file (chạy trên DB tạm riêng, tạo rồi xoá). Đây chỉ là chạy thử bản nháp trong spec; lượt L1 vẫn phải viết race spec T1–T3, T17, T21.

---

## 4. Nguồn cộng xu hiện có → Điểm Xanh

Nguyên tắc:
- Thưởng mới = Điểm Xanh lô STANDARD, `expiresAt = now + loyalty.point_expire_months` (giống điểm danh `loyalty.service.ts:777`), chịu trần 20% khi tiêu. (Đề xuất, OQ-1.)
- Mọi khoá config tính bằng điểm có hậu tố `_points`; khoá xu cũ vào `DEAD_CONFIG_KEYS` (`dead-config-keys.ts:11-36`) để admin bị chặn ghi và test `dead-config-keys.spec.ts` bắt mã còn đọc.
- Một helper cấp duy nhất `RewardPointsService.grant(userId, points, reason, refType, refId, tx?)` (thay `CoinsService.grantCoins`, cùng kiểu `createMany skipDuplicates` để không bẫy 25P02, `coins.service.ts:72-98`), ghi lot STANDARD + `pointsBalance increment`. Helper từ chối `!Number.isInteger(points) || points <= 0 || points > POINTS_GRANT_HARD_MAX` (2.000, đúng mức thưởng lớn nhất hợp lệ là mốc CTV 80 triệu) bằng lỗi 500 có log, không cấp.

| Nguồn | Hiện tại (xu) | Khoá cũ | Sau gộp (Điểm Xanh) | Khoá mới / chỗ sửa | Idempotent |
|---|---|---|---|---|---|
| Đổi Ví → xu ×1.2 | `floor(VND×1.2)` | `wallet.xu_convert_multiplier` | BỎ (mục 5) | khoá vào DEAD, gỡ khỏi RANGES `system-config.service.ts:68` | — |
| Giới thiệu, đơn 2 của bạn | 5.000 | `coins.referrer_reward` | 5 | `referral.referrer_reward_points` = `ceil(giá trị cũ/1000)` (migration chép từ DB), RANGES 0–100 | `points_transactions_referral_unique` (reason `REFERRAL_ORDER2:<refereeId>`) + kiểm dòng cũ ở coin |
| Mốc giới thiệu 3/5/10 | 20.000 / 40.000 / 100.000 | `coins.referral_milestones` `{count,bonus}` | 20 / 40 / 100 | `referral.milestones_points` `{count,bonusPoints}`; trường đổi tên để đọc nhầm bản cũ (`bonus`) ra `undefined` → bỏ qua, không cấp | cùng index referral |
| Đăng bài cộng đồng | 200, trần 3/ngày | `community.post_reward` | 1, trần 1/ngày (đề xuất OQ-6) | `community.post_reward_points`, `community.daily_post_reward_cap` đặt 1 | `points_transactions_community_reason_key` + kiểm dòng cũ |
| Trả lời | 100, trần 10/ngày | `community.answer_reward` | 0 (tắt; 0,1 điểm không biểu diễn được) | `community.answer_reward_points` = 0 | như trên |
| Câu trả lời hay nhất | 500, trần 5/ngày | `community.best_answer_reward` | 1, trần 3/ngày | `community.best_answer_reward_points`, `community.daily_best_answer_cap` 3 | như trên |
| Thắng sự kiện cộng đồng | `CommunityEvent.rewardXu` (≤ 1.000.000) | cột DB | `CommunityEvent.rewardPoints` (≤ 1.000) | cột mới (migration A quy đổi dòng cũ), DTO `@Max(1000)` thay `community-feed.controller.ts:43`, `pickWinner` đọc `rewardPoints` (`community-feed.service.ts:1124,1136`) | reason `COMMUNITY_EVENT_WIN:<eventId>:<userId>` |
| Nhiệm vụ gian hàng | 2.000 / 2.000 / 1.500 / 1.000 / 5.000 | cứng `storefront-quest.service.ts:24-65` | 2 / 2 / 2 / 1 / 5 (1.500 làm tròn lên) | đổi `rewardXu` → `rewardPoints` | `points_transactions_quest_unique` (userId, reason) + kiểm dòng cũ ở coin (`listQuests` `:94-109` phải gộp cả hai sổ) |
| Mốc doanh số CTV | 50.000 / 200.000 / 600.000 / 2.000.000 | cứng `ctv-milestones.ts:76-105` | 50 / 200 / 600 / 2.000 | `CtvMilestone.rewardPoints`, ghi `ctv_milestone_claims.rewardPoints` | unique `ctv_milestone_claims(userId, milestoneId, monthKey)` có sẵn |
| Season Pass premium (đang ẩn, PD-1) | 5.000–30.000 | `seasonpass.tiers` `type:'XU'` | 5–30 | migration đổi JSON `{type:'XU',amount:n}` → `{type:'POINTS',amount:ceil(n/1000)}`; code gặp `'XU'` thì từ chối cấp + log | guard mảng `userSeasonPass` có sẵn (`season-pass.service.ts:120-128`) |
| Hoàn đơn trả bằng XU | `+total` xu | — | `ceil(total/1000)` điểm lô CONVERTED | mục 6.2 | `points_transactions_converted_refund_unique` (`ORDER_REFUND_XU:<code>`) + guard PAID→REFUNDED |
| Gộp phiên khách | chuyển số dư | — | chuyển `pointsConvertedBalance` | mục 2.8 | khoá dòng hiện có |

Đọc lịch sử cũ (bắt buộc, chống cấp lại): sau gộp không có dòng coin mới, nhưng mọi kiểm "đã nhận chưa" phải xem CẢ `coin_transactions` (lịch sử trước gộp) lẫn `points_transactions`:
- Giới thiệu: `countReferralSuccesses`, `readMilestoneState`, `findReferralRewardedOrders`, `grantReferralOrderReward` (`referral-reward.ts:53-92,222-234`; `coins.service.ts:150-157`) đọc hợp hai sổ qua một hàm trong `referral-reward.ts`. Không thì người được mời đã thưởng bằng xu sẽ được thưởng lại bằng điểm (index points không thấy dòng coin).
- Thu hồi thưởng giới thiệu cấp bằng xu trước gộp: trừ lô CONVERTED `ceil(xu/1000)` (giá trị đó đã nằm trong lô quy đổi); thưởng cấp bằng điểm sau gộp: trừ lô STANDARD. Không âm, phần thiếu ghi dòng `delta 0` refType `REFERRAL_DEBT` như `referral-reward.ts:123-133`. `lockReferrer` (`:46-50`) đổi sang khoá dòng user và trả cả hai số dư.
- Cộng đồng: `rewardBestAnswer` đổi câu hay nhất trên bài đã thưởng bằng xu không được cấp lần 2 (kiểm dòng coin cùng reason). Trần/ngày (`community-reward.service.ts:36-38`) đếm cả hai sổ.
- Nhiệm vụ gian hàng: `claimed` = có dòng QUEST ở coin HOẶC points.

CẢNH BÁO RỦI RO ĐƠN VỊ và cách chặn:
1. Không đọc lại khoá xu dưới tên điểm: khoá mới tên khác (`*_points`), khoá cũ vào DEAD; test quét `apps/api/src` không còn chuỗi `'coins.referrer_reward'`, `'coins.referral_milestones'`, `'community.post_reward'`, `'community.answer_reward'`, `'community.best_answer_reward'`, `'game.tree_xu_price'`, `'game.plot_unlock_xu_base'`, `'game.xu_per_seed'`, `'wallet.xu_convert_multiplier'` ngoài `dead-config-keys.ts`.
2. Giá trị khoá mới tạo bằng migration tính từ giá trị DB hiện tại `CEIL(giá trị / 1000)` (giữ thiết lập admin đã sửa); SQL đầy đủ ở mục 3.1 (đã chạy thử, có bắt lỗi làm tròn). Khoá không có dòng DB thì seed tạo với mặc định trong bảng trên.
3. RANGES (`system-config.service.ts:56-84`) thêm: `referral.referrer_reward_points` 0–100, `community.*_reward_points` 0–20, `game.tree_points_price` 1–500, `loyalty.vnd_per_point_redeem` 1000–1000 (đổi tỉ giá phá giá trị lô quy đổi; xem OQ-11). Admin gõ 5000 vào khoá điểm bị từ chối lúc ghi.
4. `RewardPointsService.grant` từ chối > 2.000 điểm/lần (chặn lúc chạy nếu khoá DB đã sai từ trước).
5. JSON mốc giới thiệu đổi tên trường (`bonus` → `bonusPoints`) nên bản cũ đọc nhầm không cấp gì.
6. `CommunityEvent.rewardPoints` DTO `@Max(1000)`; miniapp admin tạo sự kiện nhập "Điểm Xanh".

Test chặn (mục 8): `points-unit-guard.spec.ts`.

---

## 5. Bỏ đổi Ví → Xu

| Việc | Cách làm |
|---|---|
| `POST /wallet/convert-xu` (`wallet.controller.ts:50-58`) | Giữ route, trả `410 Gone` "Đổi Ví sang xu đã ngừng. Tiền trong Ví Tubu vẫn rút được hoặc trả đơn." (cùng kiểu `buySeeds` `game.service.ts:358-360`). Không mở tx, không trừ ví. Xoá thân `convertToXu` (`wallet.service.ts:79-147`). |
| `GET /me/wallet` (`wallet.service.ts:20-45`) | bỏ `coinsBalance`, `xuConvertMultiplier` khỏi payload. |
| `GET /me/coins` (`wallet.controller.ts:60-63`) | 410; thống kê giới thiệu chuyển sang `GET /me/referral` (`referralCode`, `successCount`, `earnedPoints` = SUM delta REFERRAL ở points + `ceil(SUM coin REFERRAL/1000)` cho phần cũ, `milestones[{count,bonusPoints}]`, `nextMilestone`). |
| `WalletTxType.XU_CONVERT` | giữ enum + dòng sổ cũ; nhãn sao kê `wallet-rules.ts:41` đổi "Đổi sang xu (nay là Điểm Xanh)". |
| Thưởng ×1.2 | chấm dứt khi BE mới chạy. Khoá `wallet.xu_convert_multiplier` vào DEAD, gỡ RANGES. |
| `coin_transactions_convert_ref_key` | giữ (lịch sử, không có dòng mới). |
| Mẫu tin `CASHBACK_PAID` (`seed.ts:677`) | bỏ câu "Đổi sang TubuXu để nhận thêm 20%"; migration UPDATE có `WHERE "bodyTemplate" = <bản cũ>` (giữ bản admin đã sửa, như PD-1). |

---

## 6. Nơi tiêu xu

### 6.1 Thanh toán đơn bằng XU

- Bỏ `'XU'` khỏi `CHECKOUT_PAYMENT_METHODS` (`checkout.dto.ts:30`) → gửi XU nhận 400 từ validator. Gỡ nhánh `checkout.service.ts:188-189,334-338`; `paid` ở `:197` chỉ còn WALLET; bỏ đọc `loyalty.earn_points_on_xu` ở `:204-206`.
- Thay bằng: điểm quy đổi tiêu qua `pointsToUse` (mục 2.3), không phải phương thức thanh toán.
- Giữ `PaymentMethod.XU` trong enum Prisma/shared-types (đơn cũ). `order-transition.ts:95` giữ `XU: true` (đơn XU cũ vẫn là trả trước).
- Lối vào khác: đơn CTV lên hộ chỉ nhận COD/BANK_TRANSFER (`place-order-for-customer.dto.ts:61`), gói định kỳ chỉ COD/WALLET/BANK_TRANSFER (`subscriptions.service.ts:30`). Không còn đường nào tạo đơn XU.

### 6.2 Đơn XU cũ bị huỷ / trả sau gộp

- `order-reversal.service.ts:115-128`: thay cộng xu bằng dòng points lot CONVERTED `delta = ceil(order.total / 1000)`, reason `ORDER_REFUND_XU:<code>`, refType ORDER, refId order.id, `expiresAt NULL`, cộng `pointsConvertedBalance`. Guard một lần: `updateMany PAID→REFUNDED` có sẵn (`:98-108`) + index `points_transactions_converted_refund_unique`.
- Không hoàn về Ví (xu không ra tiền, Q-03a). Làm tròn lên: khách lời ≤ 999đ/đơn, đếm bằng truy vấn 3.3 (d).
- `moneyRefunded` (`:108`) vẫn true để caller báo "đã hoàn"; câu thông báo đổi thành "đã hoàn N Điểm Xanh".
- Đơn XU `placedForCustomer`: không tồn tại (lên hộ không nhận XU, mục 6.1); nhánh `refundEndCustomer` không phải xử lý XU, thêm assert + log nếu gặp.
- Đơn XU không bao giờ ở `PENDING_PAYMENT`: tạo ra là CONFIRMED + PAID (`checkout.service.ts:197-198`). Đơn XU đang CONFIRMED/PACKED/SHIPPING vẫn giao bình thường.

### 6.3 Game

| Lối | Hiện tại | Khuyến nghị | Hệ quả kinh tế |
|---|---|---|---|
| Mở lô vườn bằng xu `POST /game/garden/unlock {currency:'XU'}` | `200 × slot` xu (`game-garden.service.ts:118-121`) | BỎ. DTO chỉ nhận `SEEDS`; `'XU'` → 410 "Mở lô bằng xu đã ngừng, dùng giọt nước". `nextUnlock` bỏ `xuCost`. | 200 xu = 0,2 điểm, quy 1.000:1 phải làm tròn lên thành 1 điểm/lô (tăng giá ×5) hoặc xuống 0 (miễn phí). Mở lô bằng điểm còn mở rộng sức thu hoạch mã giảm giá 30k (trần 3/ngày ở `game-garden.service.ts:146-149`). Giọt nước đã là tiền game. |
| Góp quỹ trồng cây `POST /game/tree/buy` | 50.000 xu (`game.service.ts:363-372`) | Giữ, giá `game.tree_points_price` = 50 Điểm Xanh; tiêu STANDARD trước, thiếu thì CONVERTED (OQ-5). Reason `GAME_BUY_TREE:<cert>` refType GAME; nếu tiêu hai lô thì 2 dòng (`…` lot STANDARD và lot CONVERTED). | 50 điểm = 50.000đ, giá trị không đổi. Không sinh giá trị mới (không trả điểm/mã ngược lại), nên không thể rút lô quy đổi ra giá trị lớn hơn số đã bỏ. |
| Vòng quay, đổi voucher | điểm | chỉ STANDARD (không đổi mã) | Lô quy đổi không vào được vòng quay có kỳ vọng thưởng (`seed.ts:159-171`). |
| Mua giọt nước bằng xu | 410 từ PA-5 | giữ 410, đổi chữ "xu" trong lời báo thành "Tính năng mua giọt nước đã ngừng…" | — |
| `getProfile` trả `xuPerSeed`, `treeXuPrice` (`game.service.ts:66-72`) | — | bỏ `xuPerSeed`, đổi `treeXuPrice` → `treePointsPrice` | — |

### 6.4 Xoá tài khoản, đảo đơn

- `account-deletion.service.ts`: mục 2.8.
- `order-reversal.service.ts:198-204`: lời log "xu" → "điểm"; thu hồi giới thiệu theo mục 4.

---

## 7. UI / API / chữ

### 7.1 API trả về

| Payload | Thay đổi |
|---|---|
| `AuthUser` (`shared-types/src/auth.ts:25`, `auth.service.ts:614`) | Bỏ `coinsBalance`; thêm `pointsConvertedBalance`. Bỏ trường (không giữ = 0) để `tsc` chỉ ra mọi chỗ FE còn dùng. An toàn vì không có client cũ: miniapp chưa lên Zalo; web PROD `cb92dc8` không đọc `coinsBalance` (mục 1.4). |
| `GET /me/wallet` | bỏ `coinsBalance`, `xuConvertMultiplier`. |
| `GET /loyalty/me` (`loyalty.service.ts:428-470`) | thêm `pointsConvertedBalance`, `pointsTotal`; `redeemablePoints` giữ nghĩa STANDARD dùng được; thêm `redeemableTotal = redeemablePoints + pointsConvertedBalance`. Dòng lịch sử trả `lot`. |
| `POST /checkout/quote` | thêm `pointsUsedConverted`, `redeemableConvertedPoints`. |
| `GET /game/profile`, `GET /game/garden` | mục 6.3. |
| `POST /storefront/me/quests/:code/claim` (`storefront-quest.service.ts:121`) | `rewardPoints`, `pointsBalance` thay `rewardXu`, `coinsBalance`. |
| Affiliate milestones (`affiliate.service.ts:959,1058-1062`) | `rewardPoints`, `milestoneRewardPoints`; thông báo "Chúc mừng bạn đã nhận N Điểm Xanh từ …". |
| `GET /me/coins`, `POST /wallet/convert-xu`, `POST /game/garden/unlock` với XU | 410 Gone (1 bản phát hành), sau đó gỡ ở PD-2-kiểu dọn. |
| Admin account-deletion list (`account-deletion.service.ts:62-75`) | `pointsConvertedBalance` thay `coinsBalance`. |

### 7.2 Màn hình phải đổi (Q-26: không còn "TubuXu"/"xu")

| Màn | file | Đổi |
|---|---|---|
| Hub Cá nhân | `miniapp/src/pages/profile.tsx:266-287` | Bỏ ô "TubuXu": còn 3 ô Điểm Xanh (tổng hai lô), Ví Tubu, Mã giảm giá (C-047 "hub ≤ 3 số dư"). |
| Ví | `miniapp/src/pages/wallet.tsx` (dòng ở 1.4) | Bỏ thẻ TubuXu, nút/sheet đổi, mẹo ×1.2; khối mời bạn đọc `/me/referral`, đơn vị Điểm Xanh. Làm sau PD-1 (cùng file). |
| Thanh toán | `miniapp/src/pages/checkout.tsx`, `utils/checkout-rules.ts` | Bỏ phương thức TubuXu; ô "Dùng Điểm Xanh" hiện "trong đó N điểm không hết hạn, trả tới 100% giá trị hàng"; đơn 0đ ẩn chọn phương thức. Bỏ điều kiện `payment !== 'XU'` ở `:734,867`. |
| Điểm Xanh / hạng | `miniapp/src/pages/loyalty.tsx`, `services/account-api.ts:220-229` (`pointsReasonLabel`) | Hiện tổng + phần không hết hạn; nhãn `XU_TO_POINTS` "Chuyển từ xu sang Điểm Xanh", `ORDER_REDEEM_CONVERTED` "Dùng điểm khi thanh toán", `ORDER_REFUND_CONVERTED`/`ORDER_REFUND_XU` "Hoàn điểm đơn huỷ/trả", `REFERRAL_*`, `COMMUNITY_*`, `STOREFRONT_QUEST`, `CTV_MILESTONE`. |
| Game | `garden-plots.tsx:25-86`, `tree-actions.tsx:26-29`, `use-game-actions.ts:136,145`, `services/game-api.ts`, `i18n/vi.ts:707-708` | Bỏ nút mở lô bằng xu; góp quỹ "50 Điểm Xanh". |
| CTV | `pages/affiliate.tsx:240-241,279,449,497`, `components/affiliate/milestone-copy.ts` | "Thưởng mốc +N Điểm Xanh", "Đã cộng vào Điểm Xanh". |
| Gian hàng | `pages/storefront-builder.tsx:606-657` (+ chú thích `:203,307,723`) | "+N Điểm Xanh". |
| Cộng đồng | `pages/community-events.tsx:60`, `community-moderation.tsx:444`, `i18n/vi.ts:676` | "Thưởng N Điểm Xanh"; form admin nhập điểm. |
| FAQ | `pages/about-data.ts:38` | "… trả bằng Ví Tubu; dùng Điểm Xanh để giảm giá". |
| Định dạng | `utils/format.ts:91-98`, `components/ui/price-tag.tsx:54-55`, `i18n/vi.ts:209,377` | Xoá `formatXu`, `Xu`, `paymentXu`; nhãn đơn cũ `XU: 'Điểm Xanh (xu cũ)'`. |
| Web khách | `web/src/lib/order-view.ts:26` | `XU: 'Điểm Xanh (xu cũ)'`. |
| Admin web | `web/src/lib/export-csv.ts:38`, `components/admin/account-deletion-panel.tsx:26,146` | CSV `XU: 'Xu cũ (đã gộp Điểm Xanh)'`; panel "N Điểm Xanh không hết hạn". |
| Thông báo | `seed.ts:677,716` + migration UPDATE mẫu tin | `COMMUNITY_BEST_ANSWER`: "Bạn nhận thêm Điểm Xanh thưởng." |
| Thông báo quy đổi (đề xuất OQ-10) | mẫu tin mới `XU_CONVERTED` | "N xu của bạn đã thành M Điểm Xanh không hết hạn, dùng trả tới 100% giá trị hàng." |

Lệnh kiểm chữ: `rg -n -P "(?i)(tubu ?xu|(?<![\p{L}_])xu(?![\p{L}_]))" apps/miniapp/src apps/web/src -g '!*.spec.*'` chỉ còn nhãn đơn cũ "(xu cũ)" và chú thích kỹ thuật.

---

## 8. Test plan

Race spec chạy Postgres thật theo quy ước `test/integration-race` (DB tên `tubutree_it`, `setup-env.ts:5-8`), container riêng của lượt.

| # | Loại | Ca kiểm | File đề xuất |
|---|---|---|---|
| T1 | race | Migration B trên DB có dữ liệu mẫu (user 0 xu, 1 xu, 999, 1.000, 1.001, 123.456, user có cả điểm thường): `pointsConvertedBalance == ceil(coins/1000)` từng user; `coinsBalance = 0`; `roundingVnd ∈ [0,999]`; SUM `coin_transactions` = 0; bất biến 2 lô. | `pd3-xu-migration.race-spec.ts` |
| T2 | race | Chạy migration B lần 2 (và lần 3 sau khi chèn tay user có xu mới) → không nhân đôi: số dòng `XU_MIGRATION` không đổi với user cũ; user mới được quy đổi đúng 1 lần. | như trên |
| T3 | race | Dữ liệu lệch (`coinsBalance` ≠ SUM) hoặc âm → migration RAISE, không ghi gì. | như trên |
| T4 | migrate | `prisma migrate deploy` trên DB TRỐNG chạy hết, `check-partial-indexes.ts` báo đủ 20 index. | CI + `partial-unique-indexes.race-spec.ts` |
| T5 | race | Bất biến trước gộp: trên dữ liệu seed + luồng hiện có, `pointsBalance == SUM(delta)` (kiểm bất biến đang đúng); sau gộp: hai bất biến theo lô cho mọi user sau mỗi ca. | `pd3-points-lots.race-spec.ts` |
| T6 | race | Checkout song song: 5 đơn cùng tiêu điểm quy đổi của 1 user (đủ cho 2 đơn) → đúng 2 đơn thành công, `pointsConvertedBalance ≥ 0`, không âm. Song song checkout + vòng quay + đổi voucher: STANDARD không âm, CONVERTED không bị vòng quay/voucher chạm. | như trên |
| T7 | race | Cron `expirePoints` với user có lô CONVERTED cũ + lô STANDARD hết hạn + dòng tiêu cả hai lô: chỉ trừ đúng phần STANDARD hết hạn; `pointsConvertedBalance` không đổi; chạy 2 lần không trừ đôi. | `pd3-points-lots.race-spec.ts` + unit `loyalty-expiry.service.spec.ts` |
| T8 | unit | Không trần 20%: đơn 500.000đ, STANDARD 1.000 điểm, CONVERTED 1.000 điểm, `pointsToUse` 1.000 → s = 100, c = 400, giảm 500.000đ, tổng = phí ship. Đơn có phần lẻ (`redeemBase` 123.456đ) → c tối đa 123 − s. | `checkout.service.spec.ts`, `pricing.service.spec.ts` |
| T9 | unit | Thứ tự tiêu: STANDARD tới trần trước rồi CONVERTED; STANDARD đang khoá (`lockedOrderPoints`) không tiêu; khách chỉ có CONVERTED vẫn giảm được 100%. | `checkout.service.spec.ts` |
| T10 | race | Huỷ đơn đã tiêu cả hai lô → hoàn đúng `ORDER_REFUND_POINTS` (STANDARD) + `ORDER_REFUND_CONVERTED` (CONVERTED); huỷ 5 lần song song (khách huỷ + admin + webhook) → hoàn đúng 1 lần mỗi lô. | `order-cancel.race-spec.ts` (mở rộng) |
| T11 | race | Đơn XU cũ (tạo trực tiếp trong DB với `paymentMethod='XU'`, PAID) bị huỷ sau gộp → `+ceil(total/1000)` CONVERTED, `coinsBalance` vẫn 0, không đụng Ví; gọi lại không hoàn lần 2. | `pd3-legacy-xu-orders.race-spec.ts` |
| T12 | unit | Xét hạng: user có 5.000 điểm quy đổi + 0 đơn → hạng nền; đơn trả hoàn toàn bằng điểm quy đổi không tăng chi tiêu 12 tháng; `tierPoints` không tính `XU_TO_POINTS`. | `loyalty.service.spec.ts` |
| T13 | race | Giới thiệu: người được mời đã thưởng bằng xu trước gộp → không thưởng lại bằng điểm; trả đơn → trừ CONVERTED `ceil(xu/1000)`, thiếu ghi REFERRAL_DEBT; thưởng mới bằng điểm → STANDARD có hạn; thu hồi trừ STANDARD. 5 lần song song chỉ 1 dòng. | `referral-order2.race-spec.ts` (viết lại phần xu) |
| T14 | race | Nhiệm vụ gian hàng đã nhận bằng xu → claim lại báo đã nhận, không cấp điểm; câu trả lời hay nhất đổi trên bài đã thưởng xu → không cấp; claim song song 5 lần → 1 dòng. | `pd3-reward-sources.race-spec.ts` |
| T15 | race | Gộp khách có `pointsConvertedBalance` và dòng QUEST trùng → số dư cộng đúng, index QUEST không nổ. | `auth-merge-guest.race-spec.ts` |
| T16 | unit | CHẶN LỖI ĐƠN VỊ: (a) quét `apps/api/src` không còn đọc khoá xu cũ ngoài `dead-config-keys.ts`; (b) mọi khoá `*_points` có RANGES và mặc định trong seed ≤ max; (c) `RewardPointsService.grant(…, 20000)` ném lỗi, không ghi; (d) `referral.milestones_points` dạng cũ `{bonus:20000}` → không cấp; (e) `seasonpass.tiers` `type:'XU'` → không cấp; (f) `SystemConfigService.set('referral.referrer_reward_points', 5000)` → 400; (g) `CTV_MONTHLY_MILESTONES` và `QUESTS` tổng điểm đúng bảng mục 4. | `points-unit-guard.spec.ts` |
| T17 | race | Sau migration C: gọi đường ghi xu cũ còn sót (giả lập `UPDATE users SET coinsBalance = 1`) → vi phạm `users_coins_frozen`. | `pd3-xu-migration.race-spec.ts` |
| T18 | unit/API | `POST /wallet/convert-xu`, `GET /me/coins`, unlock `'XU'` → 410; checkout `paymentMethod='XU'` → 400; đơn tổng 0đ → COD CONFIRMED. | spec controller/service |
| T19 | FE | `profile-hub.spec.tsx`: đúng 3 ô số dư; quét `apps/miniapp/src`, `apps/web/src` không còn "TubuXu"/"xu" hướng khách (giống `tree-fund-copy.spec.ts` của PD-1); checkout không có lựa chọn XU. | miniapp/web spec |
| T20 | e2e | mock bỏ `coinsBalance`; luồng checkout dùng điểm quy đổi; Ví không còn nút đổi. | `apps/e2e/tests` |
| T21 | rollback | Áp SQL hoàn tác 3.5 trên bản DB sau T1: `coinsBalance` về đúng `coinsBefore` khi lô nguyên; chạy 2 lần không nhân đôi. | `pd3-xu-migration.race-spec.ts` |

---

## 9. Kế hoạch công việc (5 lượt tuần tự)

| Lượt | Phạm vi (file sở hữu) | Kiểm chứng chính |
|---|---|---|
| L1 Schema + migration + mô hình điểm (opus) | `prisma/schema.prisma`; migration A, B; `prisma/check-partial-indexes.ts`; `loyalty/loyalty-expiry.service.ts` (lọc lot); `loyalty/points-reconcile.ts` + `scripts/reconcile-points.ts` (đối soát theo lô); helper ghi điểm theo lô (`loyalty/points-ledger.ts` mới); `auth/auth.service.ts` (gộp khách); `users/account-deletion.service.ts`; race spec T1–T5, T7, T15, T21 | `npx prisma migrate deploy` trên DB trống + DB mẫu; race spec trên; `npx tsc --noEmit`; jest loyalty/auth/users |
| L2 Nguồn cộng (opus) | `wallet/coins.service.ts` → `RewardPointsService` (giữ file đọc lịch sử coin), `wallet/referral-reward.ts`, `feed/community-reward.service.ts`, `feed/community-feed.*` (rewardPoints), `storefront/storefront-quest.service.ts`, `affiliate/affiliate.service.ts` + `ctv-milestones.ts`, `game/season-pass.service.ts`, `system-config/*` (RANGES, DEAD), migration khoá config `*_points` + seasonpass JSON; T13, T14, T16 | race referral/reward; `points-unit-guard.spec.ts`; `dead-config-keys.spec.ts`; jest wallet/feed/storefront/affiliate/game |
| L3 Nơi tiêu (opus) | `checkout/*` (chia lô, bỏ XU, đơn 0đ), `pricing/pricing.service.ts`, `loyalty/loyalty.service.ts` (reverseOrderPoints, overview), `orders/order-reversal.service.ts` (đơn XU cũ), `game/game-garden.service.ts`, `game/game.service.ts`, `game/game.controller.ts`, `wallet/wallet.service.ts` + controller (410), migration C (đóng băng xu); T6, T8–T12, T17, T18 | race checkout/huỷ/đơn XU cũ; full jest API; `grep -rn "coinsBalance.*increment\|spendCoins\|grantCoins" apps/api/src` rỗng (trừ test) |
| L4 FE miniapp + web + admin (sonnet, sau khi PD-1 đã vào nhánh nền) | `apps/miniapp/src/**` các file mục 7.2, `packages/shared-types`, `apps/web/src/lib/{order-view,export-csv}.ts`, `apps/web/src/components/admin/account-deletion-panel.tsx`; T19 | vitest miniapp/web; `tsc --noEmit`; eslint; ảnh màn hub/ví/checkout |
| L5 Dọn chữ, seed, mẫu tin, e2e (sonnet) | `prisma/seed.ts`, migration UPDATE mẫu tin (`CASHBACK_PAID`, `COMMUNITY_BEST_ANSWER`, mẫu mới `XU_CONVERTED`), chú thích API còn "xu", `apps/e2e/tests/**` mock; T20; chạy lại toàn bộ T1–T21 | full jest API + race + vitest + e2e mock; lệnh quét chữ mục 7.2; truy vấn 3.3 trên DB mẫu |

Thứ tự an toàn: L1 không đổi hành vi khách (chỉ thêm lô, quy đổi số dư, lọc hết hạn); L2 trước L3 vì L3 thêm migration C chặn mọi ghi xu, nên mọi nguồn cộng phải đã chuyển sang điểm. Cả 5 lượt nằm trên một nhánh và deploy MỘT LẦN (migration B và C chạy cùng lúc container mới khởi động).

---

## 10. Rollback + deploy

Thứ tự: BE (container mới: `migrate deploy` A → khoá config → B → C, rồi `node dist/main.js`, `Dockerfile:39`) → web → miniapp.

Tắt ghi xu trước khi migrate:
1. Một instance (Q-23). `docker compose up -d` dừng container cũ trước khi tạo container mới, nên không có code cũ chạy lúc migration B (không cron, không request).
2. Migration B `LOCK TABLE users, coin_transactions IN SHARE ROW EXCLUSIVE MODE` (lớp hai, giống `20261010041004_wallet_ledger/migration.sql:39`).
3. Migration C `users_coins_frozen`: mọi ghi xu còn sót sau đó nổ thay vì sinh xu.
4. Bản BE mới không còn đường ghi xu (L3 kiểm bằng grep).

Trước deploy (điều phối viên/chủ dự án): `pg_dump` PROD; chạy 3.3 (a)–(e) trên bản sao PROD; nếu (b) ≠ 0 thì đối soát trước; ghi số (a) vào báo cáo.

Khi migration dừng giữa chừng:
- `apps/api/Dockerfile:39` chạy `prisma migrate deploy && node dist/main.js` với `restart: unless-stopped`. Một migration fail thì `migrate deploy` thoát lỗi, container restart và lặp lại: CẢ image mới lẫn image cũ (cùng lệnh khởi động) crash-loop với P3009 (có migration failed chưa resolve) cho tới khi người vận hành xử lý.
- Tìm migration lỗi: `SELECT migration_name, finished_at, logs FROM _prisma_migrations WHERE finished_at IS NULL;`. Đánh dấu: `pnpm exec prisma migrate resolve --rolled-back <tên migration lỗi>`.
- Thứ tự cần nhớ: migration B (quy đổi xu) đã COMMIT trước khi migration khoá config (`20261012120000`) lỗi; `migrate resolve --rolled-back` chỉ đánh dấu migration lỗi để chạy lại được, KHÔNG hoàn tác B. Sau khi sửa dữ liệu (hoặc sửa migration) thì deploy lại. Muốn hoàn tác dữ liệu B phải dùng SQL 3.5 theo đúng điều kiện ở trên.
- Khuyến nghị: chạy migration như một bước RIÊNG trước `up -d`: `docker compose -f docker-compose.vietnix.yml run --rm --no-deps api pnpm exec prisma migrate deploy`. Lỗi thì dừng tại đó, container cũ vẫn chạy (chưa bị thay), không crash-loop. Chỉ `up -d` khi bước này thành công.
- Migration khoá config đã tự bỏ qua giá trị xấu (không dừng); chạy `apps/api/prisma/manual/pd3_measure_before_deploy.sql` mục (g)-(j) trên bản sao PROD để biết trước giá trị nào bị bỏ qua.

Hoàn tác:
- Trước khi có đơn tiêu điểm quy đổi: dựng lại image API trước PD-3 (KHÔNG chạy `migrate deploy` của bản cũ thì cột mới vẫn còn, code cũ bỏ qua) + chạy SQL 3.5. Web/miniapp quay bản cũ.
- Sau khi đã có đơn tiêu điểm quy đổi: chỉ sửa tiến (hotfix BE), không hoàn tác dữ liệu.

Theo dõi sau deploy (7 ngày):
- Truy vấn "sau migration B" ở 3.3 mỗi ngày (bất biến 2 lô, `coinsBalance` = 0).
- Log `users_coins_frozen` / 23514 (vi phạm CHECK) = 0; log `RewardPointsService` từ chối > 2.000 điểm = 0.
- Số request 410 tới `/wallet/convert-xu`, `/me/coins` (phát hiện client lạ).
- `SELECT count(*), sum("pointsUsedConverted") FROM orders WHERE "createdAt" > <deploy>`; đơn 0đ.
- Cron 01:00 `expirePoints`: tổng trừ không tăng bất thường; `pointsConvertedBalance` tổng không giảm trừ do đơn.
- Khiếu nại khách về số điểm sau chuyển đổi.

---

## 11. Giả định và câu hỏi mở

Đã quyết (Q-03a / Q-03 / Q-26 / Q-09): tỉ lệ 1.000:1 làm tròn lên; lô quy đổi không hết hạn, không trần 20%, không rút, không về Ví; giữ `coin_transactions`; bỏ đổi Ví → xu; bỏ chữ TubuXu; hạng chỉ tính mua.

Đề xuất của kiến trúc sư (cần chủ dự án duyệt; cột "Hệ quả tiền"):

| Mã | Giả định / đề xuất | Hệ quả tiền |
|---|---|---|
| OQ-1 | Thưởng MỚI (giới thiệu, mốc CTV, cộng đồng, nhiệm vụ, Season Pass) là Điểm Xanh thường: hết hạn 12 tháng, trần 20%/đơn. | Mốc CTV 80 triệu = 2.000 điểm (2 triệu đồng) trước đây trả được 100% đơn, nay chỉ ≤ 20%/đơn và hết hạn sau 12 tháng: CTV nhận giá trị dùng được thấp hơn. Phương án khác: cấp vào lô quy đổi (chi phí Tubu cao hơn). |
| OQ-2 | Điểm (cả lô quy đổi) chỉ trừ vào giá trị hàng, không trừ phí ship; phần lẻ < 1.000đ phải trả tiền. | Khách có xu trước đây trả được 100% tổng đơn gồm ship; nay mỗi đơn tự trả ship và ≤ 999đ lẻ. Phương án khác: cho lô quy đổi trừ cả phí ship. |
| OQ-3 | Lô quy đổi không dùng cho vòng quay, đổi voucher catalog, mở lô vườn. | Ngăn biến tiền trả trước thành phần thưởng game; khách ít lối tiêu hơn. |
| OQ-4 | Bỏ mở lô vườn bằng xu (chỉ giọt nước). | Không còn sink xu trong game ngoài góp quỹ. |
| OQ-5 | Góp quỹ trồng cây = 50 Điểm Xanh, tiêu lô thường trước, thiếu thì lô quy đổi. | Mỗi lượt Tubu cam kết 50.000đ vào quỹ; nguồn trả có thể là điểm thưởng miễn phí (như xu hôm nay). |
| OQ-6 | Cộng đồng: đăng bài 1 điểm (≤ 1/ngày), trả lời 0, hay nhất 1 (≤ 3/ngày). | Trần/ngày 4.000đ, gần mức hiện tại 4.100đ (3×200 + 10×100 + 5×500 xu). |
| OQ-7 | Nhiệm vụ gian hàng 2/2/2/1/5 điểm (1.500 xu làm tròn lên 2). | Tổng 12.000đ/CTV thay vì 11.500đ. |
| OQ-8 | Đơn XU cũ huỷ/trả → hoàn `ceil(total/1000)` điểm lô quy đổi, không về Ví. | Khách lời ≤ 999đ/đơn; đo bằng 3.3 (d). |
| OQ-9 | Thu hồi thưởng giới thiệu cấp bằng xu → trừ lô quy đổi `ceil(xu/1000)`, không âm, thiếu ghi nợ. | Có thể trừ vào phần tiền trả trước của người mời (giá trị thưởng đã trộn vào lô quy đổi). |
| OQ-10 | Gửi thông báo trong app cho người có xu về việc quy đổi. | Không tốn tiền; giảm khiếu nại. |
| OQ-11 | Khoá `loyalty.vnd_per_point_redeem` bị khoá cứng 1.000 (RANGES 1000–1000). | Đổi tỉ giá sau gộp sẽ làm lô quy đổi (tiền trả trước) mất/tăng giá trị. |
| OQ-12 | "Ví trả một phần đơn" (Q-03 phương án 1) chưa có trong mã; đề xuất gói riêng sau PD-3. | Không đổi tiền trong PD-3. |
| OQ-13 | Migration dừng (RAISE) nếu sổ xu lệch hoặc số dư âm, chặn deploy tới khi đối soát. | Bảo vệ tiền trả trước; đổi lại có thể trễ deploy. |
| OQ-14 | Xoá tài khoản bị chặn khi còn điểm quy đổi > 0 (như xu hôm nay). | Khách muốn xoá phải tiêu hết hoặc chủ dự án quyết cho bỏ. |
| OQ-15 | Đã có sẵn, không đổi: điểm thường hoàn khi huỷ đơn (`ORDER_REFUND_POINTS`) ghi `expiresAt NULL` (`loyalty.service.ts:175-182`) nên không bao giờ hết hạn. | Rò nhỏ có sẵn, nêu để biết; ngoài phạm vi PD-3. |

---

## Điểm rủi ro tiền (xếp theo mức độ)

| # | Mức | Rủi ro | Cách chặn |
|---|---|---|---|
| R1 | Cao | Đọc giá trị config tính bằng xu thành điểm (vd 20.000 xu → 20.000 điểm = 20 triệu đồng); hoặc làm tròn sai khi chia (đã gặp ở bản nháp: `((5000+999)/1000)::int` trên numeric = 6). | Khoá mới `*_points`, khoá cũ DEAD + test quét; RANGES chặn ghi; `RewardPointsService.grant` từ chối > 2.000; đổi tên trường JSON; SQL dùng `CEIL(numeric/1000)`; T16 + kiểm giá trị sau migration config. |
| R2 | Cao | Quy đổi chạy hai lần hoặc chạy lúc code cũ còn ghi xu → nhân đôi/mất xu. | Container cũ dừng trước; LOCK TABLE; PK bảng chụp + id cố định + 2 partial unique; điều kiện `coinsBalance = coinsBefore > 0`; T1–T2. |
| R3 | Cao | Lô quy đổi lọt vào FIFO hết hạn → cron trừ sai (khách mất tiền trả trước hoặc Tubu mất). | `loadTxns` lọc `lot='STANDARD'`; CHECK `converted_no_expiry`; T7. |
| R4 | Cao | Thưởng lại lần 2 vì kiểm "đã nhận" chỉ nhìn sổ mới (giới thiệu, nhiệm vụ, hay nhất). | Đọc hợp hai sổ ở mọi kiểm idempotent; T13–T14. |
| R5 | Cao | Hoàn đơn sai lô (điểm quy đổi hoàn thành điểm thường có hạn, hoặc ngược lại) / hoàn 2 lần. | `orders.pointsUsedConverted`; reason riêng + index `converted_refund_unique`; thêm vào kiểm "đã đảo"; T10. |
| R6 | Trung bình | Lô quy đổi tiêu qua vòng quay/đổi voucher, biến tiền trả trước thành thưởng có kỳ vọng dương. | Cột số dư riêng: guard cũ chỉ thấy STANDARD; T6. |
| R7 | Trung bình | Đường ghi xu còn sót sau gộp sinh xu mới không ai thấy. | Migration C `users_coins_frozen`; grep rỗng ở L3; T17. |
| R8 | Trung bình | Dữ liệu xu lệch/âm trên PROD làm migration dừng giữa deploy. | Chạy 3.3 (b) trên bản sao trước; RAISE có thông báo rõ. |
| R9 | Trung bình | Đơn 0đ (điểm phủ hết) treo PENDING_PAYMENT rồi tự huỷ. | Ép COD/CONFIRMED khi `total = 0`; T18. |
| R10 | Thấp | Chi phí làm tròn lên (≤ 999đ/người, ≤ 999đ/đơn XU cũ). | Đo bằng 3.3 (a)(d) và ghi vào báo cáo. |
| R11 | Thấp | Gộp khách quên `pointsConvertedBalance` → mất lô quy đổi của phiên khách. | L1 sửa `mergeGuestInto`; T15. |
| R12 | Thấp | Hoàn tác sau khi khách đã tiêu lô quy đổi. | Chỉ hoàn tác khi `pointsUsedConverted` = 0 toàn hệ; sau đó sửa tiến. |

---

## Kiểm chứng SQL (chạy thử bản nháp, 2026-10-11)

Môi trường: container `tubu_it_main` (PostgreSQL 16.15), DB tạm `pd3_spec_scratch` tạo mới rồi `DROP` sau khi xong; không đụng `tubutree_it`. Áp lần lượt toàn bộ `apps/api/prisma/migrations/*/migration.sql` bằng `psql -1 -v ON_ERROR_STOP=1` (mỗi file một transaction như Prisma), rồi các khối SQL trích thẳng từ file spec này.

```
migrations hiện có                         -> 14 partial unique index (khớp check-partial-indexes.ts)
migration A                                -> A_OK; 20 partial unique index
migration B trên DB trống                   -> B_OK; xu_points_conversions = 0 dòng
dữ liệu mẫu: u0 (0 xu, sổ +500 −500), u1 (1), u999 (sổ 1200 −201), u1000, u1001, u123456, upts (3000 xu + 50 điểm thường)
truy vấn (a) trước B: users_with_xu 6 | total_xu 129457 | total_points 132 | rounding_cost_vnd 2543 | max 124
migration B lần 2 (có dữ liệu):
  u1 1 xu -> 1 điểm (làm tròn 999đ) · u1000 -> 1 (0đ) · u1001 -> 2 (999đ) · u123456 -> 124 (544đ) · u999 -> 1 (1đ) · upts 3000 -> 3, pointsBalance giữ 50
  coinsBalance = 0 mọi user; u0 không có dòng quy đổi
migration B lần 3                          -> 6 dòng XU_MIGRATION ở mỗi sổ, 6 dòng bảng chụp, tổng lô quy đổi 132 (không đổi)
sau B: coins<>0 = 0 | lệch lô CONVERTED = 0 | lệch lô STANDARD = 0 | lệch sổ xu = 0 | tổng: 6 user, 132 điểm, 2543đ làm tròn, 129457 xu
user lệch sổ (coinsBalance 700, không có dòng sổ) -> ERROR "PD-3: 1 user có coinsBalance khác SUM(coin_transactions.delta)…", bảng chụp vẫn 6 dòng
user âm (−5)                               -> ERROR "PD-3: 1 user có coinsBalance âm…"
sửa hai user rồi chạy B lần 4              -> chỉ udrift được quy đổi (700 xu -> 1 điểm, 300đ)
migration C chạy 2 lần                     -> C_OK; UPDATE coinsBalance + 5 -> ERROR vi phạm "users_coins_frozen"
dòng CONVERTED có expiresAt                -> ERROR vi phạm "points_transactions_converted_no_expiry"
pointsConvertedBalance = −1                -> ERROR vi phạm "users_points_converted_nonneg"
hoàn tác 3.5 chạy 2 lần (u123456 đã tiêu 100/124 điểm quy đổi)
  -> lô nguyên trả đúng coinsBefore (u1 1, u1000 1000, u1001 1001, u999 999, upts 3000, udrift 700); u123456 nhận 24.000 xu (24 điểm còn lại)
  -> lệch sổ xu = 0, lệch lô CONVERTED = 0, 7 dòng XU_MIGRATION_ROLLBACK (không nhân đôi)
SQL đổi khoá config (bản nháp đầu, ((n+999)/1000)::int trên numeric): 5000 -> 6, 20000 -> 21, 50000 -> 51  (SAI)
SQL đổi khoá config (bản sửa, CEIL(n/1000)), chạy 2 lần: 5000 -> 5, 5001 -> 6, mốc 20000/40000/100000 -> 20/40/100,
  tree 50000 -> 50, seasonpass premium XU 5000/12001 -> POINTS 5/13, phần SEEDS giữ nguyên
community_events rewardXu 1500 -> rewardPoints 2
```

Hàm hết hạn thật (`computePointExpiry`, chép nguyên từ `loyalty-expiry.service.ts:44-89`) với lô quy đổi 100 (không hạn), thưởng thường 50 hết hạn 2027-01-01, khách tiêu 50 điểm thường, xét ngày 2027-01-02:

```
FIFO trên mọi dòng (sai):       expiredNow = 50   (lô quy đổi bị tính là đã tiêu, 50 điểm thường "còn" và bị trừ)
FIFO chỉ lot STANDARD (đúng):   expiredNow = 0
```
