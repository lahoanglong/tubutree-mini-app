TITLE: feat(mua-hang): bảng chọn phân loại, thanh toán và chuyển khoản gọn như Mini, WELCOME30 chỉ khách mới

## Vấn đề

- Sản phẩm có nhiều phân loại: bấm Thêm vào giỏ hoặc Mua ngay là app lấy luôn phân loại còn hàng đầu tiên, không hỏi (R-6).
- Màn chuyển khoản bảo "mở app ngân hàng quét mã" trong khi mã nằm ngay trên máy đó. Mini không có nút lưu mã, web ẩn nút này ở khổ điện thoại (R-8).
- Thanh toán web 375: khối nhảy khi tải, lỗi giỏ vẫn hiện form "Tạm tính 0đ", chữ ghi chú và ô VAT khác Mini (R-7, R-22, R-23).
- Ví Tubu 0đ vẫn hiện, điểm Xanh không nói giảm bao nhiêu tiền, toast che nút Thanh toán sau Mua lại (R-26, R-28, R-29).
- Mini vẫn bán Định kỳ dù chủ đã chốt tạm ẩn (R-30). Mã WELCOME30 áp được cho khách cũ (R-31).

## Đã làm

Trang sản phẩm
- R-6: bảng chọn phân loại khi Thêm vào giỏ hoặc Mua ngay với sản phẩm từ 2 phân loại. Mini và web. Khoá bấm đúp nút xác nhận; web giữ số lượng đã chọn; bảng nạp lười để không tăng gói đầu.
- R-97: khối điểm dưới giá còn một dòng "Nhận ~X Điểm Xanh", bỏ dải Đơn sàn khỏi trang sản phẩm Mini.
- R-24: khối Đánh giá web không vẽ nút đăng nhập trước khi hydrate xong. Chưa tái hiện được lỗi gốc, xem phần để sau.
- R-26: toast thêm giỏ lên đầu màn; sau Mua lại không hiện toast che nút Thanh toán.

Thanh toán
- R-7, R-22: web có khung chờ đúng thứ tự khối; lỗi giỏ hiện cả trang kèm Thử lại; nêu lý do khi chưa đặt được. Bỏ khung chuyển khoản chết khỏi màn này.
- R-23: web khổ điện thoại dùng chữ ghi chú và ô VAT như Mini.
- R-27: tấm mã giảm giá có nút ngắn Dùng/Bỏ, mô tả chiếm phần còn lại, gợi ý ô nhập "Nhập mã".
- R-28, R-29, R-104: Mini và web ẩn Ví Tubu khi số dư 0đ; ô điểm ghi "Dùng X điểm, giảm Yđ" trước khi tick. Chưa có trần điểm của đơn thì chỉ ghi "Bạn có X điểm". Ô điểm bị khoá ghi "Bạn đang có X điểm". Tiêu đề Mã người giới thiệu cùng cỡ Mã giảm giá.
- R-31: WELCOME30 chỉ cho khách chưa có đơn (API, kèm migration). Chú thích "Nhận ~X" ở mã.
- R-105: màn đặt thành công ghi điểm một lần, "+X điểm, về khi đơn giao xong".

Chuyển khoản
- R-8, R-96: nút Lưu mã QR qua PlatformBridge ở Mini; web hiện lại nút ở khổ điện thoại. Câu hướng dẫn "lưu ảnh rồi mở app ngân hàng" chỉ ở khổ điện thoại. Web 375 giống Mini: số tiền to kèm nút chép, bỏ dòng Số tiền, bỏ khung QR, tên ngân hàng và chủ tài khoản xếp dọc. Nút Kiểm tra dính đáy; lời báo "chưa thấy tiền" hay lỗi mạng hiện ngay trên nút. Mini chừa đáy cho thanh dính và vùng an toàn.
- Lưu QR ở web nạp lười, tự bắt lỗi nạp mô-đun và trả "Chưa lưu được".

Mua chung, đơn hàng
- R-25, R-103: danh sách mua chung gắn với người xem nên thành viên thấy Mời bạn bè; ảnh và tên gộp một liên kết cao từ 44px.
- R-30: cờ `SUBSCRIPTIONS_IN_MINIAPP=false` ẩn Đặt định kỳ ở trang sản phẩm, màn đặt thành công, tab Đơn hàng và kệ Mua lại của Mini App.

## Làm một phần hoặc để sau

- R-7: chưa đo lại CLS và LCP của /thanh-toan. Việc chạy `run-all`, người giao làm riêng.
- R-24: chưa tái hiện được lỗi Hydration failed; giữ mở. Đã sửa chỗ nghi nhất.
- R-28: phần cho Ví trả một phần chưa làm (đổi luồng thanh toán).
- R-32: chữ chính sách hạn chuyển khoản, chờ chủ.
- R-97: popup chi tiết hạng và đơn sàn chưa làm.
- R-157: `new-customer-gift.tsx` ở trang chủ (gói khampha) còn nhắc "định kỳ"; sửa khi hai gói cùng gộp.
- R-163: luật nhãn ô điểm khoá và `pointsSummary` còn viết hai lần (web, Mini); nên gộp vào app-core.
- Thẻ "Đặt định kỳ" ở màn đặt thành công web 375 vẫn hiện, Mini đã ẩn. Cần chủ chốt.
- Nhỏ: icon cảnh báo khối "Giữ nguyên nội dung" ở web nằm cùng dòng, ở Mini nằm dòng riêng.

## Quyết định của chủ áp dụng ở PR này

- Bottom sheet khi sản phẩm có từ 2 phân loại (R-6).
- WELCOME30 chỉ cho khách chưa có đơn (R-31). Migration `20261028110000_welcome30_new_customer_only` chạy một câu: đặt `newCustomerOnly = true` cho coupon `WELCOME30` đang là `false`. Không đụng coupon khác.
- Định kỳ tạm ẩn ở Mini App (R-30). Lưu ý: chỉ Mini App ẩn. Web vẫn bán Định kỳ như cũ.

## Số đo

- tsc (shared-types, api, web, miniapp, app-core, e2e), eslint (api, miniapp, web): đạt.
- vitest: app-core 73 file / 932 test; miniapp 316 / 4876 (cả TZ=UTC); web 443 / 7461. Đạt.
- jest api: 484 suite / 11217 test. Đạt.
- lint:parity: đạt. vite build Mini: đạt.
- Race: 8 suite / 65 test đạt, người giao chạy sau khi sửa race demo-cleanup (f2442f6f6).
- Lần chạy lại sau commit cuối: `gates/muahang-g2.txt`, 0 FAIL, không chạy lại jest: tsc, eslint, vitest app-core 932/932 (73 file), miniapp 4876/4876 (316 file, cả TZ=UTC), web 7461/7461 (443 file), lint:parity, vite build; gói Mini entry 711/222 KB, tổng 1917/740 KB. Commit cuối `bdcb544b0` chỉ đổi tên một ca test.
- Playwright: Mini App 205 đạt, 10 bỏ qua (1,4 phút); web gate 354 đạt, 38 bỏ qua (3,6 phút). Chạy bằng `tools/pw-gate.sh` trên commit cuối, 0 ca hỏng.
- Gói Mini App: entry 711 KB raw / 222 gz, bằng trước (711 / 222). Tổng 1911,3 → 1917,4 KB raw (+6,1); gz 737,1 → 739,6 KB. Chunk đổi: bank-payment +2,1 KB (9,7 → 11,8), product-detail +2,1 KB (39,1 → 41,2), zmp-save-image mới 1,4 KB. Phần tăng nằm ở chunk nạp lười.
- First Load web (kB, trước → sau):

| Trang | Trước | Sau |
|---|---|---|
| /san-pham/[slug] | 174 | 176 |
| /thanh-toan | 191 | 189 |
| /tai-khoan/don-hang/[code] | 191 | 193 |
| /gio-hang | 163 | 164 |
| /mua-chung | 156 | 158 |
| /thanh-toan/chuyen-khoan/[code] | mới | 149 |
| shared | 103 | 103 |

- Hiệu năng, đo trên bản gộp 8 nhánh (`perf/after-integ.json`, 4G chậm, CPU x4; tải máy lúc đo 19,7, lúc đo gốc 1,4): CLS trang thanh toán web 0,313 → 0,046. LCP thanh toán 2,9 s → 3,2 s, nằm trong nhiễu do máy tải cao. Mini trang sản phẩm: CLS khách vãng lai 0,036 → 0,008.
- Review Opus: 6 lượt (3 ở đợt C, 2 ở đợt D, 1 lượt cuối). Lượt D2 ghi "chưa merge" chỉ vì chưa chạy cả bộ e2e; người giao đã chạy đủ Playwright (xem dòng Playwright). Lượt cuối xem `ea6ae1657` và `f2442f6f6`: "merge được". Migration đổi tên giống hệt bản cũ, câu UPDATE chạy lại nhiều lần vẫn an toàn. Test race kiểm đúng hành vi WELCOME30 mới và dọn dữ liệu. P3 tên ca test saveImage đã sửa ở `bdcb544b0`. P3 còn lại đã ghi ở phần để sau.

## Ảnh trước/sau

Báo cáo có ảnh: https://claude.ai/artifact/BAptEQ6qkPB2iABaL2byxi (bản riêng tư, chủ chia sẻ để người khác xem)
Thư mục `docs/2026-10-28-review/screens-muahang/` (ảnh không nằm trong repo):
- `product-slug-bang-chon-phan-loai__returning__ok__s1.png`: bảng chọn phân loại.
- `product-slug__returning__ok__s1.png`: khối điểm một dòng dưới giá.
- `checkout__returning__ok__s1.png`: thanh toán gọn, tấm mã giảm, ô điểm.
- `order-success__returning__ok__s1.png`: màn đặt thành công, điểm ghi một lần.
- `bank-payment-code__returning__ok__s1.png`: màn chuyển khoản, nút Lưu mã QR.
- `bank-check/web375-unpaid-bottom.png`: lời báo Kiểm tra trong thanh dính đáy.
- `group-buy__returning__ok__s1.png`: mua chung cho thành viên.

## Cách kiểm

1. Mini App, khách bất kỳ: mở sản phẩm có từ 2 phân loại, bấm Thêm vào giỏ. Phải thấy bảng chọn phân loại, không tự thêm.
2. Mini App: trang sản phẩm, đặt thành công, tab Đơn hàng và Mua lại không còn nút Định kỳ. Web vẫn còn.
3. Thanh toán Mini và web 375, tài khoản Ví 0đ: không thấy dòng Ví Tubu. Ô điểm ghi "Dùng X điểm, giảm Yđ".
4. Đặt đơn chuyển khoản: bấm Lưu mã QR; bấm Kiểm tra khi chưa chuyển, lời báo hiện trên nút.
5. Khách đã có đơn: mã WELCOME30 không áp được. Khách chưa có đơn: áp được.
6. Chạy lại cổng: `docs/2026-10-28-review/tools/gate.sh <worktree>` và `docs/2026-10-28-review/tools/pw-gate.sh <worktree> <cổng gốc>`.

## Deploy và migration

- Migration `20261028110000_welcome30_new_customer_only`: một câu UPDATE như trên, chạy lại không hại. Chạy `prisma migrate deploy` khi deploy API.
- Không có biến môi trường hay khoá cấu hình mới. Cờ Định kỳ là hằng số trong mã (`SUBSCRIPTIONS_IN_MINIAPP = false`).

## Thứ tự merge

1 doirac → 2 khampha → 3 muahang → 4 taikhoan → 5 diemxanh → 6 ctv → 7 quantri → 8 hieunang. Merge PR tài liệu `review/2026-10-28` trước. Nhánh gói tách từ ba commit tài liệu của PR đó, nên trước khi PR tài liệu được merge, diff sẽ có thêm `docs/2026-10-28-review/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
