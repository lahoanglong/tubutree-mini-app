# Gói P3 api-hotro: Gửi tin, lệch sổ, Zalo OA, CSKH, dọn dẹp

Gốc: main 815fa3c1e. Nguồn: các P3 reviewer Opus nêu ở đợt 28/10 (gói api-tin, hotro, dondep) chưa sửa, mục làm dở, và mục còn lại trong báo cáo cuối.

Với mỗi mục: kiểm còn đúng trên mã hiện tại không (nhiều mục đã sửa ở lượt review sau hoặc gói khác; dòng có thể lệch). Đã hết thì ghi skipped + bằng chứng file:dòng. Mục cần chủ quyết (ghi needs_owner/cần chủ quyết, hoặc phải đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, thêm tin gửi khách) thì skipped, ghi lựa chọn cho chủ. Mục trùng nhau thì làm một lần, ghi id kia là trùng.

## api-hotro-1 (review lượt 1, gói api-tin)

File: apps/api/src/modules/orders/order-status.service.ts:676

Vấn đề: E-85, lúc chuyển bản deploy: đơn giao TRƯỚC khi deploy mà việc sau giao còn dở (INCOMPLETE) đã nhận tin ORDER_DELIVERED không có dedupeKey. Sau deploy, DeliveredEffectsResyncCron (cửa sổ 14 ngày) hoặc nút chạy lại của admin làm xong, rồi sendDeliveredNotice gửi với khoá 'order-delivered:<mã>'. Không có log nào mang khoá đó nên không bị chặn, khách nhận tin 'Đã giao' lần hai. Chỉ xảy ra một lần, với số đơn đang kẹt lúc deploy.

Cách sửa đề xuất: Trong sendDeliveredNotice (hoặc chỉ ở đường resync), kiểm thêm tin cũ trước khi gửi: notificationLog.findFirst({ where: { userId, channel: 'INAPP', templateCode: 'ORDER_DELIVERED', payload: { path: ['data','order_code'], equals: order.code } } }). Thấy thì bỏ qua, giống closureNoticeSent đang làm cho tin huỷ/trả. Hoặc trước khi deploy, đếm số đơn DELIVERED chưa có deliveredEffectsAt trong 14 ngày: bằng 0 thì bỏ qua mục này.

## api-hotro-2 (review lượt 1, gói api-tin)

File: apps/api/src/modules/notifications/notifications.service.ts:279

Vấn đề: E-86: withQueueTimeout có thể báo lỗi trong khi Redis thực ra đã nhận job (timeout nhưng job đã vào hàng). Khi đó log bị ghi FAILED và đổi khoá ':failed:<id>', còn job vẫn chạy: deliverZns (dòng 333) chỉ bỏ qua log SENT nên vẫn gửi ZNS. tier-drop nhả phần việc, đêm sau gửi ZNS lần hai (tốn phí ZNS, khách nhận đôi). Trước khi sửa thì không có lần thử lại nên không gửi đôi. Rất hẹp.

Cách sửa đề xuất: Ở deliverZns dòng 333 bỏ qua cả log FAILED: `if (current?.status === 'SENT' || current?.status === 'FAILED') return current.status`. FAILED là trạng thái cuối nên không làm hỏng lần thử lại hợp lệ (lần thử lại đi qua RETRYING). Thêm một ca vào notifications.zns-queue.spec.

## api-hotro-3 (review lượt 1, gói api-tin)

File: apps/api/src/modules/loyalty/loyalty-expiry.service.ts:432

Vấn đề: E-36: trên PROD, dòng cron_runs 'LoyaltyExpiryService.expirePoints' đã có lastSuccessAt. Các lượt trước deploy ghi lỗi từng khách ở mức warn nên vẫn tính là OK. Vì vậy lượt đầu sau deploy không quét đủ: khách bị lỗi kéo dài, có lô hết hạn sớm hơn mốc 2 ngày, sẽ không bao giờ được thử lại. Trước đây họ được thử lại mỗi đêm (dù vẫn lỗi). Số điểm không sai thêm, chỉ mất đường tự sửa.

Cách sửa đề xuất: Thêm quét đủ định kỳ để tự lành, ví dụ bỏ floor khi lastSuccessAt cũ hơn 7 ngày, hoặc vào ngày 1 hằng tháng theo giờ VN (vnDateParts(now).day === 1). Hoặc ghi vào runbook deploy một lệnh chạy tay expirePoints quét đủ sau deploy.

## api-hotro-4 (review lượt 1, gói api-tin)

File: apps/api/src/modules/orders/customer-refunds.service.ts:304

Vấn đề: E-3: nhiều lời gọi notifySafe không truyền context nên log error chỉ có mã mẫu và userId, không có mã đơn. Khách có nhiều khoản hoàn thì CSKH không biết tin nào bị mất để gửi lại. Các chỗ: customer-refunds.service.ts:304, 411, 542; refund-queue.ts:229, 473, 550; order-returns.service.ts:253, 372, 496, 634; orders.service.ts:494; subscriptions.service.ts:708, 891, 898, 905.

Cách sửa đề xuất: Truyền đối số thứ 5 như order-status đang làm: notifySafe(uid, code, data, undefined, `order=${orderCode}`) (với gói định kỳ dùng `sub=${sub.id}`).

## api-hotro-5 (review lượt 1, gói api-tin)

File: apps/api/src/modules/orders/orders.service.ts:97

Vấn đề: E-31: MISSING_MEDIA đặt productPublic=false khi không tìm thấy variation. Mà variation có thể bị xoá cứng (merchant-pancake-link.ts:222 xoá biến thể tạm của SP đối tác khi gắn mã Pancake). Khi đó đơn cũ của một SP vẫn đang bán mất nút 'Viết đánh giá' và liên kết sản phẩm.

Cách sửa đề xuất: Khi không có variation, đừng khẳng định đã gỡ: bỏ trường productPublic khỏi MISSING_MEDIA (app-core coi undefined là còn). Hoặc tra product theo it.productSlug trong một truy vấn gộp rồi gọi isPublicProduct.

## api-hotro-6 (review lượt 1, gói api-tin)

File: apps/api/src/modules/ops/ledger-drift.cron.ts:16

Vấn đề: Comment kể lịch sử thay đổi ('Trước đây hai bộ đối soát chỉ chạy tay...'), trái luật brief. Tên describe trong spec cũng nhắc mã mục: order-returns.service.spec.ts:347 (E-45), order-status.service.spec.ts:367 (E-85), miniapp order-detail.spec.tsx:198 (E-31) và :220 (E-34), web page.spec.tsx:496 (E-34).

Cách sửa đề xuất: Xoá câu 'Trước đây...' (giữ phần giải thích vì sao chỉ đọc). Bỏ hậu tố '(E-xx)' khỏi tên describe.

## api-hotro-7 (review lượt 2, gói api-tin)

File: apps/api/src/modules/notifications/notifications.processor.ts:34

Vấn đề: Khi deliverZns trả 'FAILED' vì bỏ qua job đến muộn (không gọi Zalo), processor vẫn ghi error 'Gửi ZNS THẤT BẠI ... (xem cột error)'. Người trực đọc sẽ hiểu nhầm là Zalo vừa từ chối thêm một lần. Lỗi này cũng làm tăng số lỗi trên log.

Cách sửa đề xuất: Khi sửa mục P2, cho deliverZns trả một kết cục riêng (ví dụ 'SKIPPED'), hoặc processor kiểm trường hợp bỏ qua rồi ghi log debug/warn 'job đến muộn sau khi khoá đã nhả, bỏ qua' thay cho log error.

## api-hotro-8 (review lượt 2, gói api-tin)

File: apps/api/src/modules/loyalty/loyalty-expiry.service.ts:433

Vấn đề: Docstring của expiryScanFloor kể lại hành vi cũ ('lượt trước chỉ ghi warn nên vẫn tính thành công'), trái luật không viết comment kể chuyện thay đổi. Spec cũng có câu tương tự ở apps/api/src/modules/loyalty/loyalty-expiry.service.spec.ts:1193 ('ở mức warn (bản trước)').

Cách sửa đề xuất: Chỉ giữ lý do: 'Quét đủ định kỳ là đường tự lành cho khách lỗi kéo dài mà lô hết hạn đã nằm trước mốc (mốc nhích qua trong lúc lỗi).' Bỏ cụm '(bản trước)' và mệnh đề về warn ở spec dòng 1193.

## api-hotro-9 (review lượt 2, gói api-tin)

File: apps/api/src/modules/vouchers/vouchers.service.ts:197

Vấn đề: Docstring của welcomeVouchers vẫn ghi grant() nuốt lỗi notify bằng `.catch(() => undefined)`, nhưng dòng 107-115 đã đổi sang notifySafe (log error và báo Sentry). Comment sai với mã.

Cách sửa đề xuất: Đổi thành '(P2002 nuốt, tin gửi qua notifySafe: lỗi được log và báo Sentry, không ném)'.

## api-hotro-10 (review lượt 2, gói api-tin)

File: apps/api/src/modules/ops/ledger-drift.cron.ts:55

Vấn đề: Tin OPS_HEALTH_ALERT gửi cho mọi admin chứa lệnh dev 'Chạy pnpm --filter @tubutree/api reconcile:points' (dòng 60 tương tự cho Ví). Admin vận hành đọc trong app không chạy được lệnh này. Ngoài ra, nếu PROD đang có lệch cũ thì sau deploy mỗi đêm sẽ báo lại, mà runbook chưa ghi bước đối soát trước.

Cách sửa đề xuất: Đổi phần cuối tin cho admin thành câu không kỹ thuật, ví dụ 'Báo đội kỹ thuật đối soát; Ví không tự sửa.'. Giữ tên lệnh trong logger.error. Trước khi deploy, ghi vào runbook bước chạy thử reconcile:points và reconcile:wallet trên PROD (chỉ đọc) để biết mức lệch nền.

## api-hotro-11 (review lượt 1, gói hotro)

File: apps/miniapp/src/pages/ai-advisor.tsx:43 (cùng lỗi ở apps/web/src/app/tu-van/page.tsx:65)

Vấn đề: Hội thoại nay sống qua lần gỡ trang, nhưng trạng thái đang chờ trả lời thì không: `chatM` là useMutation riêng của mỗi lần dựng trang. Khách hỏi, mở sản phẩm khi trợ lý đang soạn, rồi quay lại: câu hỏi hiện ra mà không có dòng 'Trợ lý đang soạn…', `send()` không bị chặn, nên khách gửi được câu thứ hai trong lúc câu đầu còn chờ. Hai câu trả lời đến lệch thứ tự, và lịch sử gửi kèm câu thứ hai thiếu câu trả lời thứ nhất. Nếu câu đầu lỗi và tin xin lỗi đến sau cùng, nút 'Thử lại' sẽ hiện nhưng bấm không có tác dụng, vì `messages[failedIndex-1]` lúc đó là tin của trợ lý. Không phải hồi quy (trước đây quay lại là mất sạch hội thoại), nhưng đây là trạng thái mới do mục E-23 sinh ra.

Cách sửa đề xuất: Đặt `mutationKey: ['ai-advisor-chat']` cho useMutation ở cả hai nền, rồi dùng `const pending = useIsMutating({ mutationKey: ['ai-advisor-chat'] }) > 0` thay cho `chatM.isPending` ở dòng 'đang soạn', ở chỗ chặn send/retry và ở `loading` của nút Gửi. Thêm một ca vào ai-advisor.spec.tsx (Mini) và tu-van/page.spec.tsx (web): gỡ trang lúc đang soạn, dựng lại thì vẫn thấy 'Trợ lý đang soạn…' và không gửi được câu thứ hai.

## api-hotro-12 (review lượt 1, gói hotro)

File: apps/api/src/modules/ops/ops-health.service.ts:71 và :277

Vấn đề: Comment ở dòng 71 nói rằng khi token còn dưới 3 giờ thì cron 'đã lỡ ít nhất hai lượt'. Thực tế khoảng (3h, 13h] chỉ dài 10 giờ nên chứa 1 hoặc 2 lượt cron 6 giờ, tức là chắc chắn chỉ lỡ ít nhất MỘT lượt; có khi vẫn còn một lượt trong khoảng (0, 3h]. Lời cảnh báo ở dòng 277 bảo người vận hành 'xem log "Zalo OA refresh"', nhưng trường hợp nặng nhất (Zalo đã cấp token mới mà ghi DB lỗi, zalo-oa-token.service.ts:84) lại log câu 'Zalo OA đã cấp token mới nhưng ghi DB lỗi…', không chứa chuỗi đó, nên tìm theo gợi ý sẽ không thấy.

Cách sửa đề xuất: Sửa comment dòng 71 thành '...đã lỡ ít nhất một lượt'. Ở dòng 277 đổi gợi ý thành 'xem log ZaloOaTokenService', hoặc thêm tiền tố 'Zalo OA refresh:' vào câu log lỗi ghi DB ở zalo-oa-token.service.ts:84 cho khớp.

## api-hotro-13 (review lượt 1, gói dondep)

File: apps/miniapp/src/components/home/home-block-error.tsx:22,29

Vấn đề: E-78 đã xoá HomeSection của Mini App, nhưng JSDoc của prop `seeAllRow` (dòng 22) và của HomeBlockError (dòng 29) vẫn lấy HomeSection làm mốc chiều cao hàng tiêu đề. Người đọc sẽ đi tìm một component không còn tồn tại.

Cách sửa đề xuất: Viết lại hai comment, mô tả trực tiếp quy ước: khối có nút "Xem tất cả" 44px thì hàng tiêu đề cao 44px; không có thì giống khung chờ (không min-height, cách 8px). Bỏ tên HomeSection. File này không có trong danh sách được sửa của gói, nên ghi vào báo cáo cho gói canhan/giaodien hoặc sửa khi gộp.

## api-hotro-14 (review lượt 1, gói dondep)

File: apps/e2e/tests/support/mock-api.ts:332-336

Vấn đề: Từ nay page.goto của mọi project Web chờ hydrate xong mới trả về. Ca nào chỉ goto rồi kết thúc sớm sẽ lộ các lời gọi API chưa mock, như đã xảy ra ở loyalty.web.spec.ts:358. Các gói đang chạy song song viết spec web mới dựa trên helper cũ, nên khi gộp sau gói này có thể đỏ theo đúng kiểu đó. Lỗi không nằm ở mã của gói, nhưng worker chưa chạy lại toàn bộ web sau commit cuối.

Cách sửa đề xuất: Gộp xong các gói vào nhánh tích hợp thì chạy web-gate cả bộ một lần. Ca nào đỏ vì "chưa mock" thì thêm allowUnmocked hoặc mock cho ca đó, đừng nới helper.
