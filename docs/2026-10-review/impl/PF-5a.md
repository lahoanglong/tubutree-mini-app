# PF-5a: vòng quay phải tôn trọng lockedOrderPoints

Nhánh `hz17/PF-5a`, base `6c504cf8`. Chỉ đụng `apps/api` (game, comment ở loyalty, hai race spec) và hai file tài liệu. Không sửa `apps/miniapp`, `apps/web`, `packages/**`, `schema.prisma`, migration. Không push, không deploy, không ghi DB dùng chung (Postgres throwaway cổng 5701, container `tubu_it_pf5a`, đã xoá khi xong).

Commit: `f11f4034` (mục 1 và 2), `d7f0baec` (mục 4), `0d025a6e` (mục 5), commit kế tiếp là báo cáo này. Mục 3 không đổi mã.

## Mục 1: GameService.spin() không trừ lockedOrderPoints

Có lỗi thật, tái hiện trên Postgres thật. Bản cũ chỉ kiểm `pointsBalance >= phí` rồi trừ bằng `updateMany` có guard `gte phí`. Khách có 20 điểm đều là điểm đơn giao 2 ngày trước (đang khoá) quay được thay vì bị từ chối; với 20 khoá và 10 tự do, ba lượt quay xếp hàng trước lượt trả hàng đều thành công (đã quan sát ở race đỏ), tức số dư về 0 và `reverseOrderPoints` chỉ còn thu hồi được `min(..., số dư) = 0`, nên khách giữ điểm của đơn đã trả (bước thu hồi này suy từ mã; ca race đỏ dừng ở bước đếm lượt quay, trước khi kiểm thu hồi).

Sửa (`game.service.ts`, `spin`):

- Việc đầu tiên trong transaction là `SELECT "pointsBalance" FROM "users" ... FOR UPDATE`, rồi `loyalty.lockedOrderPoints(userId, new Date(), tx)` bằng chính tx đó (cùng thứ tự user rồi sổ như `buyTree`, `redeemReward`, `reverseOrderPoints`). Dùng được = `max(0, số dư − khoá)`; nhỏ hơn phí thì từ chối.
- Thông báo cùng mẫu `buyTree`: `Cần 10 Điểm Xanh để quay.`, thêm ` Một phần điểm chưa dùng được: <lockedPointsMessage>.` khi có điểm khoá. Câu cũ viết "điểm Xanh" thường, nay theo thuật ngữ Q-26 ("Điểm Xanh"); không nơi nào khác khớp theo chuỗi này (đã grep apps, packages).
- Guard atomic của `updateMany` đổi thành `gte phí + điểm khoá` (như `redeemReward`, checkout), làm lưới an toàn nếu số dư đổi giữa hai câu; `count 0` thì 400.
- Giữ nguyên: đếm trần lượt/ngày SAU khi đã trừ (nay giữ khoá bằng `FOR UPDATE` từ đầu tx), dòng `GAME_SPIN_COST` (lô STANDARD mặc định, không hạn) và `GAME_SPIN_WIN:<giải>` có `expiresAt` như PE-3, thưởng SEEDS/COUPON. Spin vẫn CHỈ chạm lô STANDARD (`pointsBalance`), không đọc hay trừ `pointsConvertedBalance`: PD-3 OQ-3 cấm lô quy đổi vào vòng quay vì kỳ vọng thưởng dương; test unit khẳng định câu SQL và `updateMany` không nhắc cột quy đổi.
- Giống `buyTree`, `spin` nay BẮT BUỘC có `LoyaltyService` (thiếu thì ném lỗi trước khi mở tx, kể cả khi giải là NONE). Trước đây chỉ giải POINTS mới cần. `LoyaltyModule` là module `@Global` và export `LoyaltyService`, `buyTree` đã dựa vào đúng điều đó, nên runtime không phải đổi wiring (chưa khởi động AppModule thật để kiểm); chỉ `game-spin-limit.race-spec.ts` (dựng module không có `LoyaltyService`) phải thêm một provider.
- Thứ tự lỗi đổi nhẹ: bản cũ báo "Cần X điểm" trước "Vòng quay chưa cấu hình" (đọc số dư ngoài tx); nay giải chưa cấu hình báo trước, vì số dư đọc trong tx. Không ai phụ thuộc thứ tự này.

## Mục 2: race test thật

`apps/api/test/integration-race/pf5-spin-locked-points.race-spec.ts`, 12 ca, Postgres thật, `afterEach` kiểm `findPointsLotDrift` rỗng:

- (a) đơn giao +20 đang khoá, số dư chỉ có 20: quay bị 400 kèm lý do khoá, số dư vẫn 20, không có dòng `GAME_SPIN*`, không có `GameSpin`. Thêm: thiếu điểm mà không có khoá thì thông báo không nhắc khoá; đơn giao 10 ngày trước (quá cửa sổ 7 ngày) thì hết khoá, quay được.
- (b) 20 khoá + 25 tự do: tuần tự 3 lần được 2 lần, số dư còn 25; 6 lượt song song được đúng 2 lượt; trúng giải điểm thì `GAME_SPIN_WIN` vẫn có hạn khoảng 12 tháng, số dư 25 và lượt kế bị từ chối (điểm thắng không mở khoá điểm đơn); chạm trần lượt/ngày thì 400 và rollback hết, không mất phí.
- (c) quay bị chặn rồi trả hàng thì `ORDER_REVERSED` -20, số dư 0; có 15 điểm tự do thì quay được một lần dùng phần tự do, trả hàng vẫn thu hồi đủ 20, không âm.
- (d) quay song song với trả hàng cùng khách, ba dạng: ba lượt quay xếp hàng ở khoá TRƯỚC lượt thu hồi (giữ khoá bằng một tx riêng, đếm `pg_stat_activity` chờ khoá): đúng 1 lượt quay thành công, thu hồi -20, số dư 0; lượt thu hồi xếp hàng TRƯỚC lượt quay: quay vẫn được (không bị từ chối nhầm), số dư 0; 4 khách bắn cùng lúc 3 quay + 1 thu hồi: mọi lỗi phải là `BadRequestException`, thu hồi thành công, số dư 0. Deadlock hay P2034 sẽ làm ca này đỏ. Kết quả cuối không phụ thuộc thứ tự xếp hàng ở khoá (cả hai thứ tự cho số dư 0, một lượt quay).
- (e) đột biến. Bản gốc `6c504cf8` chạy với spec mới: 9 đỏ, 3 xanh (ba ca xanh không liên quan khoá: quá cửa sổ, chạm trần lượt/ngày, thu hồi xếp trước quay); 8 ca đỏ vì quay tiêu điểm khoá, 1 ca đỏ vì câu thông báo cũ viết "điểm Xanh" thường. Bỏ phần trừ `lock.locked` (giữ `FOR UPDATE`): 8 đỏ, gồm cả ca (a). Bỏ `FOR UPDATE` (giữ phần trừ khoá): 2 đỏ (quay sau thu hồi bị từ chối nhầm vì đọc khoá trước khi thu hồi commit, và ca bắn đồng thời). Bỏ `+ lock.locked` ở guard `updateMany` (giữ `FOR UPDATE` và kiểm trước): 12 xanh, vì guard đó là lớp thứ hai dưới `FOR UPDATE`, không phải lớp duy nhất; ghi lại để không ai tưởng nó được test riêng.
- Ổn định: chạy lại 6 lần liên tiếp, 12/12 xanh mỗi lần.

Unit `game.service.spec.ts`: thêm 6 ca (khoá toàn bộ, ngưỡng dùng được, guard cộng điểm khoá, thứ tự `FOR UPDATE` rồi đọc khoá bằng đúng tx rồi trừ rồi đếm lượt, guard `count 0`, không chạm lô quy đổi, thiếu `LoyaltyService`) và đổi các ca spin cũ sang stub `$queryRaw` + `LoyaltyService`. Chạy bản `spin` cũ với spec này: 18 đỏ (một phần vì stub đọc số dư đã đổi nên ca cũ cũng đỏ; bằng chứng đỏ thật cho hành vi nằm ở race spec).

## Mục 3: rà mọi chỗ trừ điểm Điểm Xanh

Grep trong `apps/api/src` (không tính spec) `pointsBalance` `decrement`/`gte`, `applyPointsDelta` với delta âm, `pointsTransaction.create` và mọi `delta: -`. Kết quả: chỉ vòng quay thiếu. Vị trí là sau khi sửa.

| Chỗ trừ | Loại | Kết luận |
|---|---|---|
| `game.service.ts` `spin` | chi tiêu của khách | đã sửa ở mục 1 |
| `game.service.ts` `buyTree` (`applyPointsDelta` âm) | chi tiêu | đã chặn (khoá user, trừ `lockedOrderPoints`; PD-3 review C1, `pd3-tree-lock`) |
| `loyalty.service.ts` `redeemReward` (~655) | chi tiêu | đã chặn: guard `gte giá + khoá` sau `FOR UPDATE` |
| `checkout.service.ts` ~311 | chi tiêu | đã chặn: guard `gte usedStandard + khoá`. Phần lô quy đổi (`applyPointsDelta` ~337) không cần chặn: `lockedOrderPoints` chỉ đếm điểm `ORDER_DELIVERED` lô STANDARD |
| `game.service.ts` `creditPoints` nhánh `delta < 0` (~643) | không phải chi tiêu của khách | nhánh chết: hai caller (thưởng vòng quay POINTS, thưởng nhiệm vụ) chỉ truyền thưởng cộng, seed đều dương (PE-5 cũng ghi "không ai gọi"). Chỉ chạy nếu admin cấu hình giải POINTS hoặc `rewardPoints` nhiệm vụ âm; đó là cấu hình sai, không phải đường khách chọn. Không sửa; nên xoá nhánh hoặc kiểm giá trị cấu hình (xem rủi ro) |
| `loyalty.service.ts` `reverseOrderPoints` (~229) | thu hồi (huỷ/trả đơn) | không chặn |
| `reviews.service.ts` ~301 `remove` | thu hồi điểm đánh giá khi xoá | không chặn |
| `wallet/referral-reward.ts` ~167 | thu hồi thưởng giới thiệu của người mời khi đơn bị trả | không chặn |
| `loyalty-expiry.service.ts` ~364 | cron hết hạn | không chặn |
| `points-ledger.ts` ~80 `applyPointsDelta` | helper dùng chung | caller âm duy nhất là `buyTree` và phần quy đổi của checkout (đã nêu); `reward-points.service.ts` và `order-reversal.service.ts` chỉ cộng |
| `auth.service.ts` ~435, `wallet.service.ts` ~134, `subscriptions.service.ts` ~655, `dealer.service.ts` ~451 và ~1220, `order-reversal.service.ts` ~349 | không phải sổ điểm | sổ Ví hoặc hạn mức đại lý (`applyWalletDelta`, `dealerCreditLedger`), `auth.service.ts` ~453 chỉ cộng điểm khi gộp khách |

Không có đường chi tiêu nào khác: mở lô vườn (`game-garden.service.ts`, `unlockPlot`) dùng giọt nước chứ không dùng điểm (đường xu trả 410), các file game khác (`game-economy`, quiz, gift, collection, community) không đọc `pointsBalance`, Season Pass chỉ cộng qua `RewardPointsService.grant`. Các đường thu hồi và hết hạn không bị chặn là cố ý (chặn thu hồi bằng khoá nghĩa là không thu hồi được); chúng có thể kéo số dư xuống dưới phần cần thu hồi, khi đó `reverseOrderPoints` thu hồi ít hơn thay vì làm âm (xem mục 4).

## Mục 4: hai comment sai

Đã viết lại (chỉ đổi comment): `loyalty.service.ts` ở `reverseOrderPoints` và `loyalty-expiry.service.ts` ở `lotRecoverable`. Nội dung đúng nay là: bốn đường khách chi tiêu Điểm Xanh thường (checkout, đổi voucher, góp quỹ cây, vòng quay) chỉ tiêu phần vượt `lockedOrderPoints`; thu hồi/hết hạn không phải chi tiêu nên không bị chặn và có thể làm số dư thấp hơn phần cần thu hồi; trần theo số dư chỉ là lưới an toàn cuối, không phải bảo đảm "luôn đủ". Không còn đường chi tiêu nào không chặn.

## Mục 5: PF-3.md

Sửa hai chỗ cũ sau `abf37df5` (dòng "Mục 2" và dòng "Rủi ro") cho đúng: chỉ `ORDER_REVERSED` có thể có delta 0 và bị lọc khỏi lịch sử khách, `REVIEW_DELETE` không ghi dòng 0. Thêm mục "Sau review (lượt 2)" ghi finding vòng quay và cách xử lý (PF-5a). PF-3 không đổi mã.

## Miniapp hiển thị lỗi 400 của vòng quay ra sao (chỉ đọc, không sửa)

Thông báo mới có tới tay khách. Chuỗi gọi: `WheelOfFortune.handleSpin` (`apps/miniapp/src/components/wheel.tsx`) gọi `onSpin` = `handleSpin` trong `use-game-actions.ts`, nơi `catch` gọi `openSnackbar({ text: getErrorMessage(e), type: 'error' })`. `getErrorMessage` (`services/api.ts:143`) trả thẳng `message` của backend khi status < 500 (trừ 429), nên khách thấy nguyên câu "Cần 10 Điểm Xanh để quay. Một phần điểm chưa dùng được: 20 điểm từ đơn mới giao sẽ dùng được sau ngày <dd/mm/yyyy> (hết hạn đổi/trả hàng)." (`ngày` định dạng `dd/mm/yyyy` giờ VN). Không có bước chuyển đổi nào chặn. Ghi cho điều phối viên, không sửa:

- Nút "Quay ngay" chỉ khoá khi đang quay (`disabled={spinning}`), không khoá theo số dư hay điểm dùng được; khách bấm rồi mới thấy lỗi. Có thể gợi ý hiển thị điểm dùng được, nhưng số `profile.spinCostPoints` đã có sẵn.
- Theo mã (chưa chạy thật): `rotation` được đặt trước khi gọi API và `catch` không đặt lại, nên khi API từ chối thì snackbar hiện ngay (`Promise.all` reject sớm) trong lúc bánh xe có thể vẫn quay nốt hiệu ứng 3,6 giây. Hành vi có từ trước, áp dụng cho mọi lỗi 400 của vòng quay (hết lượt, thiếu điểm), không do gói này.
- Câu thông báo dài hơn trước (hai câu); chưa kiểm snackbar của zmp-ui có cắt dòng không (không chạy miniapp ở gói này).

## Lệnh đã chạy và kết quả

Trong worktree, `PATH` node 22.23.3, `DATABASE_URL=postgresql://tubu:tubu@localhost:5701/tubutree_it?schema=public`.

- `pnpm install --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate`, `npx prisma migrate deploy` (DB throwaway): thoát 0.
- `npx tsc --noEmit -p tsconfig.json` (apps/api): thoát 0.
- `npx eslint --max-warnings=0` trên 6 file `.ts` đã sửa (`game.service.ts`, `game.service.spec.ts`, `loyalty.service.ts`, `loyalty-expiry.service.ts`, `pf5-spin-locked-points.race-spec.ts`, `game-spin-limit.race-spec.ts`): thoát 0. Không đụng file miniapp nên không có lint `tubu-ds` để chạy.
- `npx jest src/modules/game src/modules/loyalty src/modules/reviews`: 23 suite, 605 test xanh, thoát 0.
- `npx jest -c test/integration-race/jest.config.js --runInBand pf5 pf3 pe5-reversal pe3-reward pd3 game-spin-limit game-tree loyalty order-cancel review-edit`: 21 suite, 190 test xanh, thoát 0 (gồm mọi race spec khác gọi `spin`: `pe3-reward-expiry`, `pd3-checkout-points`, `game-spin-limit`).
- Race riêng của gói chạy thêm 6 lần liên tiếp: 12/12 xanh mỗi lần.
- Phép đỏ trước và đột biến: như mục 2 (mã cũ đặt tạm bằng `git show 6c504cf8:...` rồi đặt lại, kiểm `md5` bản sửa trước và sau mỗi lần; `git status` sạch sau đó).

## Chưa verify

- Không chạy Playwright e2e, full suite, `nest build`, capture/axe. Chưa chạy miniapp, nên thông báo mới hiển thị ra sao trong snackbar thật (độ dài, cắt dòng) chưa kiểm.
- Không kiểm trên DB dùng chung: chưa biết khách nào đã quay hết điểm khoá trước bản sửa (số dư vẫn khớp sổ nhưng điểm của đơn đã trả có thể đã bị giữ). Mã mới không sửa ngược các khách đó.
- Chưa có race riêng cho ba lượt quay song song với đổi voucher hoặc checkout của cùng khách (mỗi đường đã có race với khoá riêng; chung quy ước khoá user trước, nên không phát hiện nguy cơ deadlock, nhưng chưa chạy tổ hợp).

## Rủi ro và việc ngoài nhóm file

- Hành vi nhìn thấy được: khách vừa nhận điểm đơn giao không quay được bằng phần điểm đó trong cửa sổ đổi/trả (mặc định 7 ngày), giống đổi voucher và góp quỹ. Nên báo trong FAQ/UI nếu muốn tránh khách tưởng lỗi; nút "Quay ngay" không phản ánh điều này (xem phần miniapp).
- Nhánh âm của `GameService.creditPoints` vẫn trừ điểm không qua `lockedOrderPoints`; hiện không có caller hợp lệ. Nên xoá nhánh hoặc thêm kiểm giá trị cấu hình `game.spin_prizes` (hiện không có kiểm dạng, `RANGES` chỉ kiểm số) và `Mission.rewardPoints` âm. Không làm ở gói này vì không phải đường chi tiêu của khách.
- `game-spin-limit.race-spec.ts` nằm ngoài nhóm file chính thức (không phải `pf5-*`); chỉ thêm một provider `LoyaltyService`, bắt buộc vì `spin` nay cần nó. Nếu gói khác đang sửa file này sẽ có xung đột nhỏ ở khối `providers`.
