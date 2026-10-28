# 01 Chụp web khách và admin (lane 5, main 9d0e95bd5)

Công cụ: `R/tools/capture.mjs`, tổng hợp bằng `R/tools/sum-web.mjs` (chạy lại được). Ảnh ở `R/screens/<nhãn>/`, index ở `R/screens/index-<nhãn>.jsonl`. Mọi đường dẫn ảnh dưới đây tính từ `R/screens/`.

## Số ô

420 ô, 778 ảnh, 0 ô lỗi công cụ (một ô `game__returning__web375-error500` lỗi lần đầu, chạy lại một lần thì được).

| Nhãn | Ô | Ảnh | Ghi chú |
|---|---|---|---|
| web375 (ok) | 154 | 250 | mọi route x persona |
| web768 (ok) | 17 | 45 | chỉ KEY_SCREENS, persona returning |
| web1280 (ok) | 61 | 139 | mọi route, persona returning (đúng ma trận của capture) |
| admin1280 | 43 | 88 | 42 tab + màn thu ngân, persona admin |
| admin375 | 43 | 75 | như trên |
| web375 loading / slow5s / error500 / offline / empty / longtext | 6 x 17 = 102 | 17/34/26/28/31/43 | KEY_SCREENS, returning (affiliate dùng ctv, dealer dùng dealer) |

Quầy đổi rác: `recycle-desk` persona staff ở web375 (`web375/recycle-desk__staff__web375__s1.png`), persona returning cũng chụp để so. Không chụp `recycle-desk` ở khổ admin vì không phải tab admin.

## Lỗi của công cụ đã sửa (chỉ `capture.mjs`, phần web/admin)

Lần chụp đầu, 40% ô gặp `POST /api/auth/refresh` trả 429 (API lane giới hạn tốc độ), nên khi nạp lại trang ở các trạng thái error500/offline/empty/longtext thì phần lớn màn kẹt "Đang tải…" mà không phải lỗi sản phẩm. Đã thêm: với ô web/admin, mọi request `/api/` sau khi mở phiên gửi thêm header `x-throttle-bypass` (đọc `THROTTLE_BYPASS_TOKEN` trong `lane.env`). Chụp lại toàn bộ web375, web768, web1280, admin (bản `--force`). Bản chụp cũ bị ghi đè. Ô Mini App không đổi (nhánh `!mini`), `node --check` qua, `--list` vẫn ra 1080 ô.
Còn sót: 127 ô `ok` vẫn có 1 lần 429 ở lần refresh đầu (lúc `openWeb` đăng nhập, trước khi gắn header; nằm trong bộ khung, không được sửa). Trang vẫn lên đúng, không ảnh hưởng ảnh. Đây là lỗi chụp, không phải lỗi sản phẩm. Các lỗi 4xx/5xx khác ở bảng dưới là thật.

## Màn trắng

0 ô (ngưỡng: dưới 20 chữ cái và không có ảnh), ở cả ok lẫn các trạng thái.

## pageErrors

1 ô: `product-slug__guest__web375`, "Hydration failed because the server rendered HTML didn't match the client" (React tự dựng lại cây trên client). Thêm 1 cảnh báo console "A tree hydrated but some attributes ... didn't match" ở nhóm trạng thái. Chưa tìm nguồn (cần so SSR với client của trang chi tiết SP khi là khách; chưa kiểm mã). Không lặp ở persona returning.

## consoleErrors (gom, ô ok)

| Số lần | Nội dung | Nhận xét |
|---|---|---|
| 127 | `Failed to load resource: ... 429` | do bộ khung, xem trên |
| 11 | `... 404` | `GET /storefront/me`, `GET /brand/owner/me` (persona returning vào trang CTV/chủ nhãn khi chưa có gian hàng/nhãn): 404 thay vì trả rỗng |
| 6 | `... 403` | `GET /merchant/store`, `/academy/courses`, `/academy/courses/:id` (returning chưa có quyền) |

Ô trạng thái (cố ý chặn): offline 227 `ERR_INTERNET_DISCONNECTED`, error500 216 `500`. Đúng mong đợi, không tính là lỗi sản phẩm.

## apiErrors (ô ok, không tính 429)

| Request | Status | Màn gặp |
|---|---|---|
| GET /storefront/me | 404 | storefront web375/web1280 (returning) |
| GET /brand/owner/me | 404 | brand-owner web375/web1280 |
| GET /merchant/store | 403 | merchant web375/web1280 |
| GET /academy/courses, /academy/courses/:id | 403 | academy, academy-courseid |

Đây là các trang vai trò khác mở bằng persona khách thường; kiểm xem trang có hiện thông báo "chưa có quyền" thân thiện không: chưa kiểm. Không có lỗi 5xx ở ô ok.

## axe

Bộ khung `runAxe` đã lọc sẵn mức serious/critical. Kết quả ô ok:

| Rule | Số ô | Màn |
|---|---|---|
| page-has-heading-one | 2 | `admin__returning__web375`, `admin-community__returning__web375` (đúng vai trò returning không có quyền, trang hiện báo không đủ quyền không có h1; ít quan trọng) |
| definition-list | 2 | `tab-waste` admin1280, admin375 |
| landmark-unique | 2 | `tab-reports` admin1280, admin375 |

web768 và web1280 khách: 0 vi phạm axe. Không có color-contrast hay target-size ở mức serious.

## Vùng bấm nhỏ (dưới 44 px, cộng mọi ô ok)

web375 142, web768 174, web1280 686, admin1280 1753, admin375 117. Top 15 màn (admin chiếm gần hết):

| Ô | Số | Ví dụ |
|---|---|---|
| tab-notificationTemplates admin1280 | 524 | nút Lưu, ô nhập mẫu |
| tab-config admin1280 | 69 | công tắc, ô nhập |
| tab-users admin1280 | 67 | nút Khoá, liên kết tên |
| tab-coupons admin1280 | 53 | |
| tab-commissionRates admin1280 | 47 | |
| tab-staffRoster admin1280 | 46 | |
| tab-inbox admin1280 | 45 | "Về cửa hàng" 120x36, "Đăng xuất" 108x36 (nút đầu trang, lặp mọi tab) |
| tab-cashback admin1280 | 45 | |
| tab-waste admin1280 | 44 | |
| tab-payroll admin1280 | 43 | |
| tab-orders admin1280 | 42 | |
| tab-engagement admin1280 | 36 | |
| tab-reports admin1280 | 33 | |
| tab-brands admin1280 | 32 | |
| tab-storefronts admin1280 | 30 | |

Web khách: nhiều nhất là menu trên (`Danh mục`, `Vườn Xanh` 92x36, 98x36) ở web1280/768, 23 phần tử mỗi trang danh sách; ở web375 là liên kết tên sản phẩm 251x20, logo 83x30, nút giảm số lượng 36x36 (giỏ), gợi ý chat 189x38. Ngưỡng 44 px là của Mini App; trên màn 1280 dùng chuột nên nhẹ hơn.

## Trạng thái lỗi và mất mạng không có nút thử lại (web375, 17 màn)

Sau khi sửa công cụ: 0 màn thiếu nút "Thử lại" ở cả error500 và offline (17/17 mỗi loại có "Thử lại", đã xem ảnh nhiều màn). Phát hiện thật nhìn từ ảnh:

1. offline dùng nguyên câu "Máy chủ đang bận, thử lại nhé" (`web375-offline/browse-category__returning__web375-offline__s1.png`, `.../cart...`): khi mất mạng thì nói máy chủ bận là sai, nên có câu "Không có kết nối mạng".
2. Thông báo lỗi không đồng nhất: ba kiểu (khung cảnh báo + Thử lại + số hotline: game, orders, browse; dòng đỏ "Không tải được danh sách địa chỉ. Thử lại": checkout; trang trắng chỉ có tiêu đề "Không tải được đơn hàng" và nút xanh: order-code, `web375-error500/order-code__returning__web375-error500__s1.png`). Trang chi tiết đơn lặp tiêu đề và thân.
3. checkout khi lỗi: khối "Sản phẩm" biến mất, chừa khoảng trắng giữa Địa chỉ và Mã giới thiệu, nút Đặt hàng xám mà không giải thích vì sao (`web375-error500/checkout__returning__web375-error500__s1.png`).
4. product-slug lỗi 500: trang hiện đủ (dữ liệu SSR) nhưng thiếu khối ưu đãi và điểm; không báo gì (`web375-error500/product-slug__returning__web375-error500__s1.png`).
5. home lỗi 500: chỉ "Ưu đãi giờ vàng" có nút Thử lại; banner, thanh hạng điểm, "Mua lại" biến mất không báo (`web375-error500/home__returning__web375-error500__s1.png`).
6. offers lỗi: câu "Chưa tải được lịch điểm danh: Máy chủ đang bận, thử lại nhé" ghép hai ý.

## Trạng thái tải không có skeleton

loading (700 ms) và slow5s (s1 ở 1,5 giây): 16/17 màn có khung chờ. Thiếu: `product-slug__returning__web375` (cả loading lẫn slow5s s1): không có skeleton, nhưng vì có SSR nên đã hiện nội dung cơ bản, chỉ phần điểm/ưu đãi hiện muộn (ghi nhận, nhẹ). Không có ô nào trắng khi chờ.

## empty

17/17 màn không trắng, không lỗi. Hiện đúng: giỏ "Giỏ hàng đang trống", thanh toán "Giỏ hàng đang trống", đơn hàng "Bạn chưa có đơn nào". Các màn còn lại (profile, loyalty, wallet, game, affiliate, dealer, recycle) hiện số 0 và khung trống, không có dòng hướng dẫn riêng cho danh sách rỗng ở vài chỗ (chưa kiểm từng khối).

## longtext (tên 120 ký tự)

17/17 không tràn ngang trang. Đã xem: giỏ (tên xuống 4 dòng, nút không bị đẩy), danh sách SP (cắt ba chấm 2 dòng, tốt), chi tiết đơn (xuống 4 dòng), Cá nhân (`web375-longtext/profile__returning__web375-longtext__s1.png`): tên 4 dòng, nhãn hạng 3 dòng, ảnh đại diện lệch xuống giữa, nên cắt hoặc giới hạn 2 dòng. Không thấy tràn khỏi khung.

## Điều thấy khi xem ảnh

Web375 ok (đã xem cả 17 màn, `web375/<khoá>__returning__web375__s1.png`; affiliate persona ctv, dealer persona dealer):
- Mẹo nổi "Trồng cây mỗi ngày, nhận quà thật" đè lên nội dung ngay trên thanh đáy ở home, danh mục, tìm kiếm, ưu đãi, cá nhân (`web375/home__returning__web375__s1.png`: che chữ "Mua lại" và thẻ sản phẩm). Là gợi ý lần đầu nên chụp ở phiên sạch; chưa kiểm sau bao lâu thì tắt.
- Cá nhân, "Đơn của tôi": ô "Đã giao" hiện dấu "·" thay vì số (`web375/profile__returning__web375__s1.png`; cũng ở web1280 `web1280/profile__returning__web1280__s1.png`) dù persona có 4 đơn đã giao. Nhãn "Chờ thanh toán" xuống 3 dòng làm các số lệch hàng.
- home: thẻ "Đơn 120.000đ chờ chuyển khoản" xuống dòng 4 lần ở cột chữ hẹp, nút xanh to chiếm gần nửa chiều ngang.
- Trang web375 có thanh đáy (home, danh mục, ưu đãi, vườn, cá nhân) hay chân trang Hotline + liên kết (giỏ, đơn, ví, game ở trang con) đúng kiểu Mini App; Vườn Xanh có thanh tab nền trắng lẫn nền kem (khung trắng nhỏ ở hai góc `web375/game__returning__web375__s1.png`).
- Quầy đổi rác: staff thấy báo cáo tháng và hạn mức ngày, returning thấy "Tài khoản của bạn chưa được gắn với điểm nhận nào" (đúng).

Web1280 (home, danh mục, chi tiết SP, giỏ, thanh toán, Cá nhân, `web1280/*`):
- home 1280: toàn bộ nội dung nằm trong cột trái ~580 px, nửa phải trống (`web1280/home__returning__web1280__s1.png`). Giống bố cục điện thoại kéo giãn, không tận dụng màn rộng.
- danh mục 1280 lúc chụp hiện nút "Tài khoản" thay vì avatar và chuông (phiên chưa kịp nhận diện) trong khi các trang khác cùng persona hiện "N Lại" (`web1280/browse-category__returning__web1280__s1.png`): nhấp nháy trạng thái đăng nhập, chưa kiểm có phải chậm hydrate hay thật.
- chi tiết SP, giỏ, thanh toán 1280 gọn, hai cột, có breadcrumb; Ví Tubu 0đ bị làm mờ kèm "Số dư chưa đủ" (tốt).

Admin (xem 12 màn ở 1280 + 3 tab ở 375, `admin1280/*`, `admin375/*`):
- Có menu trái 9 nhóm, ô tìm mục, nút "Màn thu ngân". "Việc cần xử lý" mở đầu ngắn gọn: "Không còn việc nào đang chờ" + 26 chip bằng 0 (nhiều chip trống chiếm cả màn khi không có việc; `admin1280/tab-inbox__admin__admin1280__s1.png`).
- Đơn hàng: trước bảng có 3 hàng bộ lọc + 3 hàng chip, bảng chỉ lộ ra ở nửa dưới màn 800 px; ô ngày hiện `mm/dd/yyyy` (định dạng Mỹ) ở cả 1280 và 375 (`admin1280/tab-orders__admin__admin1280__s1.png`, `admin375/tab-orders__admin__admin375__s1.png`): nhập sai ngày dễ.
- Tổng quan chỉ số: số liệu rõ (doanh thu 1.720.000đ, 2 đơn). Giữ chân khách: "Chưa có số liệu... hệ thống tính một lần mỗi đêm" kèm nút "Mở Báo cáo" (ổn).
- Báo cáo: tháng/ngày mm/dd/yyyy; đoạn giải thích nền xanh dài 5 dòng chữ nhỏ.
- Đổi rác: lưới 6 chỉ số và bảng Hàng nhận có mũi tên sắp thứ tự; cột "Giọt nước · gram mỗi đơn vị" hiển thị `0 · —` khó hiểu.
- Chat CSKH: khung đỏ "Mất kết nối" cầu nối Zalo, nút Đăng nhập Zalo; công tắc "Cho khách chat: đang bật (nhưng cầu nối đang mất kết nối)" tự mâu thuẫn. Đây là dữ liệu lane (cầu nối không chạy), không phải lỗi mã.
- Mẫu thông báo: 524 vùng bấm dưới 44 px (mọi mẫu một khối lặp), nút Lưu xám khi chưa sửa; banner vàng báo chưa có mẫu ZNS.
- Cấu hình: danh sách công tắc dài, mỗi công tắc có trạng thái chữ "Đang bật/Đang tắt" (tốt); công tắc "Cho khách chat" không có công tắc, chỉ có liên kết.
- Người dùng: bảng đầy dòng "Khách / — / 0 điểm" (tài khoản khách ẩn danh), nút Khoá đỏ lặp mỗi dòng; khó tìm người thật.
- Sức khoẻ hệ thống: "Mọi chỉ số trong ngưỡng", Pancake đã cấu hình, Gomdon chưa cấu hình, báo động email/tự động "Chưa bật".
- Màn thu ngân: banner "Tích điểm tại quầy đang TẮT" (do lane), ô quét có focus rõ; phần còn lại trắng rất nhiều ở 1280.
- Admin375: thanh trên gọn (logo, nút cửa hàng, Đăng xuất), chọn mục qua "Đổi mục"; bộ lọc đơn xếp dọc 6 hàng trước khi thấy bảng đơn.
- Không có ô admin nào trắng, lỗi trang hay 5xx. Mọi tab đã chụp đều ra ảnh; chỉ mở xem trực tiếp 12 màn ở 1280 (inbox, dashboard, analytics, reports, orders, waste, notificationTemplates, supportChat, config, users, opsHealth, pos) và 3 ở 375 (inbox, orders, waste); phần còn lại chỉ có số đo (không trắng, không lỗi).

## Chưa làm / chưa kiểm

- Chưa xem ảnh 31 màn admin1280 còn lại, 40 màn admin375 còn lại, s1 error500 của 9 màn web375 (loyalty, wallet, chat, cart, recycle, dealer, affiliate, order-code, browse-search), s1 offline của 13 màn web375, web768, s1 web1280 của các route ngoài 6 màn đã xem (chỉ số đo; tình trạng retry lấy từ dò DOM).
- Nguồn lỗi hydrate `product-slug` guest chưa tra mã.
- Chạy `--phase web768` chỉ KEY_SCREENS persona returning theo yêu cầu (17 ô); ma trận gốc cho web768 có 61 ô.
