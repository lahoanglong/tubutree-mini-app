TITLE: feat(tai-khoan): ngày giao dự kiến, chi tiết đơn và Cá nhân trên web giống Mini App

## Vấn đề

- Đơn đang giao chỉ ghi "Đặt lúc …", không có ngày giao dự kiến (R-9).
- Chi tiết đơn web 375 khác Mini: món không có ảnh, thiếu khối Ghi chú, màn lỗi và khung chờ tự dựng (R-35, R-107, R-108).
- Hàng "Đơn của tôi" ở Cá nhân không biểu tượng, nhãn xuống dòng, số lệch; lối chat nằm cuối trang; Đăng xuất có ở ba chỗ (R-33, R-34, R-111).
- Trạng thái rỗng của đơn, địa chỉ, thông báo trên web khác Mini; đơn rỗng không gợi ý món (R-36, R-113, R-115).
- Mini hiện giờ theo múi giờ của máy, web theo giờ Việt Nam (R-109).

## Đã làm

Chi tiết đơn (Mini và web)
- R-9: dòng "Dự kiến giao dd/MM – dd/MM" ở đầu đơn và ở mốc "Giao thành công". Tính từ giờ đặt đơn cộng `shipping.eta_min_days` và `shipping.eta_max_days`, theo ngày Việt Nam. Dùng chung `packages/app-core/src/shipping-eta.ts`. Chỉ hiện với đơn đã xác nhận, đóng gói hoặc đang giao. Ẩn khi: chưa cấu hình, ngày cuối đã qua, đơn có món đặt trước, đơn đối tác (MERCHANT), hoặc Tubu đang xử lý tay. Ngày sớm nhất không lùi về quá khứ.
- R-107: món trong đơn có ảnh 48px, bấm mở trang sản phẩm.
- R-108: web theo thứ tự khối của Mini, có khối Ghi chú; khối hỗ trợ ở cuối trang.
- R-35: web có khung chờ và màn lỗi như Mini (404, 500, mất mạng).
- R-109: giờ Mini cố định `Asia/Ho_Chi_Minh` như web.

Cá nhân và danh sách
- R-33: hàng đơn có biểu tượng và chấm số (ẩn khi 0); lỗi tải số đơn có Thử lại. Nhãn ngắn: "Xử lý", "Thanh toán". Nhãn đầy đủ vẫn dùng cho người đọc màn hình.
- R-34: chat với Tubu ở đầu trang.
- R-53 (phần menu tài khoản): hàng Học viện chỉ hiện với AFFILIATE, DEALER, STAFF, ADMIN.
- R-110 (phần avatar): avatar là chữ cái đầu.
- R-111 (phần Đăng xuất): Đăng xuất chỉ ở Cài đặt, ẩn với tài khoản khách. Có sửa `about-view.tsx` của web (trang Giới thiệu) để bỏ Đăng xuất, file này thuộc phạm vi gói gioi-thieu.
- R-36, R-113, R-115: trạng thái rỗng của đơn, địa chỉ, thông báo dùng `EmptyState` như Mini. Đơn rỗng có hàng món bán chạy. Khi chưa có địa chỉ, nút Thêm địa chỉ là nút chính.
- R-30 (ô Định kỳ ở Cá nhân, Mini): nhánh đã gộp muahang để dùng cờ `SUBSCRIPTIONS_IN_MINIAPP`. Khi cờ tắt, hàng đơn còn 4 ô và không gọi danh sách định kỳ. Web giữ ô Định kỳ (`fd04b4ec1`).

## Làm một phần hoặc để sau

- R-110: ô ngày sinh vẫn là ô ngày gốc của trình duyệt, hiện mm/dd/yyyy tuỳ máy khi chưa lưu ngày. Làm ô tự dựng đổi dữ liệu và nhiều test, không rẻ.
- R-111: nút "Xoá tài khoản" vẫn ở trang Giới thiệu, chưa dời sang Cài đặt.
- R-53: dòng Học viện ở earn-sheet chưa làm (phần của gói doirac).
- R-113: khách mới không thấy mã chào mừng ở đơn rỗng vì dữ liệu seed không có mã WELCOME cá nhân; không phải lỗi mã. Chưa kiểm việc sinh mã khi đăng ký trên môi trường thật.
- Ngày giao dự kiến tính từ giờ đặt đơn, không phải giờ xác nhận. Đơn chuyển khoản trả muộn có thể lệch tới 1 ngày sớm hơn.
- Ảnh dòng "Dự kiến giao" trên đơn đang giao chụp lúc 12:34, trước `5ffd3c5f1` (ẩn khi Tubu xử lý tay, ngày đầu không lùi về quá khứ). Cách hiện với đơn thường không đổi, nhưng chưa chụp lại ở bản cuối (R-172).

## Quyết định của chủ áp dụng ở PR này

Không có.

## Số đo

- tsc (shared-types, api, web, miniapp, app-core, e2e), eslint (api, miniapp, web): đạt.
- vitest: app-core 71 file / 927 test; miniapp 313 / 4872 (cả TZ=UTC); web 441 / 7449. Đạt.
- jest api: 484 suite / 11217 test. Đạt.
- lint:parity: đạt.
- vite build Mini: đạt. Lần chạy cổng đầu báo FAIL vì công cụ thiếu biến môi trường; đã sửa công cụ, chạy lại thì đạt.
- Lần chạy lại sau commit cuối: `gates/taikhoan-g3.txt`, chạy sau `69edeec77`, 0 FAIL: tsc, eslint, vitest app-core 942/942 (73 file), miniapp 4891/4891 (316 file, cả TZ=UTC), web 7475/7475 (443 file), jest api 484 suite / 11217 test, lint:parity, vite build; gói Mini entry 711/222 KB, tổng 1923/742 KB (đã gồm muahang).
- Playwright: Mini App 205 đạt, 10 bỏ qua (1,3 phút, chạy sau commit cuối `55319a01a`); web gate 356 đạt, 38 bỏ qua (5,4 phút, chạy sau `fd04b4ec1` và bản gộp muahang; hai commit sau đó chỉ đổi Mini App). Lần chạy đầu web hỏng 1 ca vì `GET /products` chưa mock, đã sửa ở `1cb133d8e`.
- Gói Mini App, phần riêng của taikhoan (trước khi gộp muahang): entry 711 KB raw / 222 gz, bằng trước. Tổng 1911,3 → 1917,2 KB raw (+5,9); gz 737,1 → 739,7 KB. Chunk đổi: profile +2,2 KB (15,0 → 17,2), order-detail +1,1 KB (33,1 → 34,2), shipping-eta mới 1,0 KB, profile-avatar mới 1,0 KB, package-check mới 0,6 KB, notifications -0,5 KB (12,6 → 12,1). Sau khi gộp muahang, nhánh có thêm phần của muahang (+6,1 KB raw / +2,5 KB gz); số cả nhánh: entry 711/222 KB, tổng 1923/742 KB (`gates/taikhoan-g3.txt`).
- First Load web (kB, trước → sau):

| Trang | Trước | Sau |
|---|---|---|
| /tai-khoan/don-hang/[code] | 191 | 193 |
| /tai-khoan | 170 | 172 |
| /tai-khoan/don-hang | 184 | 186 |
| /tai-khoan/dia-chi | 140 | 141 |
| /tai-khoan/ho-so | 144 | 145 |

  Các trang ngoài chi tiết đơn lấy từ đợt B; đợt C ghi các trang đó không đổi mã sau đó. Chi tiết đơn từ 194 xuống 193 nhờ tải trễ nhắc OA, hoá đơn, đổi rác, chép mã vận đơn.
- Review Opus: lượt 1 "chưa merge"; lượt 2 (đợt C) "merge được"; lượt xem các commit sau đợt C (sửa chú thích, sửa e2e `1cb133d8e`) "merge được", không có phát hiện; lượt xem bản lọc ô Định kỳ (`fd04b4ec1`) có một P2: nút Thử lại số đơn vẫn gọi danh sách định kỳ khi cờ tắt, vì `refetch()` bỏ qua `enabled`. Đã sửa ở `69edeec77`, có test đỏ khi bỏ guard. Lượt xem `69edeec77` kết luận "merge được". P3 về test cờ ở thông báo đã sửa ở `55319a01a`. P3 còn lại: ảnh ETA chưa chụp lại ở bản cuối (R-172). Ngày giao tính từ giờ đặt đã ghi ở mục "Điều chủ cần biết" của backlog.
- Sửa e2e `1cb133d8e`: ca đặt đơn bằng Ví đi qua danh sách đơn rỗng, kệ món bán chạy gọi `GET /products` chưa mock. Ca này hỏng cả lần chạy lại.

## Ảnh trước/sau

Báo cáo có ảnh: https://claude.ai/artifact/BAptEQ6qkPB2iABaL2byxi (bản riêng tư, chủ chia sẻ để người khác xem)
Thư mục `docs/2026-10-28-review/screens-taikhoan/` (ảnh không nằm trong repo):
- `r2/profile__returning__ok__s1.png`: Cá nhân bản cuối, hàng đơn có biểu tượng, nhãn "Thanh toán".
- `r2/order-code__returning__ok__s1.png`: chi tiết đơn bản cuối.
- `eta/order-code__returning__web375__s1.png`: dòng "Dự kiến giao" ở đầu đơn đang giao (web).
- `eta/order-code__returning__mini375__s2.png`: mốc "Giao thành công" kèm ngày dự kiến (Mini).
- `orders__returning__ok__s1.png`: danh sách đơn.
- `new-s1/orders__new__ok__s1.png`: đơn rỗng có món bán chạy.
- `new-s1/addresses__new__ok__s1.png`: chưa có địa chỉ, nút Thêm là nút chính.
- `orders-row-web375.png`: hàng đơn ở Cá nhân, nhãn vừa một dòng.

## Cách kiểm

1. Quản trị, Cấu hình, nhóm shipping: đặt `shipping.eta_min_days` và `shipping.eta_max_days` (ví dụ 2 và 4).
2. Mở chi tiết một đơn đã xác nhận hoặc đang giao, Mini và web 375: thấy "Dự kiến giao dd/MM – dd/MM" ở đầu đơn và ở mốc cuối. Đơn đã giao, đơn đặt trước hay đơn đối tác không có dòng này.
3. Cá nhân với khách có đơn: hàng "Đơn của tôi" có biểu tượng và chấm số; chat ở đầu trang; Đăng xuất chỉ ở Cài đặt.
4. Khách mới: Đơn hàng rỗng có món bán chạy; Địa chỉ rỗng có nút Thêm là nút chính.
5. Web 375, chi tiết đơn: khối Vận chuyển nằm trước "Cần hỗ trợ?", khối hỗ trợ ở cuối.
6. Chạy lại cổng: `docs/2026-10-28-review/tools/gate.sh <worktree>` và `docs/2026-10-28-review/tools/pw-gate.sh <worktree> <cổng gốc>`.

## Deploy và migration

- Không có migration.
- Khoá cấu hình mới: chủ phải điền `shipping.eta_min_days` và `shipping.eta_max_days` ở Quản trị, Cấu hình, nhóm shipping (một khoảng chung cả nước). Chưa điền thì dòng "Dự kiến giao" ẩn ở mọi nơi.
- Không có biến môi trường mới.

## Thứ tự merge

Nhánh này đã gộp muahang (`1a4b19f6b`) nên phải merge sau muahang. Trước khi muahang vào main, diff của PR này có cả phần của muahang.

1 doirac → 2 khampha → 3 muahang → 4 taikhoan → 5 diemxanh → 6 ctv → 7 quantri → 8 hieunang. Merge PR tài liệu `review/2026-10-28` trước. Nhánh gói tách từ ba commit tài liệu của PR đó, nên trước khi PR tài liệu được merge, diff sẽ có thêm `docs/2026-10-28-review/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
