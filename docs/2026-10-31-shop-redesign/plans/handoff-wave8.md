# Bàn giao đợt 8 (hạn chế còn lại của đợt 7: chữ, lưới chặn chữ, MINOR giao diện, suất Giờ vàng theo khách)

Đợt 8 làm các mục còn sửa được bằng mã trong `handoff-wave7.md` §4. Có 4 gói, mỗi gói đi theo vòng: agent làm, reviewer Opus xem, agent sửa tới khi APPROVE. Gói đường tiền (M4) được review 2 lượt. Không deploy: deploy là việc chủ quyết.

## 1. Đã có gì

- **M1 (chữ client, `plans/M1-client-copy.md`):**
  - Bỏ "Vui lòng", "chúng tôi", "..." ba dấu chấm, "Nhãn hàng", "giờ vàng" viết thường, "HSD", "Chỉ còn n" ở chữ khách đọc của hai app và app-core.
  - Danh sách miễn trừ của `terminology.spec` chỉ còn hai nhóm: "cửa hàng" nghĩa điểm bán thật (13 dòng) và văn bản pháp lý `legal.ts` (1 dòng).
  - Câu dùng chung hai app nằm ở `packages/app-core/src/client-copy.ts` (lỗi chung, mất mạng, chuyển khoản, hoàn tiền, ô bắt buộc, màn chủ thương hiệu), nên Mini và web ra cùng chữ.
- **M2 (chữ API, `plans/M2-api-copy.md`):**
  - Viết lại 111 chuỗi "Vui lòng"/"vui lòng" ở khoảng 47 file `apps/api/src`, kèm spec jest, race spec và mock e2e.
  - Câu mà client cũ so khớp để rẽ nhánh được giữ nguyên, có test ghim. Danh sách ở mục notes của gói, gồm "đăng nhập Zalo", "không đủ tồn kho", "Hết suất ưu đãi.", "Vượt giới hạn mua ưu đãi.", các mệnh đề đầu của lỗi hoàn tiền.
  - Chữ khách đọc của Giờ vàng tách ra `apps/api/src/modules/flash-sale/flash-sale-notice.ts`, nên bộ quét đã quét được.
  - `terminology.spec` có thêm luật cấm "Vui lòng"/"chúng tôi" ở MỌI file `apps/api/src` (trừ spec), kể cả thư mục admin.
  - Bộ quét xét thêm từ cấm viết thường ở đoạn giữa và cuối của chuỗi template (`${n} voucher`). Giá trị truy vấn (`?tab=HOT`) và địa chỉ `scheme://…` không còn bị bắt nhầm.
- **M3 (MINOR giao diện, `plans/M3-ui-minors.md`):**
  - Hàng danh mục: nhãn tối đa 2 dòng, chữ 12px/600, siết chữ -0,04em, hai nhãn kề nhau luôn cách tối thiểu 2px (e2e đo cả khi ép chữ rộng kiểu Linux).
  - Tên mã do admin đặt xuống hàng riêng dưới điều kiện, tối đa 2 dòng, ngắt cả từ dài không dấu cách.
  - `apps/web/src/components/sticky-action-bar.tsx` dùng token semantic và đã vào `WEB_SHOP` của lưới chặn.
  - Trình dựng gian hàng CTV vẽ ngay, không chờ `/affiliate/tiers`. Chỉ chỗ huy hiệu bậc có khung chờ cùng cỡ. Bậc lỗi hoặc hết hạn chờ thì ẩn huy hiệu, không có màn lỗi.
- **M4 (suất Giờ vàng theo khách, đường tiền, `plans/M4-flash-allowance.md`):**
  - Endpoint mới `GET /flash-sales/me/allowance?items=<flashSaleItemId,…>`: cần đăng nhập, `Cache-Control: private, no-store`, bỏ qua id đã hết, đã kết thúc hoặc không biết. Không đụng cache chung `/flash-sales/active`, `/slots`.
  - `commerce/flash-line.ts` nhận thêm số suất còn lại của khách. PDP, sheet chọn phân loại và bảng thêm nhanh ở Yêu thích của hai app gọi endpoint một lần cho các món đang vẽ.
  - Khách đã dùng hết suất: nút và tổng ghi giá thường kèm "Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường." Còn một phần: "Bạn còn {n} suất Giờ vàng. Mua {qty} thì cả dòng tính giá thường."
  - Số suất tự làm mới sau khi đặt đơn.
  - Luật tính giá ở máy chủ không đổi.
- **Sửa sau review, làm ở nhánh tích hợp:**
  - Câu "tải thêm lỗi" thành "Bạn thử lại nhé".
  - Bỏ chữ "Bạn" lặp hai lần trong câu tự duyệt đổi/trả.
  - 4 mẫu thông báo trong `seed.ts` bỏ "Vui lòng".
  - Chữ "nhãn" nghĩa thương hiệu còn sót ở Trang chủ và PDP hai app ("Xem sản phẩm thương hiệu X", "{n} thương hiệu Việt").

Ảnh trước/sau của từng gói nằm ngoài git, ở `screens/<gói>/` của worktree gói (`.claude/worktrees/shop-M3`, `shop-M4`).

## 2. Deploy (việc chủ quyết)

- Không có migration mới.
- API đổi hai loại:
  - Chữ lỗi và chữ thông báo khách đọc. Câu nào Mini bản cũ còn so khớp thì giữ nguyên.
  - Thêm endpoint `GET /flash-sales/me/allowance`. Mini và web bản cũ không gọi endpoint này. Bản mới gặp API cũ thì coi như không có số theo khách, chạy như đợt 7.
- `seed.ts` có 4 mẫu thông báo khách đổi chữ. Mẫu `createOnly` đã có trong DB PROD thì không đổi khi chạy seed (xem §5).
- Khách Mini App chỉ thấy thay đổi sau khi build và tải bản Mini mới lên Zalo.

## 3. Quyết định thay chủ (chủ giao "tự chốt thiết kế"; muốn đổi thì báo)

- **Giọng chữ:**
  - "Vui lòng X." thành "Bạn X nhé." hoặc câu mệnh lệnh ngắn ("Nhập tên ngân hàng.").
  - "chúng tôi" thành "Tubu".
  - Lỗi chung: "Đã có lỗi xảy ra. Bạn thử lại nhé."
  - Ô bắt buộc: "Bạn điền giúp Tubu mục này nhé".
- **Thanh ngữ cảnh Gian hàng CTV:** "Đang xem gian hàng", không để "Gian hàng" trơn, vì đứng cạnh "Về Tubu Tree" thì chữ trơn mất nghĩa.
- **Hàng danh mục:** giữ 5,5 cột ló mép, chữ siết -0,04em. Tên dài quá 2 dòng thì "…" ("Nông sản & Thực…" khi có từ 11 danh mục). Không cho chữ hai ô chạm nhau.
- **Tên mã admin đặt:** hàng riêng dưới điều kiện. Phiếu cao thêm khi tên dài.
- **Khách đã hết suất Giờ vàng:** giá lớn ở đầu PDP, đầu sheet và chip vẫn là giá Giờ vàng (giá của đợt). Nút, tổng tiền và ghi chú theo số của khách.

## 4. Giới hạn còn lại

- **Cố ý để nguyên:**
  - "cửa hàng" nghĩa điểm bán hoặc điểm nhận thật (Đổi rác, đại lý, sổ điểm): chưa chốt tách nghĩa với Gian hàng.
  - Văn bản pháp lý ("chúng tôi" là chủ thể ký): đổi phải chủ duyệt nội dung.
  - Hộp báo bỏ món combo: khi hai bộ chung một món, số tiền mất giảm là cận trên (báo dư, không báo thiếu).
  - Danh sách Giờ vàng ở client có thể cũ vài chục giây.
- **Giờ vàng theo khách:**
  - Trên PDP (ngoài sheet), ghi chú hết suất hiện khi số về. Số về muộn thì phần dưới ô Số lượng nhích xuống một lần. Sheet có giữ chỗ; PDP thì không, vì giữ chỗ cho mọi khách đăng nhập sẽ để một dòng trống ở đa số trang.
  - Chữ "Bạn không còn suất…" dùng cho mọi trường hợp số suất bằng 0, kể cả người tạo đợt (máy chủ cũng trả 0).
- **Trình dựng CTV:** CTV bậc thấp nhất, chưa được duyệt, vào thẳng bằng liên kết (chưa có cache bậc từ trang CTV) thì hàng huy hiệu thu lại một lần, khoảng 30px.
- **Bộ quét chữ cấm:**
  - "nhãn" đứng một mình không bị bắt (chỉ bắt "Nhãn hàng", "theo dõi nhãn", "nhãn này").
  - Ở đoạn giữa và cuối của chuỗi template, từ viết thường được coi là mã khi dính `_ - / . =`.
- **Chữ client lặp lại câu API:** `checkout-rules.ts` hai app, `order-actions` chưa khớp từng chữ với câu API mới. Nghĩa vẫn đúng.
- **E2E:** `bundles-cls.miniapp` chập chờn khi máy tải nặng (đỏ cả ở base 173de56b3, mỗi lần một ca).

## 5. Việc của chủ

- **Quyết deploy:** main sau khi PR đợt 8 merge.
- **Tải bản Mini App mới lên Zalo (Testing),** nếu muốn khách Mini thấy thay đổi.
- **Mẫu thông báo trên PROD:** 4 mẫu ORDER_AWAITING_PAYMENT, ORDER_UNDERPAID, SUBSCRIPTION_PAUSED, SUBSCRIPTION_ORDER_AWAITING_PAYMENT có thể còn "Vui lòng" trong DB. Sửa ở trang quản trị mẫu thông báo, hoặc cho phép đọc PROD để kiểm.
- **Xem lại các quyết định ở §3.**
- **Còn từ `handoff-wave7.md` §5 và `handoff-wave6.md` §5:**
  - Duyệt độ lệch §5 của F9.
  - Gán danh mục 2 cấp và ảnh thật cho sản phẩm.
  - Xem lại tỉ lệ hoa hồng CTV khi có combo.
