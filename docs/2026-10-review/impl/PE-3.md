# PE-3: Điểm Xanh thưởng còn ghi không hạn

Nhánh `hz14/PE-3`, tách từ `hardening/2026-10` @ `03293ee5`. Chỉ đụng `apps/api` (game, reviews, loyalty và test), không có migration, không sửa checkout, order-reversal, wallet, `schema.prisma`.

Commit: `e5dd7b10` (vòng quay, nhiệm vụ), `386e1255` (điểm đánh giá), `b06ffaf1` (test chốt chặn), `379741e1` (race Postgres thật), `d98d3e34` (xoá đánh giá sau khi điểm đã hết hạn).

## Việc đã làm

PE-1a liệt kê ba nguồn còn ghi dòng điểm dương lô STANDARD với `expiresAt NULL`: `GAME_SPIN_WIN:<giải>`, `MISSION:<mã>:<chu kỳ>` (cả hai qua `GameService.creditPoints`) và `REVIEW:<slug>` (`ReviewsService.createFirst`). Cả ba nay ghi `expiresAt = bây giờ + loyalty.point_expire_months` tháng bằng `LoyaltyService.pointsExpiresAt`, đúng helper mà điểm danh, POS và `ORDER_REFUND_POINTS` đang dùng (chỉ đổi từ `private` sang công khai, không viết lại cách tính tháng, cấu hình hỏng vẫn rơi về 12).

Số điểm (5/10/15 cho đánh giá, giá trị giải, `rewardPoints` của nhiệm vụ), `reason`, `refType`, `refId`, khoá unique `mission_progress` và các unique `(reason, refId)` không đổi.

Chi tiết từng chỗ:
- `GameService.spin`: nếu giải là POINTS thì tính hạn trước khi mở transaction (sau khi chọn giải). Giải không phải POINTS không đọc cấu hình hạn.
- `GameService.claimMission`: tính hạn sau các kiểm tra rẻ (nhiệm vụ có thật, đủ điều kiện), trước transaction, chỉ khi `rewardPoints > 0`.
- `GameService.creditPoints`: `tx` và `expiresAt` thành tham số bắt buộc. Nhánh cộng ném lỗi nếu thiếu `expiresAt`, nên một call site mới quên truyền sẽ nổ ngay trong test thay vì ghi dòng không hạn. Nhánh trừ (hiện không ai gọi) giữ nguyên hành vi.
- Thiếu `LoyaltyService` (vốn `@Optional()` trong `GameService`) thì `spin`/`claimMission` ném lỗi TRƯỚC khi trừ điểm hay ghi claim, giống `buyTree`. Không im lặng ghi dòng không hạn.
- `ReviewsService` nhận `LoyaltyService` bắt buộc (module `LoyaltyModule` là `@Global`, đã thử dựng `ReviewsModule` + `LoyaltyModule` thật bằng Nest, resolve được). Hạn tính trong `createFirst` trước transaction; lần sửa đánh giá (không thưởng) và lượt thua race P2002 không ghi dòng điểm.
- Race spec cũ `review-edit` thêm `LoyaltyService` vào providers vì `ReviewsService` nay cần nó.

### Phát hiện thêm và sửa: xoá đánh giá sau khi điểm đã hết hạn trừ hai lần (`d98d3e34`)
Khi điểm đánh giá có hạn, `ReviewsService.remove` vẫn thu hồi `pointsEarned` bằng dòng `REVIEW_DELETE`, không biết điểm đó đã bị cron trừ. Đã đo trên Postgres thật (probe tạm, đã xoá): đánh giá cũ hơn 12 tháng, cron đã trừ, còn 30 điểm khác thì xoá đánh giá làm số dư xuống 25; không còn điểm nào thì xuống -5 (không có CHECK chặn số dư âm ở lô STANDARD). Trước PE-3 điều này không xảy ra vì điểm đánh giá không hết hạn.

Sửa: `remove` tra dòng thưởng gốc (`refType REVIEW`, `refId` = id đánh giá, `delta > 0`) ngoài transaction; nếu `expiresAt <= bây giờ` (cùng quy tắc với cron) thì chỉ xoá đánh giá và tính lại sao, không ghi `REVIEW_DELETE`. Điểm còn hạn, dòng gốc cũ `expiresAt NULL` hoặc không tìm thấy dòng gốc vẫn thu hồi như cũ, nên chiêu tạo, xoá, tạo lại để farm điểm vẫn bị chặn. Nếu cron chưa chạy mà đã xoá thì cron đêm đó trừ phần hết hạn đúng một lần (có race test).

Đây là việc ngoài mục tiêu gốc của gói nhưng là hệ quả trực tiếp của việc cho điểm đánh giá hết hạn; nằm trong một commit riêng để điều phối viên bỏ được nếu muốn đổi cách xử lý (xem rủi ro 3).

## Bảng nguồn ghi điểm dương lô STANDARD

Rà bằng grep `pointsTransaction.create*`, `applyPointsDelta`, `creditPoints`, `pointsBalance` (increment) trong `apps/api/src`, `scripts`, `prisma/seed*`.

| Nguồn (reason) | Có expiresAt | Kết quả |
|---|---|---|
| `GAME_SPIN_WIN:<giải>` (`game.service.ts` spin) | trước: không; nay: có | SỬA ở PE-3 |
| `MISSION:<mã>:<chu kỳ>` (`game.service.ts` claimMission) | trước: không; nay: có | SỬA ở PE-3 |
| `REVIEW:<slug>` (`reviews.service.ts` createFirst) | trước: không; nay: có | SỬA ở PE-3 |
| `ORDER_DELIVERED:<mã>` (`loyalty.service.ts` creditOrderPoints) | có | Giữ. Tự tính `setMonth` từ cấu hình, không qua `pointsExpiresAt` (xem rủi ro 1) |
| `DAILY_CHECKIN:DAY_n` (điểm danh) | có (`pointsExpiresAt`) | Giữ |
| `POS_OFFLINE_ORDER:<biên lai>` | có (`pointsExpiresAt`) | Giữ |
| `ORDER_REFUND_POINTS:<mã>` | có (`pointsExpiresAt`, PE-1a) | Giữ |
| `RewardPointsService.grant`: `REFERRAL`, `COMMUNITY`, `QUEST`, `SEASONPASS`, `AFFILIATE_MILESTONE` | có (`expiresAt()` riêng trong `reward-points.service.ts`, cùng công thức) | Giữ (xem rủi ro 1) |
| Lô CONVERTED: `ORDER_REFUND_CONVERTED`, `ORDER_REFUND_XU`, `XU_TO_POINTS` (migration) | không, CÓ CHỦ ĐÍCH | Giữ. CHECK DB `points_transactions_converted_no_expiry`; PD-3-SPEC (quyết định Q-03a, mục 2.2 và 2.5): lô quy đổi không hết hạn |
| Gộp phiên khách (`auth.service.ts` `pointsTransaction.updateMany`) | dòng cũ đi cùng `expiresAt` của nó | Không tạo dòng mới, không đụng |
| Dòng âm hoặc 0: `GAME_SPIN_COST`, `ORDER_REDEEM`, `ORDER_REVERSED`, `LOYALTY_REDEEM_VOUCHER`, `REVIEW_DELETE`, `GAME_BUY_TREE`, `POINTS_EXPIRED`, thu hồi thưởng giới thiệu / `REFERRAL_DEBT` | không áp dụng | Không phải nguồn cộng |
| `scripts/loadtest`, `scripts/audit` | n/a | Dữ liệu giả, không tính (như PE-1a) |

Không có nguồn STANDARD nào cố ý không hạn.

Về `PD-3-SPEC.md` mục 2.7 ("đánh giá, vòng quay thắng điểm: giữ nguyên, lot STANDARD, `expiresAt` như hiện tại"): đọc là phạm vi của PD-3 (không đổi mã ở các chỗ này), không phải quyết định "không hạn": câu đó đứng chung với điểm danh và POS vốn đã có hạn, và không có chỗ nào trong spec nêu lý do để điểm game/đánh giá sống vĩnh viễn. Các bằng chứng ngược chiều: FAQ miniapp (`about-data.ts`: "Điểm có hạn 12 tháng", chỉ loại trừ điểm quy đổi từ xu), và audit 2026-09 (`docs/audit-2026-09/03-retention-loops.md` dòng 137) ghi "điểm đánh giá và vòng quay không hết hạn" in đậm như một điểm lệch so với điểm đơn/điểm danh/POS. Nên coi là lỗi bỏ sót và sửa theo OQ-1 (ROADMAP mục 9). Đây là cách đọc của người làm gói; nếu có quyết định kinh doanh ngược lại thì chỉ cần hoàn tác hai commit `e5dd7b10`, `386e1255` (và `d98d3e34`).

## Test chốt chặn tái phát (`b06ffaf1`)

`loyalty/points-expiry-guard.spec.ts` quét mã nguồn (cùng kiểu `common/cron-timezone.spec.ts`): mọi lời gọi `pointsTransaction.create/createMany/createManyAndReturn` và `applyPointsDelta(` phải có `expiresAt`, hoặc là lô CONVERTED, hoặc `delta` âm/0, hoặc nằm trong danh sách ngoại lệ có lý do (helper `points-ledger.ts`, thu hồi thưởng giới thiệu). Có kiểm "ngoại lệ còn khớp lời gọi thật", "không INSERT thô vào `points_transactions`", và test riêng cho bộ quét (comment, ngoặc, dấu nháy trong chuỗi). Đột biến thử: bỏ `expiresAt` khỏi `creditPoints` và `createFirst` thì test đỏ và chỉ đúng hai vị trí đó.

Giới hạn: là kiểm tĩnh, dựng `data` ở biến riêng rồi truyền vào sẽ bị báo (viết thẳng trong lời gọi hoặc thêm ngoại lệ); không chứng minh `expiresAt` có giá trị đúng (phần đó do unit và race).

## Test đỏ → xanh

- Unit (game 8 ca, reviews 13 ca, loyalty 1 ca mới; ngoài test chốt chặn): `expiresAt` đúng giá trị helper trả cho từng nguồn, tính trước khi mở tx, không đọc cấu hình khi không thưởng, thiếu `LoyaltyService` thì dừng trước khi mở tx. Đỏ trước khi sửa: 6/8 ca game (2 ca còn lại là ca phủ định đã đúng sẵn), 4 ca reviews đỏ (đúng lý do: thiếu `expiresAt`, helper không được gọi).
- Race Postgres thật `test/integration-race/pe3-reward-expiry.race-spec.ts` (17 ca). Thời gian trôi được dựng bằng cách lùi `createdAt`/`expiresAt` của user trong sổ điểm đi N tháng rồi chạy cron ở giờ thật (không giả `Date` ở JS vì `createdAt` của dòng do cron ghi được gán bằng giờ máy thật, mà replay của cron dựa vào đó). Các ca:
  - từng nguồn ghi `expiresAt` trong [trước + 12 tháng, sau + 12 tháng] (cùng phép `setMonth`), đúng lô, số dư khớp sổ; sửa đánh giá không thêm dòng;
  - song song: 6 lượt nhận cùng nhiệm vụ → đúng 1 dòng (5 lỗi 400), 5 lượt tạo đánh giá → 1 đánh giá 1 dòng thưởng, 5 lượt quay → 5 dòng thắng đều có hạn;
  - cron: nhận thưởng → cron sau hạn → trừ đúng một lần dù chạy ba đêm; lô không hạn cũ (30 điểm) trộn với ba lô thưởng hết hạn lần lượt (đánh giá, vòng quay, nhiệm vụ) sau khi đã có tiêu điểm: mỗi lô bị trừ đúng một lần, lô không hạn còn nguyên (còn 8); admin hạ `loyalty.point_expire_months` từ 12 xuống 3 giữa chừng nên lô mới hết hạn TRƯỚC lô cũ; thưởng đã tiêu hết trước hạn thì cron không trừ gì;
  - xoá đánh giá: sau khi cron đã trừ (còn 30 và 0 điểm khác) không trừ hai lần và không âm; quá hạn nhưng cron chưa chạy; còn hạn vẫn thu hồi; dòng gốc cũ không hạn vẫn thu hồi;
  - sau MỖI ca `findPointsLotDrift` phải rỗng.
- Đỏ trước khi sửa: bỏ `expiresAt` khỏi game và reviews thì 10/12 ca (khi đó spec có 12 ca) đỏ, 2 ca còn lại không phụ thuộc hạn. Với `remove`: bỏ kiểm hạn thì 3 ca race đỏ (các ca "đã hết hạn"), các ca còn hạn / dòng cũ vẫn xanh.

## Lệnh kiểm và kết quả thật

Chạy trong `apps/api` của worktree, PATH node 22. Postgres throwaway `tubu_it_pe3` cổng 5594, DB `tubutree_it`, `prisma migrate deploy` xong (132 migration), đã `docker rm -f -v` sau khi xong.

| Lệnh | Exit | Kết quả |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 | sạch |
| `npx eslint --max-warnings=0` 9 file đã sửa/thêm | 0 | sạch |
| `npx jest src/modules/game src/modules/reviews src/modules/loyalty src/modules/feed src/modules/users` | 0 | 28 suite, 752 test xanh |
| `DATABASE_URL=...5594/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand pe3-reward-expiry review-edit game-tree-idempotency game-spin-limit loyalty-refund-expiry pd3-order-reversal pd3-points-lots pd3-tree-lock pd3-checkout-points pd3-reward-sources loyalty.race` | 0 | 11 suite, 80 test xanh |
| lặp 3 lần `pe3-reward-expiry review-edit` | 0, 0, 0 | 25/25 mỗi lần |

## Chưa verify

- Không chạy Playwright, full suite jest, full bộ race spec (điều phối viên chạy). Race spec ngoài 11 suite trên (vd auth-merge-guest, referral, wallet) chưa chạy lại trong gói này.
- Không backfill dòng cũ: dòng `GAME_SPIN_WIN:*`, `MISSION:*`, `REVIEW:*` đã ghi `expiresAt NULL` trước gói này vẫn không bao giờ hết hạn (chưa có dữ liệu thật). Nếu DB nào đã có, đếm bằng `SELECT count(*) FROM points_transactions WHERE delta > 0 AND lot = 'STANDARD' AND "expiresAt" IS NULL AND (reason LIKE 'GAME_SPIN_WIN:%' OR reason LIKE 'MISSION:%' OR reason LIKE 'REVIEW:%')` rồi quyết có đặt hạn tính từ `createdAt` hay không (đặt hạn trong quá khứ sẽ làm cron trừ ngay đêm sau).
- Giao diện (miniapp/web) chưa kiểm: không có thay đổi FE; thông báo nhắc điểm sắp hết hạn (`POINTS_EXPIRING`, cron 8h) từ nay sẽ tính cả điểm game/đánh giá, chưa xem copy có hợp không.
- Chưa chạy trên staging/PROD. Đường `ReviewsService.remove` cho ADMIN xoá đánh giá của người khác dùng chung đoạn mã, có test unit và một ca race (`remove(..., 'ADMIN', ...)`), chưa thử qua HTTP.

## Rủi ro còn lại

1. Còn hai bản sao công thức hạn khác `pointsExpiresAt`: `creditOrderPoints` (`loyalty.service.ts`, tự `setMonth`, không rơi về 12 khi cấu hình hỏng) và `RewardPointsService.expiresAt()` (`wallet/`, ngoài nhóm file của gói). Khác biệt thực tế (đọc mã, chưa chạy): `loyalty.point_expire_months` đặt 0 hoặc âm thì điểm đơn giao hết hạn ngay tại thời điểm cộng (cron đêm sau trừ) trong khi mọi nguồn khác rơi về 12 tháng; khoá này không có biên trong `SystemConfigService.RANGES`. Đề xuất gói nhỏ sau: cho hai chỗ gọi `pointsExpiresAt` (hoặc thêm biên 1–120 cho khoá), vì đụng đường cộng điểm đơn và wallet nên không làm lẫn vào gói này.
2. Điểm đã quá hạn nhưng cron 01:00 chưa chạy vẫn tiêu được (checkout dùng `pointsBalance`, không xét hạn từng lô; ghi từ PE-1a). Nay điểm game/đánh giá cũng có hạn nên diện này rộng hơn; cửa sổ tối đa khoảng một ngày.
3. Xoá đánh giá sau khi điểm đã hết hạn không thu hồi: người dùng có thể tạo → chờ 12 tháng → xoá → tạo lại để nhận thêm 5 đến 15 điểm mỗi sản phẩm mỗi năm. Chấp nhận vì nhỏ và giữ chặn farm trước hạn; nếu không muốn thì chọn: (a) hoàn tác `d98d3e34` và chấp nhận trừ hai lần, hoặc (b) chặn đánh giá lại cùng sản phẩm sau khi xoá. Cần chủ dự án quyết nếu quan tâm.
4. Thứ tự replay của cron dựa trên `createdAt` (không đổi so với PE-1a). Race spec cố ý không giả đồng hồ vì lý do đó; việc "chạy cron ở thời điểm sau hạn" được mô phỏng bằng lùi mốc thời gian trong sổ.
5. `pointsBalance` không có CHECK `>= 0` ở lô STANDARD; các dòng âm không guard (`REVIEW_DELETE` còn hạn, `ORDER_REVERSED`) vẫn có thể kéo số dư âm nếu người dùng đã tiêu hết trước đó. Có sẵn từ trước, không đổi trong gói.
6. Gói đụng điểm (tiền trả trước) nên cần review opus hai lượt; hai chỗ nên nhìn kỹ: thứ tự "tính hạn ngoài tx, rồi mới mở tx, thiếu `LoyaltyService` thì dừng trước khi trừ điểm" ở `spin`, và quy tắc `expiresAt <= now` bỏ thu hồi ở `remove`.
