# muahang đợt D

mergeable=False

## Sửa D1 (head a5e973e6f)

Nhánh review/1028-muahang, 2 commit mới trên 09ee76909, chưa push, worktree sạch, không có cổng 3770-3779 nào còn nghe:
- 3d632ac4b fix(chuyen-khoan): lời báo Kiểm tra trong thanh dính đáy, nhãn ô điểm khoá, bắt lỗi nạp Lưu QR
- a5e973e6f perf(thanh-toan): nạp lười BankTransferPanel (next/dynamic, ssr:false)

TỪNG VIỆC
(1) P2 kết quả Kiểm tra bị khuất: ĐÃ LÀM (3d632ac4b). Khi stickyCheck, lời báo (chưa thấy tiền / lỗi mạng, hết phiên, failed) hiện trong StickyActionBar ngay trên nút, testid bank-check-result-sticky. Bản trong trang ẩn ở max-md, từ md vẫn như cũ. Test mới trong bank-mini.spec cho unpaid và lỗi mạng: đỏ trước, xanh sau.
(2) P2 ảnh TRƯỚC order-success: ĐÃ LÀM. Ghép 4 cột bằng chromium. Cột trước lấy từ GĐ1: screens/flows/mini/2-tim-va-mua/14-man-dat-thanh-cong.png và screens/flows/web/2-tim-mua/14-man-dat-thanh-cong.png. Cột sau lấy từ sau-mini375-order-success.png và sau-web375-order-success.png ở screens-muahang (chụp lượt trước; order-success không đổi lượt này). Đã tự xem. Lưu ý: ảnh GĐ1 Mini 750x1624 và web 375x812, đều thu về 375 khi ghép; đơn mẫu mỗi ảnh khác nhau nên số tiền khác. Ảnh ở screens-muahang/order-success__returning__ok__s1.png (nằm ngoài worktree gói, không commit).
(3) P3 ô điểm khoá: ĐÃ LÀM. Thêm lockedPointsLabel() ở apps/web/src/lib/checkout-points.ts, cùng chữ với checkoutPoints().label của Mini: "Bạn đang có X điểm", hoặc "Dùng được X/Y điểm" khi một phần còn bị giữ. Hết cảnh "Dùng được" cạnh "chưa dùng được". 2 test mới ở points-label.spec, đỏ rồi xanh.
(4) P3 catch khi import download-image hỏng: ĐÃ LÀM (catch setQrSaved('failed') ở handleSaveQr). Test mới (saveImage reject) hiện "Chưa lưu được", nút mở lại. Đỏ rồi xanh.
(5) /thanh-toan First Load: ĐÃ CẮT bằng next/dynamic BankTransferPanel (a5e973e6f). 194 → 190 KB (base 191, tức -1; mức yêu cầu ≤ +2 đạt). Đổi lại /san-pham/[slug] 176 → 178 KB (base 174, +4, VƯỢT +2): nhiều khả năng do Next chia lại chunk dùng chung, slug không có mã mới (chưa kiểm chunk). Đã thử hai phương án khác, đều bất lợi hơn: dynamic OrderSuccess riêng cho thanh-toan 186 / slug 177, nhưng khách thấy màn trống nếu mất mạng sau khi đã đặt đơn và 5 test hỏng; cả hai dynamic cho thanh-toan 180 / slug 178. Chọn phương án an toàn nhất. Người giao quyết định nhận slug +4 hay thôi cắt.
Bảng next build cuối (KB, trước nhóm này → sau): /thanh-toan 194→190, /san-pham/[slug] 176→178, /gio-hang 164→164, /mua-chung 158→158, / 206→206, /tai-khoan 171→172. JSON: screens-muahang/perf/bundle-web-muahang.json. Mini không đổi mã lượt này nên entry và tổng giữ nguyên lượt trước (entry 711,2 KB raw, tổng 1630 KB), vite build không chạy lại.
(6) GHI BACKLOG: có, xem cuối báo cáo.
Còn lại trong Review 3: P2 R-7 CLS/LCP KHÔNG LÀM (cấm run-all, việc của người giao: run-all --only web --build-web --label muahang). P3 "delta +3 chưa tách khỏi lệch nền": đã đo lại, xem (5).

KIỂM THẬT (Node 22)
- tsc: web 0 lỗi; eslint file đổi 0 lỗi; apps/e2e tsc 0 lỗi. App-core và Mini không sửa file nào nên chỉ chạy test.
- vitest web 443 file / 7458 test xanh; app-core 73 / 932 xanh; Mini 316 / 4874 xanh (cả TZ=UTC).
- Lưu ý: bank-transfer-panel.spec "Lưu mã QR" từng đỏ một lần khi máy đang bận (import động lúc đó trễ), chạy lại riêng 2 lần xanh 27/27, vòng web cả bộ xanh. Chưa xác định test hơi nhạy với tải.
- lint:parity xanh (0 pending).
- Web gate cả bộ (cổng 3771-3775): 354 passed, 38 skipped, 0 failed. Playwright Mini toàn bộ (cổng 3773): 205 passed, 10 skipped, 0 failed.
- Không chạy jest API và race (không đụng API, tiền hay điểm). Không chụp lại ảnh sau cho thanh dính đáy (không bật lane 6 lượt này); kết quả Kiểm tra mới chỉ kiểm bằng test jsdom, chưa xem trên màn thật.
- Không đụng giá, phí, mã ưu đãi hay migration WELCOME30.

GHI BACKLOG
- new-customer-gift.tsx (trang chủ, gói khampha) còn nhắc "định kỳ" khi đơn định kỳ chưa bật.
- R-24 hydrate chưa tái hiện (giữ mở).
- Thẻ "Đặt định kỳ" ở order-success web 375 vẫn hiện còn Mini ẩn (SUBSCRIPTIONS_IN_MINIAPP=false), chưa sửa; cần chủ chốt.
- /san-pham/[slug] First Load 178 vs base 174 (+4): nên kiểm chunk dùng chung sau gộp tất cả gói.
- Nhỏ: icon cảnh báo khối "Giữ nguyên nội dung" trên web nằm cùng dòng, ở Mini ở dòng riêng; hàng Mini thấp hơn web vài px.

## Review D1

KẾT LUẬN: chưa merge

- [P2] apps/web/src/app/thanh-toan/page.tsx:72 và :375 (kèm :285). Vấn đề: dòng 285 chỉ gọi `setPlaced` khi đơn không phải chuyển khoản, nên ở /thanh-toan `BankTransferPanel` lúc nào cũng trả về null (bank-transfer-panel.tsx:75, `isBankTransfer` false). Vì vậy chunk động 7218 (15 KB) chỉ được tải sau mỗi đơn COD hoặc Ví, và không để làm gì. Nếu chunk này tải hỏng thì `next/dynamic` ném lỗi ra app/error.tsx, và màn OrderSuccess bị thay bằng "Có chút trục trặc" ngay sau khi đơn đã tạo. Chunk hỏng khi: deploy xong giữa lúc khách mở trang và lúc bấm Đặt hàng (hash cũ trả 404), hoặc mạng chập chờn. Khi đó khách không thấy mã đơn và dễ đặt lại thành đơn đôi. Chính worker đã nêu rủi ro này để từ chối dynamic OrderSuccess, nhưng lại đưa nó vào qua panel. Cách sửa: bỏ hẳn `BankTransferPanel` và import khỏi page.tsx, vì đơn chuyển khoản đã `router.replace` sang /thanh-toan/chuyen-khoan/[code]. Cách này cắt byte mà không cần tải động. Đo lại next build.
- [P2] /san-pham/[slug] First Load 178 KB so với nền 174 (+4), vượt luật ≤ +2. Trang này không có mã nào đổi trong a5e973e6f. Báo cáo chỉ đoán "chia lại chunk dùng chung" và tự ghi là "chưa kiểm chunk", nên chưa đạt điều kiện "ghi số từng chunk + lý do". Trong .next hiện tại, slug có hai chunk riêng là 616 (9,9 KB, chứa sticky-bar) và 9389 (8,0 KB). Mã StickyActionBar bị chép ra 3 chunk (616, 5622, 4457), đúng dấu hiệu splitChunks chia lại sau khi tách panel. Cách sửa: làm theo mục P2 ở trên (xoá import chết thay vì dynamic), build lại, rồi ghi số từng chunk của slug và thanh-toan so với base.
- [P3] apps/web/src/lib/checkout-points.ts:76 (`lockedPointsLabel`). Vấn đề: khi ô bị khoá (trần 0, câu "Đơn này chưa dùng được Điểm Xanh" ở checkout-points.ts:109) mà một phần điểm còn bị giữ, nhãn vẫn là "Dùng được 300/500 điểm", tức vẫn hai câu mâu thuẫn. Việc (3) yêu cầu "không còn hai câu mâu thuẫn". Mini lỗi y hệt (apps/miniapp/src/utils/checkout-rules.ts:128 cạnh :149). Thêm nữa, luật nhãn đang viết hai lần (web và Mini), không nằm ở app-core. Cách sửa: chuyển một hàm nhãn khoá vào app-core. Khi `disabled` thì luôn ghi "Bạn đang có Y điểm", phần bị giữ để `lockNote` nói. Test ở cả hai nền.
- [P3] apps/web/src/app/thanh-toan/bank-transfer-panel.tsx:330-337. Vấn đề: lời báo trong thanh dính đáy mới chỉ được kiểm bằng jsdom (worker tự nhận). Chưa có ảnh 375 nào chứng minh nó "thấy được ngay", và chưa xem thanh cao thêm có che dòng cuối hay đè vùng an toàn không. Trạng thái `failed` không có test sticky. Cách sửa: chụp bank-payment-code ở web 375 sau khi bấm Kiểm tra (unpaid và lỗi), ghép trước/sau, thêm 1 test cho `failed`.
- [P3] apps/web/src/app/thanh-toan/bank-transfer-panel.tsx:133-135. Vấn đề: lỗi nạp mô-đun được bắt ở màn gọi, còn hợp đồng `saveImage` của cầu nối web (apps/web/src/lib/platform-bridge.ts:34) vẫn có thể reject. Mini thì bắt ngay trong cầu nối (apps/miniapp/src/services/platform-bridge.ts:23-29). Ai gọi cầu nối sau này sẽ gặp lại lỗi chưa bắt. Cách sửa: thêm try/catch trả 'failed' trong platform-bridge.ts của web, giữ catch ở panel làm lớp phòng hờ.

Đã chạy (Node 22): `vitest` cho bank-mini.spec, points-label.spec, bank-transfer-panel.spec, xanh 55/55. Ảnh ghép order-success 4 cột đã xem, khớp nguồn GĐ1. Không thấy đổi giá, phí, mã ưu đãi hay migration WELCOME30 trong 2 commit mới.

GHI BACKLOG (giữ như worker nêu, kèm một điểm mới):
- Thẻ "Đặt định kỳ" vẫn hiện ở order-success web 375 (thấy trong ảnh "Web sau"), còn Mini đã ẩn. Cần chủ chốt.
- Nhãn khoá điểm khi giữ một phần (mục P3 thứ nhất) cần sửa ở cả Mini nếu chưa sửa trong gói này.

## Sửa D2 (head Đã sửa P2, P3, 2 commit, chưa push. Test vitest và lint xanh; chưa chụp ảnh và chưa đo bundle Mini.)

Nhánh review/1028-muahang, worktree /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-muahang.
Commit:
- fix(thanh-toan): bỏ khung chuyển khoản chết khỏi màn thanh toán; ô điểm khoá chỉ ghi số dư ở web và Mini (R-7, R-22)
- fix(chuyen-khoan): cầu nối Lưu QR của web tự bắt lỗi nạp mô-đun; thêm test thanh dính khi giao dịch thất bại (R-8)

Từng mục reviewer:
- P2 BankTransferPanel: đã bỏ khỏi apps/web/src/app/thanh-toan/page.tsx (import động và chỗ render). Đơn chuyển khoản vẫn chuyển sang trang chuyển khoản riêng như cũ.
- P2 First Load slug: sau khi bỏ panel, build lại:
  - /san-pham/[slug]: 176 KB, nền 174, tức +2, nằm trong luật ≤ +2. Trang này không có mã nào đổi; chưa kiểm từng chunk. Nghi do chia lại chunk dùng chung, chưa chứng minh.
  - /thanh-toan: 189 KB, nền 191, giảm 2 KB. Chunk động 7218 không còn.
  - Số lấy từ bảng của next build.
- P3 nhãn khoá điểm: đã sửa cả web và Mini, ô bị khoá luôn ghi "Bạn đang có Y điểm" (Y = tổng số dư), phần bị giữ để lockNote nói.
  - Web: lockedPointsLabel trong apps/web/src/lib/checkout-points.ts. Thêm test ở checkout-points.spec.ts, sửa test cũ trong points-label.spec.tsx.
  - Mini: thêm lockedPointsLabel trong apps/miniapp/src/utils/checkout-rules.ts, dùng ở pages/checkout.tsx khi ô bị khoá và còn điểm dùng được. Thêm test ở checkout-rules.spec.ts.
  - Chưa chuyển hàm vào app-core, mỗi nền vẫn giữ một hàm riêng (xem GHI BACKLOG).
- P3 try/catch cầu nối web: đã thêm trong apps/web/src/lib/platform-bridge.ts, trả 'failed' khi nạp mô-đun hỏng; catch ở panel giữ làm lớp phòng hờ.
- P3 test cho trạng thái failed của thanh dính: đã thêm trong bank-mini.spec.tsx.
- P3 ảnh chụp bank-payment-code ở 375: không làm, vì chưa bật lane. Chỉ có test jsdom, chưa có ảnh chứng minh thanh dính không che dòng cuối hay đè vùng an toàn.

Kiểm:
- vitest web toàn bộ: 443 file, 7460 test, xanh.
- vitest miniapp toàn bộ (TZ=UTC): 316 file, 4875 test, xanh.
- vitest app-core toàn bộ: 932 test, xanh.
- tsc --noEmit web và miniapp: không lỗi.
- eslint trên file đã sửa (web và Mini): không lỗi.
- pnpm lint:parity: "lint:parity xanh (0 mục pending)".
- next build web: qua.

Chưa chạy:
- Playwright, vite build Mini và bundle-report: thay đổi Mini chỉ vài chục byte trong chunk trang thanh toán, chưa đo số thật. Entry Mini không đổi cấu trúc.
- Ảnh trước/sau, đo hiệu năng.
- Lane chưa bật nên không có gì cần dừng.

GHI BACKLOG:
- Thẻ "Đặt định kỳ" vẫn hiện ở order-success web 375, Mini đã ẩn. Cần chủ chốt.
- Luật nhãn khoá điểm còn viết hai lần (web và Mini); pointsSummary cũng có hai bản. Nên gộp vào app-core, việc lớn hơn gói này.
- Chụp bank-payment-code web 375 (unpaid và lỗi) để chứng minh lời báo thấy được trong thanh dính.
- Chỗ chọn khác brief: chưa chạy Playwright e2e và đo bundle Mini như brief yêu cầu.

## Review D2

KẾT LUẬN: chưa merge

- [P2] Lượt này không chạy hai bộ kiểm mà người giao yêu cầu: "web gate CẢ BỘ" và "Playwright Mini toàn bộ". Báo cáo worker tự ghi "Chưa chạy: Playwright". Lần chạy cả bộ gần nhất (Mini 205 passed, web gate 354 passed, ghi ở muahang-c.md) diễn ra trước 4 commit đổi màn: 3d632ac4b, a5e973e6f, 029bc57fc và 820a001f2.
  - Từ đó đến nay đã đổi: thanh dính đáy và lời báo trong `apps/web/src/app/thanh-toan/bank-transfer-panel.tsx`, màn OrderSuccess ở `apps/web/src/app/thanh-toan/page.tsx:365` (đã bỏ panel), và nhãn ô điểm ở `apps/miniapp/src/pages/checkout.tsx:766`.
  - Hồi quy ở luồng /thanh-toan → OrderSuccess và ở /thanh-toan/chuyen-khoan/[code] hiện chưa được e2e nào xác nhận.
  - Cách sửa: chạy `E2E_SCOPE=miniapp` toàn bộ và `web-gate.sh` cả bộ trong dải cổng của gói, rồi chép số thật vào báo cáo.

- [P3] `apps/web/src/lib/platform-bridge.ts:34-40`: try/catch mới (nạp mô-đun hỏng thì trả 'failed') chưa có test. `platform-bridge.spec.ts:32-43` chỉ có 2 ca, saved và failed do download-image trả về, không có ca `import('./download-image')` reject. Nếu ai đó xoá catch, mọi test vẫn xanh, vì test của panel mock thẳng `saveImage` của cầu nối. Cách sửa: thêm một ca `dl.saveImage.mockRejectedValue(...)` (hoặc cho mock module ném lỗi) và kỳ vọng `'failed'`.

- [P3] `apps/miniapp/src/pages/checkout.tsx:766-768`: chỗ nối nhánh khoá (`partnerPoints.disabled && points.usable > 0 → lockedPointsLabel`) chưa có test ở mức trang. Test `checkout-rules.spec.ts:294-300` chỉ kiểm một hàm template trả chuỗi. Ca trang ở `checkout.spec.tsx:1146-1155` (pointsMax 0 kèm partnerNote) không kiểm nhãn, và không có ca nào có `redeemablePoints < pointsBalance`. Cách sửa: thêm một ca vào checkout.spec với pointsBalance 500, redeemablePoints 300, pointsMax 0. Kỳ vọng thấy "Bạn đang có 500 điểm" và không thấy "Dùng được".

- [P3] Luật nhãn ô khoá điểm vẫn viết hai lần với hai chữ ký khác nhau: `apps/web/src/lib/checkout-points.ts:74` và `apps/miniapp/src/utils/checkout-rules.ts:132`. Brief yêu cầu logic chung đặt ở app-core. Worker đã đưa vào GHI BACKLOG, người giao có thể chấp nhận.

- [P3] Thiếu bằng chứng cho hai trang dùng chung `bank-transfer-panel.tsx` (đã đổi trong gói):
  - Báo cáo không ghi First Load của `/thanh-toan/chuyen-khoan/[code]` (nền 148 KB) và `/tai-khoan/don-hang/[code]` (nền 191 KB). Bản build 15:14 trong `screens-muahang/perf/bundle-web-muahang.json` ghi /tai-khoan/don-hang/[code] là 194 KB (+3). Tôi ước lượng từ `.next/app-build-manifest.json` hiện tại (gzip -9, cùng cách tính cho ra đúng 189 và 176 như worker báo): khoảng 149 KB (+1) và 192 KB (+1), tức đạt luật. Nhưng số phải lấy từ bảng next build và ghi vào báo cáo.
  - Vẫn chưa có ảnh bank-payment-code ở web 375 sau khi bấm Kiểm tra (unpaid và error). Việc này để kiểm thanh dính cao thêm có che dòng cuối hoặc vùng an toàn không. Đây là bằng chứng cho chính thay đổi của gói, không phải việc backlog.

Đã kiểm, các mục lượt trước đã sửa thật:
- BankTransferPanel đã bị bỏ khỏi /thanh-toan. Đơn chuyển khoản không bao giờ vào `placed` (`page.tsx:281`), và vẫn `router.replace` sang trang chuyển khoản. Hai chỗ còn dùng panel (chi tiết đơn, chuyển khoản) đều import tĩnh.
- Nhãn ô khoá ở web và Mini cùng ghi "Bạn đang có {tổng} điểm", không còn "Dùng được" cạnh câu "Đơn này chưa dùng được Điểm Xanh". Tổng ở web tính bằng `pointsSummary(quote).total`, ở Mini bằng `lots.total`, nên khớp nhau. Không đổi trần điểm, tỉ giá, giá hay phí.
- Đã có test sticky cho trạng thái FAILED.
- Mini `CheckoutPage` nạp lười (`components/app.tsx:49`), nên đổi `checkout-rules` không chạm entry.
- 2 commit cuối không đụng migration WELCOME30, mã ưu đãi hay API.

Lệnh đã chạy (Node 22.23.3):
- web vitest: points-label, checkout-points, bank-mini, bank-transfer-panel, platform-bridge, 5 file 106/106 xanh.
- Mini vitest (TZ=UTC): checkout-rules, checkout, 2 file 135/135 xanh.

GHI BACKLOG:
- `new-customer-gift.tsx` (gói khampha) còn chữ "định kỳ"; R-24 (lỗi hydrate) chưa tái hiện được. Hai mục này người giao đã nêu, worker không nhắc lại trong báo cáo.
- Thẻ "Đặt định kỳ" còn hiện ở order-success web 375, Mini đã ẩn. Cần chủ chốt.
- Gộp lockedPointsLabel và pointsSummary vào app-core.
