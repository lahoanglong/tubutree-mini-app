# Review PA-7 lượt 3 — commit e098b73 (thưởng giới thiệu tra theo đơn sau gộp phiên khách, C-003)

Review độc lập, chỉ đọc. Nhánh `hz3/PA-7`, worktree `.claude/worktrees/hz3-PA-7`.
Phạm vi: `wallet/referral-reward.ts`, `wallet/coins.service.ts`, `orders/order-reversal.service.spec.ts`,
`test/integration-race/referral-order2.race-spec.ts`; đối chiếu `auth.service.ts` mergeGuestInto (259-446),
`order-status.service.ts` setStatus (100-205), `affiliate.service.ts` grantReferralReward (530).

## Kết luận: APPROVE

Không có blocker/major. Lỗi MAJOR lượt 2 (sau gộp khách, cùng cặp đơn O1:O2 thưởng lại lần 2 và trả hàng chỉ
tìm `REFERRAL_ORDER2:T`) đã được sửa đúng: lúc cấp thưởng thì loại các đơn đã dùng, lúc thu hồi thì tra theo
id đơn trong refId. Còn 3 minor (bên dưới), không chặn merge.

## Kiểm chứng đã chạy

| Lệnh | Kết quả |
|---|---|
| `cd apps/api && npx tsc --noEmit` | exit 0 |
| `jest --runInBand` unit: orders/order-reversal, orders/order-status, wallet/*, affiliate/*, auth/* | 10 suite, 283 test pass |
| `jest -c test/integration-race/jest.config.js --runInBand referral-order2 auth-merge-guest` trên Postgres thật (`tubu_it_pa7`:5547, `migrate status` = up to date) | 2 suite, 31 test pass (có g1-g4) |

Test có đỏ trước fix hay không: **suy ra từ code, chưa chạy lại trên code cũ** (không checkout theo yêu cầu chỉ đọc):
- g1: trước fix, `grant(T)` không thấy `REFERRAL_ORDER2:T` → lấy O1, O2 (cách 9 và 4 ngày, nằm trong cửa sổ) → R nhận thưởng lần 2 → `balance: REWARD` đỏ.
- g2: trước fix, thu hồi tìm `REFERRAL_ORDER2:<T>` → không thấy → R giữ xu → đỏ.
- g3: trước fix, `deliver(target, 2)` đủ 3 đơn → R2 được thưởng từ O1:O2 → kỳ vọng `r2 = 0` đỏ.
- g4 là test chống hồi quy cho trường hợp không gộp (qua cả trước và sau fix), hợp lệ.
Các test dùng AuthService thật (ensurePhoneForCurrentUser → mergeGuestInto) và setStatus thật, không mock Prisma, nên không phải test giả.

## Trả lời 4 câu hỏi

### (1) Còn đường nào thưởng 2 lần?
- **Tuần tự sau gộp, T cùng người mời R**: `findReferralRewardedOrders(T)` trả O1/O2 kèm referrerId R → return false. Đúng.
- **2 lần setStatus DELIVERED song song cho T**: cả hai `lockReferee(T)` → chạy lần lượt; lần sau thấy `REFERRAL_ORDER2:T`. Thêm partial unique index `coin_transactions_referral_unique(reason) WHERE refType='REFERRAL'` cùng `skipDuplicates` làm lớp chặn thứ hai. Đúng.
- **grant(G) chạy cùng lúc với gộp**: cả hai khoá dòng G (gộp khoá G rồi T) → chạy lần lượt. Nếu gộp chạy trước, grant(G) không còn đơn của G. Nếu grant(G) chạy trước, dòng thưởng đã commit trước khi gộp chuyển đơn. Đúng.
- **grant(T) chạy cùng lúc với gộp**: cả hai khoá T. Ở READ COMMITTED, câu SELECT chạy sau khi lấy được khoá nên thấy đơn đã chuyển và dòng thưởng của G. Đúng.
- Không còn đường nào thưởng lại **cùng cặp đơn**. Ngoài gộp phiên, không có code nào khác đổi `orders.userId` (đã grep).
- Còn để ngỏ (quyết định nghiệp vụ, không phải lỗi của fix này): T có người mời **khác** R2 thì R2 vẫn được thưởng nếu T có 2 đơn mới. Nghĩa là một người thật làm cả R lẫn R2 nhận thưởng, mỗi lượt cần 2 đơn thật ≥ min_order. Comment trong code nói rõ đây là chủ ý. Nếu nghiệp vụ muốn "1 người thật chỉ 1 lần thưởng" thì cần đổi thành `if (rewardedOrders.length) return false`.

### (2) Thu hồi
- **Trừ đúng người**: trừ `grant.userId` (người mời đã nhận lượt đó). Lấy refereeId từ reason của chính dòng thưởng nên reason thu hồi `REFERRAL_ORDER2_REVOKE:<guestId>` khớp với lượt cấp và với `countReferralSuccesses`. Đúng (g1, g2, g3).
- **Idempotent**: reason thu hồi duy nhất cho mỗi người được mời + `createMany skipDuplicates` (ON CONFLICT DO NOTHING) → trả cả O1 lẫn O2 chỉ trừ 1 lần (g1, g2). Lần thu hồi trước gộp (REVOKE:G) và sau gộp cũng không trừ trùng. Đúng.
- **Không làm số dư âm**: `take = min(balance, amount)` đọc sau `FOR UPDATE`. Với nhiều dòng thưởng trong vòng lặp, mỗi lần đọc lại số dư đã giảm trong cùng tx; phần thiếu ghi vào REFERRAL_DEBT. Đúng.
- **Không bắt P2002 trong tx**: không có try/catch. Chỉ dùng ON CONFLICT DO NOTHING. Dòng DEBT (`create` thường) chỉ ghi sau khi insert thành công nên không đụng unique. Đúng.

### (3) False-negative của quy tắc "cùng người mời thì không thưởng lại"
Không đáng kể. Chỉ đơn từ khách đã gộp mới có thể xuất hiện ở đây (ngoài gộp phiên không có gì khác chuyển chủ đơn). Khi cùng người mời thì đó đúng là cùng một người đã được thưởng, kể cả khi lượt đó đã bị thu hồi. Kết quả này nhất quán với trường hợp không gộp: `REFERRAL_ORDER2:<id>` đã tồn tại thì không bao giờ cấp lại. Đơn của khách chưa dùng để thưởng vẫn được ghép với đơn của T như bình thường.

## Phát hiện

### MINOR-1: thu hồi khoá theo `order.userId` lấy từ ảnh chụp cũ
`setStatus` đọc đơn ngoài tx (order-status.service.ts:100). Lần lật trạng thái chỉ chặn theo `status`, không chặn theo `userId`. Nếu gộp phiên commit giữa lúc đọc và lúc lật, `revokeReferralRewardForOrder` sẽ `lockReferee(G)` (id khách cũ) chứ không khoá T.
Kịch bản: O1 của G **chưa** dùng để thưởng. Gộp chạy đúng trong khe đó. Đồng thời có một đơn khác của T vừa DELIVERED → grant(T) (khoá T) đọc O1 còn DELIVERED (lần trả hàng chưa commit) → cấp thưởng O1:O3. Lần thu hồi tra theo id O1 trước khi grant commit → không thấy gì → thưởng còn nguyên dù O1 đã bị trả.
Khe thời gian rất hẹp. Lỗi có sẵn từ trước, không do commit này gây ra; trước fix còn tệ hơn. Cách sửa rẻ: trong `revokeReferralRewardForOrder`, đọc `SELECT "userId" FROM orders WHERE id = $1` trong tx (dòng đã bị chính lần lật khoá nên giá trị đọc được là mới) rồi khoá theo giá trị đó. Comment ở referral-reward.ts:179-183 đang lập luận theo hướng "dòng thưởng của khách"; nên bổ sung giả định về chủ đơn hiện tại.
Cũng từ ảnh chụp cũ đó, ngoài phạm vi PA-7 nhưng đáng ghi lại: phần hoàn tiền trong `reverseFinancials` cộng vào `order.userId` = G, tức ví của khách đã gộp (đã đưa về 0). Còn có thể deadlock giữa trả hàng (khoá O1 → chờ G) và gộp (khoá G, T → chờ O1). Postgres sẽ huỷ một bên nên không lệch tiền, chỉ cần thử lại.

### MINOR-2: thiếu test race cho đường gộp
g1-g4 đều chạy tuần tự. Chưa có test chạy song song gộp với `setStatus DELIVERED` của T, hoặc gộp với trả O1. Lập luận khoá ở mục (1) đúng khi đọc code, nhưng chưa được kiểm bằng test song song.

### MINOR-3 (nit): hiệu năng `findReferralRewardedOrders`
Câu JOIN `o.id IN (split_part(...), split_part(...))` không dùng được index nên quét mọi dòng `refType='REFERRAL'` có prefix REFERRAL_ORDER2, mỗi lần một đơn DELIVERED có người mời. Thu hồi dùng `refId LIKE` cũng không có index. Với lượng thưởng giới thiệu hiện tại thì chấp nhận được. Nếu bảng lớn, nên thêm index biểu thức hoặc lọc trước theo `o."userId"` qua `EXISTS ... ct."refId" LIKE o.id || ':%'`.

Ghi chú khác (không cần sửa trong PA-7): dòng thưởng cũ `REFERRAL_CASHBACK:<guestId>` không gắn với đơn nên không được quy tắc mới chặn. T cùng người mời có thể được thưởng thêm một lần qua luồng mới. Luồng cũ đã gỡ nên rủi ro thấp.
