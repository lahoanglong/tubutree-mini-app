# PE-1a: chống bấm đôi góp quỹ trồng cây + hạn của điểm hoàn khi huỷ đơn

Nhánh `hz13/PE-1a`, tách từ `hardening/2026-10` @ `6739ca0a`. Chỉ đụng API (`apps/api`), không có migration, không sửa checkout, order-reversal, wallet.

Commit: `ece07c7c` (Mục 1), `87407fcd` (Mục 2), `657a9696` (sửa cron hết hạn, phát hiện khi làm Mục 2), `35a40164` (test controller), `0a64a1ce` (sau review: giả định `createdAt` của dòng `POINTS_EXPIRED`).

## Mục 1 (OQ-5): Idempotency-Key cho `POST /game/tree/buy`

### Đã làm
- `game.controller.ts` nhận header tuỳ chọn `Idempotency-Key` (cùng tên với checkout) và chuyển cho `GameService.buyTree(userId, key?)`.
- Key hợp lệ là chuỗi 8 đến 128 ký tự `[A-Za-z0-9_-]`. Header có mà sai (rỗng, ngắn, dài, có khoảng trắng, dấu `:`, ký tự ngoài ASCII, header lặp bị gộp bằng dấu phẩy) thì 400 tiếng Việt, trước khi mở transaction. Vắng header thì hành vi y như cũ (mã ngẫu nhiên 8 ký tự, không tra bản ghi cũ). Header rỗng được coi là sai, không coi là vắng, để lỗi client không biến thành "tưởng đã chống bấm đôi" (khác dealer, nơi chuỗi rỗng bị bỏ qua).
- Có key thì `certificateCode = 'TUBU-' + 12 ký tự hex in hoa đầu của sha256('game:tree-buy:' + userId + ':' + key)`. Hàm thuần nằm ở `tree-purchase-key.ts` (`parseTreeBuyKey`, `treeCertificateCodeFor`).
- Trong transaction: khoá dòng user (`FOR UPDATE`, đã có), SAU ĐÓ mới tra `planted_trees` theo mã. Có rồi thì dựng lại kết quả từ sổ điểm (`reason = GAME_BUY_TREE:<mã>` kèm userId): `pointsUsed` = tổng điểm đã trừ, `pointsUsedConverted` = phần lô CONVERTED, `cost` = `pointsUsed`, `treeType` lấy từ bản ghi. Nên lượt gọi lại trả đúng kết quả lượt đầu dù giá `game.tree_points_price` đã đổi, và không trừ thêm.

### Quyết định thiết kế
- Không cần cột/migration: chính cột unique `planted_trees.certificateCode` là khoá chống trùng, `GAME_BUY_TREE:<mã>` đã có sẵn trên sổ điểm.
- Mã dài 12 hex (không phải 8 như luồng không key). Lý do: mã này do client chọn gián tiếp, nếu trùng một cây có sẵn thì key đó không bao giờ thành công; 8 hex (32 bit) đã có xác suất va chạm đáng kể ở cỡ trăm nghìn cây, 48 bit thì không đáng kể ở cỡ triệu. Khác độ dài nên không thể trùng mã ngẫu nhiên của luồng không key. Giao diện chỉ hiển thị mã dạng chuỗi (không có regex kiểm độ dài ở miniapp/web).
- Key của user A không chạm bản ghi user B: hash gắn userId, tra sổ điểm luôn kèm userId. Nếu mã suy ra đã thuộc user khác (va chạm hash hoặc cố ý mài key) thì 400 "Idempotency-Key này không dùng được", không trừ điểm, không lộ dữ liệu người kia.
- Thiếu điểm thì tx rollback, không để lại cây hay dòng sổ; nạp thêm rồi dùng lại cùng key thì góp được bình thường (key chỉ "chiếm chỗ" khi lượt góp đã thành công).
- Kiểm giá cấu hình hợp lệ vẫn ở ngoài tx như cũ, nên nếu admin đặt giá sai thì replay cũng 400 "chưa khả dụng". Chấp nhận, không đáng thêm nhánh.

### Test
- Unit: `tree-purchase-key.spec.ts` (validate key, mã tất định, khác user/khác key, ranh giới user:key), `game.service.spec.ts` (replay, đổi giá, thứ tự khoá trước tra, key khác, thiếu điểm rồi nạp, va chạm user khác, 6 dạng key sai không mở tx, hai biên 8 và 128, không key như cũ), `game.controller.spec.ts` (header chuyển nguyên văn).
- Race Postgres thật `test/integration-race/game-tree-idempotency.race-spec.ts` (12 ca): 8 request song song cùng key → đúng 1 cây, trừ 50 một lần, cùng mã; 10 vòng lặp; gọi lại tuần tự; hai lô (20 thường + 100 quy đổi) → mọi request báo 30 quy đổi; key khác nhau → nhiều lượt; 3 key × 4 request xen kẽ; thiếu điểm song song → toàn 400 rồi nạp và dùng lại key; số dư vừa đủ 1 lượt + 6 request → cả 6 cùng nhận mã; hai user cùng key song song → độc lập; va chạm mã với user khác → 400; không key → như cũ; key sai → 400.
- Đỏ → xanh: với thân hàm giả (nhận key nhưng bỏ qua) 29 unit và 10/12 ca race đỏ đúng lý do (8 request → 8 cây). Đột biến thử: đặt bước tra "đã có chưa" TRƯỚC khoá dòng user thì 7/12 ca race đỏ (kẻ thua đụng unique), nên spec thật sự chứng minh thứ tự khoá.

## Mục 2 (OQ-15): hạn của điểm hoàn khi huỷ đơn

### Đã làm
- `reverseOrderPoints` ghi dòng `ORDER_REFUND_POINTS` (lô STANDARD) với `expiresAt = bây giờ + loyalty.point_expire_months` tháng, tái dùng `pointsExpiresAt` như điểm danh và POS (cấu hình hỏng thì 12 tháng). Tính ngoài transaction, chỉ khi có phần STANDARD để hoàn. Dòng trừ `ORDER_REVERSED` và lô CONVERTED (tiền trả trước, CHECK `converted_no_expiry`) không đổi.
- Không backfill dòng hoàn cũ có `expiresAt NULL` (chưa có dữ liệu thật).
- Sửa `pd3-order-reversal.race-spec.ts`: nó khẳng định `expiresAt: null` cho dòng hoàn STANDARD, nay là `expect.any(Date)`.

### Phát hiện và sửa: cron hết hạn có thể trừ điểm lần hai (commit `657a9696`)
Kiểm "cron không trừ trùng" với dòng hoàn có hạn cho kết quả đỏ. `computePointExpiry` replay mọi dòng âm vào lô CŨ NHẤT, kể cả `POINTS_EXPIRED` do chính cron ghi. Khi trước lô hết hạn còn một lô không hạn (thưởng game, review) hoặc lô hết hạn muộn hơn, dòng `POINTS_EXPIRED` bị replay vào lô đó, lô hết hạn trông còn nguyên và đêm sau cron trừ lại, lặp mỗi đêm cho tới khi lô cũ cạn. Lỗi này có từ trước (lô đơn giao có hạn nằm sau lô game không hạn cũng dính); lô hoàn có hạn chỉ làm nó dễ gặp hơn, nên sửa trong đợt này. Đã tái hiện trên Postgres thật (cron cũ: 3/7 ca đỏ, mất 40 điểm lần hai).
- Sửa: `PointExpiryTxn` có thêm `reason?`; dòng `POINTS_EXPIRED` được replay vào các lô đã hết hạn tại thời điểm nó được ghi trước, phần dư mới FIFO như cũ; dòng tiêu thường giữ nguyên FIFO. Khi mọi lô cùng thời hạn thì kết quả y hệt cũ (mọi test cũ vẫn xanh). `loadTxns` đọc thêm `reason`.
- Đối soát `reconcile-points` (so `pointsBalance` với `SUM(delta)` lô STANDARD) không phụ thuộc hạn nên không đổi; mọi spec race của gói kiểm `findPointsLotDrift = []` sau từng ca.

### Test
- Unit `loyalty.service.spec.ts` (hạn mặc định, 6 tháng, cấu hình hỏng, ORDER_REVERSED không mang hạn, hoàn lặp không ghi), `loyalty-expiry.service.spec.ts` (8 ca hàm thuần gồm mô phỏng cron 4 đêm, 2 ca dịch vụ: đọc `reason`, không trừ lần hai).
- Race `loyalty-refund-expiry.race-spec.ts` (7 ca): hạn ≈ +12 tháng, 5 lần hoàn song song chỉ một dòng, đơn hai lô, cron không đụng điểm hoàn còn hạn, lùi hạn rồi chạy cron nhiều lần chỉ trừ một lần, FIFO một phần, lô game không hạn cũ hơn + 3 lần cron.
- Đỏ → xanh Mục 2: 8 unit đỏ vì `expiresAt` undefined, 4 race đỏ vì `NULL`; sau khi sửa xanh. Phần cron: 6 unit và 3 race đỏ với cron cũ.

### Liệt kê nơi ghi dòng điểm dương lô STANDARD không có `expiresAt` (grep `pointsTransaction.create*` và `applyPointsDelta`)
Còn lại sau gói (không sửa, vì không rõ là cùng lỗi: đây có thể là luật nghiệp vụ "điểm game/review không hết hạn", cần chủ dự án quyết):
1. `game.service.ts` `creditPoints` (dòng cộng thưởng): `GAME_SPIN_WIN:<giải>` và `MISSION:<mã>:<chu kỳ>`.
2. `reviews.service.ts` tạo đánh giá: `REVIEW:<slug>`.

Đã có hạn: `creditOrderPoints` (đơn giao), điểm danh, POS, `RewardPointsService.grant` (giới thiệu, nhiệm vụ gian hàng, season pass, cộng đồng, mốc CTV, đều qua `applyPointsDelta` có `expiresAt`). Không hạn có chủ đích: lô CONVERTED (`ORDER_REFUND_CONVERTED`, `ORDER_REFUND_XU`, migration xu → điểm). Script dữ liệu giả (`scripts/loadtest`, `scripts/audit`) không tính. Nhờ bản sửa cron, các lô không hạn ở mục 1 và 2 không còn làm cron trừ trùng.

## Lệnh kiểm và kết quả thật
Chạy trong `apps/api` của worktree, PATH node 22. Postgres throwaway `tubu_it_pe1a` cổng 5591, DB `tubutree_it`, `prisma migrate deploy` xong (132 migration).

| Lệnh | Exit | Kết quả |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` (sau `pnpm build` của shared-types để phân giải kiểu) | 0 | sạch |
| `npx eslint --max-warnings=0 src/modules/game src/modules/loyalty` + 3 race spec đã sửa/thêm | 0 | sạch |
| `npx jest src/modules/game src/modules/loyalty` | 0 | 20 suite, 421 test xanh |
| `DATABASE_URL=...5591/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand game-tree-idempotency loyalty-refund-expiry pd3-order-reversal pd3-points-lots pd3-tree-lock pd3-checkout-points game-spin-limit pd3-reward-sources loyalty.race` | 0 | 9 suite, 54 test xanh |
| lặp 3 lần `game-tree-idempotency loyalty-refund-expiry` | 0, 0, 0 | 19/19 mỗi lần |

## Chưa verify
- Không chạy Playwright, full suite jest, full bộ race spec (điều phối viên chạy). Các spec race ngoài 9 suite ở trên (vd checkout, wallet, referral) chưa chạy lại trong gói này.
- Miniapp chưa gửi header `Idempotency-Key` cho nút góp quỹ: gói này chỉ làm API. Muốn hết bấm đôi thật ngoài đời, FE phải sinh một key mỗi lần mở màn góp và gửi lại cùng key khi bấm lại (`newIdempotencyKey()` có sẵn trong `apps/miniapp/src/utils/idempotency.ts` sinh UUID hoặc `idk-…`, đều qua được validate).
- Chưa chạy trên staging/PROD, chưa đo với `connection_limit` thật.

## Rủi ro còn lại
- Request cùng key chờ khoá dòng user thì giữ một kết nối pool trong lúc chờ lượt thắng (vài chục ms). Bấm đôi chỉ thêm 1 kết nối; khi tải bùng nổ phải đặt `connection_limit` theo số vCPU (đang chờ số `nproc`), nếu không có thể gặp P2028.
- Không có key thì bấm đôi vẫn thành hai lượt (đúng yêu cầu "hành vi như cũ"); bảo vệ chỉ có khi FE gửi key.
- Dòng hoàn cũ `expiresAt NULL` giữ nguyên (không backfill).
- Thứ tự replay của cron dựa trên `createdAt`, không đổi so với trước. `createdAt` do client Prisma gán bằng giờ máy ứng dụng lúc INSERT (không phải lúc bắt đầu transaction; đã đo trên Postgres thật: transaction mở 12:26:26.311, INSERT 12:26:27.766, `createdAt` 12:26:27.767), nên luôn không sớm hơn `now` mà cron chụp lúc bắt đầu. Quy tắc "POINTS_EXPIRED chỉ ăn lô có `expiresAt <= createdAt`" dựa vào điều này; đã ghi chú cạnh `EXPIRY_REASON` và có test giữ.
- Điểm game/review không hạn (danh sách ở trên) là quyết định nghiệp vụ còn mở.
- Gói đụng điểm (tiền trả trước) nên cần review opus hai lượt; hai chỗ nên nhìn kỹ: thứ tự "khoá dòng user rồi tra mã" trong `buyTree`, và quy tắc replay `POINTS_EXPIRED` trong `computePointExpiry`.

## Sau review
Review độc lập cho ba finding, cả ba mức minor. Mỗi cái đã đối chiếu với mã trước khi quyết; cả ba đều đúng về sự thật, một cái sửa, hai cái không sửa trong gói này.

### 1. Điểm hoàn khởi động lại đồng hồ hạn: đúng, không sửa, chuyển thành câu hỏi mở cho chủ dự án
Đã kiểm: `reverseOrderPoints` gọi `pointsExpiresAt(new Date())` (`loyalty.service.ts`), không liên quan tới hạn của các lô mà dòng `ORDER_REDEEM` đã ăn. Race spec đã có sẵn cho thấy rõ: lô seed hết hạn sau 300 ngày, dòng hoàn nhận hạn khoảng 12 tháng. Nửa còn lại của finding cũng đúng: `checkout.service.ts` tiêu điểm theo `pointsBalance` (guard `gte`), không xét hạn của từng lô, nên điểm đã quá hạn mà cron 01:00 chưa trừ vẫn dùng được, huỷ đơn thì nhận lại với hạn mới. Chưa đo được tần suất huỷ đơn có thể lặp lại trong thực tế (giới hạn huỷ của khách không nằm trong gói này), nên mức khai thác thực tế là unverified.

Lý do không sửa: đề bài của gói quy định đúng hành vi này (tái dùng `pointsExpiresAt`, 12 tháng như điểm thường), và đổi sang "kế thừa hạn gốc" là đổi luật nghiệp vụ ngoài mục tiêu gói, lại đụng tới tiền trả trước của khách (điểm). Trước gói này dòng hoàn không bao giờ hết hạn nên hiện trạng đã chặt hơn.

Câu hỏi mở cho chủ dự án (OQ-15b), ba lựa chọn:
- Giữ như hiện tại: mỗi vòng đặt rồi huỷ đơn gia hạn thêm tối đa 12 tháng cho phần điểm đã tiêu. Đơn giản, không thêm code.
- Dòng hoàn kế thừa hạn của lô bị ăn: replay FIFO tới dòng `ORDER_REDEEM:<mã>`, lấy hạn sớm nhất trong các lô nó ăn, hoàn với `min(hạn gốc, bây giờ + N tháng)`. Hạn gốc đã qua thì dòng hoàn đã hết hạn ngay và cron đêm đó trừ lại (đúng luật hạn). Chặt nhất nhưng cần thêm logic replay và test, nên làm thành gói riêng, kèm review opus vì đụng điểm.
- Giữ hạn mới nhưng chặn vòng lặp ở chỗ khác (giới hạn số lần huỷ đơn dùng điểm trong kỳ): nằm ngoài loyalty, cần PM quyết.

### 2. Câu sai về `createdAt` trong báo cáo: đúng, đã sửa (commit `0a64a1ce`)
Đã đo lại trên Postgres thật (probe ngoài repo, đã xoá): transaction mở 12:26:26.311, giờ máy ứng dụng ngay trước INSERT 12:26:27.766, `createdAt` ghi ra 12:26:27.767. Vậy `createdAt` là giờ máy ứng dụng lúc INSERT (client Prisma gán, dù cột DB có `DEFAULT CURRENT_TIMESTAMP`), không phải lúc bắt đầu transaction. Đã sửa câu đó ở mục "Rủi ro còn lại".

Giả định mà quy tắc replay `POINTS_EXPIRED` dựa vào là `createdAt >= now` của lượt cron. Đã làm ba việc: ghi chú cạnh `EXPIRY_REASON` (nói đúng lý do và hậu quả nếu đặt sớm hơn), dùng hằng số `EXPIRY_REASON` ở chỗ tạo dòng cùng một dòng nhắc không đặt `createdAt` tay, và hai test giữ giả định: unit kiểm dữ liệu tạo ra không có `createdAt`, race kiểm `createdAt` của dòng thật không sớm hơn lúc cron bắt đầu. Test này không đỏ trước khi sửa vì hành vi vốn đúng; để chứng minh nó có tác dụng, đã thử đột biến đặt `createdAt = now - 60 giây` trong cron: unit mới đỏ, race mới đỏ, và 3 ca cron cũ trong `loyalty-refund-expiry` cũng đỏ (cron trừ lần hai quay lại), rồi khôi phục. Chiều ngược lại (`createdAt` muộn hơn `now` vài giây tới vài phút khi cron chạy dài) theo lập luận không làm sai tổng điểm trừ vì mọi lô liên quan đều đã hết hạn ở đêm kế tiếp; đây là lập luận, chưa có test.

### 3. Miniapp chưa gửi `Idempotency-Key`: đúng, không sửa trong gói này, chuyển thành việc FE
Đã kiểm: grep `apps/miniapp/src` không có nơi nào gửi header này cho góp quỹ cây (`buyTreeM = useMutation({ mutationFn: buyTree })` trong `use-game-actions.ts`, `onBuy={() => buyTreeM.mutate()}` trong `pages/game.tsx`); chỉ `dealer.tsx` dùng `newIdempotencyKey()`. Nên OQ-5 mới đóng ở phía API; ngoài đời bấm đôi vẫn ra hai lượt cho tới khi FE gửi key. Báo cáo gốc đã nêu điều này.

Lý do không sửa: gói PE-1a chỉ đụng `apps/api` (ghi ngay từ đầu), còn FE đi qua chuẩn `tubu-ds`, vitest miniapp và nằm đúng các file mà gói `busyRef` trang Vườn và sửa cảnh báo `key` trùng (mục C của roadmap) cũng sẽ sửa, nên gộp vào đây dễ xung đột khi hợp nhánh. Đề xuất cho gói FE:
- `buyTree(key)` gửi header `Idempotency-Key` (8 đến 128 ký tự `[A-Za-z0-9_-]`; `newIdempotencyKey()` sinh UUID hoặc `idk-…` đều hợp lệ).
- Giữ key trong `useRef`, sinh lúc bắt đầu một lượt góp và dùng lại khi bấm lại hoặc retry. Thiếu điểm (400) thì giữ key: API chỉ "chiếm chỗ" khi lượt góp đã thành công.
- Phải sinh key MỚI sau khi góp thành công. Quên bước này thì lượt góp sau dùng lại key cũ, API trả lại kết quả lượt đầu và không trồng thêm cây, khách bị báo thành công mà không góp.
- Gặp 400 "Idempotency-Key này không dùng được" (mã suy ra đã thuộc người khác, hiếm) thì sinh key mới và thử một lần.

### Lệnh kiểm sau review
Chạy trong `apps/api` của worktree, PATH node 22, Postgres throwaway `tubu_it_pe1a_fix` cổng 5592 (DB `tubutree_it`, 132 migration), đã `docker rm -f -v` sau khi xong.

| Lệnh | Exit | Kết quả |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 | sạch |
| `npx eslint --max-warnings=0` 3 file đã sửa (`loyalty-expiry.service.ts`, `.spec.ts`, `loyalty-refund-expiry.race-spec.ts`) | 0 | sạch |
| `npx jest src/modules/loyalty src/modules/game` | 0 | 20 suite, 422 test xanh (trước review 421) |
| `DATABASE_URL=...5592/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand game-tree-idempotency loyalty-refund-expiry pd3-order-reversal pd3-points-lots pd3-tree-lock pd3-checkout-points game-spin-limit pd3-reward-sources loyalty.race` | 0 | 9 suite, 55 test xanh (trước review 54) |
| đột biến `createdAt = now - 60 giây` trong cron (đã khôi phục) | không ghi | unit mới đỏ, race mới đỏ cùng 3 ca cron cũ đỏ (4/8 ca race, 1/30 ca unit) |

Chưa verify: không chạy Playwright, full suite, các spec race ngoài 9 suite trên; không đo mức khai thác thực tế của kẽ hở ở finding 1.
