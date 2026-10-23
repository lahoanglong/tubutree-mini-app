# D14-miniapp-logic — Logic phía Mini App

## Tóm tắt

Không thấy lỗi P0 nào ở logic Mini App. Ba lỗi đáng kể nhất đều nằm trong vùng phiên UAT.

1. D14-01 (P1): Màn "Tích điểm đơn sàn" không có nút chia sẻ số điện thoại. Đây là cửa vào chính cho khách mua trên Shopee/Lazada/TikTok, và họ thường chưa đặt đơn trong app nên chưa có SĐT. Khi máy chủ trả NOT_ELIGIBLE_USER, khách chỉ đọc được câu "cho phép Tubu xem số điện thoại" mà không có cách nào làm điều đó ngay trên màn này.
2. D14-02 (P2): Màn QR chuyển khoản vẫn hiện QR và tài khoản Techcombank sau khi đơn đã bị huỷ hoặc quá hạn. Lý do: react-query giữ dữ liệu cũ khi lần tải lại bị lỗi 400. Bấm "Tôi đã chuyển khoản — Kiểm tra" thì app báo nhầm là lỗi mạng.
3. D14-03 (P2): Rút Ví về ngân hàng đổi Idempotency-Key sau mọi lỗi, kể cả quá thời gian chờ hay 5xx (lúc đó máy chủ có thể đã trừ ví). Khách bấm lại trên cùng sheet là thành lệnh rút thứ hai, mất phí 3.000đ hai lần.

Ba mục P3 nhỏ hơn:
- D14-04: refresh token lỗi mạng thì app đẩy khách về màn "Đăng nhập" thay vì "mất kết nối, thử lại", và không tự thử lại.
- D14-05: đếm ngược giờ vàng chỉ dựa vào đồng hồ điện thoại.
- D14-06: FAQ dự phòng nói "xu cũ" với mọi khách. Mục này cần chủ quyết vì liên quan thuật ngữ.

Phần đã đọc kỹ mà không thấy lỗi:
- Đặt đơn ở checkout: chống bấm hai lần, Idempotency-Key đóng băng lại khi chưa rõ kết quả (unknownAttempt), không đổi theo trường lấy từ báo giá. Nếu khách rời màn rồi quay lại thì key mới, nhưng máy chủ đã xoá giỏ nên lần đặt sau không thành đơn thứ hai.
- Đơn CTV lên hộ: tự gửi lại cùng key và chỉ đường xem Đơn hàng.
- Đổi quà, góp nước Vườn Xanh, đơn đại lý: dùng key đúng.
- Tiền hiển thị: lấy từ báo giá của máy chủ. Số xem trước có ghi chú, và nút đặt khoá tới khi có báo giá. Máy chủ còn chặn bằng expectedTotal / TOTAL_CHANGED.
- Mã lỗi 409/422/429: chuyển thành câu tiếng Việt (getErrorMessage, translateValidationErrors), GET bị 429 được thử lại một lần.
- Khôi phục phiên: có trần chờ, có trạng thái "mất kết nối" và tự khôi phục.
- Link ?claim=, ?ref=, ?s=: tham số được lưu lại, không mất sau khi đăng nhập.
- Quét mã khi camera bị từ chối: có câu mời nhập tay.
- Định dạng tiền/điểm/ngày: đi qua một hàm chung trong utils/format.

Chưa chạy test hay truy vấn DB (máy không có psql). Mọi kết luận đến từ đọc mã, có kèm path:line.

## Phạm vi đã đọc

Đã đọc đầy đủ hoặc phần liên quan, trong apps/miniapp/src:
- services: api.ts, core-http.ts, payment-api.ts, coupon-claim.ts, first-touch.ts, cart-key.ts, query-client.ts, external-points-api.ts; zmp-bridge.ts (login, phone, scan, referral).
- store: auth.ts, storefront-context.ts.
- hooks: use-idempotency-key, use-auth-phase, use-remaining, use-countdown.
- utils: idempotency.ts, format.ts, use-debounced.ts; checkout-rules.ts (một phần).
- components: app.tsx (route, deep link, khôi phục phiên), coupon-claim-gate.tsx, onboarding-rules (phần claim), checkout/address-section, referral-code-box (một phần), order-success (một phần), affiliate/ctv-order-sheet.tsx (phần đặt đơn), affiliate/recent-customers.ts, address-form.tsx (phần điền từ Zalo), ui/auth-gate.tsx, ui/empty-state.tsx (ErrorState), flash-sale.tsx (đếm ngược), game/tree-actions.tsx (key).
- pages: checkout.tsx (toàn bộ), bank-payment.tsx, order-detail.tsx (dòng 60-480), cart.tsx (mutation, debounce, thanh tổng), wallet.tsx (rút tiền), affiliate.tsx (WithdrawForm), rewards.tsx (key), dealer.tsx (key), recycle.tsx (xin SĐT), recycle-new.tsx (gửi yêu cầu), external-points.tsx, orders.tsx (tổng quan), product-detail.tsx (giờ vàng, mua ngay), about-data.ts.

Phía API đối chiếu: checkout.service (idempotency), bank-transfer.service getBankQr, wallet.service withdraw, external-claim.service (userOk), auth.controller/auth.service (đăng nhập Zalo, gộp khách), affiliate.service (đơn CTV), validation-pipe.

Đọc lướt hoặc chưa đọc: loyalty.tsx, game.tsx, feed/community, storefront-builder, brand-*, staff/payroll, admin, notifications.tsx; recycle-* trừ recycle-new và recycle; voucher-sheet.tsx, order-refunds, return-request-sheet; phần còn lại của order-detail (vận chuyển, đổi/trả).

Chưa chạy vitest. Chưa truy vấn DB vì máy không có psql.

## Bảng phát hiện

Tất cả phát hiện có tiền sử "mới" và thuộc vùng phiên UAT.

| ID | Mức (sau soát) | Soát chéo | Nhóm | Vùng | Vị trí | Mô tả + kịch bản | Đề xuất sửa + test |
|---|---|---|---|---|---|---|---|
| D14-01 | P1 | CONFIRMED | agent sửa ngay | uat | apps/miniapp/src/pages/external-points.tsx:177-191; apps/miniapp/src/pages/external-points.tsx:204-212; apps/miniapp/src/i18n/vi.ts:575; apps/api/src/modules/external-points/external-claim.service.ts:336; apps/miniapp/src/store/auth.ts:176-181 | Tích điểm đơn sàn: khách chưa có SĐT bị từ chối mà không có nút chia sẻ số điện thoại. Khách mua trên Shopee mở Mini App, đăng nhập ngầm không xin SĐT nên user.phone = null. Nhập mã vận đơn SPXVN... thì máy chủ trả 403 NOT_ELIGIBLE_USER. Màn chỉ hiện câu đỏ, không có nút. Chi tiết ở mục D14-01 bên dưới. | Trong ClaimForm, khi NOT_ELIGIBLE_USER thì hiện nút "Chia sẻ số điện thoại" gọi ensurePhone(); có SĐT thì tự gửi lại mã đã nhập. Tốt hơn: biết user.phone null thì hiện thẻ xin SĐT trước form, như recycle.tsx. Test: external-points.spec.tsx, submit bị từ chối NOT_ELIGIBLE_USER thì có nút; bấm nút gọi ensurePhone một lần; ensurePhone trả SĐT thì submitExternalClaim gọi lại với cùng mã. |
| D14-02 | P2 | chưa soát | agent sửa ngay | uat | apps/miniapp/src/pages/bank-payment.tsx:30-36; apps/miniapp/src/pages/bank-payment.tsx:89-94; apps/miniapp/src/pages/bank-payment.tsx:123-143; apps/miniapp/src/pages/bank-payment.tsx:179-249; apps/api/src/modules/integrations/payment/bank-transfer.service.ts:30-32 | Màn QR chuyển khoản vẫn hiện QR/STK sau khi đơn bị huỷ hoặc quá hạn; nút Kiểm tra báo nhầm lỗi mạng. Khách đang ở /bank-payment/TT001 thì đơn bị huỷ (cron hết hạn hoặc CSKH). Lượt poll 4 giây nhận 400 "Đơn đã hủy/trả, không thể thanh toán.". React-query v5 giữ data cũ (UNPAID) nên trang vẫn vẽ QR, số tài khoản, số tiền, dòng "Đang chờ thanh toán…". refetchInterval vẫn 4000. Bấm "Tôi đã chuyển khoản — Kiểm tra" thì snackbar báo "Không thể kết nối tới máy chủ...". Khách có thể chuyển tiền thật vào đơn đã huỷ, phải hoàn tay. Mở link cũ của đơn đã huỷ chỉ thấy "Không tải được thông tin thanh toán." kèm nút Thử lại vô ích. | Khi query lỗi 4xx (status < 500) hoặc remaining.expired: ẩn QR và STK, hiện "Đơn đã huỷ hoặc quá hạn thanh toán" bằng getErrorMessage(error), kèm nút "Xem đơn hàng". Dừng refetchInterval khi lỗi 4xx. Ở handleCheckPayment hiện getErrorMessage(err) thay câu mạng cố định. Test: lần đầu trả UNPAID, lần poll sau reject 400 "Đơn đã hủy/trả" thì không còn ảnh alt="VietQR", có câu đơn đã huỷ và nút "Xem đơn hàng". |
| D14-03 | P2 | chưa soát | agent sửa ngay | uat | apps/miniapp/src/pages/wallet.tsx:68-85; apps/api/src/modules/wallet/wallet.service.ts:79-106; apps/miniapp/src/services/api.ts:181-185 | Rút Ví về ngân hàng: lỗi quá thời gian/5xx vẫn đổi Idempotency-Key, bấm lại thành lệnh rút thứ hai. Ví có 1.000.000đ, khách rút 400.000. Máy chủ đã tạo Payout và trừ ví nhưng axios hết 15 giây (ECONNABORTED). onError tạo key mới, sheet vẫn mở, số dư chưa tải lại. Khách bấm Rút lần nữa với key mới, máy chủ tạo Payout thứ hai và trừ thêm 400.000. Kết quả: hai lệnh rút, mất phí 3.000đ hai lần, khách nhận 800.000. | onError: nếu isOutcomeUnknown(e) thì GIỮ key và tải lại ['wallet'] cùng lịch sử rút. Chỉ đổi key khi lỗi 4xx. Thêm câu "Lệnh rút có thể đã được ghi nhận, kiểm tra lịch sử trước khi rút lại". Test: wallet.spec.tsx, lần withdraw đầu reject ECONNABORTED, lần bấm lại phải gửi đúng Idempotency-Key cũ. |
| D14-04 | P3 | chưa soát | agent sửa ngay | uat | apps/miniapp/src/store/auth.ts:250-263; apps/miniapp/src/hooks/use-auth-phase.ts:33-35; apps/miniapp/src/store/auth.ts:193-196 | Refresh token lỗi mạng (không phải bị từ chối) vẫn hạ phiên về "idle". Access token sống 15 phút. Khách để app nền hơn 15 phút rồi quay lại lúc sóng yếu: request đầu bị 401, /auth/refresh lỗi mạng. Handler đặt status "idle", user null. Trang hiện "Đăng nhập" thay vì "Mất kết nối, thử lại". useSessionRecovery chỉ tự thử lại khi status là "error", nên app đứng ở màn mời đăng nhập. restore() xử lý đúng bằng "error" (auth.ts:196), hai đường lệch nhau. | Trong handler 401: nếu !isRefreshRejected(err) thì đặt status "error" kèm vi.errors.sessionUnavailable, giữ user, để useSessionRecovery gọi restore(). Chỉ hạ về "idle" khi lỗi 401/403. Test: auth.spec.ts, refreshTokens reject lỗi không có response thì status === "error" và refresh token còn trong storage. |
| D14-05 | P3 | chưa soát | agent sửa ngay | uat | apps/miniapp/src/components/flash-sale.tsx:87-96; apps/miniapp/src/hooks/use-countdown.ts:11-16; apps/miniapp/src/pages/product-detail.tsx:170-171 | Đếm ngược giờ vàng tính theo đồng hồ điện thoại, không bù lệch giờ với máy chủ. Điện thoại nhanh 10 phút, suất còn 8 phút: Trang chủ lọc bỏ suất nên mất đồng hồ trong khi thẻ giá vẫn hiện; trang sản phẩm useCountdown trả "". Điện thoại chậm thì đếm "còn 0h 05m" khi máy chủ đã hết giờ. Tới thanh toán gặp sheet PRICE_CHANGED (máy chủ vẫn chặn đúng, không mất tiền). | Tính độ lệch một lần từ header Date của response axios (hoặc thêm serverNow vào /flash-sales/active), dùng now = Date.now() + offset cho useCountdown, useRemaining và bộ lọc suất. Test: useCountdown với offset +10 phút vẫn hiện đúng thời gian còn lại. |
| D14-06 | P3 | chưa soát | cần chủ quyết | uat | apps/miniapp/src/pages/about-data.ts:49-52; apps/miniapp/src/i18n/vi.ts:448 | FAQ dự phòng nói "xu cũ" với mọi khách. Admin chưa nhập FAQ hoặc /faqs lỗi thì trang Về Tubu Tree dùng fallbackFaq, luôn kèm "Điểm quy đổi từ xu cũ thì không hết hạn và trừ được tới 100%...". Khách mới đọc thấy chữ "xu", trái quyết định thuật ngữ "Điểm Xanh (không dùng xu)", và có thể hiểu lầm có loại điểm trừ được 100% đơn. | Chủ chọn một: bỏ câu này khỏi FAQ dự phòng, hoặc chỉ hiện khi pointsConvertedBalance > 0 và đổi chữ thành "Điểm Xanh không hết hạn". Test: about-data.spec kiểm fallbackFaq() không chứa "xu". |

## Chi tiết P0/P1

### D14-01 (P1, CONFIRMED) — Tích điểm đơn sàn: khách chưa có SĐT bị từ chối, không có nút chia sẻ SĐT

Kịch bản: Khách mua trên Shopee, quét thẻ trong hộp hàng rồi mở Mini App. App đăng nhập ngầm bằng Zalo mà không xin SĐT (auth.ts:178 gửi phoneToken=undefined), nên user.phone = null. Khách vào Cá nhân > Tích điểm đơn sàn và nhập mã vận đơn SPXVN... Máy chủ trả 403 NOT_ELIGIBLE_USER vì userOk cần !!user.phone. Màn hình chỉ hiện câu đỏ "Bạn cần đăng nhập Zalo và cho phép Tubu xem số điện thoại...", không có nút nào. Khách đã đăng nhập Zalo rồi nên không biết làm gì tiếp. Đường duy nhất để chia sẻ SĐT là đặt một đơn trong app, vào Đổi rác, hoặc thêm địa chỉ đầu tiên. Luồng chính để đưa khách sàn sang app (luật đã chốt: đơn sàn 1%, quét hoặc nhập mã vận đơn) bị chặn với đúng nhóm khách cần nhất.

Bằng chứng:
- external-points.tsx:187-190: `onError: (e) => { setResult(null); const rejected = externalClaimRejectCode(e); setError(rejected ? t.reject[rejected] : getErrorMessage(e)); }`. Trang không gọi ensurePhone và không có nút nào.
- Grep cho thấy ensurePhone chỉ được gọi ở checkout.tsx:1068, coupon-claim-gate.tsx:128, recycle.tsx:130,138 và zalo-profile.ts:38.
- recycle.tsx:136-155 có loginCard "Chia sẻ số điện thoại" cho đúng tình huống này.
- Máy chủ: external-claim.service.ts:336 `userOk: !!user && isRealUser(user) && !!user.phone && !user.isBlocked`.
- Spec external-points.spec.tsx chỉ thử ALREADY_CLAIMED, không có ca NOT_ELIGIBLE_USER.

Lý do soát chéo (CONFIRMED, mức P1 giữ nguyên):
1. Đăng nhập ngầm không xin SĐT. auth.ts:186-187 gọi loginZaloMiniApp(code, accessToken, undefined, ...). Phía máy chủ, auth.service.ts:141 chỉ lấy SĐT khi có phoneToken, nên khách Zalo mới mua trên sàn có phone = null. upgradeGuestSilently (auth.ts:102) cũng không gửi phoneToken.
2. Không lớp nào khác thu SĐT trước trang này. useAuthPhase chỉ trả loading/guest/unavailable/authenticated, không có phase SĐT. ExternalPointsPage (external-points.tsx:256-268) vẽ ClaimForm ngay khi phase === 'authenticated'. Cổng mã trong hộp (coupon-claim-gate.tsx:108-112) chỉ gọi ensurePhone với khách guest; khách Zalo không có SĐT đi thẳng vào claim. Ở miniapp, requestZaloPhoneToken chỉ được gọi trong ensurePhone (auth.ts:211). ensurePhone chỉ được gọi từ checkout.tsx:1068, coupon-claim-gate.tsx:128 (chỉ guest), recycle.tsx:130/138 và zalo-profile.ts:38. external-points.tsx không gọi cái nào, profile.tsx cũng không có lời nhắc SĐT.
3. Máy chủ từ chối người dùng này. external-claim.service.ts:336 có userOk = ... && !!user.phone. external-claim.rules.ts:68 từ chối NOT_ELIGIBLE_USER và service ánh xạ thành 403 (dòng 35). Client (external-points.tsx:187-190) chỉ đặt chữ đỏ từ vi.ts:576, không có nút.
4. Chưa được sửa ở commit sau. Git log của trang dừng ở a4a7e908. Mục này không có trong danh mục phát hiện, các file launch-review, hay các báo cáo UAT khác (D13, D2). Luật đã duyệt (Q2: quét đơn sàn cần SĐT đã xác minh và chỉ trên Mini App) yêu cầu có SĐT nhưng không nói app được phép để khách không có cách cung cấp. Đây là lỗ hổng UX thật, không phải quyết định luật.
5. Không phải P0: điểm không mất vĩnh viễn. NOT_ELIGIBLE_USER nằm trong danh sách UNRECORDED (service.ts:31) nên lần thử thất bại không tính vào LOCKED hay DAILY_ATTEMPTS. Khách quay lại sau khi chia sẻ SĐT qua checkout hoặc Đổi rác, miễn là đơn còn trong hạn TOO_OLD. Luồng vẫn bị chặn với đúng nhóm mục tiêu (khách sàn mới với app), nên giữ P1.

## Bỏ sót do soát chéo phát hiện

- apps/miniapp/src/components/coupon-claim-gate.tsx:108-112: đây là chi tiết bối cảnh cho D14-01, không phải lỗi riêng. Thẻ QR trong hộp là cửa vào của khách sàn, nhưng chỉ xin SĐT (ensurePhone) khi người dùng là guest. Khách Zalo chưa có SĐT nhận mã giảm giá mà không bị hỏi. Vậy giả định của người soát rằng thẻ trong hộp đã thu SĐT là không đúng: sau thẻ trong hộp, khách vẫn chưa có SĐT và bị từ chối NOT_ELIGIBLE_USER ở /points/scan. Khi sửa D14-01, hãy xin SĐT ngay tại /points/scan như recycle.tsx:136-155. Đừng dựa vào cổng của thẻ trong hộp.

## Đã bác bỏ

Không có phát hiện nào bị REFUTED.
