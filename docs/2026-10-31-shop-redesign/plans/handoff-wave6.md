# Bàn giao đợt 6 (MINOR sau review của F10, 38 P2 của bước chốt, MINOR của chính đợt 6)

Đợt 6 không thêm chức năng mới. Đợt này sửa những gì review để lại sau đợt 4b–5b (xem `handoff-wave4b-4f.md` §5) và `review/final-critique.md` (38 P2). Mỗi gói đi theo vòng: agent làm, reviewer Opus xem, agent sửa. Gói đường tiền được review 2 lượt. Không deploy: deploy là việc chủ quyết.

## 1. Đã có gì

PR #113 (main `dcade9c64`):
- **G1 mã và Ưu đãi:**
  - Chữ mã không còn "Tặng 20k đồng". Tên mã có số riêng (vd "cho 3 đơn") không bị coi là nhắc lại mã.
  - Chấm đỏ Ưu đãi chỉ đánh dấu mã đã vẽ. Phiếu mã cao đều (88–98px).
  - Mẫu "Tất cả (n)" dùng chung và ẩn khi rỗng. Một nhãn liên kết Zalo.
  - Banner Ưu đãi từ lg có tỉ lệ 4:1.
- **G2 giỏ (chỉ phần hiển thị, đường tiền, 2 lượt):**
  - Giá gạch lấy từ một nguồn (`cardPricing` gọi `strikePrice`).
  - Chân dính 320px không tràn khi số tiền lớn; `scroll-padding` theo chiều cao chân dính thật.
  - "Tiết kiệm" gồm cả combo. Một nhãn "Tạm tính"/"Tạm tính (đã giảm)" ở mọi khổ, cùng chữ với Mini; bỏ chữ "Tổng" vì số này chưa gồm phí giao.
  - Số tiền khách trả không đổi.
- **G3 PDP:**
  - Giữ chip phân loại, bỏ dòng "Phân loại ›".
  - Số lượng nằm ngay dưới phân loại. Bỏ khối "Cùng nhà".
  - Rãnh "Đã bán" thấy được trên nền kem.
  - Web1280 Giờ vàng có giá ở cột thông tin.
- **H1 chữ tên mã:**
  - Chữ tiền tệ đứng sau k/tr ("20k vnđ", "20k đồng") được tính là một phần của con số.
  - "Đồng hành/loạt/giá/ý…" vẫn là chữ thường. Danh sách từ ghép nằm ở `DONG_COMPOUNDS` trong `commerce/voucher.ts`; gặp từ ghép mới thì thêm vào đó.
- **G4 Trang chủ:**
  - Mua lại chống trùng với Giờ vàng theo phân loại (xem §3).
  - Kệ Bán chạy nhất hụt hạng thì huy hiệu không ghi số.
  - "Hành trình nguyên liệu" và "Cộng đồng hỏi đáp" dùng `SectionHeader`.
  - Lời chào bằng tên gọi (`givenName`).
  - `HOME_BEST_SELLER_LIMIT` tăng từ 12 lên 24 (API và app-core cùng giá trị, có spec đọc file API).
  - Ghi chú "Tối đa n/khách" có câu đọc riêng.
- **G5 duyệt/danh mục:**
  - Pager số ẩn ở điện thoại (sr-only, giữ cho SEO).
  - Hub có hơn 8 danh mục: "Xem tất cả" ở tiêu đề khối, cột 5,5 ló mép.
  - Ẩn dòng thương hiệu khi tên sản phẩm đã chứa tên đó.
  - Mũi tên kệ ẩn ở đầu và cuối kệ. Không lặp h1/h2 "Danh mục".
  - Ảnh chiến dịch giữ tỉ lệ 5:2.
- **G6 trình dựng và trang shop:**
  - Vùng chạm 44px không chiếm chỗ trên giao diện.
  - Nút tắt cùng màu ở hai app. Nút icon Mini căn giữa.
  - Thanh dính có hai nút bằng nhau. "Thêm ảnh bìa" mở sheet hồ sơ.
  - Web1280: hai nút lên hàng tiêu đề, ComboCard có trần bề rộng, kệ ít món vẽ thành lưới.

PR #114 (nháp tới khi CI xanh):
- **H2 MINOR G2/G3:**
  - Ô chọn giỏ web rộng 24px, cách ảnh 12px như Mini.
  - Thanh miễn phí giao dùng token chung `--color-track` / `--color-progress-fill-from`.
  - PDP web bỏ đường kẻ thừa.
  - Sao đọc theo vi-VN.
  - Tách e2e PDP 375px. Sửa ca Theo dõi nhãn hàng bị chập chờn trên CI.
- **Chữ "mã giảm giá":** đã đổi trong chữ Mua chung (cả nút) và ở Ưu đãi. Trong `EXEMPT` chỉ còn nhãn ô vòng quay "Mã giảm".
- **H3 MINOR 6b:**
  - Tên gọi bỏ từ chỉ có số.
  - Mua lại loại mọi phân loại của các sản phẩm kệ Giờ vàng đang vẽ, logic ở `flashExcludedVariations` (`merch/home-shelves.ts`).
  - Pager 375 không còn dải trống. Nhãn danh mục tối đa 2 dòng.
  - Kệ ít món ở lg dùng lưới Sản phẩm.
  - Nút trình dựng lg ẩn/hiện bằng CSS, không còn nháy.
  - Có e2e kiểm tương phản nút tắt.

Ảnh trước/sau của từng gói nằm ngoài git, ở `screens/<gói>/` của worktree tích hợp.

## 2. Deploy (việc của chủ quyết)

- Không có migration mới trong đợt 6.
- API chỉ đổi một hằng số, `HOME_BEST_SELLER_LIMIT` = 24. Client cũ gửi limit 12 vẫn chạy: Mini chỉ dùng khối `/home` gộp khi limit khớp, lệch thì gọi request lẻ (chậm hơn một nhịp, không lỗi).
- Deploy main là mang theo cả #109 và #113 (và #114 nếu đã merge). Danh sách migration của #109 xem `handoff-wave4b-4f.md` §2.

## 3. Quyết định thay chủ (chủ giao "tự chốt thiết kế"; muốn đổi thì báo)

- **Mua lại và Giờ vàng chống trùng theo phân loại, không theo sản phẩm.** Khách đã mua Can 5L vẫn thấy Can 5L ở Mua lại khi Can 1L đang Giờ vàng. Chỉ loại phân loại của những sản phẩm kệ Giờ vàng đang vẽ (tối đa 8 sản phẩm). Sản phẩm bị cắt sau trần kệ vẫn ở Mua lại.
- **Kệ Bán chạy nhất:** khi hạng hiển thị không liền nhau từ 1 (vì kệ trên đã chiếm món), huy hiệu chỉ ghi "Bán chạy", không ghi số.
- **Lời chào:** lấy từ cuối của họ tên ("Chào An"). Tài khoản thử "Nguyễn Thị Quay Lại" ra "Lại".
- **PDP:** giữ chip phân loại, bỏ dòng "Phân loại ›". Ghi ở `01-thiet-ke.md` §5 và nhật ký `DESIGN.md`.
- **Kệ 6 món ở lg:** vẽ 5+1, giống hàng cuối của lưới Sản phẩm.

## 4. Rủi ro đã biết, giới hạn còn lại (MINOR, chưa sửa)

- Hàng danh mục 5,5 cột (hai app): ô không có đệm để "Chăm sóc" vừa cột 62px. Hai nhãn dài kề nhau chỉ cách khoảng 2–4px.
  - Thêm khe thì nhãn lại bị cắt. Muốn hết hẳn phải rút tên danh mục hoặc đổi số cột.
  - Ba nhãn vẫn bị cắt: "thiên nhiên", "Nông sản &", "Thực phẩm".
- Nhãn ô vòng quay "Mã giảm" vẫn thiếu chữ "giá" vì ô hẹp; sửa khi vẽ lại vòng quay.
- PDP:
  - Hàm nối `divider` ở `san-pham/[slug]/page.tsx` chưa có test cấp trang.
  - Nhánh e2e "sản phẩm một phân loại" chưa chạy trên DB seed vì seed luôn có sản phẩm 2 phân loại.
- G1: tên mã do admin đặt không lặp lại nhãn vẫn bị ellipsis ở khoảng 100px. Chip mã ở trang thương hiệu mất mã khi phụ đề dài hơn 2 dòng.
- Gian hàng web lg: hai bộ nút trình dựng và hai bản thẻ kệ cùng nằm trong DOM. Bản ẩn dùng `display:none` và ảnh lazy, nên không vào cây trợ năng và không tải ảnh hai lần.

## 5. Việc của chủ

- **Quyết deploy:** main gồm #109, #113, và #114 nếu đã merge.
- **Cho phép chạy `recompute-sold` trên PROD:** đây là thao tác ghi PROD.
- **Duyệt độ lệch §5 của F9:** combo chỉ chiếm món ở các kệ bên dưới; một món có thể vừa ở Mua lại vừa ở combo.
- Xem các quyết định ở §3.
- Gán danh mục 2 cấp và ảnh thật cho sản phẩm.
- Combo làm giảm hoa hồng CTV: xem lại tỉ lệ nếu cần.
