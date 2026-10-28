# muahang đợt C

mergeable=False

## Review 1

KẾT LUẬN: chưa merge
- [P2] /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-muahang/ — Việc bắt buộc (1) chưa làm: thư mục ảnh không tồn tại. Chưa có ảnh trước/sau mini375+web375 cho product-slug (kèm bảng chọn phân loại đang mở), cart, checkout, bank-payment-code, group-buy, order-success, nên chưa so được Mini và web, cũng chưa xem thanh dính đáy mới ở bank-payment. — Bật lane 6, chụp, ghép bằng before-after.mjs, xem từng ảnh.
- [P2] reviews/muahang-b.md "Web gate chưa chạy cả bộ" — Việc bắt buộc (2) thiếu: mới chạy 3 spec. — Chạy web gate cả bộ và ghi số pass/fail.
- [P2] apps/web/src/components/add-to-cart.tsx:17 — Việc bắt buộc (3) thiếu. Đối chiếu 03-perf-build.md:55 thì `/san-pham/[slug]` lên từ 174 KB thành 188 KB (+14 KB), vì VariationSheet import tĩnh qua barrel `@/components/mini` (variation-sheet.tsx:8) dù bảng chỉ dùng ở khổ <768px. `/thanh-toan` 191→192, `/mua-chung` 156→157, `/gio-hang` 163→163. Worker báo "không tìm thấy số trước" trong khi số có sẵn trong 03-perf-build.md. — Dùng `next/dynamic` cho VariationSheet, import thẳng từng file thay vì barrel, đo lại và ghi bảng trước/sau.
- [P2] apps/miniapp/src/services/zmp-bridge.ts:160 — Việc bắt buộc (4) thiếu: entry Mini vẫn 712 KB, mốc là ≤ 711. — Đưa saveImageFromUrl/saveImageToGallery sang chunk lazy (import động trong hàm, hoặc tách bank-payment), build lại và ghi số.
- [P2] apps/web/src/lib/platform-bridge.ts:34 — Việc bắt buộc (5) thiếu: platform-bridge.spec.ts không có ca nào cho `saveImage` (grep ra 0). — Thêm test: bridge.saveImage gọi download-image, trả 'saved' hoặc 'failed'.
- [P2] apps/miniapp/src/components/reorder/purchased-rail.tsx:231 — R-30 sót lối vào. Kệ Mua lại vẫn có nút "Định kỳ -X%" mở SubscribeSheet. Kệ này hiện ở tab Đơn hàng (orders.tsx:139, thuộc muahang) và trang chủ. Khách vẫn đăng ký định kỳ được trong Mini dù cờ SUBSCRIPTIONS_IN_MINIAPP=false. new-customer-gift.tsx:45 vẫn quảng cáo ưu đãi định kỳ. — Bọc cả hai bằng SUBSCRIPTIONS_IN_MINIAPP; ít nhất phần orders, phần trang chủ thì báo khampha. Thêm test.
- [P2] apps/miniapp/src/pages/product-detail.tsx:315 và components/variation-sheet.tsx:86 — Có thể bấm hai lần (chưa kiểm trên máy). zmp Sheet giữ nội dung thêm khoảng 200ms khi đóng (bottom-sheet.tsx dùng unmountOnClose). onConfirm trả void nên khoá inFlight của Button không chặn. confirmVariation cũng không kiểm `isPending` như handleAdd cũ. Bấm "Mua ngay" hai lần nhanh thì lần 2 chạy với sheetMode=null và rơi vào addMutation. Kết quả: giỏ cộng gấp đôi số lượng, checkout tính dòng đã gộp. Khách vãng lai còn có thể gọi login() hai lần. — Đầu confirmVariation thêm `if (!sheetMode || addMutation.isPending || buyNowMutation.isPending) return`, truyền busy thật, trả Promise từ onConfirm.
- [P2] packages/app-core/src/points-offer.ts:17 — Chưa có báo giá (khách chưa có địa chỉ, hoặc báo giá lỗi vì web đặt quote=undefined khi isError) thì cap = toàn bộ số dư. Ví dụ: 50.000 điểm, đơn 100.000đ, trần max_redeem_pct 20%, chữ vẫn ghi "Dùng 50.000 điểm, giảm 50.000đ" trong khi thực giảm tối đa 20.000đ. Đây là chữ sai về tiền. Spec points-offer.spec.ts:6 khoá đúng hành vi sai này. — Chưa có `pointsMax` thì ghi "Bạn có X điểm", không hứa số tiền giảm.
- [P2] R-7 (apps/web/src/app/thanh-toan/page.tsx:421) — Backlog đặt đích CLS < 0,05, LCP < 2,0 s và yêu cầu đo bằng run-all.mjs. Worker ghi "CLS/LCP CHƯA đo". — Đo trên lane, ghi số trước/sau.
- [P2] R-24 — Mục của gói chưa làm (chưa tái hiện Hydration failed vì không bật `next start`). — Làm cùng lane ở việc (1): tái hiện với khách vãng lai, sửa đến khi 0 pageErrors ở product-slug web375.
- [P3] packages/app-core/src/points-offer.ts:4 — Tỉ giá cứng `VND_PER_POINT = 1`, trong khi API đọc `loyalty.vnd_per_point_redeem` (pricing.service.ts:116) và rates.vndPerPointRedeem đã có ở client. Chính test cũng lệch: checkout.spec ghi "giảm 1.250đ" trước khi tick rồi "giảm 12.500đ" sau khi tick. E2E checkout.miniapp.spec.ts:88 ghi "giảm 100đ" rồi :106 ghi "76 điểm giảm 76.000đ". — Truyền tỉ giá từ config vào hàm; sửa mock cho nhất quán.
- [P3] apps/web/src/components/add-to-cart.tsx:213 — confirmVariation gọi setSelectedId rồi setQty(quantity), nhưng effect ở :101 đặt qty về 1 khi đổi phân loại. Sau khi thêm 3 món từ bảng, trang và thanh dính hiện số lượng 1 với giá ×1. — Bỏ qua lần reset khi đổi phân loại từ bảng (cờ ref), hoặc đặt qty sau effect.
- [P3] apps/web/src/app/thanh-toan/bank-transfer-panel.tsx:182 — BANK_QR_HINT ("Lưu mã QR rồi mở app ngân hàng, chọn quét từ ảnh") hiện cả ở 1280px, nơi khách quét bằng điện thoại. Trên iOS Safari, blob download vào Files chứ không vào Ảnh, mà vẫn báo "Đã lưu ảnh QR vào máy". — Chỉ hiện câu này ở khổ điện thoại; ghi rõ hành vi trên iOS.
- [P3] apps/miniapp/src/i18n/vi.ts:146, apps/web/src/lib/points-earn.ts:34 — Chú thích còn nói "Tối đa" dù chữ đã đổi thành "Nhận ~X". R-97 bỏ hẳn chi tiết hạng/đơn sàn, không có popup như backlog ghi. — Sửa chú thích; popup thì làm, hoặc ghi rõ là hoãn.
- [P3] apps/api/prisma/migrations/20261028110000_welcome30_new_customer_only — Cùng tiền tố thời gian với review/1028-ctv (20261028110000_affiliate_auto_wallet_transfer) và review/1028-diemxanh (20261028110000_tier_drop_notice). Gộp và deploy lệch thứ tự thì thứ tự áp migration không theo tên. — Đổi sang dấu thời gian riêng (ví dụ 20261028120000).
- [P3] Nút "Lưu mã QR" ở Mini dùng saveImageToGallery với URL VietQR bên ngoài, chưa thử trên Zalo thật (whitelist tên miền, SDK ≥2.16). — Thử trên Zalo thật trước khi deploy.

Đã kiểm, không thấy lỗi:
- R-31: UPDATE chỉ theo code và idempotent; FREESHIP, giá trị, ngưỡng không đổi. API lọc ví (loyalty.service.ts:808), validate (coupons.service.ts:223) và redeem trong tx (coupons.service.ts:279) đều chặn khách đã có đơn chưa huỷ.
- Khoá group-buy vẫn bị invalidate theo tiền tố ['group-buy'].

## Sửa trước review 2 (head review/1028-muahang: đã sửa hết P2 reviewer nêu (trừ R-7 CLS/LCP chưa đo, ghi rõ bên dưới); 9 commit mới trên b7fdabcc5, chưa push. Còn một chỗ chưa xong ngoài gói: new-customer-gift.tsx của trang chủ vẫn quảng cáo "định kỳ".)

Nhánh review/1028-muahang, tip d0a74278c, không push. Commit mới sau b7fdabcc5:
4da70a9d3 điểm không hứa tiền khi chưa có trần; 509d3ed50 Mini khoá bấm đúp; 6c0cf3d62 web giữ số lượng + khoá bấm đúp; 49658972d bảng web nạp lười; 1291559cd Mini lazy saveImage + test; 30886d8d1 kệ Mua lại ẩn Định kỳ; aebafb347 migration đổi mốc + chú thích + gợi ý QR; bdda65eef hydration; 643db0019 e2e home-h; d0a74278c bridge web lazy.

Từng phát hiện:
- Ảnh (1): ĐÃ LÀM. Lane 6 (cổng 3261-3268 theo LANES.md), ảnh ở review-1028/docs/2026-10-28-review/screens-muahang/: 5 ảnh 4 cột (product-slug, cart, checkout, bank-payment-code, group-buy) + sau-{mini375,web375}-{product-slug, bảng-chọn-phân-loại, checkout-gon, order-success}. Đã xem từng ảnh, Mini/web 375 khớp. Lệch nhỏ còn: bank-payment web để Ngân hàng cạnh nhau, Mini xếp dọc.
- Web gate cả bộ (2): 354 pass, 38 skipped, 0 fail (4,2 phút, cổng 3771-3775).
- First Load web (3): ĐÃ LÀM, lazy VariationSheet + import thẳng file. Trước/sau (KB): /san-pham/[slug] 174/176, /thanh-toan 191/194, /gio-hang 163/164, /mua-chung 156/158, "/" 204/206. KHÔNG đạt mốc +2KB ở /thanh-toan (+3). "/" không sửa gì cũng +2 nên có thể là nền, chưa tách ra được.
- Mini entry (4): 711 KB raw / 222 gz = baseline (từ 712). Tổng JS 1630 KB, tổng bản build 1917 KB.
- Test saveImage (5): thêm cho Mini và web, pass.
- R-30: kệ Mua lại ẩn Định kỳ theo SUBSCRIPTIONS_IN_MINIAPP (test mới + sửa e2e home-h). Hiệu ứng ở trang chủ vì dùng chung component. new-customer-gift.tsx:45 (trang chủ) CHƯA sửa, báo khampha. Web vẫn có "Đặt định kỳ" ở order-success (cờ chỉ dành Mini).
- Bấm đúp: Mini + web có khoá, busy thật. Test Mini thấy đỏ rồi xanh. Test web bấm đúp xanh cả trước lẫn sau sửa (không chứng minh được lỗi); test giữ số lượng 3 thấy đỏ rồi xanh.
- points-offer: chưa có pointsMax thì ghi "Bạn có X điểm". Test mới; sửa mock Mini/web/e2e (thêm pointsMax). Test đỏ chưa kiểm trước sửa.
- R-24: nguyên nhân khối Đánh giá vẽ nút đăng nhập trước khi hydrate xong. Thêm useHydrated + test; guest product-slug web375 0 pageErrors (trước 1). Chưa kiểm bằng next start, mới next dev.
- P3: sửa chú thích "Tối đa"→"~"; gợi ý QR chỉ khổ điện thoại (md:hidden); migration WELCOME30 đổi sang 20261028140000 (các gói khác dùng 120000/130000), đã migrate deploy lane 6: WELCOME30 true, FREESHIP false.
- Không làm: VND_PER_POINT từ config (đơn vị tỉ giá điểm chưa rõ, chữ đã bỏ lời hứa khi thiếu trần); câu iOS (BANK_QR_SAVED dùng chung Mini, không phát hiện iOS chắc chắn); popup chi tiết hạng/đơn sàn R-97: hoãn; thử Zalo thật (R-8): chưa kiểm.
- R-7 CLS/LCP: CHƯA đo (run-all bị cấm, dev server không đại diện).

Số kiểm thật: tsc web/miniapp/app-core/e2e sạch; eslint file đổi sạch; vitest app-core 931/931, miniapp (TZ=UTC) 315 file 4872/4872, web 442 file 7447/7447 (chạy trước 2 commit cuối, chạy lại riêng platform-bridge, thanh-toan, add-to-cart, san-pham: pass); Playwright Mini 202 pass, 10 skipped, 2 fail rồi sửa home-h còn 12/12; lint:parity xanh 0 pending. Jest API/race không chạy (API không đổi mã, chỉ đổi tên thư mục migration; không đổi luật tiền/điểm).
Đã lane-down lane 6, khôi phục routes.json/params-l6.json, cây git sạch.

## Review 2

KẾT LUẬN: chưa merge

- [P2] apps/web/src/app/thanh-toan/bank-transfer-panel.tsx:197-285 so với apps/miniapp/src/pages/bank-payment.tsx:265-343 — Ở khổ 375, màn chuyển khoản của web và Mini App khác nhau. Lượt này Mini đã đổi bố cục; ảnh `screens-muahang/bank-payment-code__returning__ok__s1.png` cho thấy rõ. Mini có số tiền to kèm nút chép, nút "Lưu mã QR" rộng hết màn, "Ngân hàng" và "Chủ tài khoản" xếp dọc, bỏ dòng "Số tiền", và nút "Tôi đã chuyển khoản — Kiểm tra" dính ở đáy (StickyActionBar). Web vẫn hiện số tiền không có nút chép, nút Lưu nhỏ có viền, các dòng nằm ngang (:221, :229), dòng "Số tiền" vẫn còn (:231) và nút Kiểm tra nằm trong dòng chảy của trang (:280). Worker chỉ ghi nhận chỗ "Ngân hàng cạnh nhau". Chủ đã dặn web khổ điện thoại phải giống Mini App. — Cách sửa: đưa bố cục web ở max-md về giống Mini (số tiền to kèm nút chép, bỏ dòng Số tiền, xếp dọc hai dòng tên, nút Lưu rộng hết màn, CTA dính đáy), rồi chụp lại.
- [P2] R-7 (apps/web/src/app/thanh-toan/page.tsx) — Đích CLS < 0,05 và LCP < 2,0 s của một màn trả tiền P1 vẫn chưa có số đo. Backlog dòng 218 yêu cầu `run-all.mjs --only web --build-web --label muahang`. Thư mục `screens-muahang/perf/after-muahang.json` không tồn tại. Worker không chạy vì được lệnh không chạy, nên phần này là việc bên giao phải đo trước khi merge. — Cách sửa: chạy run-all trên lane 6 và ghi số trước/sau.
- [P3] apps/miniapp/src/pages/bank-payment.tsx:255 — Đáy trang chỉ chừa `paddingBottom: 90`, trong khi thanh dính mới cao 80px cộng `--safe-bottom` (sticky-action-bar.tsx). Trên iPhone có tai thỏ (safe-bottom 34px) thanh cao khoảng 114px. Phần chừa là 90 + 16 (lề của Box) = 106px, nên nút "Để sau / Xem đơn hàng" bị che khoảng 8px khi cuộn tới cuối. — Cách sửa: dùng `calc(96px + var(--safe-bottom))` như checkout.tsx:490.
- [P3] apps/miniapp/src/pages/bank-payment.tsx:332-336 — Chú thích "loading+disabled… Button tự chặn bấm-2-lần khi loading" giờ đứng trên nút "Để sau", không còn đúng chỗ, vì nút Kiểm tra đã chuyển xuống StickyActionBar ở :343. — Cách sửa: chuyển chú thích theo nút Kiểm tra.
- [P3] packages/app-core/src/points-offer.ts:17 — Câu "Bạn có X điểm" lấy số `usable` (số điểm dùng được), không phải số dư. Khách có 5.000 điểm, trong đó 3.800 điểm bị khoá, sẽ đọc "Bạn có 1.200 điểm". Câu này sai sự thật và lệch với nhãn "Dùng được X/Y" ở checkout-rules.ts:128. — Cách sửa: ghi "Dùng được X điểm".
- [P3] packages/app-core/src/points-offer.ts:4 — `VND_PER_POINT = 1` vẫn cố định trong mã, còn API đọc `loyalty.vnd_per_point_redeem` (loyalty.service.ts:669). Hiện mặc định là 1 nên chữ đang đúng. Nếu cấu hình đổi khác 1 thì chữ "giảm Yđ" sẽ sai. — Cách sửa: truyền tỉ giá lấy từ config vào hàm.
- [P3] apps/web/src/components/add-to-cart.spec.tsx:609 — Test "bấm đúp chỉ thêm giỏ một lần" là test giả: worker tự báo test này xanh cả trước lẫn sau khi sửa. Trong jsdom, bảng đóng ngay nên lần bấm thứ hai rơi vào nút đã bị gỡ. Khoá ở add-to-cart.tsx:525 vì vậy chưa có test bảo vệ. — Cách sửa: giữ bảng còn mở khi đóng (ví dụ mock BottomSheet không gỡ nội dung), hoặc gọi thẳng onConfirm hai lần.
- [P3] apps/web/src/app/thanh-toan/bank-transfer-panel.tsx:12,115 — Màn web gọi thẳng `saveImage` của download-image, không đi qua PlatformBridge. Vì vậy: (1) test mới ở platform-bridge.spec.ts không phủ đường mà màn thật dùng; (2) nạp lười ở platform-bridge.ts:34 không giảm gì cho /thanh-toan; (3) nút Lưu không có khoá, bấm đúp sẽ tải hai lần. — Cách sửa: màn dùng bridge, thêm cờ busy.
- [P3] First Load web /thanh-toan 191→194 KB (+3) vượt mốc +2 KB của brief (gd3-worker-brief.md:44). Worker cho rằng phần tăng đến từ nền vì "/" cũng +2, nhưng chưa build lại base 1384ff380 bằng cùng bộ công cụ để chứng minh. — Cách sửa: build base và nhánh trên cùng máy, ghi số chênh thật của riêng trang.
- [P3] screens-muahang/ — Việc (1) còn thiếu ảnh trước/sau ghép 4 cột cho order-success (mới có `sau-*`). — Cách sửa: chụp ảnh trước ở base và ghép bằng before-after.mjs.
- [P3] apps/web/src/components/add-to-cart.tsx:482,544 — Bảng chọn phân loại nạp lười, chỉ bắt đầu tải ở lần bấm đầu. Trên mạng chậm, khách bấm xong không thấy phản hồi gì cho tới khi tải xong; tải lỗi thì im lặng, không báo. — Cách sửa: tải trước khi chạm/hover vào nút (preload), hoặc cho nút báo đang xử lý trong lúc tải.
- [P3] apps/miniapp/src/services/zmp-save-image.ts:333-336 — `setTimeout` 30 giây trong Promise.race không được xoá khi lưu ảnh xong, để lại hẹn giờ thừa. — Cách sửa: gọi clearTimeout trong finally.
- [P3] R-24 mới kiểm bằng `next dev`, chưa kiểm bằng `next start`. R-8 phần Mini chưa thử trên Zalo thật (whitelist tên miền img.vietqr.io, SDK ≥ 2.16). new-customer-gift.tsx:45 vẫn quảng cáo ưu đãi định kỳ (đã chuyển cho khampha).

Đã kiểm, phần lượt trước đã sửa đúng:
- Mini khoá bấm đúp ở product-detail.tsx:318, busy thật, onConfirm trả Promise.
- Web giữ số lượng sau khi xác nhận bảng (keepQtyOnce) và có khoá bấm đúp.
- points-offer không còn hứa số tiền giảm khi chưa có pointsMax.
- R-30 đã ẩn nút Định kỳ ở kệ Mua lại khi cờ tắt, có test.
- Migration đổi sang 20261028140000, không trùng nhánh nào khác: ctv dùng 130000, diemxanh dùng 120000. Nội dung vẫn là UPDATE theo code, idempotent.
- Chú thích "~" và câu gợi ý QR có `md:hidden` đã đúng.
- Test saveImage có ở cả Mini lẫn web.
- Ảnh bảng chọn phân loại, product-slug, cart, checkout, group-buy: Mini và web 375 khớp nhau.
- Chạy lại vitest (Node 22): web add-to-cart, platform-bridge, use-hydrated 80/80; Mini product-detail-default-variation, platform-bridge, purchased-rail 51/51; app-core points-offer 4/4.

## Sửa trước review 3 (head 09ee76909)

Nhánh review/1028-muahang, worktree r1028-muahang, chưa push. Lượt này có 7 commit mới trên d0a74278c:
e613958f4 chuyển khoản web 375 giống Mini, Lưu QR qua cầu nối + chặn bấm đúp; 40b9ad127 Mini chừa đáy + chuyển chú thích + xoá hẹn giờ; 30d178a9b "Dùng được X điểm" + tỉ giá từ config; db6b7266d test khoá bấm đúp thật + tải trước bảng; 4bc511aec kiểu PublicConfig web; 9d9fb919c bỏ khung QR/icon Lưu/đậm số tiền; 09ee76909 khôi phục routes.json và params-l6.json (file sinh theo lane đã lỡ commit).

PHÁT HIỆN CỦA REVIEWER
- [P2] Bố cục chuyển khoản web khác Mini: ĐÃ SỬA (e613958f4, 9d9fb919c). Số tiền to kèm nút chép, bỏ dòng Số tiền ở max-md, Ngân hàng/Chủ TK xếp dọc, Lưu mã QR rộng hết thẻ, nút Kiểm tra dính đáy (StickyActionBar chỉ ở trang /chuyen-khoan). Ảnh sau web 375 khớp Mini. Còn lệch nhỏ: icon cảnh báo của khối "Giữ nguyên nội dung" nằm trên dòng riêng ở Mini, cùng dòng ở web; hàng Mini thấp hơn web vài px. Không làm.
- [P2] Đo CLS/LCP: KHÔNG LÀM (prompt cấm chạy run-all.mjs). Việc bên giao: chạy run-all --only web --build-web --label muahang. Có đo First Load bằng bundle-report (xem dưới).
- [P3] Mini paddingBottom 90: ĐÃ SỬA (40b9ad127), dùng calc(96px + var(--safe-bottom)).
- [P3] Chú thích sai chỗ ở nút "Để sau": ĐÃ SỬA (40b9ad127), chuyển sang nút Kiểm tra.
- [P3] "Bạn có X điểm": ĐÃ SỬA (30d178a9b), thành "Dùng được X điểm" ở app-core và dòng partnerPoints.disabled của web; test app-core cập nhật.
- [P3] VND_PER_POINT cố định: ĐÃ SỬA (30d178a9b, 4bc511aec). Thêm tham số vndPerPoint (mặc định 1), web và Mini truyền loyalty.vndPerPointRedeem từ config công khai; có test 1 điểm = 1.000đ.
- [P3] Test bấm đúp giả: ĐÃ SỬA (db6b7266d). Bọc VariationSheet lấy onConfirm, gọi hai lần liền nhau; bỏ khoá confirming thì test ĐỎ (đã thử), có khoá thì xanh.
- [P3] Web bypass bridge + không khoá bấm đúp: ĐÃ SỬA (e613958f4). Màn dùng platformBridge.saveImage, khoá bằng ref + disabled; test mới gọi một lần khi bấm đúp.
- [P3] First Load +3KB: ĐÃ ĐO, không build lại base. Trang không đụng cũng lệch +1..2 KB ("/" 204→206, /doi-rac 166→167, /tai-khoan 170→171, /uu-dai 165→166, /vuon-xanh 169→170). Delta riêng của trang ≤ ~+1,5 KB. Số liệu ở mục Bundle.
- [P3] Ảnh order-success trước/sau: ĐÃ GHÉP phần sau; ảnh "trước" KHÔNG LÀM vì phải đặt đơn trên lane 5 (cấm đụng lane 5). Ghép đủ 4 cột cho product-slug, bảng chọn phân loại (trước trống), cart, checkout, bank-payment-code, group-buy.
- [P3] Bảng phân loại nạp lười không phản hồi: ĐÃ SỬA (db6b7266d), tải trước sau 800ms ở điện thoại khi SP ≥ 2 phân loại. Lỗi tải vẫn im lặng, không làm.
- [P3] clearTimeout 30s: ĐÃ SỬA (40b9ad127) + spec mới zmp-save-image.spec.ts (2 ca).
- [P3] next start / Zalo thật / quảng cáo ưu đãi ở new-customer-gift: KHÔNG LÀM (cần môi trường thật; new-customer-gift thuộc gói khampha).

VIỆC BẮT BUỘC THÊM
(1) Lane 6 bật từ worktree gói, seed, chụp mini375+web375, ghép before-after.mjs, đã tự xem từng ảnh. (2) Web gate cả bộ. (3) Bundle xong. (4) Mini entry xong. (5) Test web cho bridge.saveImage đã có.

KIỂM THẬT
- tsc: web, miniapp, app-core, e2e, api sạch. eslint file đổi sạch. lint:parity xanh (0 pending).
- vitest app-core 73 file / 932 test; miniapp 316 / 4874 (cả TZ=UTC); web 443 / 7453. Tất cả xanh (web chạy lại sau sửa cuối).
- Playwright Mini toàn bộ: 205 passed, 10 skipped, 0 failed. Web gate cả bộ (cổng 3771-3775): 354 passed, 38 skipped, 0 failed.
- jest API và race không chạy vì không đụng mã API (chỉ migration WELCOME30 + seed, typecheck API sạch). Migration vẫn là UPDATE theo code, idempotent.
- Bundle Mini: entry 711,2 KB raw / 222 KB gz (cơ sở 711 / 222). Tổng JS 1630 KB (cơ sở 1624, +6 KB do chunk lazy bảng phân loại, gần như toàn chunk mới).
- Bundle web First Load, trước→sau: /san-pham/[slug] 174→176, /gio-hang 163→164, /thanh-toan 191→194, /mua-chung 156→158.

ẢNH: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-muahang/ (*__returning__ok__s1.png), JSON bundle trong screens-muahang/perf/.

LƯU Ý CHO CHỦ
- Order-success web 375 còn thẻ "Đặt định kỳ" và cách trên đầu lớn hơn Mini; thẻ định kỳ do SUBSCRIPTIONS_IN_MINIAPP=false chỉ ẩn ở Mini, theo comment của chủ chốt 28/10. Chưa sửa.
- Đã dừng lane 6; cổng 3261-3268 trống.

## Review 3

KẾT LUẬN: chưa merge

- [P2] apps/web/src/app/thanh-toan/bank-transfer-panel.tsx:310-323 — Ở khổ 375 nút "Tôi đã chuyển khoản — Kiểm tra" đã dính đáy (StickyActionBar, :324-330), nhưng kết quả kiểm vẫn là đoạn `bank-check-result` nằm trong dòng chảy của trang, ở dưới khung hạn và dòng dò nền. Ảnh `bank-payment-code` (cột Web sau) cho thấy màn 375 bị cắt ở khối "Giữ nguyên nội dung", nên đoạn này nằm dưới mép màn. Ví dụ: khách đang xem QR, bấm Kiểm tra khi tiền chưa về hoặc khi mất mạng. Nút chỉ đổi "Đang kiểm tra…" rồi trở lại như cũ, khách không thấy "Chưa thấy tiền về" hay lỗi mạng. Đây là hồi quy so với lượt trước, vì khi đó lời báo nằm ngay dưới nút. Nó cũng lệch Mini: bank-payment.tsx:111-127 báo bằng snackbar `position: 'top'`, thấy được ở mọi vị trí cuộn. — Cách sửa: khi `stickyCheck`, hiện kết quả trong StickyActionBar (phía trên nút) hoặc bằng toast trên đầu như Mini, rồi thêm test cho trường hợp unpaid và error.
- [P2] screens-muahang/order-success__returning__ok__s1.png — Việc bắt buộc (1) vẫn thiếu ảnh "trước" của order-success: cột Mini trước và cột Web trước đều ghi "không có". Lý do "phải đặt đơn trên lane 5" không đứng được, vì base 1384ff380 có thể bật trên lane 6, giống lúc chụp ảnh "sau". — Cách sửa: checkout base trên lane 6, seed, đặt một đơn COD, chụp mini375 và web375, rồi ghép lại bằng before-after.mjs.
- [P2] R-7, apps/web/src/app/thanh-toan/page.tsx — Vẫn chưa có số đo CLS và LCP (thư mục screens-muahang/perf/ chỉ có bundle-*.json). Việc này do bên giao làm: `run-all.mjs --only web --build-web --label muahang` trước khi merge.
- [P3] apps/web/src/app/thanh-toan/page.tsx:766-767 — Khi `partnerPoints.disabled` (pointsMax = 0, xem apps/web/src/lib/checkout-points.ts:98-101), ô điểm bị khoá nhưng vẫn ghi "Dùng được 1.200 điểm", còn dòng capNote ngay dưới (:773) ghi "Đơn này chưa dùng được Điểm Xanh". Hai câu tự mâu thuẫn. Mini cũng khác: apps/miniapp/src/pages/checkout.tsx:763-765 dùng `points.label` là "Bạn đang có X" hoặc "Dùng được X/Y". — Cách sửa: khi bị khoá thì dùng đúng nhãn như Mini (`checkoutPoints().label`), hoặc chỉ ghi số dư.
- [P3] apps/web/src/app/thanh-toan/bank-transfer-panel.tsx:123-133 — Nhánh lỗi ngoài saveImage không được bắt. download-image.saveImage tự bắt lỗi và trả 'failed', nhưng nếu `import('./download-image')` ở platform-bridge.ts:34 hỏng (mất chunk, mạng chập chờn) thì promise reject. Lúc đó try/finally chỉ mở khoá rồi lỗi rơi ra thành unhandled rejection, khách không thấy BANK_QR_SAVE_FAILED. — Cách sửa: thêm `catch { setQrSaved('failed') }`.
- [P3] Mini entry: bundle-mini-muahang.json ghi `rawKB: 711`, bằng cơ sở 711 nên đạt (4). Việc thêm (3): delta /thanh-toan +3 KB (191 → 194) vẫn chưa được tách khỏi phần lệch nền (+1..2 KB) bằng một bản build base trên cùng máy. Hiện mới là suy luận.

Đã kiểm lượt này, phần đã sửa đúng:
- Phần chừa đáy Mini là `calc(96px + var(--safe-bottom))`. Chú thích đã chuyển theo nút Kiểm tra.
- clearTimeout nằm trong finally. zmp-save-image.spec 2/2 xanh.
- points-offer ghi "Dùng được X điểm" và nhận vndPerPoint. API khoá `loyalty.vnd_per_point_redeem` ở min 1, max 1 (system-config.service.ts:175) và public-config trả `loyalty.vndPerPointRedeem`, nên không lệch giá.
- Test bấm đúp ở add-to-cart giờ gọi thẳng onConfirm hai lần. Web Lưu QR đi qua platformBridge, có khoá bằng ref và disabled, có test.
- Tải trước bảng chỉ mount với open=false. Bảng đặt lại lựa chọn mỗi lần mở (variation-sheet.tsx:53-59), nên không giữ số lượng hay phân loại cũ.
- Migration vẫn chỉ có một lệnh `UPDATE ... WHERE code='WELCOME30' AND newCustomerOnly=false` (idempotent). Seed chỉ thêm `newCustomerOnly: true`; FREESHIP, giá trị và ngưỡng không đổi.
- Thanh dính ẩn bottom nav (globals.css:88).
- Đã chạy lại trên Node 22: web bank-mini + add-to-cart 69/69, app-core points-offer 5/5, Mini zmp-save-image 2/2.
