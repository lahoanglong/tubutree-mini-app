# D3: Kênh bán của đại lý/CTV, gian hàng và listing sản phẩm

Ngày 2026-10-17. Đọc mã ở worktree `launch-review` (cùng cây với main 0cc2fe62). Chỉ đọc mã, không chạy build/test/trình duyệt.
Phạm vi: `apps/api/src/modules/{affiliate,dealer,storefront,merchant,brand,pricing,content-kit,cashback}`, web `/s`, `/merchant`, `/brand`,
miniapp `affiliate`, `dealer`, `storefront-*`, `brand-*`, cùng 2 spec CTV-storefront (2026-06-26) và merchant-fulfilment (2026-10-14).
Mã `A5-xx` là mã của `docs/audit-2026-09/05-ctv-dealer-staff.md`. Mục nào ghi "VẪN CÒN" thì đã kiểm lại trên mã hiện tại.

## 1. Tóm tắt

- **Mức hoàn thiện ước tính khoảng 60%.** Phần tiền làm kỹ: hoa hồng, thuế TNCN, công nợ, đối soát đối tác, chống race. Gian hàng
  CTV và cổng đối tác tự giao chạy được từ đầu đến cuối. Phần còn yếu là những thứ giúp CTV/đại lý tự bán, và công cụ admin để quản kênh.
- **Lỗ hổng 1 (P0): không có chỗ nào nhập % hoa hồng** (`Variation.affiliateRate`). Sync Pancake không ghi trường này, admin cũng
  không có UI hay API để nhập. Vì vậy với catalog thật CTV nhận 0đ trên mọi đơn: không tạo dòng hoa hồng, không báo CTV, bậc và mốc
  thưởng đứng yên (D3-01).
- **Lỗ hổng 2 (P1): gian hàng công khai không ai kiểm duyệt.** CTV đăng ký một chạm là có gian hàng mang tick xanh,
  "CTV tuyển chọn" và "100% Chính hãng"; tiêu đề, ảnh và subdomain đặt tuỳ ý. Admin không có danh sách gian hàng để gỡ, và khoá
  tài khoản cũng không ẩn gian hàng (D3-02).
- **Lỗ hổng 3 (P1): kênh bán online của đại lý chưa khép.** Miniapp không có lối vào Cổng người bán. Hàng Tubu "bán lại" trong gian
  hàng đại lý không ghi công cho đại lý. CTV lên đại lý thì mất màn hoa hồng, tiền hoa hồng còn lại không rút được qua giao diện.
  Đơn sỉ không có đơn tối thiểu, Tubu chịu phí giao và hạn nợ NET không được áp (D3-03, D3-04, D3-05).
- Việc admin phải làm tay mỗi ngày gồm: duyệt hồ sơ đại lý, xác nhận chuyển khoản đơn sỉ, chuyển tiền từng lệnh rút, lập phiếu đối
  soát, soạn content kit cho từng sản phẩm. Danh sách đầy đủ ở mục 1.3.

### 1.1 Các vai trò trong mã và việc mỗi vai trò làm được

| Việc | CTV (`AFFILIATE`) | Đại lý (`DEALER`) | Đối tác tự giao (gian hàng `MERCHANT` hoặc `isPartner`) | Chủ nhãn (`Brand.ownerUserId`) |
|---|---|---|---|---|
| Đăng ký, duyệt | Một chạm, chỉ tick điều khoản, không KYC, không duyệt (`affiliate.service.ts:108-133`) | Hồ sơ doanh nghiệp + CCCD 2 mặt (`dealer.dto.ts:50-63`); admin duyệt và chọn bậc (`admin.service.ts:240-286`) | Không có hồ sơ riêng: có khi được duyệt đại lý hoặc admin bật cờ (`partner-store.ts:3-12`, `merchant-admin.controller.ts:104`) | Admin dán userId vào nhãn (`brand.service.ts:225-230`) |
| Gian hàng `/s/<slug>` | Có, slug = mã giới thiệu viết thường (`storefront.service.ts:57-75`). Dựng ở miniapp `/storefront` hoặc web `/merchant` | Không có ở miniapp (`storefront.service.ts:57`). Web `/merchant` tự tạo gian hàng `MERCHANT` (`merchant.service.ts:365`) | Như cột đại lý | Trang `/brand/<slug>` do admin dựng |
| Listing | Chỉ chọn sản phẩm Tubu đang bán (`storefront.service.ts:183-215`); không tự đăng (`merchant.service.ts:235`) | Tự đăng sản phẩm, chờ admin duyệt; "bán lại" sản phẩm Tubu | Tự giao, hoặc "Tubu giao hộ" qua mã Pancake | Không tự thêm: admin gắn sản phẩm (`brand-admin.controller.ts:34-45`) |
| Giá | Giá lẻ, combo của gian hàng ≤ `storefront.max_combo_pct` | Giá sỉ = giá lẻ × (1 − 20–45%) hoặc giá riêng theo bậc (`dealer.service.ts:1491-1511`) | Tự đặt giá lẻ (≥1.000đ) | Tạo khuyến mãi gắn mã |
| Đặt đơn hộ khách | Có, COD hoặc chuyển khoản, đơn ghi `userId` = CTV (`affiliate.service.ts:623-760`) | Không (`affiliate.service.ts:500`); chỉ đặt đơn sỉ cho chính mình, có thể chọn địa chỉ nhận khác | Không | Không |
| Chia sẻ, content kit | QR trên màn hình, chia sẻ Zalo, chép link web, 3 caption; content kit theo sản phẩm (`content-kit.controller.ts:7`) | Không có content kit | Link `/s/<slug>` ở `/merchant` | Banner share-to-earn hiện cho CTV xem trang nhãn |
| Thu nhập | Hoa hồng theo `affiliateRate` từng biến thể; mốc tháng trả bằng Điểm Xanh | Lãi bán lẻ ngoài hệ thống; thưởng quý trừ vào công nợ (`dealer.service.ts:1218-1260`); thưởng mốc (tour/quà) | Tiền hàng trừ phí sàn 15% (`merchant-config.ts`) | Không |
| Rút tiền | Rút hết số dư: vào Ví 1:1 hoặc về ngân hàng ≥50k, khấu trừ TNCN 10% từ 2 triệu (`affiliate.service.ts:943-1140`) | Không có (không phải ví) | Admin lập phiếu đối soát rồi chuyển tay | Không |
| Báo cáo | Dashboard, theo gian hàng, theo sản phẩm, thống kê 30 ngày, bảng kê thuế | Báo cáo quý, tiến độ thưởng, sổ công nợ | KPI, đơn qua gian hàng, đối soát | Doanh thu nhãn (`brand.controller.ts:50-53`) |
| Khách của mình | Chỉ "khách gần đây" lưu trên máy (`ctv-order-sheet.tsx:94`) | Không | Thấy người nhận của đơn mình giao | Không |
| Giao hàng | Tubu giao (Pancake) | Tubu giao đơn sỉ; còn thiếu hàng thì giữ lại chờ đối soát tồn | Tự giao, nhập mã vận đơn tay; SLA nhắc mỗi giờ (`merchant-sla.cron.ts:38`) | Tubu giao |

Cashback sàn ngoài (`cashback/*`, AccessTrade) đang tắt cứng (`apps/miniapp/src/utils/features.ts:10`). Tính năng này kéo khách sang
sàn, ngược mục tiêu 1, nên nên giữ tắt.

### 1.2 Đi thử: một CTV và một đại lý từ đăng ký tới nhận tiền

**CTV mới**
1. Vào Hồ sơ → Cộng tác viên, tick điều khoản, thành `AFFILIATE` ngay. Bước này ổn.
2. Bấm "Gian hàng của tôi", chọn mẫu theo danh mục (8 sản phẩm, `storefront.service.ts:451-489`) hoặc tự thêm, sửa hồ sơ, rồi Đăng.
   **Gãy:** % hoa hồng là 0 với mọi sản phẩm thật nên badge "+%HH" không hiện (`storefront-builder.tsx:730`). Mẫu không lọc sản
   phẩm chưa duyệt (D3-16). Ô subdomain hứa `ten-ban.tubutree.com` trong khi DNS còn chờ (D3-11).
3. Chia sẻ. **Thiếu:** builder không có nút chia sẻ, phải vào "Xem trước" rồi bấm "Chia sẻ gian hàng". QR chỉ xem được trên màn,
   không lưu hay in được. "Tạo link" không đếm được click (D3-06, D3-08).
4. Khách mua. Đơn được ghi công theo thứ tự: mã giới thiệu, rồi slug gian hàng CTV, rồi "chạm" giới thiệu còn hạn 7 ngày
   (`attribution.ts:13-39`). Hoa hồng tạo trong cùng transaction với đơn (`checkout.service.ts:631`). **Gãy:** hoa hồng 0đ thì
   `amount <= 0 → return` (`affiliate.service.ts:871`): không có dòng hoa hồng, không báo CTV, quest "đơn đầu tiên" cũng không đạt.
5. Nhận tiền (khi đã có %). Đơn giao xong thì hoa hồng `LOCKED`, sau max(`hold_days` 20, hạn đổi trả 7) thì `APPROVED`
   (`affiliate.service.ts:1150-1180`, `seed.ts:55`). Rút về Ví thì có ngay. Rút về ngân hàng thì phải gõ lại STK mỗi lần, admin
   duyệt, chuyển tay rồi đánh dấu đã chi. Từ lúc giao tới lúc có tiền ngân hàng mất từ 3 tuần trở lên (D3-14).

**Đại lý mới**
1. Vào Hồ sơ → Đăng ký đại lý, gửi hồ sơ kèm ảnh CCCD. Admin nhận báo (`dealer.service.ts:114-140`).
2. Admin vào web, tab Đại lý: xem ảnh, chọn bậc, duyệt; đại lý nhận thông báo (`admin.service.ts:296-303`). **Tay:** KYC bằng mắt.
3. Đại lý đặt sỉ trong miniapp. Mua chịu chỉ được trong hạn mức, và Cấp 1 có hạn mức 0 (`seed.ts:338`). Trả trước thì sang màn QR.
   **Tay:** đơn trả trước có hàng đặt trước không lên Pancake nên Pancake không tự đối soát được, admin phải bấm xác nhận
   (`dealer-admin.controller.ts:71-78`); trả nợ cũng do admin ghi nhận (`:96-118`). **Thiếu:** không có đơn tối thiểu, phí giao luôn
   bằng 0 (D3-05).
4. Có gian hàng. **Gãy:** miniapp và thông báo duyệt (`seed.ts:824`) không nhắc tới Cổng người bán, cả repo không có link nào tới
   `/merchant`. Đại lý phải tự biết mở `app.tubutree.com/merchant` và đăng nhập Zalo trên web. Ở đó gian hàng `MERCHANT` tự tạo
   sẵn, đã đăng, chỉ có 1 bộ sưu tập rỗng.
5. Bán đơn đầu. Hàng sỉ đã mua thì đại lý bán ngoài hệ thống. Bán online được 2 cách, cả hai lệch kinh tế: "bán lại" sản phẩm Tubu
   thì Tubu giao và Tubu thu tiền, đại lý không được gì; tự đăng lại sản phẩm (nội dung trùng catalog, chờ duyệt) thì tự giao và chịu
   phí sàn 15% dù đã mua sỉ (D3-04).
6. Nhận tiền. Đơn tự giao COD thì đại lý thu trực tiếp. Phiếu đối soát do admin lập, chuyển tay rồi đánh dấu (`merchant-admin.controller.ts:72-92`).
   Thưởng quý tự trừ vào công nợ, còn thưởng mốc tour/quà thì admin duyệt rồi trao ngoài hệ thống.

### 1.3 Việc admin còn làm tay (mục tiêu 5)

| Việc | Có màn hình? | Tần suất khi chạy thật |
|---|---|---|
| Duyệt hồ sơ đại lý, KYC CCCD, chọn bậc | Có (tab Đại lý) | Theo hồ sơ |
| Xác nhận chuyển khoản đơn sỉ trả trước; ghi nhận đại lý trả nợ | Có | Hằng ngày |
| Duyệt lệnh rút hoa hồng, chuyển khoản tay từng lệnh, nhập mã giao dịch | Có, nhưng không xuất được file chuyển khoản hàng loạt | Hằng ngày |
| Lập phiếu đối soát đối tác, chuyển tay, thu phiếu âm | Có (Đơn đối tác & đối soát) | Hằng tuần |
| Duyệt sản phẩm đối tác, xác nhận liên kết "Tubu giao hộ" | Có | Theo sản phẩm |
| Soạn content kit cho TỪNG sản phẩm, soạn academy | Có, nhưng chưa có nội dung seed | Mỗi khi có sản phẩm mới |
| Nhập % hoa hồng cho sản phẩm | **Không có** (D3-01) | Phải có trước ra mắt |
| Tra đơn X do CTV nào giới thiệu, chỉnh hoa hồng khi khách quên mã | **Không có** (D3-07) | Theo khiếu nại |
| Gỡ gian hàng vi phạm | **Không có** (D3-02) | Theo sự cố |
| Gán chủ nhãn bằng userId, gắn sản phẩm vào nhãn | Có, nhưng phải dán ID | Ít |

### 1.4 Gian hàng `/s/<slug>` có dùng được như một kênh bán thật không

| Tiêu chí | Hiện trạng (bằng chứng) | Đánh giá |
|---|---|---|
| SEO | Có title/description (`s/[slug]/page.tsx:22-50`); sitemap liệt kê 500 gian hàng đã đăng (`storefront.service.ts:326-334`, `sitemap.ts:34-37`); robots cho phép `/s`. Không có canonical, không JSON-LD; gian hàng rỗng cũng vào sitemap | Tạm được |
| OG khi chia sẻ Zalo/Facebook | `og:image` là ảnh sản phẩm đầu tiên, rồi mới tới ảnh bìa (`page.tsx:30`), không có thẻ riêng kiểu avatar + tên gian hàng. Ảnh bìa/avatar có thể là base64 tới 1,5MB khi thiếu Cloudinary (`storefront.controller.ts:12`), lúc đó không dùng được làm `og:image` | Yếu (D3-10) |
| Tốc độ | ISR 300 giây (`page.tsx:20`). API công khai không cache (`storefront.controller.ts:98`, khác `brand` có `@PublicCache`), mỗi lượt xem còn tính bậc CTV bằng một truy vấn gộp. Ảnh dùng `<img>` thô, không resize, không width/height (`page.tsx:85,110,251`). Chưa đo vì luật không cho build | Chưa đo, có rủi ro |
| Trang sản phẩm | Ô sản phẩm dẫn sang `/san-pham/<slug>` chung (`page.tsx:245`): mất ghi chú của CTV, không có thanh "về gian hàng" (miniapp có `storefront-context-bar.tsx`) | Thiếu (D3-09) |
| Giỏ, thanh toán | Giỏ và checkout dùng chung. Bối cảnh gian hàng nằm trong sessionStorage cộng "chạm" 7 ngày (`storefront-context.ts`, `storefront-tracker.tsx`); checkout web gửi `referralCode` (`thanh-toan/page.tsx:196`) | Ổn |
| Ghi công đúng đại lý | CTV: tốt, có test parity web/miniapp. Gian hàng `MERCHANT` của đại lý: không ghi công cho chủ, và có thể rơi về "chạm" của một CTV khác (`attribution.ts:26-36`) | Lệch (D3-04) |
| Mobile | Lưới 2 cột, chữ dùng token tương phản, vùng chạm hotline ≥44px. Chưa kiểm trên máy thật | Chưa kiểm |
| Niềm tin | Mọi gian hàng đều có tick xanh và 4 cam kết tĩnh (`page.tsx:125,137,202-225`), kể cả CTV chưa ai duyệt | Rủi ro (D3-02) |
| Liên hệ người bán | Không có nút nhắn Zalo hay gọi CTV, mà CTV chốt đơn chủ yếu qua chat | Thiếu (mục 3) |

## 2. Bảng phát hiện

| ID | Mức | Vai trò bị ảnh hưởng | Hiện trạng + bằng chứng | Đề xuất | Công sức | Cần chủ dự án quyết? |
|---|---|---|---|---|---|---|
| D3-01 | P0 | đại lý/CTV, marketing, admin | Không có đường nhập `Variation.affiliateRate`. Schema ghi "import Excel" (`schema.prisma:715`) nhưng không có bản import nào. Sync Pancake tạo biến thể mà không ghi rate (`pancake-sync.service.ts:411-434`). Ngoài test và migration demo `20260616000000_demo_catalog_multibrand`, không chỗ nào ghi trường này; khoá `affiliate.product_rate_source` đã bị đánh dấu chết (`dead-config-keys.ts:14`). Hệ quả: hoa hồng 0đ thì không tạo dòng (`affiliate.service.ts:871`); nền doanh số bậc/mốc chỉ tính dòng có rate > 0 nên bậc và mốc không bao giờ lên; share-to-earn trên trang nhãn hiện 0%; điều khoản CTV hứa "tỷ lệ hiển thị trong ứng dụng" (`vi.ts:606`) | Tab admin sửa % theo sản phẩm/biến thể, cộng nhập CSV hàng loạt. Thêm khoá `affiliate.default_rate` để dùng khi rate null. Kiểm go-live: báo đỏ khi % biến thể đang bán có rate > 0 bằng 0. Hiện % trên trang sản phẩm khi người xem là CTV | M | Y: % mặc định bao nhiêu, nhóm hàng nào loại trừ? (Q2) |
| D3-02 | P1 | khách, marketing, admin, CSKH | Gian hàng không qua kiểm duyệt (A5-23 VẪN CÒN). CTV một chạm có trang công khai với tick xanh, "CTV tuyển chọn", "100% Chính hãng" (`s/[slug]/page.tsx:125,137,210`); tiêu đề/ảnh tự do; subdomain chỉ cấm 17 từ (`identifier-validation.ts:14-17`), không cấm tên nhãn, `cskh`, `hotro`, `khuyenmai`, `zalo`, `hello`. Admin không có danh sách hay nút gỡ gian hàng: `admin/storefronts` chỉ có `:id/partner` (`merchant-admin.controller.ts:98-104`). Khoá tài khoản không ẩn gian hàng vì `getPublicBySlug` chỉ lọc `isPublished` (`storefront.service.ts:221-233`); chỉ xoá tài khoản mới gỡ đăng (`account-deletion.service.ts:328`) | Tab admin "Gian hàng": danh sách, xem, gỡ đăng kèm lý do và báo chủ. Ẩn gian hàng của chủ bị khoá. Thêm từ cấm. Tick "tuyển chọn" chỉ hiện khi admin đã duyệt gian hàng | M | Y: gian hàng CTV có cần duyệt trước khi công khai? (Q3) |
| D3-03 | P1 | đại lý, kế toán | CTV được duyệt đại lý thì mất màn hoa hồng (A5-25 VẪN CÒN). Gian hàng giữ loại CTV để vẫn hưởng hoa hồng (`partner-store.ts:3-6`, `attribution.ts:26`), nhưng `/affiliate/me` trả `isAffiliate=false` cho `DEALER` (`affiliate.service.ts:140`). Miniapp vì vậy hiện màn đăng ký (`affiliate.tsx:127`), mà đăng ký lại bị chặn (`affiliate.service.ts:110`). Hoa hồng tiếp tục cộng nhưng không xem, không rút được qua giao diện; picker và lên đơn hộ cũng chặn `DEALER` (`storefront.service.ts:186`, `affiliate.service.ts:500`) | Cho `isAffiliate` đúng với `DEALER` có gian hàng CTV hoặc có hoa hồng; mở picker và dashboard cho họ. Lâu dài: tách quyền CTV khỏi `User.role` | S | N |
| D3-04 | P1 | đại lý | Mô hình bán online của đại lý chưa khép. (a) Không có link nào tới `/merchant` trong web hay miniapp (`site.ts:14,20` chỉ khai đường riêng tư), thông báo duyệt chỉ nói "bảng giá sỉ" (`seed.ts:824`). (b) Gian hàng `MERCHANT` "bán lại" hàng Tubu không ghi công cho chủ (`attribution.ts:26` chỉ xét loại CTV); đơn còn có thể rơi hoa hồng cho CTV khác qua "chạm" (`attribution.ts:30-36`); `ShareSheet` gửi `referralCode=null` cho loại này (`storefront-view.tsx:105`). (c) Muốn bán hàng sỉ đã mua thì phải tự đăng lại sản phẩm (trùng catalog, chờ duyệt), tự giao, chịu phí sàn 15% | Chốt mô hình (Q1). Bất kể chọn gì: thêm mục "Gian hàng của tôi" trong `/dealer` mở web `/merchant`, và ghi rõ trong thông báo duyệt | M–L | Y (Q1) |
| D3-05 | P1 | kế toán, kho, admin | Đơn sỉ: `minOrderVolume` (10–200 triệu, `seed.ts:337-341`) chỉ để hiển thị, `dealer.service.ts` không kiểm. Phí giao luôn 0 (`dealer.service.ts:304`). `paymentTerms` NET 15/30 không áp, không nhắc nợ quá hạn. Câu hỏi MOQ/NET đã nêu ở `audit-2026-09/00-MASTER-SUMMARY.md:250` nhưng chưa có quyết định. Hệ quả: đại lý Cấp 1 đặt một món được giảm 20% mà Tubu vẫn chịu phí ship | Thêm khoá `dealer.min_order_value`, phí giao đơn sỉ theo ngưỡng, nhắc nợ trước hạn và khoá mua chịu khi quá hạn | S–M | Y (Q4) |
| D3-06 | P1 | CTV | Link chia sẻ có đếm click thực ra không đếm gì (A5-16 VẪN CÒN). `trackClick` (`affiliate.service.ts:228`) không ai gọi, không có route `/r/`, tham số `l=` (`affiliate.tsx:731`) không được đọc, chỉ tạo được link trang chủ (`:342`). Màn đăng ký hứa "theo dõi click & chuyển đổi" (`:147`) còn danh sách luôn hiện "0 click · 0 đơn" | Thêm route web `/r/[code]`: gọi `trackClick`, đặt `ref`, chuyển tiếp. Cộng `conversions` khi đơn mang mã link. Cho tạo link theo sản phẩm hoặc gian hàng. Chưa làm kịp thì gỡ câu hứa | S–M | N |
| D3-07 | P1 | CSKH, admin, kế toán | Không tra được ai giới thiệu một đơn và hoa hồng bao nhiêu. Admin không có endpoint commission hay danh sách CTV; chi tiết đơn trên web không hiện người giới thiệu (`components/admin/order-detail-extras.tsx`); khách quên mã thì không có công cụ gán lại | Thêm khối "Giới thiệu & hoa hồng" ở chi tiết đơn (CTV, gian hàng, nguồn ghi công, trạng thái hoa hồng). Tab "CTV": danh sách, doanh số đã chốt, hoa hồng chờ/rút được, khoá CTV. Gán người giới thiệu thủ công có ghi vết | M | N |
| D3-08 | P1 | CTV | Builder miniapp không có nút Chia sẻ dù dòng chữ nhắc "chia sẻ link để bắt đầu bán" (`storefront-builder.tsx:604`), và không có "Gỡ đăng" vì publish luôn gửi `true` (`:226`) (A5-39 VẪN CÒN). Có 2 trình dựng song song (miniapp `/storefront`, web `/merchant`, C-096); web tạo gian hàng ĐÃ ĐĂNG ngay dù còn rỗng (`merchant.service.ts:365-376`) và gian hàng đó vào sitemap | Thêm nút Chia sẻ (dùng lại `ShareSheet`) và nút Gỡ đăng vào builder. Gian hàng tạo từ web để nháp cho tới khi có ≥1 sản phẩm | S | N |
| D3-09 | P2 | khách, CTV | Web `/s` dùng ô sản phẩm riêng (`page.tsx:227-290`) nên thiếu những gì miniapp đã có: ghi chú của CTV cho từng món; lớp phủ "tạm hết hàng" dù API trả `inStock` (`storefront.service.ts:312`); thanh "về gian hàng" khi đã sang trang sản phẩm. Gian hàng không còn món nào hiển thị thì không có empty-state (spec §11) | Dùng `ProductCard` (đã xử lý hết hàng), hiện `note`, thêm thanh bối cảnh gian hàng trên web, thêm empty-state dẫn về catalog | S | N |
| D3-10 | P2 | marketing, CTV | OG và tốc độ: ảnh chia sẻ là ảnh sản phẩm đầu tiên (`page.tsx:30`); không có canonical; ảnh bìa/avatar base64 khi thiếu Cloudinary (giới hạn 1,5MB ở `storefront.controller.ts:12`; go-live đã cảnh báo ở `env-checks.ts:309-324`) nằm thẳng trong HTML/JSON; `<img>` thô không resize; API công khai không cache | Thêm `opengraph-image` động theo gian hàng (avatar, tên, 3 ảnh sản phẩm). Resize ảnh qua Cloudinary hoặc `next/image`. Gắn `@PublicCache` cho `storefront/public/:slug`. Bắt buộc Cloudinary cho ảnh gian hàng | S–M | N |
| D3-11 | P2 | CTV, đại lý | Subdomain và tên miền riêng được quảng bá dù chưa chạy: `xxx.tubutree.com` hiện ở builder (`storefront-builder.tsx:906-911`), ở trang web (`page.tsx:150`) và ở `/merchant`, trong khi DNS wildcard còn chờ. Tên miền riêng nhập được nhưng middleware không xử lý (`middleware.ts:22-27`), `GET /storefront/by-host` không ai gọi. Host có ≥3 nhãn (ví dụ preview `*.vercel.app`) bị coi là gian hàng nên trang chủ bị rewrite sang `/s/<nhãn>` (`:39`) | Bật subdomain bằng cờ cấu hình khi DNS + SSL xong; ẩn ô tên miền riêng; middleware chỉ nhận subdomain của root domain đã cấu hình | S | Y (Q6) |
| D3-12 | P2 | CTV, khách | Combo chỉ có ở phía server: API và checkout hỗ trợ (`combo.service.ts`, `storefront.controller.ts:42-47`), nhưng không UI nào tạo được combo (tìm "combo" trong `storefront-builder.tsx` và `merchant/page.tsx` ra 0 kết quả), và trang gian hàng web/miniapp không hiện "Combo −X%" | Làm UI tạo combo (≥2 sản phẩm, % ≤ `storefront.max_combo_pct`) kèm nhãn trên trang, hoặc tắt hẳn cho bản ra mắt | S–M | Y (Q7) |
| D3-13 | P2 | CTV, marketing, admin | Content kit: admin phải soạn cho từng sản phẩm (`content-kit.service.ts:78-90`), chưa có nội dung seed nên sản phẩm chưa soạn hiện rỗng. Ảnh chỉ để xem, không có nút lưu (`content-kit-sheet.tsx:100-110`). Khoá `app.miniapp_base_url` (`content-kit.service.ts:50`) không được seed và admin không đặt được (`admin.service.ts:1252` từ chối khoá lạ); miniapp tự chữa bằng `absoluteLink` (`content-kit-sheet.tsx:24-27`). Đại lý không dùng được content kit (`content-kit.controller.ts:7`) | Nội dung mặc định sinh từ mô tả và USP sản phẩm; nút "Lưu ảnh" (`saveImageToGallery` của ZMP); bỏ khoá chết hoặc seed nó; mở content kit cho DEALER | M | N |
| D3-14 | P2 | CTV, kế toán | Rút hoa hồng: phải gõ lại STK mỗi lần (`affiliate.tsx:975`); admin chuyển từng lệnh, không xuất được file chuyển khoản hàng loạt (`payout-admin.controller.ts`); thời gian giữ = max(20, 7) ngày sau giao (`seed.ts:55`, `affiliate.service.ts:1243-1252`) | Lưu STK đã dùng vào hồ sơ CTV; xuất CSV lệnh chuyển theo mẫu ngân hàng; cân nhắc giảm `hold_days` | S | Y (Q5) |
| D3-15 | P2 | CTV, khách | Không có "Khách của tôi" (A5-13 VẪN CÒN): chỉ có khách gần đây lưu trên máy (`ctv-order-sheet.tsx:94`); đơn hộ vẫn ghi `userId` = CTV (`affiliate.service.ts:695`, A1-011 còn mở). CTV không chăm khách mua lại được | Xem mục 3, đề xuất 6 | M–L | N |
| D3-16 | P3 | CTV | Mẫu gian hàng không lọc `approvalStatus` (`storefront.service.ts:456`) trong khi picker có lọc (`:196`), nên món chưa duyệt lọt vào gian hàng mà khách không thấy | Thêm `approvalStatus: 'APPROVED'` | S | N |
| D3-17 | P3 | CTV | Miniapp lấy slug làm mã giới thiệu (`storefront-view.tsx:27,105`) thay vì `referralCode` API đã trả (`storefront.service.ts:268`), và gắn `kind:'ctv'` cho cả gian hàng `MERCHANT`. Hôm nay vẫn đúng vì slug của CTV = mã viết thường; sẽ vỡ nếu sau này cho đổi slug | Dùng `sf.referralCode`, `kind` theo `sf.type` | S | N |
| D3-18 | P3 | marketing | Mọi đơn có `storefrontSlug` đều mang `orderSource='ctv_assisted'` (`checkout.service.ts:375`), trùng nhãn với đơn CTV lên hộ (`affiliate.service.ts:710`), nên báo cáo kênh không tách được khách tự mua qua gian hàng với CTV đặt hộ | Thêm nguồn `storefront` | S | N |
| D3-19 | P3 | CTV | Web cache 300 giây cả trang lẫn dữ liệu (`page.tsx:20`, `lib/api.ts:189`), không có revalidate theo yêu cầu. CTV vừa đăng hay sửa gian hàng thì link web có thể hiện bản cũ hoặc 404 trong vài phút | Gọi revalidate khi publish/sửa, hoặc ghi chú "web cập nhật sau vài phút" | S | N |

## 3. Đề xuất tính năng mới (xếp theo giá trị trên công sức)

1. **Nhập % hoa hồng và đặt % mặc định** (D3-01). Công sức M. Không có bước này thì toàn bộ kênh CTV (mục tiêu 4) không trả được tiền.
2. **Link rút gọn có mã kèm QR in được.** `app.tubutree.com/r/<mã>` cho gian hàng, bộ sưu tập, sản phẩm; thêm nút "Tải QR"
   (PNG/PDF khổ A6, có tên gian hàng) để dán quầy, in tờ rơi, bỏ vào gói hàng đại lý gửi đi. Đếm click và đơn theo từng link.
   Công sức S–M. Phục vụ mục tiêu 4, và cả mục tiêu 1: kéo khách offline hoặc khách sàn của đại lý về mua trực tiếp.
3. **Tab admin "CTV & Gian hàng"** (D3-02, D3-07): kiểm duyệt, gỡ đăng, tra hoa hồng theo đơn, gán người giới thiệu, xếp hạng
   doanh số. Công sức M. Bớt việc tra DB và giảm rủi ro thương hiệu (mục tiêu 5).
4. **"Bài đăng hôm nay" cho CTV/đại lý.** Mỗi ngày 1–3 bài sinh từ flash sale, hàng mới, content kit, sự kiện cộng đồng; tự chèn
   tên và link `/r/`; có nút lưu ảnh và chia sẻ Zalo/Facebook; admin lên lịch trước một tuần. Công sức M. Phục vụ mục tiêu 4 và 3,
   vì CTV không phải tự soạn bài.
5. **Bảng xếp hạng CTV tháng.** Xếp theo doanh số đã chốt, chỉ hiện hạng và bậc, không hiện số tiền; thưởng top 3 bằng Điểm Xanh
   hoặc quà. Dùng lại `confirmedRevenue`. Công sức S. Phục vụ mục tiêu 4 và 3.
6. **"Khách của tôi" và nhắc mua lại qua CTV** (A5-12, A5-13). Ràng buộc khách với CTV lâu dài, danh sách khách và lần mua cuối,
   nút nhắn Zalo nhắc mua lại. Công sức M–L. Phục vụ mục tiêu 4 và 3.
7. **Academy lộ trình CTV/đại lý.** 5 bài khởi động (dựng gian hàng, chia sẻ không bị chặn spam trên Zalo, lên đơn hộ, chính sách
   hoa hồng/thuế, xử lý đổi trả) cộng checklist "tuần đầu" trong dashboard. Phần mềm đã có, chủ yếu cần soạn nội dung.
   Công sức S. Phục vụ mục tiêu 4 và 5.
8. **Nút "Nhắn Zalo cho chủ gian hàng"** trên `/s/<slug>`, CTV tự bật/tắt. Công sức S. Tăng tỷ lệ chốt đơn qua chat.
9. **Điểm nối sang `chodeli-marketing-support-system` (bán sỉ, chỉ nêu, không thiết kế sâu).** Repo này đang giữ toàn bộ nghiệp vụ
   sỉ: hồ sơ và bậc đại lý (`DealerApplication`, `DealerTier`, `User.metadata.dealerTierId`), bảng giá sỉ (`Variation.dealerPrices`
   cộng `DealerPriceHistory`), đơn sỉ (`Order.type=DEALER` đẩy Pancake), công nợ (`DealerCreditLedger`), thưởng quý/mốc. Cần chốt:
   (a) bên nào là nguồn chuẩn cho đại lý, giá sỉ và công nợ; (b) tránh hai hệ thống cùng đẩy đơn sỉ vào Pancake, làm doanh số thưởng
   bị đếm đôi hoặc bị thiếu; (c) nội dung social của repo marketing có thể đổ vào "Bài đăng hôm nay" và content kit; (d) mã link `/r/`
   và `?ref=` nên dùng chung để đo khách từ sàn/social chảy về mini-app.

## 4. Câu hỏi cho chủ dự án (kèm phương án tôi khuyên)

- **Q1. Đại lý bán online theo mô hình nào?** (A, khuyên) Đại lý là "CTV cấp cao": gian hàng bán hàng Tubu, Tubu giao, đại lý hưởng
  % hoa hồng cao hơn CTV theo bậc; hàng nhập sỉ để bán offline. (B) Cho đại lý tự giao hàng Tubu đã nhập sỉ từ kho của mình, phí sàn
  thấp. (C) Đại lý chỉ bán offline, ẩn gian hàng với đại lý không phải CTV. Chọn A thì sửa ít nhất (ghi công cho chủ gian hàng
  `MERCHANT`, thêm % theo bậc).
- **Q2. % hoa hồng mặc định khi sản phẩm chưa đặt riêng?** Khuyên 10% cho toàn catalog, chỉnh tay từng sản phẩm biên thấp, sản phẩm
  không cho CTV bán thì bật `affiliateBlocked`.
- **Q3. Gian hàng CTV có cần duyệt trước khi công khai?** Khuyên: làm CTV và chia sẻ link sản phẩm thì không cần duyệt; gian hàng
  `/s/` công khai thì admin duyệt lần đầu, hoặc ít nhất bỏ tick xanh và chữ "tuyển chọn" cho tới khi duyệt.
- **Q4. Đơn sỉ tối thiểu, phí giao, hạn nợ?** Khuyên: đơn tối thiểu 3 triệu, miễn phí giao từ 5 triệu, nhắc nợ trước hạn 3 ngày,
  khoá mua chịu khi quá hạn NET.
- **Q5. Giữ hoa hồng 20 ngày sau giao có giảm không?** Khuyên 10 ngày (hạn đổi trả 7 ngày cộng 3 ngày đệm), để CTV mới có tiền đầu
  tiên nhanh hơn.
- **Q6. Bật subdomain gian hàng lúc ra mắt?** Khuyên tắt, dùng `app.tubutree.com/s/<mã>` cộng link `/r/`, tới khi DNS wildcard và
  SSL xong; bỏ hẳn ô tên miền riêng.
- **Q7. Combo gian hàng: làm UI hay tắt?** Khuyên tắt cho bản ra mắt, làm sau khi đã có dữ liệu bán.
