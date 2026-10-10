# Review vòng 3 (độc lập, chỉ đọc): PA-2 915cc89 (C-004) và PA-3 6be7bbd (C-024)

Nhánh `hardening/2026-10`, HEAD `a2bf222`. Reviewer không sửa code và không ghi git. Probe chỉ nằm trong scratchpad, không nằm trong repo.

## Verdict

| Commit | Verdict | Blocker/Major |
|---|---|---|
| 915cc89 fix(auth) mergeGuestInto check-in/ledger (C-004) | **APPROVE** | 0 / 0 |
| 6be7bbd fix(pancake) reconcile trước status (C-024) | **APPROVE** | 0 / 0 |

## Lệnh đã chạy và kết quả thật

1. `docker run -d --name tubu_it_main ... postgres:16-alpine` (cổng 5550) chạy, `pg_isready` báo ready. Sau đó `DATABASE_URL=...5550/tubutree_it npx prisma migrate deploy` báo "All migrations have been successfully applied."
2. `npx jest -c test/integration-race/jest.config.js --runInBand auth-merge-guest.race-spec.ts pancake-paid-status.race-spec.ts`: **2 suites, 14/14 pass**.
3. `npx jest --maxWorkers=1 src/modules/integrations/pancake src/modules/auth src/modules/loyalty src/modules/orders/order-status`: **18 suites, 331/331 pass**.
4. Probe riêng của reviewer (scratchpad `probe/review.probe-spec.ts`, Postgres thật, chạy PancakeProcessor, OrderStatusService, AuthService và LoyaltyService thật): **11/11 pass**. Kết quả từng kịch bản ở dưới.

## 915cc89: trace điểm danh

Code: `apps/api/src/modules/auth/auth.service.ts:320-352`. Bước 4 chuyển các ngày `< max(target)` không trùng sang target và `RETURNING dayKey`. Bước 5 đổi khoá sổ CHECKIN thành `MERGED:<gid>:<ngày>` cho mọi ngày không có trong danh sách đã chuyển, cũng như ngày mà target đã có dòng sổ.

| Kịch bản | Kết quả (probe/race thật) |
|---|---|
| Khách điểm danh hôm nay, target hôm qua | Ngày hôm nay của khách ở lại khách, dòng sổ của khách mang khoá `MERGED`. Target điểm danh hôm nay thành công, chuỗi = 2, số dư = tổng sổ (race spec). |
| Cùng một ngày | Target giữ dòng của mình, giữ cả hai lượt điểm, hôm sau chuỗi đi tiếp (race spec). |
| Khách có ngày cũ hơn ngày gần nhất của target | Ngày đó chuyển sang target cùng khoá ngày, chuỗi không đổi (race spec). |
| A1: target chưa từng điểm danh, khách hôm qua + hôm nay | Chuyển hết. `checkedInToday=true`, chuỗi = 2, điểm danh lại bị từ chối, số dư 12 = tổng sổ. |
| A3: ngày xen kẽ (target -4,-2; khách -5,-4,-3,-1,0) | Target có -5,-4,-3,-2. Khách giữ -4,-1,0, dòng sổ của 3 ngày này mang khoá MERGED. Target điểm danh hôm nay thành công, số dư = tổng sổ = 2+10+điểm hôm nay. |
| A4: target có dòng sổ CHECKIN cũ nhưng không có dòng `loyalty_check_ins`, khách có ngày đó | Dòng sổ của khách mang khoá MERGED, không có P2002, số dư khớp tổng sổ. |
| A5: gộp và target điểm danh hôm nay chạy song song (5 vòng) | Cả hai thành công, không có P2002, số dư = tổng sổ. |

Ghi nhận (minor, không chặn):
- **m1 (chuỗi reset do thiết kế):** khách điểm danh hôm qua, target hôm kia, gộp hôm nay. Ngày hôm qua ở lại khách nên chuỗi của target đứt: probe A2 cho `streakDays` trước khi điểm danh = 0, điểm danh xong chuỗi = 1 và cycleDay = 1. Với người dùng thật thì đây là 3 ngày liên tiếp. Hệ quả này có từ b0053f9 ("không thừa hưởng chuỗi khách"), không phải hồi quy của 915cc89. Nếu muốn "không reset sai" theo nghĩa của người dùng thì cần một quyết định nghiệp vụ riêng (ví dụ cho phép nối chuỗi khi ngày của khách bằng max(target)+1).
- **m2:** trong kịch bản "khách hôm nay, target hôm qua", target nhận hai lượt điểm cho cùng một ngày. Điều này đúng với Q-11 và tối đa 1 lần cho mỗi lần gộp.
- **m3:** test dùng `vnDay()` theo `Date.now()`, nên có thể chập chờn nếu chạy đúng lúc qua nửa đêm giờ VN (khoảng thời gian rất nhỏ).
- Không còn chỗ nào trong src đọc `refId` CHECKIN như một ngày (grep `'CHECKIN'` chỉ ra auth.service và loyalty.service), nên tiền tố MERGED an toàn. `<> ALL('{}'::text[])` đã được kiểm với mảng rỗng (race test 1 và 2 có movedCheckInDays rỗng).

## 6be7bbd: trace Pancake

Code: `apps/api/src/modules/integrations/pancake/pancake.processor.ts:30-33, 95-106`. Gate nằm ở `order-status.service.ts:111-122`, transition ở `order-transition.ts:20-83`.

| Kịch bản | Kết quả |
|---|---|
| status=3 + bank_payment=total | Ra SHIPPING+PAID, không có marker. Sự kiện lặp lại không đổi gì: history 1, order_paid 1 (race spec). |
| status=2 + bank | Ra PACKED+PAID (race spec). |
| status=3, không có tiền | Giữ PENDING_PAYMENT+UNPAID, có marker, event PROCESSED (race spec). |
| status=6 + bank | Ra CANCELLED+UNPAID. Probe P4 gửi 2 lần: cả hai PROCESSED, ví vẫn 0. |
| P1: status=0 + bank | Ra CONFIRMED+PAID, PROCESSED. Lệnh setStatus(PENDING_PAYMENT) sau khi đã lật bị `assertTransition` chặn và nuốt êm, không có marker. |
| P2: chỉ có bank_payment, không có status | Ra CONFIRMED+PAID. |
| P5: hai sự kiện 3+bank giống nhau chạy song song (5 vòng) | Luôn ra SHIPPING+PAID, history 1, order_paid 1, không có marker. |

Ghi nhận (minor, không chặn):
- **m4 (marker cũ còn sót):** probe P3. Trước đó có webhook status=3 chưa có tiền, nên đã ghi marker. Webhook sau mang status=3 + bank thì đơn tự lên SHIPPING+PAID, nhưng `note` vẫn còn `[Chờ thanh toán: vận chuyển đã báo SHIPPING — đẩy tay sau khi nhận tiền]`, dù đơn đã đẩy xong. Gợi ý: xoá marker khi setStatus thắng ở đúng target đó.
- **m5:** nhánh reconcile lật PENDING_PAYMENT→CONFIRMED bằng `flipPaidWithEvent` (`pancake.processor.ts:199-203`). Nhánh này không ghi `order_status_history` và không đi qua `OrderStatusService.markPaid`, nên audit chỉ có `['SHIPPING']`. Race spec còn khẳng định đúng điều này (`history == ['SHIPPING']`). Vấn đề có từ trước, nhưng test đang khoá luôn thiếu sót đó.
- **m6:** test "huỷ + tiền về" chỉ kiểm CANCELLED+UNPAID. Nó không kiểm rằng cảnh báo hoàn tiền thủ công được phát ra (`pancake.processor.ts:189-193`, chỉ là `logger.warn`, không có alert cho admin). Yêu cầu "vẫn ra cảnh báo hoàn thủ công" chỉ đúng khi đọc code, test không chứng minh.
- **m7 (có từ trước, chỉ xảy ra khi concurrency>1):** probe P6 chạy song song sự kiện 3+bank với sự kiện 6+bank, 5/5 vòng ra SHIPPING+PAID. Lệnh huỷ thua guard `status` trong `setStatus` (`order-status.service.ts:186-189`), bị bỏ qua trong im lặng, mà event vẫn PROCESSED. `@Processor(QUEUE_PANCAKE_EVENTS)` không đặt concurrency, mặc định của BullMQ là 1, nên với 1 instance thì không xảy ra. Khi xử lý tuần tự, cả hai thứ tự đều đúng: ship rồi huỷ thì đơn huỷ và có hoàn; huỷ rồi ship thì có cảnh báo hoàn thủ công.
- Không có hồi quy cho luồng khác: chỉ 4 eventType `orders/order/order.status_updated/order.updated` đổi thứ tự. `order.cancelled`, `order.shipping_updated` và đơn đại lý ghi nợ không bị ảnh hưởng, vì reconcile không phụ thuộc thứ tự cho những đơn này.
