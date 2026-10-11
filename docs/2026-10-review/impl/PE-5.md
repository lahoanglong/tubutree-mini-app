# PE-5: Dòng thu hồi ăn đúng lô gốc khi cron hết hạn điểm

Nhánh `hz15/PE-5`, base `a7415605`. Chỉ đụng `apps/api` (loyalty, một hàm của wallet, test). Không migration, không sửa checkout, order-reversal, `schema.prisma`. Không push, không deploy, không ghi DB dùng chung (Postgres throwaway cổng 5596, đã xoá).

Commit: `1beb214c` (mục 1), `a745d9b1` (mục 2), `0800003f` (siết test mục 1 sau khi chạy đột biến), commit kế tiếp ghim hai ca hồi tố của mục 3 và báo cáo này. Mục 3 không đổi mã.

## Mục 1: dòng âm của huỷ/trả đơn ăn sai lô

### Chứng minh lỗi trước (race Postgres thật, đỏ trước khi sửa)

`pe5-reversal-expiry.race-spec.ts` dùng `LoyaltyService`, `RewardPointsService`, hàm thu hồi thưởng giới thiệu và cron thật, "thời gian trôi" dựng bằng lùi `createdAt`/`expiresAt` như `pe3-reward-expiry`. Ca đề bài: lô cũ không hạn 30, đơn giao +20 có hạn (`creditOrderPoints`), trả đơn (`reverseOrderPoints` ghi `ORDER_REVERSED` -20), qua 13 tháng, cron hai lần. Kỳ vọng 30 và không có `POINTS_EXPIRED`; thực tế ra `POINTS_EXPIRED -20` và số dư 10. Lỗi có thật. Lượt chạy đỏ: 8/10 ca đỏ, 2 ca đối chứng (không có dòng thu hồi) xanh, mỗi ca đỏ đúng một lý do là có thêm dòng `POINTS_EXPIRED`:

- đơn giao +20 rồi huỷ, lô cũ không hạn: trừ thêm 20 (còn 10);
- hạ `loyalty.point_expire_months` 12 → 3, lô cũ hạn dài hơn: trừ thêm 15;
- đơn tiêu 40 điểm rồi bị trả (có cả `ORDER_REFUND_POINTS`): trừ 60 thay vì 40;
- hai đơn, chỉ trả một: trừ 30 thay vì 20;
- khách tiêu 25 điểm vào việc khác giữa chừng rồi đơn bị trả: trừ thêm 5 (còn 0 thay vì 5);
- thu hồi thưởng giới thiệu (`REFERRAL_ORDER2_REVOKE`), kèm mốc thưởng thêm, mốc đời 2: trừ thêm 5, 15, 30. Lỗi cùng loại với đơn, nằm ngoài danh sách đề bài nhưng nằm trong lớp "dòng âm đảo ngược một khoản cộng cụ thể".

### Kiểm kê dòng âm lô STANDARD (grep `pointsTransaction.create*`, `applyPointsDelta`, mọi `delta` âm, `pointsBalance` decrement trong `apps/api/src`, `scripts`, `prisma`)

| Dòng âm | refType / refId | Nơi ghi | Loại | Xử lý trong replay |
|---|---|---|---|---|
| `ORDER_REVERSED:<mã>` | ORDER / id đơn | `LoyaltyService.reverseOrderPoints` | đảo ngược lô `ORDER_DELIVERED:<mã>` | ăn lô gốc trước, dư FIFO (mới) |
| `REVIEW_DELETE:<productId>` | REVIEW / id đánh giá | `ReviewsService.remove` | đảo ngược lô đánh giá | như PE-3, gộp vào bảng quy tắc |
| `REFERRAL_ORDER2_REVOKE:<id người được mời>` | REFERRAL / id đơn bị trả (dòng thưởng mang "<đơn đầu>:<đơn hai>") | `revokeReferralRewardForOrder` | đảo ngược lô `REFERRAL_ORDER2:<id>` | ăn lô gốc theo hậu tố reason (mới) |
| `REFERRAL_MILESTONE_REVOKE:<người mời>:<mốc>#<đời>` | REFERRAL / id đơn | `revokeLostMilestones` | đảo ngược lô `REFERRAL_MILESTONE:<người mời>:<mốc>[#<đời>]` | theo mốc và đời (mới) |
| `ORDER_REDEEM:<mã>` | ORDER / id đơn | `CheckoutService.create` | TIÊU | FIFO, không đổi |
| `LOYALTY_REDEEM_VOUCHER:<id>` | REWARD / id coupon | `LoyaltyService.redeemReward` | TIÊU | FIFO |
| `GAME_SPIN_COST`, `GAME_BUY_TREE:<mã>` (phần STANDARD) | GAME | `GameService` | TIÊU | FIFO |
| `GameService.creditPoints` nhánh âm | GAME | không ai gọi | TIÊU | FIFO |
| `POINTS_EXPIRED` | EXPIRE | cron | luật riêng PE-1a | không đổi |
| `REFERRAL_*_DEBT` (delta 0) | REFERRAL_DEBT | `debitReferralReward` | không trừ gì | bị bỏ qua như trước |

Không tồn tại: dòng trừ điểm khi xoá bài cộng đồng (`community-reward.service` chỉ cộng), đảo điểm game/nhiệm vụ/Season Pass, đảo điểm POS, đảo điểm danh. `dealerCreditLedger`, `walletTransaction`, `coinTransaction` không phải sổ điểm. Lô CONVERTED không vào replay (PD-3).

### Cơ chế

`loyalty-expiry.service.ts`: `PointExpiryTxn` đã có `refType`, `refId` (PE-3). Cơ chế riêng của đánh giá thành bảng `REVERSAL_RULES`, mỗi quy tắc cho hai hàm: `lotKey` (dòng dương tạo lô nào) và `reversedLotKey` (dòng âm thu hồi lô nào, null nghĩa là dòng tiêu). Lô mang khoá; dòng âm có khoá ăn trước các lô cùng khoá, phần dư (lô gốc đã bị tiêu bớt hoặc không còn) mới FIFO. Dòng không khớp quy tắc nào chạy đúng như cũ.

Quyết định thiết kế:

- Đơn khớp theo `refType` ORDER và `refId`, nhưng thêm điều kiện reason `ORDER_DELIVERED:` ở lô và `ORDER_REVERSED:` ở dòng thu hồi. Lý do (PE-3 đã nêu): cùng `refId` một đơn còn có `ORDER_REFUND_POINTS` (dương, lô mới có hạn riêng) và `ORDER_REDEEM` (âm, dòng tiêu). Khớp chỉ theo refType+refId thì `ORDER_REVERSED` có thể ăn nhầm lô hoàn khi lô đơn đã cạn, và `ORDER_REDEEM` bị coi là thu hồi. Tiền tố reason đã là hợp đồng của sổ (partial unique index `reason LIKE 'ORDER_DELIVERED:%'`, `lockedOrderPoints` dùng đúng hai tiền tố này). Đánh giá giữ khớp theo refType+refId thuần như PE-3.
- Thưởng giới thiệu không khớp được theo refId (dòng thưởng mang "<đơn đầu>:<đơn hai>", dòng thu hồi mang id đơn bị trả, mốc thưởng thêm mang id người mời), nên khớp theo hậu tố reason: `REFERRAL_ORDER2:<id>` với `REFERRAL_ORDER2_REVOKE:<id>`; mốc có thêm số lượt và đời (đời 0 không có hậu tố ở dòng thưởng, dòng thu hồi luôn có `#<đời>`). Không sửa `wallet/referral-reward.ts` (ngoài nhóm file); hai tiền tố ORDER2 import từ đó, hai tiền tố mốc khai báo lại ở loyalty (không export được).
- Khoá bao gồm tên quy tắc nên các quy tắc không ăn chéo nhau. Reason hỏng (đời không phải số) thì không có khoá và đi FIFO như trước, không bao giờ tệ hơn hành vi cũ.

### Test

- Race Postgres thật `pe5-reversal-expiry.race-spec.ts` (12 ca): 6 ca đơn (đề bài, hạ cấu hình, đơn tiêu điểm rồi trả, nhiều đơn, tiêu điểm khác chen giữa, không có dòng thu hồi), 4 ca thu hồi thưởng giới thiệu (kể cả mốc đời 2 và thưởng không bị thu hồi), 2 ca cấu hình hỏng của mục 2. Mỗi ca: cron chạy 2 đến 3 đêm không trừ lần hai; `afterEach` kiểm `findPointsLotDrift` rỗng; số dư bằng tổng dòng STANDARD.
- Unit `loyalty-expiry.service.spec.ts` (+20 ca, 38 lên 58): từng quy tắc, lô gốc bị tiêu bớt, thu hồi lớn hơn lô gốc, lô hoàn cùng `refId` và cùng `createdAt` với dòng thu hồi (id nhỏ hơn), `ORDER_REDEEM` cùng refType/refId với lô giao vẫn FIFO, mốc khác đời/khác số lượt, đời hỏng. Thêm ca bất biến cũ: 300 sổ ngẫu nhiên (PRNG cố định, lô có/không hạn, dòng tiêu mọi loại kể cả cùng refType/refId với lô, `POINTS_EXPIRED`) cho `expiredNow` y hệt một bản replay FIFO thuần viết riêng trong test.
- Đột biến, mỗi cái làm test đỏ: tắt cả cơ chế (11 ca race đỏ: 8 của gói và 3 của PE-3, 15 ca unit); bỏ điều kiện reason của quy tắc đơn (3 ca unit đỏ, race không bắt được vì luồng thật luôn tiêu lô đơn sau lô cũ); khoá đơn bỏ refId (cả hai phía), khoá ORDER2 thành hằng (cả hai phía), mốc bỏ đời, mốc bỏ số lượt (mỗi cái 1 ca unit đỏ). Lần viết đầu các ca đảo ngược cho hai lô cùng hết hạn nên một số đột biến (ví dụ mốc bỏ đời) không bị bắt vì tổng điểm hết hạn y hệt; đã siết (`0800003f`) bằng cách cho lô còn lại chưa hết hạn.

## Mục 2: hai bản sao công thức hạn

Đọc mã và chạy `points-expiry-date.spec.ts` (36 ca) trên bản cũ:

- `RewardPointsService.expiresAt`: cùng công thức `pointsExpiresAt` (số hữu hạn dương lấy phần nguyên, còn lại 12). Ghi chú của PE-3 ("khác") không đúng với bản wallet: chỉ là bản sao chép tay, không khác hành vi.
- `creditOrderPoints`: `setMonth(getMonth() + raw)` không kiểm gì. Khác với `pointsExpiresAt` ở cấu hình không hợp lệ. Trước đây: `0` hạn bằng lúc cộng (cron đêm sau trừ lại), `-3` hạn trong quá khứ 3 tháng, `null` như 0, chuỗi `'6'` nối thành `"96"` nên hạn ra tháng 1 năm 2034, `NaN`/`Infinity`/`'abc'` ra `Invalid Date` (chưa kiểm Prisma phản ứng thế nào với giá trị này). Nay tất cả rơi về 12 tháng như các nguồn khác. Chỉ số `0` và số âm đặt được qua `SystemConfigService.set` (khoá không có biên, giữ nguyên kiểu số); các giá trị còn lại chỉ có khi ghi thẳng DB.
- Cấu hình hợp lệ (> 0) không đổi: bảng 1, 6, 12, 24, 1.9 tháng cho cùng ngày ở cả ba nguồn trước và sau.

Sửa: hàm thuần `pointsExpiryFrom(from, rawMonths)` trong `loyalty/points-expiry-date.ts`; `LoyaltyService.pointsExpiresAt`, `creditOrderPoints` và `RewardPointsService.expiresAt` dùng chung (RewardPointsService không inject được `LoyaltyService` mà không đổi wiring module nên dùng hàm thuần). Race: cấu hình 0 và -3, điểm đơn giao và thưởng cộng đồng đều có hạn ≈ bây giờ + 12 tháng, cron không trừ gì; đỏ trên bản cũ (hạn 2026-10 và 2026-07 thay vì 2027-10).

Không sửa: cấu hình trong khoảng (0, 1) (ví dụ 0.5) cho 0 tháng, tức hết hạn ngay, ở mọi nguồn kể từ trước; giá trị > 0 nên ngoài phạm vi "cấu hình hỏng", ghi để chủ dự án biết (xem rủi ro 4).

## Mục 3: tác động hồi tố (chỉ báo cáo)

Không có dòng sổ nào bị sửa; chỉ nghĩa của replay đổi cho các dòng thu hồi cũ (đơn, thưởng giới thiệu; đánh giá do PE-3). Với user có dòng thu hồi ghép được với lô gốc:

1. Lô gốc có hạn chưa tới hạn: từ lần cron đầu sau deploy lô gốc không còn bị trừ lại. Đúng và có lợi cho khách.
2. Lô cũ hơn mà bản cũ coi là đã bị dòng thu hồi ăn: nay replay coi nó còn nguyên. Nếu lô cũ đó có hạn thì tới hạn nó hết hạn đủ phần còn lại (đúng, vì phần thu hồi đã thuộc về lô gốc); bản cũ cho lô này hết hạn ít hơn nhưng lô gốc hết hạn thừa. Nếu hạn lô cũ đã qua trước deploy thì xem mục 4: khách bị trừ ngay.
3. Đã mất hai lần trước deploy (`POINTS_EXPIRED` đã ghi): không tự hoàn. Replay mới thấy lô gốc đã bị dòng thu hồi ăn hết nên dòng `POINTS_EXPIRED` cũ không còn lô hết hạn nào để ăn, phần dư đi FIFO vào lô cũ; tổng vẫn bằng `pointsBalance` và cron không trừ thêm (ghim bằng hai ca unit "sổ đã ghi trước PE-5"). Muốn hoàn phải bù tay.
4. Bị trừ sớm, không báo trước: lô cũ có hạn đã qua trước deploy, hết hạn trước lô gốc, dòng thu hồi ghi trước hạn đó (bản cũ để thu hồi ăn lô cũ nên cron cũ chỉ trừ phần còn lại của lô cũ, có khi không ghi `POINTS_EXPIRED` nào). Replay mới coi phần đó hết hạn từ hạn lô cũ, nên ngay lượt cron 1 giờ sáng đầu tiên sau deploy khách bị trừ phần chênh, sớm hơn lịch cũ (bản cũ chỉ trừ khi lô gốc hết hạn) và không có nhắc `POINTS_EXPIRING` vì nhắc chỉ xét hạn trong tương lai. Số dư cuối cùng vẫn đúng và bằng bản cũ: khi lô gốc cũng tới hạn, hai bản cho cùng `expiredNow`. Đã chạy `computePointExpiry` bản `a7415605` so với bản mới trên sổ ví dụ (lô cũ +30 hạn 2026-01-01, đơn giao +20 hạn 2026-05-01, thu hồi -20 ngày 2025-06-01, `POINTS_EXPIRED` -10 ngày 2026-01-02): tại 2026-03-01 bản cũ 0, bản mới 20; tại 2026-05-02 cả hai 20 (ghim bằng ca unit "lô cũ có hạn đã qua, hết hạn trước lô đơn"). Khuyến nghị trước deploy: lấy danh sách user từ SQL (4), chạy `computePointExpiry` bản cũ và bản mới cho từng người để biết ai bị trừ ngay và bao nhiêu, rồi quyết có báo khách hay không (SQL (4) là danh sách ứng viên, không tính số điểm).

Chạy trên DB có dữ liệu trước deploy (chỉ ghi vào TEMP VIEW của phiên, không đụng bảng thật). Bốn số theo thứ tự: chặn trên; replay có thể đổi; ứng viên đã mất hai lần (thu hồi xảy ra trước hạn lô gốc, lô gốc đã qua hạn, có `POINTS_EXPIRED` từ lúc đó); ứng viên bị trừ sớm ngay sau deploy (mục 4 ở trên).

```sql
CREATE TEMP VIEW pe5_pairs AS
SELECT r."userId",
       r."id"        AS "reversalId",
       r."createdAt" AS "reversalAt",
       o."id"        AS "originId",
       o."createdAt" AS "originAt",
       o."expiresAt" AS "originExpiresAt"
  FROM "points_transactions" r
  JOIN "points_transactions" o
    ON o."userId" = r."userId"
   AND o."lot" = 'STANDARD' AND o."delta" > 0
   AND o."createdAt" <= r."createdAt"
   AND (
        (r."refType" = 'ORDER' AND starts_with(r."reason", 'ORDER_REVERSED:')
         AND o."refType" = 'ORDER' AND starts_with(o."reason", 'ORDER_DELIVERED:') AND o."refId" = r."refId")
     OR (r."refType" = 'REFERRAL' AND starts_with(r."reason", 'REFERRAL_ORDER2_REVOKE:')
         AND o."refType" = 'REFERRAL'
         AND o."reason" = 'REFERRAL_ORDER2:' || substr(r."reason", length('REFERRAL_ORDER2_REVOKE:') + 1))
     OR (r."refType" = 'REFERRAL' AND starts_with(r."reason", 'REFERRAL_MILESTONE_REVOKE:')
         AND o."refType" = 'REFERRAL' AND starts_with(o."reason", 'REFERRAL_MILESTONE:')
         AND (CASE WHEN position('#' IN o."reason") > 0
                   THEN substr(o."reason", length('REFERRAL_MILESTONE:') + 1)
                   ELSE substr(o."reason", length('REFERRAL_MILESTONE:') + 1) || '#0' END)
             = substr(r."reason", length('REFERRAL_MILESTONE_REVOKE:') + 1))
       )
 WHERE r."lot" = 'STANDARD' AND r."delta" < 0;

-- (1) chặn trên: user có ít nhất một dòng thu hồi ghép được với lô gốc
SELECT count(DISTINCT "userId") AS users_with_pair FROM pe5_pairs;

-- (2) replay có thể đổi kết quả: lô gốc có hạn, hoặc có lô có hạn cũ hơn lô gốc (nơi bản cũ có thể đã ăn nhầm)
SELECT count(DISTINCT p."userId") AS users_replay_may_change
  FROM pe5_pairs p
 WHERE p."originExpiresAt" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "points_transactions" e
                WHERE e."userId" = p."userId" AND e."lot" = 'STANDARD' AND e."delta" > 0
                  AND e."expiresAt" IS NOT NULL AND e."createdAt" < p."originAt");

-- (3) ứng viên đã bị trừ hai lần, cần đối chiếu tay
SELECT count(DISTINCT p."userId") AS users_maybe_double_charged
  FROM pe5_pairs p
 WHERE p."originExpiresAt" IS NOT NULL
   AND p."reversalAt" < p."originExpiresAt"
   AND p."originExpiresAt" <= now()
   AND EXISTS (SELECT 1 FROM "points_transactions" x
                WHERE x."userId" = p."userId" AND x."reason" = 'POINTS_EXPIRED' AND x."createdAt" >= p."originExpiresAt");

-- (4) ứng viên bị trừ sớm ngay lượt cron đầu sau deploy: lô có hạn đã qua, cũ hơn lô gốc, dòng thu hồi ghi trước hạn đó,
--     còn lô gốc chưa tới hạn (hoặc không hạn). Tập con của (2).
SELECT count(DISTINCT p."userId") AS users_deducted_early
  FROM pe5_pairs p
  JOIN "points_transactions" e
    ON e."userId" = p."userId" AND e."lot" = 'STANDARD' AND e."delta" > 0
   AND e."expiresAt" IS NOT NULL AND e."expiresAt" <= now()
   AND e."createdAt" < p."originAt"
   AND p."reversalAt" < e."expiresAt"
 WHERE p."originExpiresAt" IS NULL OR p."originExpiresAt" > now();
```

Đã chạy trên DB throwaway của gói (sau các lượt chạy race): cú pháp đúng, bốn số trả về, và (3) gắn cờ đúng người của lượt chạy đỏ (sổ: lô cũ 30, `ORDER_DELIVERED` +20, `ORDER_REVERSED` -20, `POINTS_EXPIRED` -20) mà không gắn cờ người của lượt xanh (cùng sổ, không có `POINTS_EXPIRED`). (4) đã chạy trên năm sổ dựng tay (hai ca bị trừ sớm: một có `POINTS_EXPIRED`, một thu hồi ăn hết lô cũ nên không có; ba ca đối chứng: lô gốc cũng đã hết hạn, thu hồi sau hạn lô cũ, lô cũ không hạn): gắn cờ đúng hai người đầu, và `computePointExpiry` bản cũ so bản mới tại `now()` cho 0 so 20 ở hai người đó, bằng nhau ở ba người kia. Chưa chạy trên DB có dữ liệu thật hay bản thử VPS. (3) bỏ sót ca thu hồi sau khi lô gốc đã hết hạn (đó là rủi ro 2, loại khác), và không tính được số điểm cần bù; số đó phải đo bằng cách chạy `computePointExpiry` bản cũ so với bản mới cho từng user. Đánh giá (`REVIEW_DELETE`) không nằm trong SQL vì PE-3 đã xử lý.

## Lệnh kiểm và kết quả thật

Chạy trong `apps/api` của worktree, PATH node 22, Postgres `tubu_it_pe5` cổng 5596, DB `tubutree_it`, `prisma migrate deploy` xong.

| Lệnh | Exit | Kết quả |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 | sạch |
| `npx eslint --max-warnings=0` 7 file đã sửa hoặc thêm | 0 | sạch |
| `npx jest src/modules/loyalty src/modules/reviews src/modules/orders src/modules/wallet` | 0 | 26 suite, 624 test xanh |
| `DATABASE_URL=...5596/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand loyalty-refund-expiry pe3-reward-expiry pd3-order-reversal pd3-points-lots order-cancel cod-return-refund loyalty.race pe5-reversal-expiry referral-order2 pd3-reward-sources review-edit` | 0 | 11 suite, 106 test xanh |
| lặp 3 lần `pe5-reversal-expiry` | 0, 0, 0 | 12/12 mỗi lần |

Lượt đỏ trước khi sửa (cùng lệnh, chỉ `pe5-reversal-expiry`): 8 failed, 2 passed. Lượt đỏ của mục 2: `points-expiry-date.spec.ts` 7 ca đỏ ở `creditOrderPoints`, race 2 ca đỏ.

## Chưa verify

- Không chạy Playwright, full suite jest, full bộ race (điều phối viên chạy). Race ngoài 11 suite trên (vd `auth-merge-guest`, `account-deletion`, `wallet-*`) chưa chạy lại; gói không đụng các đường đó nhưng `auth.service.ts` gộp phiên đổi `userId` của dòng sổ nên đi cùng khoá ghép; chưa có test gộp phiên với dòng thu hồi.
- Race cron chạy song song `reverseOrderPoints` (cron giữ khoá user, thu hồi ghi sau) chưa dựng. Đọc mã: cron tính lại trong tx sau khi khoá user nên thấy dòng thu hồi đã commit; thứ tự ngược lại thuộc rủi ro 2.
- SQL mục 3 chỉ chạy trên DB throwaway, chưa trên dữ liệu thật.
- Chưa đo độ trễ cron với sổ nhiều lô (mỗi dòng âm có khoá lọc mảng lô một lần, cùng bậc với cách PE-3 làm cho đánh giá).
- Chưa chạy trên staging/PROD, chưa qua pgbouncer.

## Rủi ro còn lại

1. Hồi tố: xem mục 3. Khách đã mất hai lần trước deploy không được hoàn tự động.
2. `reverseOrderPoints` vẫn trừ `pointsEarned` dù lô `ORDER_DELIVERED` đã hết hạn và cron đã trừ, và không khoá dòng user trước khi quyết (khác `ReviewsService.remove` từ PE-3). Đơn bị trả/huỷ quá 12 tháng sau lúc giao (admin xử lý trả hàng muộn) mất điểm hai lần và `pointsBalance` có thể âm (decrement không guard). Có từ trước, replay mới không làm nó tệ hơn (dòng thu hồi ăn phần dư của lô khác như bản cũ). Đề xuất gói riêng làm giống `rewardExpired` của đánh giá: khoá user, bỏ thu hồi khi lô gốc đã hết hạn. Đây là đổi hành vi tiền nên không làm lẫn vào đây.
3. Ghép thưởng giới thiệu dựa vào tiền tố reason của `wallet/referral-reward.ts`; hai tiền tố mốc khai báo lại ở loyalty. Đổi tên tiền tố ở một phía thì cơ chế rơi về FIFO (hành vi cũ, lỗi cũ quay lại, không sai số dư). Race `pe5-reversal-expiry` dùng hàm thu hồi và cấp thưởng thật nên sẽ đỏ khi hai phía lệch.
4. Cấu hình `loyalty.point_expire_months` trong (0, 1) cho 0 tháng (hết hạn ngay) ở mọi nguồn; khoá vẫn không có biên trong `SystemConfigService.RANGES`. Đề xuất thêm biên 1 đến 120 (file ngoài nhóm của gói).
5. `loyalty-expiry.service.ts` nay import hằng số từ `wallet/referral-reward.ts` (file chỉ import kiểu từ Prisma, không có vòng phụ thuộc); gói loyalty phụ thuộc thêm một file wallet.
6. Gói đụng điểm (tiền trả trước) nên cần review opus hai lượt. Chỗ nên nhìn kỹ: bảng `REVERSAL_RULES` (nhất là điều kiện reason của quy tắc đơn), cách `milestoneKey` đọc đời, và phân loại "đảo ngược hay tiêu" ở bảng kiểm kê.
