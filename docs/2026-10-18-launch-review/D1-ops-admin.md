# D1 — Việc nhân sự vẫn phải làm ngoài hệ thống

Ngày đọc mã: 2026-10-17, worktree `launch-review` (cùng cây main 0cc2fe62). Chỉ đọc mã, không chạy app, test hay DB.
Ký hiệu đường dẫn: `page.tsx` là `apps/web/src/app/admin/page.tsx`; `components/admin/*` là `apps/web/src/components/admin/*`; API là `apps/api/src/modules/*`.

## 1. Tóm tắt

- **Mức hoàn thiện cho vận hành hằng ngày: khoảng 55%.** Luồng đơn và các hàng đợi ngoại lệ làm tốt: "Việc cần xử lý" có 15 hàng đợi, có đổi/trả, hoàn tiền, rút tiền, đối soát đối tác, Pancake và Gomdon. Phần trưng bày, báo cáo, phân quyền, CRM và kênh đại lý/CTV còn mỏng.
- Kho làm việc trên Pancake là đúng thiết kế: in vận đơn, đóng gói, giao hãng, tồn kho và nhập hàng đều trên Pancake, trạng thái tự về app. Tính cả phần này thì kho đạt khoảng 80%.
- Trong ma trận ở mục 3, 53 việc chia thành 19 việc ✓, 14 việc ◐ và 20 việc ✗. 8 trong số đó làm trên Pancake. Việc ✗ dồn vào CSKH, marketing, quản lý đại lý/CTV và kế toán.
- **Ba lỗ hổng lớn nhất:**
  1. **Không có cách nhập % hoa hồng CTV.** Mọi sản phẩm thật lấy từ Pancake đều có hoa hồng 0đ (D1-01). Bậc đại lý, giá sỉ và công nợ từng đại lý cũng không có màn (D1-06).
  2. **Đơn ngoài luồng app phải làm trên Pancake và không quay về app.** Gồm đơn khách đặt qua chat hoặc điện thoại, và đơn bị sửa địa chỉ hay sửa món. Hệ quả: CSKH làm hai nơi, khách không có điểm, số tiền lệch (D1-02, D1-03).
  3. **Thiếu báo cáo theo ngày và theo kênh, và chỉ có 2 nhóm việc CSKH/KHO.** Chủ shop và kế toán phải xoay Excel. Marketing và kế toán phải được cấp ADMIN toàn quyền (D1-04, D1-05).
- Ghi chú xung đột: phiên đổi-rác đang sửa `page.tsx` và `engagement-tab.tsx`. Mọi đề xuất dưới đây nên làm ở file mới trong `components/admin/` và chỉ thêm 1 dòng menu cùng 1 dòng render vào `page.tsx`, sau khi nhánh đổi-rác đã merge.

## 2. Bảng phát hiện

| ID | Mức | Vai trò bị ảnh hưởng | Hiện trạng + bằng chứng | Đề xuất | Công sức | Cần chủ dự án quyết? |
|---|---|---|---|---|---|---|
| D1-01 | **P0** (nếu mở CTV ngay ngày ra mắt) | đại lý/CTV, admin, kế toán | % hoa hồng nằm ở `Variation.affiliateRate` (`schema.prisma:715`, ghi chú "import Excel") nhưng **không có đường ghi**. Đồng bộ Pancake tạo biến thể mà không có trường này (`integrations/pancake/pancake-sync.service.ts:422-434`). Không endpoint hay màn nào ghi trường này. Chỉ có script audit ghi (`scripts/audit/seed-audit-personas.ts:655`). Hoa hồng tính theo `v.affiliateRate ? … : 0` (`affiliate/affiliate.service.ts:845-851`), nên mọi sản phẩm thật ra 0đ. Kiểm go-live không bắt lỗi này (grep `affiliate` trong `config/go-live/db-checks.ts` cho 0 dòng). | Làm như `POST admin/dealer-prices/import`: dán CSV "sku,%" để nhập, thêm khoá cấu hình `affiliate.default_rate` làm nền, và thêm dòng go-live báo "SP đang bán mà rate trống". | M | Y: % mặc định là bao nhiêu? Có khác theo sản phẩm hay nhãn không? |
| D1-02 | P1 | CSKH, kế toán, khách | **CSKH không lên đơn hộ được.** Đường lên đơn hộ chỉ mở cho AFFILIATE và ADMIN (`affiliate.service.ts:498-503`). STAFF bị chặn, và web admin không có màn này. Đơn khách đặt qua chat Zalo hoặc điện thoại vì thế phải tạo thẳng trên Pancake. Webhook bỏ qua đơn không có trên Tubu (`pancake.processor.ts:318-320`). Kết quả: khách không có Điểm Xanh hay lịch sử, CTV không có hoa hồng, doanh thu app thiếu. | Thêm "Lên đơn hộ" cho ADMIN/CSKH, dùng lại `quoteOrderForCustomer`/`placeOrderForCustomer`: đơn đứng tên khách theo SĐT, không tính hoa hồng cho người lên đơn. Chưa kiểm hệ quả hoa hồng khi ADMIN gọi đường CTV hiện có. | M | Y: đơn qua chat đi qua app (khách được điểm) hay giữ trên Pancake? |
| D1-03 | P1 | CSKH, kế toán, khách | **Sửa đơn chỉ làm được trên Pancake và không về app.** Admin không có endpoint sửa địa chỉ hay dòng hàng (`admin/admin.controller.ts:456-574`). Webhook chỉ ghi lại phần vận chuyển: hãng, mã vận đơn, trạng thái giao, link theo dõi (`pancake.processor.ts:624-633`). Webhook không so tổng tiền (grep `total_price` hay "lệch" trong processor cho 0 dòng). Hệ quả: khách thấy sai địa chỉ và sai tổng; hoàn tiền, hoa hồng và đối soát tính theo số cũ. | Ngắn hạn: ghi quy trình "không sửa đơn trên Pancake, huỷ rồi đặt lại", và cho webhook so tổng Pancake với `order.total`, lệch thì đưa vào "Cần xử lý Pancake". Sau đó: cho CSKH sửa địa chỉ khi đơn chưa PACKED rồi đẩy lại Pancake. | S (cảnh báo) / M (sửa địa chỉ) | Y: chọn quy trình hay xây chức năng sửa? |
| D1-04 | P1 | admin, kế toán, marketing | **Không có báo cáo theo thời gian hay theo kênh.** "Tổng quan KPI" là số cộng dồn mọi thời gian, không chọn được ngày (`admin.controller.ts:400-403`, `admin/admin.service.ts:675`). Tab Retention chỉ có 30 ngày khách/đơn (`app/admin/analytics-tab.tsx:10-50`). Không có doanh thu theo ngày, theo kênh, theo sản phẩm hay theo CTV. Đơn đã lưu `source`, `platform`, `referrerUserId`, `storefrontId` (`schema.prisma:953-979`), nhưng CSV không xuất các cột này và cũng không có dòng hàng (`admin/admin-export.ts:88-110`). App cũng không thu UTM (grep `utm_` chỉ thấy ở cashback). Vì vậy chưa đo được mục tiêu 1: đơn trực tiếp tăng hay không. | (a) S: thêm cột nền tảng, nguồn, CTV/gian hàng giới thiệu vào CSV, và thêm file CSV theo dòng hàng. (b) M: KPI có chọn khoảng ngày, kèm bảng doanh thu theo ngày × kênh. | S + M | N |
| D1-05 | P1 | marketing, kế toán, admin | **Chỉ có 2 nhóm việc nhân viên** là `CSKH` và `KHO` (`apps/api/src/common/staff-permissions.ts:9`; `page.tsx:265-269`). Người làm marketing (voucher, flash sale, FAQ, content kit, mẫu thông báo) và kế toán (hoàn tiền, rút tiền, đối soát, CSV) phải được cấp ADMIN. Với ADMIN, họ cấp được ADMIN cho người khác (`page.tsx:1711-1719`), sửa được mọi cấu hình, và bấm được "Đã chi". Xuất CSV cũng chỉ ADMIN làm được (`page.tsx:1005`). | Thêm `MARKETING` và `KE_TOAN` vào `STAFF_PERMISSIONS`, gắn `@AllowStaff` cho các route tương ứng, mở `STAFF_TABS` tương ứng. | M | Y: ai trong đội làm việc nào? |
| D1-06 | P1 | quản lý đại lý, kế toán | **Đại lý thiếu ba màn:** (1) Không có danh sách đại lý với công nợ từng người. Dashboard chỉ có tổng dư nợ (`admin.service.ts:727-763`). Sổ công nợ và nút ghi nhận tiền chỉ mở được từ bên trong một đơn của đại lý (`components/admin/dealer-credit-panel.tsx:36-49`). (2) Bậc, chiết khấu và hạn mức chỉ tạo được qua seed (`apps/api/prisma/seed.ts:891`); API chỉ có GET (`admin.controller.ts:433`). (3) Nhập giá sỉ theo bậc đã có API và client (`admin.controller.ts:602-606`, `apps/web/src/lib/admin-client.ts:376`) nhưng không màn nào gọi. | Tab "Đại lý" thêm danh sách đã duyệt: bậc, dư nợ, hạn mức, doanh số tháng, nút "Ghi nhận thanh toán". Thêm ô dán CSV giá sỉ vào tab "Lịch sử giá đại lý". Thêm form sửa bậc. | M | N |
| D1-07 | P1 | marketing, khách | **Marketing không tự sắp xếp trưng bày được.** Sản phẩm Tubu đồng bộ từ Pancake mà không gán danh mục; chính mã cũng ghi "danh mục seed có thể trống trên prod" (`catalog/catalog.service.ts:440-442`). Các trường "Tubu tự quản" gồm brand, phân khúc, thành phần, chứng nhận, SEO, nổi bật (`pancake-sync.service.ts:67-68`) không có endpoint ghi: catalog chỉ có GET (`catalog/catalog.controller.ts:18-66`), nhãn hàng chỉ gắn được sản phẩm (`brand/brand-admin.controller.ts:37-43`). Trang chủ tự dựng (`catalog/home.service.ts:97-106`), không có banner hay khối chiến dịch. Muốn đổi phải nhờ dev. | Màn "Sản phẩm" chỉ sửa các trường Tubu tự quản: danh mục, nổi bật, phân khúc, thành phần. Thêm CRUD danh mục và 1 khối banner trong cấu hình. | M–L | Y: làm trước hay sau ra mắt? |
| D1-08 | P1 | marketing/CSKH, khách (cộng đồng) | **Bài cộng đồng chờ duyệt mà chỉ ADMIN duyệt được, trên điện thoại.** Bài của người chưa "tin cậy" vào trạng thái PENDING (`feed/community-feed.service.ts:458`). Chỉ ADMIN duyệt được (`feed/community-feed.controller.ts:90-99`), và chỉ trên miniapp (`apps/miniapp/src/pages/admin.tsx:105-106`). "Việc cần xử lý" không đếm bài chờ duyệt (`ops/ops-inbox.service.ts:10-25`). Ngày ra mắt, bài đầu tiên của mọi khách sẽ nằm chờ chủ shop mở điện thoại. Việc này ảnh hưởng mục tiêu 3. | Thêm khoá `communityPending` vào "Việc cần xử lý" và tab web "Kiểm duyệt cộng đồng" mở cho CSKH/marketing. | S–M | Y: ai duyệt bài, trong bao lâu? |
| D1-09 | P1 | mọi nhân sự | **Chưa có sổ tay việc hằng ngày theo vai trò.** Chỉ có kịch bản đơn thử (`docs/launch/pilot-order-playbook.md:20-31`). Ranh giới việc nào làm trên Pancake, việc nào trên Tubu chưa ghi ra. Ví dụ: không sửa đơn trên Pancake (D1-03); COD đã thu được Pancake báo bằng mã `16` (`pancake-status.map.ts:42`); hoàn một phần phải hoàn tiền bằng tay (`pancake-status.map.ts:44-47`). | Viết mỗi vai trò một trang, dựa trên ma trận ở mục 3. Không cần code. | S | N |
| D1-10 | P2 | CSKH | **CSKH không thấy bot đã trả lời khách gì.** Webhook Zalo OA lưu tin, rồi bot tự trả lời theo mẫu tin nhanh hoặc lời chào (`integrations/zalo-oa/zalo-oa-webhook.controller.ts:68-77`, `zalo-oa-events.processor.ts:35-47`). Tin không khớp mẫu thành SKIPPED. Không màn nào đọc `OaInboundMessage` (grep web/miniapp cho 0 dòng). CSKH trả lời ngoài hệ thống (OA Manager hoặc Pancake), nên dễ trả lời trùng hoặc ngược với bot. | Chốt công cụ chat. Tối thiểu: thêm khoá cấu hình tắt bot trong giờ hành chính, hoặc hiện "tin bot đã trả" trong chi tiết khách. | S | Y: CSKH chat bằng công cụ nào? |
| D1-11 | P2 | CSKH, marketing | **CRM mỏng.** Ngăn chi tiết khách có hồ sơ, đơn gần nhất, ví, điểm và lịch sử vai trò (`components/admin/user-detail-drawer.tsx:92-150`). Còn thiếu địa chỉ, tổng chi tiêu, ghi chú nội bộ, nhãn/nhóm. Đơn trong ngăn không bấm mở được. Đơn hàng cũng không có ghi chú nội bộ, chỉ có `note` của khách (`schema.prisma:984`). Danh sách người dùng không lọc theo vai trò (`admin.controller.ts:415-419`), nên không liệt kê được CTV hay đại lý. | Thêm `staffNote` cho User và Order, bộ lọc vai trò, và tổng chi tiêu. Nhãn khách làm sau. | M | N |
| D1-12 | P2 | CSKH, marketing | **Không tặng được mã đền bù cho một khách.** API nhận `scope USER_GROUP` kèm userId (`admin.controller.ts:220-224`), nhưng form web cố định `PUBLIC` (`page.tsx:1801,1824`) và chỉ ADMIN dùng được. Cũng không có cộng điểm tay. | Thêm nút "Tặng mã cho khách này" trong ngăn chi tiết khách, kèm trần giá trị cho CSKH. | S | Y: trần đền bù cho CSKH là bao nhiêu? |
| D1-13 | P2 | marketing | **Không gửi được tin chủ động theo nhóm.** Thông báo chỉ gửi theo sự kiện, từng người, qua INAPP hoặc ZNS (`notifications/notifications.service.ts:36-40`). Không có broadcast hay chiến dịch (grep `broadcast\|campaign` cho 0 dòng). Đã có tự động hoá vòng đời: giỏ bỏ dở, win-back, nhắc mua lại, mời đánh giá (`lifecycle/remarketing.service.ts:42,125`, `lifecycle/lifecycle.service.ts:70`, `lifecycle/review-invite.service.ts:48`). Chiến dịch phải làm trên Zalo OA Manager và không nhắm theo dữ liệu mua được. | Sau ra mắt: xuất CSV theo nhóm (đã mua X, lâu chưa mua) để dùng trên OA. Gửi ZNS theo nhóm sau khi Zalo duyệt mẫu. | S (CSV) / L | N |
| D1-14 | P2 | admin, kế toán | **Không có thao tác hàng loạt; xuất file chỉ có 2 loại.** Không tab nào chọn được nhiều dòng (grep `bulk\|selectAll` trong web admin cho 0 dòng). Hàng loạt chỉ có API duyệt ca (`staff/admin-shifts.controller.ts:54`). Chỉ xuất được file đơn hàng và người dùng (`admin-client.ts:1511-1517`). Báo cáo thuế TNCN của CTV chỉ là bảng trên màn (`components/admin/payout-admin-tab.tsx:160-185`). Rút tiền, hoàn tiền và đối soát không xuất được. | S: xuất CSV cho TNCN, rút tiền, hoàn tiền. M: chọn nhiều rồi "Duyệt" hoặc "Đã chi", làm khi số đơn tăng. | S / M | N |
| D1-15 | P2 | admin, kế toán | **Lương và duyệt ca chỉ có trên miniapp.** Duyệt ca, mẫu ca và lương (chốt, mở lại, đã chi kèm ảnh) chỉ làm được trên miniapp, chỉ ADMIN (`miniapp/src/pages/admin.tsx:70-90`). Web chỉ có chấm công đang diễn ra và chốt ra ca (`components/admin/attendance-tab.tsx:15`). Đây là phần còn mở của C-091 cũ, đã hoãn theo Q-29. | Chuyển tab Lương sang web và gắn nhóm `KE_TOAN` (D1-05). | M | N |
| D1-16 | P2 | admin | **Không có nhật ký thao tác chung.** Đã có lịch sử trạng thái đơn (`schema.prisma:2442-2453`, hiện trong chi tiết đơn) và lịch sử vai trò/khoá (ngăn chi tiết khách). Lịch sử cấu hình có ghi (`system-config/system-config.service.ts:345`) nhưng không màn nào đọc. Không có nhật ký chung cho việc duyệt hoàn tiền, rút tiền hay sửa voucher. | Màn "Nhật ký" đọc `SystemConfigHistory` và các cột người làm sẵn có (`paidBy`, `reviewedBy`). | M | N |
| D1-17 | P2 | CSKH, kho | **Danh sách đơn thiếu bộ lọc; "Việc cần xử lý" thiếu 2 hàng đợi.** Không lọc được theo phương thức hay tình trạng thanh toán, loại đơn (đại lý/CTV/lẻ), nguồn (miniapp/web), CTV hay gian hàng giới thiệu. Không đổi được thứ tự sắp xếp (`admin.controller.ts:286-298`). Hoá đơn VAT chờ xuất và bài/đánh giá chờ duyệt không có trong "Việc cần xử lý" (`ops-inbox.service.ts:10-25`). | Thêm 3 bộ lọc (loại đơn, tình trạng thanh toán, nền tảng) và 2 khoá inbox. | S | N |
| D1-18 | P2 | kho, marketing | **App không cảnh báo hết hàng.** Tồn kho và nhập hàng làm hoàn toàn trên Pancake. Tồn đồng bộ mỗi 15 phút và qua webhook (`pancake-sync.service.ts:120`; `pancake.processor.ts:700-715`). App không có cảnh báo sắp hết hay hết hàng (grep `lowStock\|hết hàng` cho 0 dòng). Marketing không biết sản phẩm đang chạy flash sale hay voucher sắp hết. | Chấp nhận dựa vào Pancake. Thêm khoá inbox "SP bán chạy còn dưới N". | S | Y: kho có dùng cảnh báo tồn của Pancake không? |
| D1-19 | P2 | CSKH, kho (UX) | **Dùng được trên điện thoại nhưng trang nặng và thiếu trạng thái tải.** Phần tốt: menu chia nhóm, ở điện thoại mở bằng ngăn kéo (`components/admin/admin-nav.tsx:58-80`). Chi tiết đơn mở ngăn kéo khi màn hẹp (`page.tsx:896-897,1291-1302`), nút cao 44px, nên dùng được ở 390px. Phần chưa tốt: 30 mục nằm trong một trang `page.tsx` 3.232 dòng, khoảng 40 component import tĩnh, không tách theo tab (`page.tsx:86-149`). Tải lần đầu trên 4G có thể nặng (chưa đo). 7 tab không có trạng thái "đang tải", chỉ có lỗi/rỗng: Người dùng, Cấu hình, Nhãn hàng, Flash Sale, FAQ, Mẫu tin nhanh, Academy (`page.tsx:1635,1763,1899,2212,2490,2656,2976`). | Tách các tab còn trong `page.tsx` ra `components/admin/*` dùng `next/dynamic`, và thêm dòng "Đang tải…". Làm **sau** khi nhánh đổi-rác merge. | M | N |
| D1-20 | P3 | CSKH | **Ba việc CSKH nhỏ còn thiếu:** không phản hồi được đánh giá, chỉ ẩn/xoá và chỉ ADMIN (`reviews/reviews.controller.ts:67-74`); không tạo được yêu cầu đổi/trả thay khách gọi điện, API chỉ có danh sách, xem trước, duyệt, đã nhận (`orders/returns-admin.controller.ts:26-44`); không mở được hàng đợi hoàn tiền vì chỉ ADMIN (`ops-inbox.service.ts:52`), chỉ thấy chữ "Đang hoàn tiền" ở dòng đơn (`page.tsx:1336-1343`). | Để sau ra mắt. | S–M | N |
| D1-21 | P3 | admin | **Đăng nhập web admin chỉ qua Zalo OAuth** (`apps/web/src/app/dang-nhap/page.tsx:41-66`). Thiếu cấu hình đăng nhập Zalo trên web thì không nhân viên nào vào được admin. COD tối đa nằm cứng trong mã (`checkout/checkout-split.ts:328`). | Ghi vào checklist go-live. Chưa kiểm cấu hình thật. | S | N |

Mục cũ còn thấy trong mã: **C-091 (A1-030)** còn một phần ở D1-15. Duyệt ca và lương vẫn chỉ trên miniapp. Còn chấm công trực tiếp, chốt ra ca và "Tính lại số đã bán" thì nay đã có trên web (`components/admin/ops-health-tab.tsx:196`).

## 3. Ma trận vai trò × việc hằng ngày

Ký hiệu: ✓ làm trọn trong hệ thống · ◐ một phần, ví dụ ghi nhận trong app nhưng tiền chuyển ngoài · ✗ phải làm ngoài (Excel, Zalo, giấy hoặc dev). **(P)** nghĩa là làm trên Pancake POS, đã tích hợp; việc này chấp nhận được nếu dữ liệu quay về app.

| Vai trò | Việc hằng ngày | Mức | Ở đâu / làm ngoài thế nào |
|---|---|---|---|
| Admin / chủ shop | Đầu ngày xem việc tồn | ✓ | "Việc cần xử lý": 15 hàng đợi, tự làm mới mỗi 60 giây (`ops-inbox.service.ts:47-73`, `components/admin/ops-inbox-tab.tsx:28`) |
| | Theo dõi tích hợp Pancake/Gomdon/webhook | ✓ | `ops-health-tab.tsx:83` + email báo động (`ops/ops-alerts.ts:13-20`) |
| | Xem doanh thu hôm qua, tuần này, theo kênh | ◐ | Chỉ có số cộng dồn; phải xuất CSV ra Excel (D1-04) |
| | Cấp quyền, khoá nhân viên hoặc khách | ✓ | `page.tsx:1690-1758`; nhóm việc trong `user-detail-drawer.tsx` |
| | Duyệt ca, chốt lương | ◐ | Chỉ trên miniapp, chỉ ADMIN (D1-15) |
| | Sửa phí ship, tài khoản ngân hàng, hotline | ◐ | Sửa JSON có luật kiểm (`page.tsx:1760-1781`); COD tối đa nằm cứng trong mã |
| | Sửa sản phẩm, giá, ảnh | ✗ (P) | Sửa trên Pancake. Trường Tubu tự quản không có màn (D1-07) |
| CSKH | Trả lời chat Zalo OA | ✗ | Dùng OA Manager hoặc Pancake; app chỉ có bot (D1-10) |
| | Tra đơn theo SĐT, mã đơn, mã vận đơn, tên | ✓ | `page.tsx:958-966` |
| | Báo khách tình trạng giao | ✓ | Mã vận đơn và lịch sử trạng thái (`page.tsx:1402-1407,1422`) |
| | Huỷ đơn theo yêu cầu khách | ✓ | CSKH được huỷ (`admin/order-actor-transitions.ts:13-16`) |
| | Đổi địa chỉ, thêm bớt món | ✗ (P) | Sửa trên Pancake, không về app (D1-03) |
| | Lên đơn cho khách đặt qua chat hoặc điện thoại | ✗ (P) | Tạo trên Pancake, đơn không vào app (D1-02) |
| | Duyệt đổi/trả | ✓ | `returns-admin.controller.ts:38`, `page.tsx:1437-1501` |
| | Tạo yêu cầu đổi/trả thay khách | ✗ | Không có API (D1-20) |
| | Trả lời khách "bao giờ nhận tiền hoàn" | ◐ | Thấy "Đang hoàn tiền", hàng đợi chỉ ADMIN mở được (D1-20) |
| | Ghi chú, phân nhóm khách | ✗ | Ghi ở Zalo hoặc Excel (D1-11) |
| | Tặng mã đền bù | ✗ | Form chỉ tạo mã PUBLIC (D1-12) |
| | Sửa mẫu tin nhanh cho bot | ✓ | `page.tsx:2575-2760` |
| | Ẩn đánh giá xấu / phản hồi đánh giá | ◐ | Ẩn được nhưng chỉ ADMIN; không phản hồi được |
| Kho | Nhận đơn, in vận đơn, đóng gói, giao hãng | ✓ (P) | Làm trên Pancake; trạng thái tự về app (`pancake-status.map.ts:31-44`). KHO bấm được "Đã đóng gói" (`order-actor-transitions.ts:15`) |
| | Xử lý đơn kẹt chưa lên Pancake hoặc Pancake báo bất thường | ✓ | `page.tsx:1107-1152`; `admin.controller.ts:477-485` |
| | Nhận hàng hoàn về kho | ✓ | `returns-admin.controller.ts:44`. Hoàn một phần phải hoàn tiền bằng tay (`pancake-status.map.ts:44-47`) |
| | Kiểm tồn, cảnh báo hết hàng | ✗ (P) | D1-18 |
| | Nhập hàng | ✗ (P) | App không có (grep purchase/nhập cho 0 dòng) |
| | In phiếu giao, hoá đơn bán lẻ | ✗ (P) | App không có chức năng in (grep `print`/pdf trong web và api cho 0 dòng) |
| Marketing / nội dung | Tạo, tắt, gia hạn voucher; xem lượt dùng | ✓ | `page.tsx:1793-1873`; `components/admin/coupon-list.tsx:75,174` |
| | Flash sale; xem số đã bán so với quota | ✓ | `page.tsx:2158-2420`, `:2375` |
| | Nhiệm vụ và quà đổi điểm | ✓ | `engagement-tab.tsx` (phiên đổi-rác đang sửa) |
| | Banner, sản phẩm nổi bật, danh mục | ✗ | Phải nhờ dev (D1-07) |
| | Gửi tin hoặc ZNS theo nhóm | ✗ | Dùng Zalo OA Manager (D1-13) |
| | Lịch đăng nội dung | ✗ | Không có (grep `scheduledAt\|publishAt` cho 0 dòng) |
| | Duyệt bài cộng đồng | ◐ | Chỉ ADMIN, chỉ trên miniapp (D1-08) |
| | FAQ, Content Kit, Academy, mẫu thông báo | ✓ | `page.tsx:2422,2761,2909`; `notification-templates-tab.tsx:89-122` |
| | Đo hiệu quả theo kênh, nguồn khách | ✗ | D1-04 |
| Quản lý đại lý / CTV | Duyệt hồ sơ đại lý, gán bậc | ✓ | `page.tsx:492-607` |
| | Đổi bậc, hạn mức, chiết khấu | ✗ | Chỉ qua seed, phải nhờ dev (D1-06) |
| | Nhập bảng giá sỉ | ✗ | API có nhưng không có màn (D1-06) |
| | Theo dõi và ghi nhận công nợ từng đại lý | ◐ | Chỉ mở được từ trong một đơn (D1-06) |
| | Duyệt thưởng đại lý | ✓ | `dealer-claims-tab.tsx`, `dealer/dealer-admin.controller.ts:32-53` |
| | Xem danh sách CTV kèm doanh số | ✗ | Xuất CSV người dùng rồi lọc trong Excel (D1-11) |
| | Đặt % hoa hồng | ✗ | Không có đường nhập (D1-01) |
| | Duyệt và chi rút tiền hoa hồng | ◐ | Duyệt và ghi "đã chi" trong app (`affiliate/payout-admin.controller.ts:45-66`); chuyển khoản làm ngoài |
| | Duyệt sản phẩm đối tác, theo dõi đơn đối tác trễ | ✓ | `merchant-products-tab.tsx`, `merchant-fulfilment-tab.tsx` |
| Kế toán / đối soát | Xác nhận khoản chuyển khoản | ✓ | Pancake liên kết ngân hàng tự báo đã trả (`integrations/payment/bank-transfer.service.ts:8-10`); có nút "Đã nhận tiền" dự phòng (`admin.controller.ts:557`, `order-status-actions.tsx:251-259`) |
| | Đối soát COD với hãng vận chuyển | ◐ (P) | Làm trên Pancake; app có số "COD chưa thu" (`page.tsx:718-721`) |
| | Chi hoàn tiền cho khách | ◐ | Hàng đợi nhận / kiểm / đã chi (`orders/customer-refunds-admin.controller.ts:56-85`); chuyển khoản làm ngoài |
| | Chi tiền cho đối tác, CTV, thưởng đại lý | ◐ | Ghi mã giao dịch trong app (`merchant/merchant-admin.controller.ts:72-87`); không có file chi hàng loạt |
| | Xuất hoá đơn VAT | ◐ | Lọc đơn và bấm "Đã xuất" (`admin.controller.ts:488-491`); phát hành trên Pancake hoặc phần mềm hoá đơn điện tử |
| | Doanh thu theo ngày, sản phẩm, kênh | ✗ | Excel (D1-04) |
| | Kê khai thuế TNCN của CTV | ◐ | Bảng theo tháng, không xuất file (D1-14) |
| | Tổng hợp công nợ đại lý | ✗ | D1-06 |
| | Tính lương | ◐ | Chỉ trên miniapp (D1-15) |

### Đồng bộ Tubu ↔ Pancake: dữ liệu nào đi chiều nào

- **Tubu → Pancake:** tạo đơn, báo đã thanh toán, huỷ đơn. Đẩy qua hàng đợi (`pancake-order.service.ts:162-172`). Đơn gian hàng đối tác tự giao thì không đẩy.
- **Pancake → Tubu:** sản phẩm, giá, ảnh và mô tả (15 phút một lần và quét toàn bộ lúc 3:30, `pancake-sync.service.ts:120,134`); tồn kho; trạng thái đơn; vận đơn; đã thu tiền; hoá đơn.
- **Không quay về Tubu:** sửa địa chỉ, món hay tổng tiền; đơn tạo thẳng trên Pancake; thông tin khách. Ba khoảng này là gốc của D1-02 và D1-03.

## 4. UX của admin web

- **Bố cục:** một trang, 30 mục chia 9 nhóm trong menu trái (`page.tsx:186-257`). Đã bỏ dải tab cuộn ngang cũ (ADMINOPS-13). Trạng thái tab nằm trên URL nên gửi link cho đồng nghiệp được (`page.tsx:279-305`). Nhân viên chỉ thấy mục thuộc nhóm việc của mình (`page.tsx:414-416`).
- **Điện thoại:** đạt mức "không vỡ ở 390px" của Q-29. Menu và chi tiết đơn mở bằng ngăn kéo, ô tìm kiếm rút gọn chữ gợi ý, có thẻ đơn dạng 2 dòng ở Tổng quan (`page.tsx:794-814`). Việc CSKH/KHO cần nhất (Việc cần xử lý, Đơn hàng, Đổi/Trả) đều dùng được trên điện thoại. Lương, ca và kiểm duyệt cộng đồng lại chỉ ở miniapp, nên admin phải dùng hai nơi.
- **Trạng thái tải, lỗi, rỗng:** tab Đơn hàng, Đại lý, Đổi/Trả và Tổng quan đủ cả ba. 7 tab thiếu "đang tải" (D1-19). Danh sách chờ duyệt có "Tải thêm" và báo còn bao nhiêu mục chưa tải (`page.tsx:546-565`).
- **Xung đột cần tránh:** phiên đổi-rác đang sửa `page.tsx` và `engagement-tab.tsx`. Mọi việc ở bảng trên nên viết ở file mới trong `components/admin/` và chạm `page.tsx` tối đa 2 dòng (thêm vào `NAV_GROUPS`/`STAFF_TABS` và 1 dòng render). Việc tách file (D1-19) để sau khi nhánh đổi-rác merge.

## 5. Đề xuất tính năng mới (xếp theo giá trị chia công sức)

1. **Nhập % hoa hồng CTV** (CSV "sku,%" kèm % mặc định) và **màn nhập giá sỉ đại lý**, dùng lại client có sẵn (`admin-client.ts:376`). S–M. Phục vụ **mục tiêu 4**: thiếu cái này thì CTV bán không có hoa hồng.
2. **Sổ tay vận hành hằng ngày** theo 6 vai trò, kèm ranh giới Tubu/Pancake. S, không cần code. Phục vụ **mục tiêu 5**: hết hỏi "việc này làm ở đâu".
3. **Thêm cột CSV và KPI theo khoảng ngày, theo kênh** (nền tảng, nguồn, CTV/gian hàng, dòng hàng). S + M. Phục vụ **mục tiêu 1 và 5**: đo được đơn trực tiếp tăng, kế toán bớt xoay Excel.
4. **Kiểm duyệt cộng đồng trên web và đếm trong "Việc cần xử lý"**, mở cho CSKH/marketing. S–M. Phục vụ **mục tiêu 3**: bài của khách mới không nằm chờ.
5. **Nhóm việc MARKETING và KE_TOAN.** M. Phục vụ **mục tiêu 5** và an toàn: thôi phát quyền ADMIN cho mọi người.
6. **Danh sách đại lý kèm công nợ, hạn mức, doanh số và nút ghi nhận thanh toán.** M. Phục vụ **mục tiêu 4 và 5**.
7. **Lên đơn hộ cho CSKH**, dùng lại luồng CTV. M. Phục vụ **mục tiêu 1 và 5**: khách chat cũng vào app và được điểm, hướng tới mua lại trực tiếp.
8. **Cảnh báo lệch tổng tiền giữa Pancake và Tubu**, và cho sửa địa chỉ trước khi đóng gói. S/M. Phục vụ **mục tiêu 5**.
9. **Màn trưng bày:** danh mục, sản phẩm nổi bật, phân khúc, banner. M–L. Phục vụ **mục tiêu 1**: trải nghiệm mua sắm do marketing tự điều chỉnh.
10. **Ghi chú nội bộ cho khách và đơn, tặng mã đền bù có trần.** M. Phục vụ **mục tiêu 3 và 5**.
11. Sau ra mắt: xuất danh sách khách theo nhóm cho OA hoặc ZNS, thao tác hàng loạt, màn nhật ký, chuyển tab lương sang web.

## 6. Câu hỏi cho chủ dự án

Chỉ hỏi những câu làm đổi quyết định. Mỗi câu kèm phương án mặc định tôi khuyên.

1. **Hoa hồng CTV:** một mức chung hay khác theo sản phẩm? Mức là bao nhiêu?
   Mặc định: một mức chung trong cấu hình, cho phép ghi đè theo SKU bằng CSV. Phải nhập xong trước khi mở CTV.
2. **Đơn khách đặt qua chat hoặc điện thoại:** CSKH lên đơn trong app (khách được điểm, có lịch sử) hay giữ trên Pancake?
   Mặc định: lên đơn trong app (D1-02). Trong lúc chưa có, quy định rõ trong sổ tay rằng đơn Pancake không tích điểm.
3. **Sửa đơn:** cấm sửa trên Pancake ("huỷ và đặt lại") hay xây chức năng sửa địa chỉ trong app?
   Mặc định: ra mắt với quy tắc cấm sửa kèm cảnh báo lệch tổng (S). Chức năng sửa địa chỉ trước khi đóng gói làm sau.
4. **CSKH chat bằng công cụ nào** (Zalo OA Manager hay Pancake)? Có giữ bot tự trả lời theo mẫu không?
   Mặc định: giữ bot ngoài giờ hành chính, tắt trong giờ có người trực.
5. **Kế toán và marketing có phải người riêng không?**
   Mặc định: có. Thêm 2 nhóm việc, không cấp ADMIN cho họ.
6. **Ai duyệt bài cộng đồng, trong bao lâu?**
   Mặc định: CSKH duyệt trên web trong 4 giờ làm việc. Mở cho người đã có 1 đơn giao thành công được đăng thẳng không cần duyệt (cần sửa luật "tin cậy"; chưa kiểm luật hiện tại).
7. **Nhân viên dùng điện thoại hay máy tính?** Q-29 đã chọn máy tính.
   Mặc định: giữ Q-29, nhưng bảo đảm 3 màn CSKH/KHO dùng tốt ở 390px (hiện đã đạt) và đưa kiểm duyệt cộng đồng lên web.
8. **Trưng bày (danh mục, nổi bật, banner) làm trước hay sau ra mắt?**
   Mặc định: trước ra mắt làm tối thiểu: CRUD danh mục và gán sản phẩm vào danh mục. Banner làm sau.
