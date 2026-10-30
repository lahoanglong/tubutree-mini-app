# Gói P3 diem-doirac: Điểm Xanh, Vườn, Đổi rác

Gốc: main 815fa3c1e. Nguồn: các P3 reviewer Opus nêu ở đợt 28/10 (gói diem, doirac) chưa sửa, mục làm dở, và mục còn lại trong báo cáo cuối.

Với mỗi mục: kiểm còn đúng trên mã hiện tại không (nhiều mục đã sửa ở lượt review sau hoặc gói khác; dòng có thể lệch). Đã hết thì ghi skipped + bằng chứng file:dòng. Mục cần chủ quyết (ghi needs_owner/cần chủ quyết, hoặc phải đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, thêm tin gửi khách) thì skipped, ghi lựa chọn cho chủ. Mục trùng nhau thì làm một lần, ghi id kia là trùng.

## diem-doirac-1 (review lượt 1, gói diem)

File: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-diem/packages/app-core/src/loyalty-tier-copy.ts:31

Vấn đề: Có vài comment kể lại thay đổi hoặc chứa mã mục, trái luật brief. Cụ thể: loyalty-tier-copy.ts:31 viết '(thay cho khối danh sách mã...)'; apps/api/src/modules/loyalty/loyalty.service.ts:769 viết 'trả 100 dòng đầu như bản cũ'; apps/api/test/integration-race/community-pick-winner.race-spec.ts:13 viết '(trước đây đóng trước, cộng lỗi chỉ ghi warn...)'; harvest-coupon-count.race-spec.ts viết 'thay cho hai lần coupon.count'; tên describe ở apps/miniapp/src/pages/loyalty-layout.spec.tsx:84 có mã '(C-074, R-122)'.

Cách sửa đề xuất: Viết lại các comment để chỉ nói lý do hiện tại. Ví dụ: 'Không tham số thì trả tối đa 100 dòng mới nhất (client chưa phân trang vẫn chạy)'; 'Trang Hạng chỉ có một dòng lối tắt, vì danh sách mã nằm ở Ưu đãi'. Bỏ '(C-074, R-122)' khỏi tên describe.

## diem-doirac-2 (review lượt 1, gói diem)

File: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-diem/apps/e2e/tests/loyalty.web.spec.ts:85

Vấn đề: Gói sửa file có chủ khác. apps/e2e/** thuộc gói dondep (gói khác chỉ được thêm spec mới), nhưng gói này sửa loyalty.web.spec.ts và loyalty.miniapp.spec.ts:233. Gói cũng sửa packages/shared-types/src/waste.ts (dòng GiftRedemptionDTO viết trên một dòng); file này không có trong bảng chủ file nhưng doirac rất có thể cũng đụng. Gộp có thể xung đột.

Cách sửa đề xuất: Ghi vào thứ tự merge: gộp diem trước dondep và doirac, hoặc báo hai gói đó rebase lên diem. Nếu xung đột thì giữ phần sửa spec của diem, vì trang Hạng không còn khối 'Mã giảm giá của tôi'.

## diem-doirac-3 (review lượt 1, gói diem)

File: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-diem/apps/web/src/app/kho-qua/cua-toi/page.tsx:16

Vấn đề: Chưa đo First Load web của /kho-qua/cua-toi và /tai-khoan/diem-xanh. Worker tự ghi điều này. /kho-qua/cua-toi nay kéo thêm useCouponUse (shop-client applyCoupon/getCart, cart-key), có thể vượt trần +2 KB của brief mà không ai biết.

Cách sửa đề xuất: Chạy next build trên gốc 376ad7055 và trên HEAD, so First Load của /kho-qua/cua-toi và /tai-khoan/diem-xanh. Nếu tăng quá 2 KB thì ghi lý do trong báo cáo (đổi lại có nút Dùng ngay).

## diem-doirac-4 (review lượt 1, gói diem)

File: /Users/longla/coding/tubutree-mini-app/apps/miniapp/src/components/game/garden-plots.tsx:55

Vấn đề: E-102 mới sửa thẻ cây chính. Danh sách lô (Mini garden-plots.tsx:55 và :68, web garden-plots.tsx:56 và :75) vẫn hiện 'Lô N · Cây Dứa Fuwa3e' như tên thật. File này ngoài phạm vi gói, worker đã báo.

Cách sửa đề xuất: Giao cho gói sở hữu garden-plots: dùng treeTitle(p.treeType) từ @tubutree/app-core/tree-title cho chữ hiện ra và aria-label, ở cả hai nền.

## diem-doirac-5 (review lượt 1, gói diem)

File: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-diem/apps/api/src/modules/game/game.controller.ts:49

Vấn đề: Đã xoá POST /game/check-in và GET /me/loyalty/check-in. Mini App Testing V19/V20 (bản 4eea3135 trở về trước) vẫn gọi hai route này. Bản 0a43f0b0 (V21) trở đi thì không gọi nữa. Nếu bản Live trên Zalo vẫn là V19/V20 thì nút điểm danh Vườn sẽ báo 404.

Cách sửa đề xuất: Trước khi deploy API, xác nhận bản Live trên Zalo từ V21 (0a43f0b0) trở lên. Đây là cùng giả định với lần xoá POST /me/loyalty/check-in ở 5c1d47a2f đã deploy ngày 28/10. Ghi vào runbook deploy.

## diem-doirac-6 (review lượt 2, gói diem)

File: apps/miniapp/src/components/game/eco-impact.tsx:54 và apps/web/src/components/game/eco-impact.tsx:36

Vấn đề: E-102 chưa đạt hết tiêu chí 'không còn hiện giá trị mặc định như tên thật'. Thẻ 'Tác động xanh của bạn' trên trang Vườn (cả hai nền) có mục 'Đóng góp của tôi'. Mục này vẫn in `t.treeType` của từng chứng nhận cây. Mọi PlantedTree đều được ghi treeType = DEFAULT_TREE_TYPE (xem game.service.ts:433, :617; game-garden.service.ts:237 với lô tạo ở :149), nên khách đã thu hoạch thấy 'Cây Dứa Fuwa3e' dưới mỗi mã chứng nhận. Vòng R1 đã sửa garden-hero và garden-plots nhưng sót file này.

Cách sửa đề xuất: Ở cả hai file eco-impact.tsx, import `treeTitle` và `GENERIC_TREE_TITLE` từ '@tubutree/app-core/tree-title'. Chỉ hiện dòng loài khi `treeTitle(t.treeType) !== GENERIC_TREE_TITLE`; còn lại bỏ hẳn dòng đó, vì dưới mã chứng nhận ghi 'Cây của bạn' là thừa. Thêm ca vào g3.spec.tsx của hai nền: forest có 1 cây treeType 'Cây Dứa Fuwa3e' thì container không khớp /Fuwa3e/; có 1 cây 'Sồi' thì vẫn hiện 'Sồi'.

## diem-doirac-7 (review lượt 2, gói diem)

File: apps/miniapp/src/pages/loyalty.tsx:289

Vấn đề: Dòng 'Ví mã (n)' / 'Đổi quà' trên Mini cao hơn hẳn web ở khổ 375. Ước theo ảnh chụp: Mini khoảng 99px, web khoảng 63px. Lý do: Mini dùng Card padding 16 cộng ListRow padding 12px 0, còn web chỉ p-3 (apps/web/src/app/tai-khoan/diem-xanh/page.tsx khoảng dòng 223). Trang này mục tiêu là gọn, và luật web khổ điện thoại phải giống Mini cả giao diện. Đây là dòng mới thêm nên nên khớp ngay từ đầu.

Cách sửa đề xuất: Với riêng thẻ này, đổi Card Mini thành padding dọc 0 (vd `padding={0}` với style padding '0 16px'; ListRow đã có 12px trên dưới). Hoặc đổi web sang p-4 cho bằng chiều cao Mini, chọn một chiều và giữ cả hai nền giống nhau. Sau đó chụp lại 375px hai nền (loyalty__returning có mã và không mã) và đối chiếu.

## diem-doirac-8 (review lượt 2, gói diem)

File: apps/miniapp/src/pages/loyalty.tsx:349 và apps/web/src/app/tai-khoan/diem-xanh/page.tsx:152

Vấn đề: Lúc couponsQ đang tải, couponShortcut(0) trả về to='rewards', nên dòng 'Kho quà' trong thẻ lối tắt bị ẩn. Tải xong mà khách có mã thì dòng này mới hiện, làm thẻ lối tắt giãn ra và nội dung bên dưới bị đẩy xuống (nhảy bố cục), trong khi phía trên vẫn là skeleton.

Cách sửa đề xuất: Đổi điều kiện hiện thành `(couponsQ.isLoading || couponRow.to === 'coupons')` ở cả hai nền. Thêm một ca vào loyalty-layout.spec.tsx (Mini) và diem-xanh/page.spec.tsx (web): khi couponsQ còn pending thì dòng 'Kho quà' vẫn có trong thẻ lối tắt.

## diem-doirac-9 (review lượt 2, gói diem)

File: packages/app-core/src/tree-title.ts:5

Vấn đề: Chuỗi 'Cây Dứa Fuwa3e' được chép tay từ apps/api/src/modules/game/game.constants.ts:6. Nếu sau này đổi DEFAULT_TREE_TYPE ở API, giao diện sẽ lại hiện giá trị mặc định như tên thật mà không test nào đỏ.

Cách sửa đề xuất: Thêm một spec phía API (vd apps/api/src/modules/game/game.constants.spec.ts) import DEFAULT_TREE_TYPE của API và kiểm `treeTitle(DEFAULT_TREE_TYPE) === GENERIC_TREE_TITLE` từ app-core. Cách khác: export DEFAULT_TREE_TYPE từ app-core rồi so bằng nhau trong spec đó.

## diem-doirac-10 (mục E-38 làm dở ở gói doirac)

Ghi chú của worker: Chỉ làm phần (b): thu kèm đơn đã được kho nhận không còn tô bước chờ kho, dùng chung timeline ở app-core (Mini + web). Phần (a) chờ chủ.

Làm nốt phần còn lại nếu không cần chủ quyết.

## diem-doirac-11 (mục E-42 làm dở ở gói doirac)

Ghi chú của worker: Web quầy có nút quét (BarcodeDetector + getUserMedia, không thêm thư viện, ẩn khi máy không hỗ trợ), thẻ hạn mức lên trước như Mini, nút Từ chối dùng màu cảnh báo; spec web có BarcodeDetector giả. CHƯA so ảnh 375px (máy quá tải, không dựng capture); chỉ có test cấu trúc thứ tự thẻ.

Làm nốt phần còn lại nếu không cần chủ quyết.

## diem-doirac-12 (review lượt 1, gói doirac)

File: apps/miniapp/src/pages/recycle-desk.tsx:432 vs apps/web/src/components/recycle/recycle-desk.tsx:48,472

Vấn đề: The 'Từ chối cả yêu cầu' button looks different on the two platforms. Mini uses variant=secondary (the secondary button background) with red text. Web uses DANGER_BTN (red border + bg-danger-bg + red text). At 375px the two still differ, which goes against the rule that web on a phone must look like the Mini App. E-42 also has no 375px screenshot comparison, so this was not caught.

Cách sửa đề xuất: Pick one style and use it on both. Either give web skin.btnSecondary + text-danger-fg, or give Mini the same red border and danger background as web. Then compare 375px screenshots of /doi-rac/quay and /recycle/desk (staff, s1) before closing E-42.

## diem-doirac-13 (review lượt 1, gói doirac)

File: worker report (items E-38/E-40/E-41) + checks

Vấn đề: The report swaps item descriptions. Under 'E-38 partial' it describes E-40 (pickup timeline). Under 'E-41 done' it describes E-38 (desk lookup of a colleague's request). E-41 itself (0 points: 'Lần này chưa đủ để cộng điểm') is described nowhere, although the code has it (app-core/waste-desk.ts deskDoneCopy, tests on both platforms). The report also lacks the web First Load figure for /doi-rac/quay after adding recycle-scan.tsx (statically imported), and the Mini total gz increase was not measured. The brief requires both numbers or a stated reason. The gate file gate-e2e-doirac.txt (23:58) is older than HEAD 6daf76776 (00:20). The only HEAD change is a race spec, which I re-ran myself and it passed.

Cách sửa đề xuất: Correct the report: E-38 partial (part (b) only, part (a) waits for the owner), E-40 done, E-41 done. Add the web First Load measurement for /doi-rac/quay before and after, plus the Mini total gz (or a reason). Re-run gate.sh on HEAD so the gate file matches the latest commit.

## diem-doirac-14 (review lượt 2, gói doirac)

File: packages/app-core/src/waste-desk.ts:44-50

Vấn đề: deskClosedText chỉ hiện giờ ('Đã duyệt lúc 10:05'), nhưng máy chủ cho xem lại yêu cầu đã đóng trong tối đa 24 giờ (WASTE_DESK_RECENT_MS = 24h, apps/api/src/modules/waste-exchange/waste.constants.ts:10). Yêu cầu duyệt lúc 10:05 hôm qua, tra lúc 09:00 hôm nay, vẫn hiện 'Đã duyệt lúc 10:05', nhân viên dễ hiểu là hôm nay.

Cách sửa đề xuất: Khi closedAt không cùng ngày (giờ VN) với lúc hiện tại thì thêm ngày, ví dụ 'Đã duyệt lúc 10:05 ngày 28/10' (hoặc '10:05 hôm qua'). Truyền now vào deskClosedText để test được, rồi thêm một ca trong waste-desk.spec.ts.

## diem-doirac-15 (review lượt 2, gói doirac)

File: apps/web/src/components/recycle/recycle-scan.tsx:23-41, 104-110

Vấn đề: Nút quét chỉ kiểm tra BarcodeDetector và getUserMedia có tồn tại, không kiểm tra BarcodeDetector.getSupportedFormats() có 'qr_code' hay không. Trên máy có API nhưng không đọc được QR (ví dụ Android không có Google Play Services), camera vẫn mở, detect cứ trả rỗng hoặc lỗi và bị nuốt ở .catch, nên nhân viên không nhận được thông báo nào. Ngoài ra khi bị chặn quyền camera, câu 'Chưa quét được. Hãy thử lại...' bảo thử lại, mà thử lại thì vẫn lỗi y như cũ.

Cách sửa đề xuất: Trong useBarcodeScan, sau khi thấy có API thì await BarcodeDetector.getSupportedFormats?.() và chỉ bật nút khi danh sách có 'qr_code'. Trong catch của getUserMedia, nếu lỗi tên NotAllowedError thì dùng câu 'Chưa mở được camera. Hãy cho phép camera trong trình duyệt hoặc gõ mã bên dưới.'

## diem-doirac-16 (review lượt 2, gói doirac)

File: packages/app-core/src/waste-timeline.ts:23

Vấn đề: Comment '// Thu kèm đơn: kho nhận xong (RECEIVED) là đang đếm, bước 3.' nói ngược với mã. current = 3 là chỉ số của 'Cộng điểm', nên bước 'Kho nhận, đếm' được tô là đã xong, không phải 'đang đếm'. Spec app-core cũng ghi 'Kho nhận, đếm đã qua, đang tới Cộng điểm'.

Cách sửa đề xuất: Sửa comment cho đúng ý, ví dụ: 'Thu kèm đơn: kho đã nhận (RECEIVED) thì coi bước "Kho nhận, đếm" đã qua, đang chờ cộng điểm (current = 3).'

## diem-doirac-17 (review lượt 2, gói doirac)

File: apps/miniapp/src/utils/waste-labels.ts:105-111; apps/web/src/components/recycle/recycle-labels.ts:150-156

Vấn đề: Tin WASTE_REQUEST_EXPIRED cho MAIL_IN nay hướng khách nhắn CSKH kèm mã vận đơn, nhưng màn chi tiết yêu cầu (đích của tin, /recycle/r/:id) vẫn chỉ ghi 'Hết hạn giữ chỗ', không có câu hướng dẫn đó. Khách bấm vào tin rồi thì không còn thấy lối đi tiếp trên màn. Brief không bắt buộc phần này.

Cách sửa đề xuất: Tuỳ chọn: trong closedLabel, khi method MAIL_IN và closeReason HOLD_EXPIRED thì reason = 'Nếu bạn đã gửi kiện, hãy nhắn CSKH kèm mã vận đơn để được hỗ trợ' ở cả hai nền, kèm test ở hai spec labels.

## diem-doirac-18 (còn lại trong báo cáo cuối 29/10)

Web khách chưa đăng nhập ở trang chọn điểm nhận đổi rác: tiêu đề khác Mini. So ảnh Mini và web 375 (docs/2026-10-28-review/screens nếu có), đưa web về chữ của Mini.
