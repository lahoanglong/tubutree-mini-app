# Gói P3 giaodien-quantri: Nhân sự, công cụ quản trị, giao diện chung

Gốc: main 815fa3c1e. Nguồn: các P3 reviewer Opus nêu ở đợt 28/10 (gói admin-nhansu, admin-congcu, giaodien) chưa sửa, mục làm dở, và mục còn lại trong báo cáo cuối.

Với mỗi mục: kiểm còn đúng trên mã hiện tại không (nhiều mục đã sửa ở lượt review sau hoặc gói khác; dòng có thể lệch). Đã hết thì ghi skipped + bằng chứng file:dòng. Mục cần chủ quyết (ghi needs_owner/cần chủ quyết, hoặc phải đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, thêm tin gửi khách) thì skipped, ghi lựa chọn cho chủ. Mục trùng nhau thì làm một lần, ghi id kia là trùng.

## giaodien-quantri-1 (review lượt 1, gói admin-nhansu)

File: apps/api/src/modules/merchant/merchant.service.ts:431-449, 507-513 (updateStore)

Vấn đề: E-50 chỉ ghi dấu ở StorefrontService.updateMine. Nhưng PUT /merchant/store (MERCHANT_PORTAL_ROLES có AFFILIATE) dùng getOrCreateStore, tìm theo ownerUserId nên trả về đúng gian hàng CTV của CTV, rồi ghi title/headerNote/avatarUrl/coverUrl mà không đặt contentChangedAt. Ở web /merchant, tab "Gian hàng & Subdomain" không có cờ merchantOnly, nên CTV có gian hàng đã duyệt mở /merchant, đổi tên hoặc ảnh, bấm Lưu thì admin không thấy dấu "Đổi sau duyệt". Lối này hẹp: CTV không có link điều hướng tới /merchant (chỉ dealer-hub có link), còn gian hàng đối tác thì luôn tính là đã duyệt. Báo cáo của worker không nhắc lối này.

Cách sửa đề xuất: Tách phép so sánh hiện ở storefront.service.ts:219-221 (CONTENT_FIELDS + so với giá trị đang lưu) thành helper export trong module storefront, ví dụ `contentChangedPatch(current, nextData)` trả `{ contentChangedAt: new Date() }` hoặc `{}`. Gọi helper này trong MerchantService.updateStore khi `store.type === 'CTV' && store.approvedAt`. merchant.service.ts thuộc gói diem nên ghi "cần gói diem sửa" hoặc làm ở đợt sau. Thêm spec: CTV đã duyệt đổi tên qua updateStore thì có dấu.

## giaodien-quantri-2 (review lượt 1, gói admin-nhansu)

File: apps/api/src/modules/staff/rbac/rbac.service.ts:131-142; apps/miniapp/src/pages/admin.tsx:521-524; apps/web/src/components/admin/staff-roster-tab.tsx:31-33

Vấn đề: Thêm theo SĐT của người đã là STAFF và chọn nhóm thì nhóm cũ bị THAY bằng nhóm vừa chọn, không cộng thêm. Ví dụ đang có [KHO, KE_TOAN], chọn [CSKH] thì còn [CSKH]. Mini không có chỗ sửa nhóm cho từng người, nên admin dễ dùng sheet Thêm để "thêm một nhóm". Thêm nữa, addGrant trả applied=false (vai trò không đổi), nên Mini và web báo "Đã lưu quyền (sẽ áp khi họ mở app)" dù nhóm đã đổi ngay. Dòng gợi ý "Không chọn nhóm nào: chỉ dùng quầy..." cũng sai với người đã là STAFF, vì để trống thì nhóm cũ vẫn giữ nguyên.

Cách sửa đề xuất: addGrant trả thêm `permissionsChanged: boolean`. Mini và web báo "Đã đổi nhóm việc của <SĐT> thành ..." khi cờ này bật. Trong sheet Thêm, nếu SĐT trùng một thành viên STAFF trong danh sách đã tải thì hiện dòng "Nhóm đang có: ... — lưu sẽ thay bằng nhóm bạn chọn", hoặc chọn sẵn nhóm hiện có của họ.

## giaodien-quantri-3 (review lượt 1, gói admin-nhansu)

File: apps/api/src/modules/storefront/storefront-admin.service.ts:197-198 (markContentSeen); apps/web/src/components/admin/storefronts-tab.tsx:86, 253

Vấn đề: "Đã xem" xoá dấu vô điều kiện (`where: { id, contentChangedAt: { not: null } }`). Khi admin đang mở ngăn chi tiết, chủ đổi ảnh thêm lần nữa, admin bấm "Đã xem" thì lần đổi mới mà admin chưa thấy cũng bị xoá dấu.

Cách sửa đề xuất: Client gửi `contentChangedAt` mà admin đang xem (body `{ seenChangedAt }`). Server dùng `updateMany({ where: { id, contentChangedAt: { lte: seenChangedAt } } })`. Nếu count=0 vì dấu đã mới hơn thì trả lại summary để web hiện dấu mới.

## giaodien-quantri-4 (review lượt 1, gói admin-nhansu)

File: apps/api/src/modules/staff/rbac/rbac.service.ts:60, 92-94; apps/miniapp/src/pages/admin.tsx:519; apps/web/src/components/admin/staff-roster-tab.tsx:29

Vấn đề: Comment kể lại thay đổi ("như trước", "như cũ"), trái luật brief: comment chỉ giải thích vì sao.

Cách sửa đề xuất: Viết lại theo lý do, ví dụ: "Không gửi khoá permissions để máy chủ giữ nguyên nhóm đã lưu" và "Lời mời không ghi nhóm thì không đụng nhóm hiện có của user".

## giaodien-quantri-5 (review lượt 1, gói admin-congcu)

File: apps/web/src/components/admin/payroll-adjust-sheet.tsx:156

Vấn đề: Câu gợi ý "Phạt trừ vào lương tháng này, thưởng cộng thêm vào." sai khi admin đang xem tháng trước. Khoản thực tế đi vào tháng đang xem ({month}/{year}), không phải tháng này.

Cách sửa đề xuất: Đổi thành `Phạt trừ vào lương tháng ${month}/${year}, thưởng cộng thêm vào.`

## giaodien-quantri-6 (review lượt 2, gói admin-congcu)

File: apps/web/src/components/admin/payroll-admin-tab.tsx:255

Vấn đề: Dòng chữ 'Mở lại bảng lương trước khi thưởng/phạt hoặc tính lại tháng.' hiện cả ở tháng ĐÃ TRẢ (PAID). Mở lại tháng PAID sẽ xoá paidAt, paidBy và ảnh chứng từ (payroll.service.ts:434), nên câu này đẩy admin vào đúng luồng dễ rối tiền: tiền đã chuyển rồi mà phải ghi lại 'đã trả'. Hộp xác nhận mở lại cũng không nói việc xoá chứng từ.

Cách sửa đề xuất: Chỉ hiện câu cũ khi status === 'FINALIZED'. Với 'PAID' đổi thành: 'Tháng đã trả: ghi thưởng/phạt vào tháng sau.' (hoặc nói rõ là mở lại sẽ xoá dấu đã trả).

## giaodien-quantri-7 (review lượt 2, gói admin-congcu)

File: apps/web/src/components/admin/payroll-adjust-sheet.tsx:79-80

Vấn đề: Comment ghi 'tháng trước vẫn hiện số cũ ... tới đêm sau'. Sai: cron (payroll.job.ts:27-31) chỉ tính lại tháng trước trong 3 ngày đầu tháng. Sau mốc đó số cũ nằm đó tới khi chốt, ghi đã trả hoặc mở Xem giờ. Người đọc sau dễ tưởng bước tính lại là thừa rồi bỏ đi.

Cách sửa đề xuất: Sửa thành: 'cron chỉ tính lại tháng trước trong 3 ngày đầu tháng; ngoài khoảng đó số tháng cũ đứng yên tới khi chốt/ghi đã trả'.

## giaodien-quantri-8 (review lượt 2, gói admin-congcu)

File: apps/web/src/components/admin/payroll-adjust-sheet.tsx:128-130, 103-106

Vấn đề: Lúc đang ghi (send.isPending) vẫn đóng được sheet bằng Esc hoặc bấm nền. Đóng giữa chừng thì lỗi của adjust (setErr) và hộp hỏi 409 không bao giờ hiện, admin không biết khoản có được ghi hay không. Thêm một ca: lần đầu ghi được nhưng mất phản hồi, admin gửi lại, máy chủ trả 409, admin bấm Huỷ. Khi đó không có bước tính lại nào, nên dòng tháng trước vẫn hiện số cũ.

Cách sửa đề xuất: Truyền dismissible={!send.isPending} cho <Sheet>. Ở nhánh 409 mà admin bấm Huỷ thì vẫn gọi recomputePayroll (hoặc onDone kèm câu 'Khoản giống hệt đã có, đã cập nhật số') để dòng lương khớp sổ.

## giaodien-quantri-9 (review lượt 2, gói admin-congcu)

File: apps/web/src/components/admin/community-moderation-tab.tsx:441-444

Vấn đề: Link 'Mở bài' mở /cong-dong/:id ngay trong tab quản trị. Chữ trả lời đang gõ dở ở ô bên cạnh bị mất, và admin bị đưa ra khỏi /admin.

Cách sửa đề xuất: Thêm target="_blank" rel="noopener" cho Link, hoặc giữ nguyên nhưng xoá dở chữ trước khi rời trang.

## giaodien-quantri-10 (review lượt 1, gói giaodien)

File: apps/miniapp/www/assets/index.DISM7s0-.module.js (đo từ apps/miniapp/src/components/bottom-nav.tsx:16-21, apps/miniapp/src/components/ui/product-tile.tsx:88-127, packages/app-core/src/product-badges.ts)

Vấn đề: Entry Mini tăng từ 722.536 lên 724.325 B (thêm 1.789 B raw, khoảng 0,7 KB gz). Như vậy trái quyết định đã chốt 'entry Mini App KHÔNG tăng'. Tôi đã đo lại bản build ở HEAD, số khớp báo cáo của worker. Phần tăng nằm trong vỏ dùng chung (thanh đáy, ProductTile, isNewProduct), là chỗ chính gói này bắt phải sửa, nên không bỏ ra khỏi entry được nếu vẫn giữ tính năng. Gate chỉ in số, không chặn.

Cách sửa đề xuất: Chủ duyệt ngoại lệ và ghi vào báo cáo đợt (worker đã nêu). Không cần sửa mã. Nếu chủ không duyệt thì phải bỏ nhãn Mới hoặc bỏ phần cuộn về đầu ở thanh đáy.

## giaodien-quantri-11 (review lượt 1, gói giaodien)

File: apps/api/src/modules/integrations/pancake/pancake-sync.service.ts:443

Vấn đề: Nhãn Mới dựa vào Product.createdAt, mà createdAt là lúc đồng bộ Pancake tạo dòng lần đầu, không phải ngày SP mới ra. Nếu DB PROD (Vietnix, dựng 24-25/10) được đồng bộ catalog mới trong 30 ngày qua thì gần như mọi thẻ sẽ có nhãn Mới tới cuối tháng 11. Như vậy trái đúng ý 'nhãn Mới đúng nghĩa' và trái comment có sẵn 'không dán nhãn Mới cho mọi món' (apps/web/src/components/product-card.tsx:104). Mã làm đúng quyết định; rủi ro nằm ở dữ liệu thật, tôi không kiểm được (không đụng PROD).

Cách sửa đề xuất: Trước khi deploy, chủ chạy truy vấn chỉ đọc trên PROD: tỉ lệ SP isActive có createdAt trong 30 ngày qua. Nếu đa số là mới thì hoãn nhãn Mới, hoặc thêm mốc tối thiểu (ngày mở bán) trong isNewProduct qua cấu hình ở gói sau.

## giaodien-quantri-12 (review lượt 1, gói giaodien)

File: apps/web/src/components/product-card.tsx:25 và apps/web/src/components/mini/product-tile.tsx:87

Vấn đề: isNewProduct dùng Date.now() lúc render. Hàm này chạy trong client component có HTML dựng sẵn ISR (home-section, browse-view, suggest-feed, best-seller-rail; revalidate 300, nhưng HTML cũ có thể được trả muộn hơn ở trang ít khách). Nếu một SP vừa qua mốc 30 ngày giữa lúc dựng HTML và lúc hydrate, hoặc điện thoại khách để sai ngày, thì server và client lệch nhau một phần tử. React báo lỗi hydration và dựng lại phía client (trang không vỡ, nhưng chớp màn và có lỗi trên console).

Cách sửa đề xuất: Web: chỉ hiện nhãn sau khi mount (cờ đã hydrate, server snapshot là false). Hoặc để API trả thêm isNew tính ở toCard, khi đó HTML và lúc hydrate đọc cùng một giá trị đã gửi xuống.

## giaodien-quantri-13 (review lượt 1, gói giaodien)

File: apps/miniapp/src/pages/wishlist.tsx:64 và apps/web/src/app/tai-khoan/yeu-thich/quick-add.tsx:79

Vấn đề: Khi bấm giỏ nhanh mà SP vừa hết hàng: (1) danh sách yêu thích không được làm mới, nên thẻ vẫn còn nút giỏ và không có lớp Hết hàng; khách bấm lại thì vẫn ra cùng thông báo. (2) Chữ hai nền khác nhau: Mini báo 'Tạm hết — sẽ về sớm' (hứa hàng về, dạng lỗi), web báo 'Sản phẩm vừa hết hàng. Bạn xem sản phẩm khác nhé.'

Cách sửa đề xuất: Ở nhánh soldOut gọi invalidateQueries cho khoá wishlist (Mini ['wishlist'], web wishlistQuery(coreHttp).queryKey). Đặt một chuỗi dùng chung trong app-core quick-add.ts (ví dụ QUICK_ADD_SOLD_OUT) cho cả hai nền.

## giaodien-quantri-14 (review lượt 1, gói giaodien)

File: apps/miniapp/src/components/ui/product-tile.tsx:127

Vấn đề: Nút giỏ nhanh (imageOverlay) nằm trước nút tên SP trong DOM. Trình đọc màn hình và phím Tab vì vậy gặp 'Thêm X vào giỏ' trước tên sản phẩm. Web đặt nút sau link và tim, nên thứ tự hai nền khác nhau. Tim trong cùng file đã cố ý đặt sau nút tên vì đúng lý do này.

Cách sửa đề xuất: Dời {imageOverlay} xuống ngay sau tim (sau nút tên), bọc trong khối absolute 0x0 neo vào vùng ảnh như cách làm với WishlistHeart.

## giaodien-quantri-15 (review lượt 1, gói giaodien)

File: apps/web/src/app/dang-nhap/page.tsx, apps/web/src/app/tai-khoan/yeu-thich/quick-add.tsx

Vấn đề: Chưa đo First Load web của /dang-nhap (thêm next/image logo, publicConfigQuery) và /tai-khoan/yeu-thich (thêm quick-add, api cart/catalog của app-core). Luật yêu cầu không tăng quá 2 KB hoặc phải ghi lý do; worker ghi là chưa kiểm.

Cách sửa đề xuất: Chạy bundle-report.mjs --build-web (hoặc next build) ở worktree gói, ghi số trước và sau của hai trang vào báo cáo.

## giaodien-quantri-16 (review lượt 1, gói giaodien)

File: báo cáo worker (items E-95, E-107)

Vấn đề: Mã mục trong báo cáo bị tráo. Theo file gói, E-95 là bấm lại tab thì cuộn về đầu (Mini), E-107 là hotline không ngắt dòng. Báo cáo lại ghi E-95 là hotline và E-107 là nhãn tab. Mã đã làm đủ cả hai, nhưng sổ backlog sẽ ghi sai mục.

Cách sửa đề xuất: Sửa lại bảng mục trong báo cáo: E-95 = cuộn về đầu ở thanh đáy (bottom-nav.tsx Mini + web), E-107 = whiteSpace nowrap ở support-hotline hai nền.

## giaodien-quantri-17 (review lượt 1, gói giaodien)

File: apps/api/src/modules/storefront/storefront.service.ts:370

Vấn đề: Thẻ SP ở gian hàng CTV chưa có createdAt nên không có nhãn Mới, trong khi cùng SP đó ở catalog thì có. Không gây lỗi, chỉ thiếu nhãn. File này thuộc gói admin-nhansu, worker đã ghi lại.

Cách sửa đề xuất: Chuyển cho gói admin-nhansu: thêm createdAt: true vào select và createdAt: p.createdAt?.toISOString() vào thẻ ở storefront.service.ts, kèm một spec giống brand.service.spec.

## giaodien-quantri-18 (còn lại trong báo cáo cuối 29/10)

Lời "không tìm thấy" của trang nhãn hàng (brand) và trang đơn hàng khác nhau giữa Mini và web: thống nhất theo chữ Mini (web khổ điện thoại phải giống Mini).
