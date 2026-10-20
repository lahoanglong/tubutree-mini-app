# Báo cáo sáng 2026-10-20: UAT trước khi mở khách

Viết lúc 07:45. Phiên đêm bị ngắt khoảng 00:20 đến 07:30, nên vài việc chưa xong. Mục "Còn đang chạy" ở cuối ghi rõ việc nào và kết quả sẽ cập nhật vào file này.

## 1. Kết luận

**Chưa mở cho khách được.** Lý do, theo thứ tự:

1. **Việc của chủ chưa xong** (mục 5, các việc 1 đến 7): khoá Pancake thật, DNS, chuyển khoản QR thật, FAQ, nội dung pháp lý (tên công ty, mã số thuế), biến build Mini App, khoá Zalo OA/ZNS.
2. **Mã sửa đêm nay chưa vào main.** Mọi bản sửa nằm trên nhánh cục bộ `uat/int` (120 commit sau 05e6ae97). Chưa push, chưa PR, chưa deploy (đúng luật đêm nay).
3. **Đợt sửa 5 đang làm.** Đợt này có một lỗi tiền: khách chuyển khoản thiếu rồi chuyển bù, mã QR lần hai vẫn đòi đủ tiền cả đơn (U1-B04). Khách có thể trả dư. Cần xong đợt này trước khi mở.
4. **Gate cuối và Playwright web trên bản cuối chưa chạy.**

Không có lỗi P0. Đêm nay tìm được 11 lỗi P1. Mọi lỗi P1 có bản sửa đã gộp vào `uat/int`, trừ D8-5 (nội dung pháp lý, chủ tự điền).

## 2. UAT theo vai trò

Lượt đầu chạy trên mã 05e6ae97, chưa có bản sửa nào. Chi tiết từng ca ở `uat/U*.md`, ảnh ở `uat/shots/`.

| Làn | Vai | Ca | PASS | FAIL | BLOCKED |
|---|---|---|---|---|---|
| U1 | khách mới từ QR hộp, mua, chuyển khoản | 35 | 31 | 4 | 0 |
| U2 | khách quay lại: Điểm Xanh, hạng, gói định kỳ | 34 | 33 | 1 | 0 |
| U3 | CTV, đại lý, nhận hàng | 45 | 39 | 5 | 1 |
| U4 | đổi rác, cộng đồng, trò chơi | 40 | 36 | 3 | 1 |
| U5 | admin, nhân viên, kế toán, chủ thương hiệu, kiểm duyệt | 39 | 34 | 4 | 1 |
| U6 | khách trên web, khổ 390 và 1440 | 61 | 38 | 19 | 4 |

U6: 9 trong 19 ca FAIL là lỗi bộ khung (trình duyệt bị đóng khi phiên tắt), không phải lỗi sản phẩm. Các ca này đang chạy lại.

Ca FAIL của U1–U5 và chỗ sửa:

| Ca | Lỗi | Sửa ở |
|---|---|---|
| U1-07 | Sắp xếp theo giá dùng giá gốc thay vì giá bán | đợt 5 (đang làm) |
| U1-10 | Giỏ có hàng hết | đợt 5 (đang làm) |
| U1-20 | Chuyển bù vẫn hiện số tiền cả đơn | đợt 5 (đang làm) |
| U1-24 | Quá hạn chuyển khoản vẫn hiện QR | đợt 2, 9dcc431b |
| U2-19b | Không đổi được chu kỳ gói định kỳ | chờ chủ (Q22) |
| U3-25, U3-26, U3-30 | Đơn sỉ không có tối thiểu 3 triệu, luôn miễn ship, không khoá mua chịu | đợt 2, 269aec88 |
| U3-37 | Link CTV không đếm chuyển đổi | đợt 5 (đang làm) |
| U3-38, U4-04 | Đại lý nhận được hộp sữa, vỏ chai | đợt 2, 93b1e221 |
| U4-26, U5-54 | CSKH ghim được bài cộng đồng | đợt 1, quyen-admin |
| U4-29 | Quà sự kiện ngoài 20.000–50.000 điểm vẫn nhận | đợt 5 (đang làm) |
| U5-35 | Marketing tạo flash sale giảm 90% | đợt 1, flash-sale-staff |
| U5-46 | "Việc cần xử lý" lệch số theo vai trò | đợt 1, quyen-admin |
| U5-48 | Khoá tiền affiliate.*, coupon.* lưu không hỏi lại | đợt 5 (đang làm) |

Ba ca BLOCKED cần dịch vụ thật nên không chạy được trên máy: U3-45 (ZNS), U4-19 (Gomdon), U5-55 (vị trí Zalo).

**Chạy lại ca FAIL trên mã mới: chưa làm.** Làm sau khi đợt 5 gộp.

## 3. Bản sửa và số test

Tổng hợp 140 mục: P0 0, P1 11, P2 41, P3 88 (`00-tong-hop.md`). 26 gói sửa trong 5 đợt (`impl/dot2.md`, `dot3.md`, `dot4a.md`, `dot4b.md`). Mỗi gói làm theo TDD, có review Opus. Gói đụng tiền, điểm, quyền, tin khách, migration có review 2 lượt.

Bốn migration mới:
- `20261020010000_waste_item_warehouse_only`
- `20261020100000_best_answer_reward_note_template`
- `20261020100000_review_return_reversal`
- `20261020110000_coupons_admin_list_index`

Số test, đầu đêm so với gate gần nhất xanh trọn vẹn (gate 4, `uat/int` 755fede9, `logs/gate-int-4.out`):

| Bộ | Đầu đêm 05e6ae97 | Gate 4 755fede9 |
|---|---|---|
| jest api | 426 suite / 9308 test | 433 / 9540 |
| race (Postgres thật) | 253 / 1964 | 265 / 2033 |
| vitest miniapp (VN và UTC) | 283 / 4313 | 293 / 4449 |
| vitest web (VN và UTC) | 358 / 6178 | 361 / 6298 |
| vitest app-core | 41 / 489 | 41 / 489 |
| Playwright Mini App | 170 test | 168/170; 2 test hỏng do giao diện đổi, đã sửa ở a6c3ecc6, chạy lại file đó 8 passed |

Số test không giảm ở bộ nào.

Sau gate 4 có thêm đợt 4a và 6 commit sửa nhỏ, nên tip hiện tại là 4d71b653. Gate 5 trên 4d71b653: lần đầu bị ngắt sau bước jest (437 suite / 9619 test pass), đang chạy lại.

## 4. Lỗi web khách đã chuyển phiên web (d3)

Phiên web nhận đủ 5 lô, ghi ở `PROGRESS.md` mục "Phối hợp":
- lô 1: D7-28 đến D7-36, D15-01;
- lô 2 đến lô 4: màn Mini App đổi để web theo;
- lô 5: chữ mua chung % và "Voucher chào mừng".

Lỗi web của U6 chưa gửi. Lô 6 sẽ gửi sau khi chạy lại U6 xong.

## 5. Việc chủ cần làm, theo thứ tự

1. Điền khoá Pancake thật (PANCAKE_API_KEY, PANCAKE_SHOP_ID) khi deploy.
2. Cấu hình DNS cho web và API.
3. Chuyển khoản thật qua màn QR trên bản gần giống production.
4. Nhập FAQ ở tab Cấu hình.
5. Nhập nội dung pháp lý cho legal.dieu-khoan, legal.bao-mat, legal.doi-tra, legal.van-chuyen: tên công ty, mã số thuế, địa chỉ, số ngày.
6. Đặt VITE_ZALO_OA_ID, VITE_CLOUDINARY_* khi build Mini App.
7. Đặt khoá Zalo OA, ZNS và mẫu ZNS đã duyệt (docs/GO-LIVE-KEYS.md). Gửi thử một tin vào OA trước khi bật tự trả lời.
8. Chạy grant-admin với ADMIN_PHONE đúng dạng, nạp seed với `--with-business-defaults` (runbook bước 7b).
9. Xác nhận hotline và email CSKH.
10. Điền shippingEta.
11. Hỏi kế toán cách khấu trừ TNCN khi CTV rút nhiều lần (Q2).
12. Khi có SSL: bật HSTS, giữ CSP Report-Only tuần đầu.
13. Trả lời câu hỏi ở `98-cau-hoi.md` (Q1–Q24). Các câu cần quyết trước khi mở khách sẽ hỏi trực tiếp sáng nay.

## 6. Kế hoạch gộp vào main

Kiểm trên máy lúc 07:42:

```
git merge-tree --write-tree uat/int web/mobile-visual        -> exit 0
git merge-tree --write-tree uat/2026-10-20 uat/int           -> exit 0
file cùng sửa ở cả uat/int (413 file) và web/mobile-visual (244 file): 0
```

Thứ tự đề xuất:

1. Trong worktree `uat`: `git merge --no-ff uat/int`, rồi gộp đợt 5, rồi chạy gate cuối và Playwright Mini App + web.
2. Mở hai PR vào main: `uat/2026-10-20` và `web/mobile-visual`. **Gộp cùng đợt**, vì chữ "mã giảm %" của web cần API mua chung 29795d4e.
3. Gộp PR UAT trước, rồi rebase hoặc merge PR web lên main mới. Chạy lại vitest web và Playwright web trên kết quả gộp.
4. Deploy theo runbook. Bốn migration đêm nay nằm ngoài danh sách tương thích image (runbook đã ghi), nên phải backup trước khi migrate.

Việc 2 đến 4 cần chủ ra lệnh. Đêm nay không push, không PR, không deploy.

## 7. Còn đang chạy

| Việc | Trạng thái |
|---|---|
| Đợt sửa 5: 6 gói (tiền chuyển bù, giỏ Mini App, CTV/sự kiện/thẻ hộp, admin, đảo đơn/flash, tài liệu) | chạy lại từ 07:36 |
| Gate 5 trên 4d71b653 | chạy lại từ 07:37 |
| Chạy lại 9 ca U6 hỏng do bộ khung, điều tra U6-90 (hệ số hạng khi tích điểm, cặp đơn trùng trong 5 giây) | đang chạy |
| Gộp đợt 5, gate cuối, Playwright web, chạy lại ca FAIL U1–U6 | chưa bắt đầu |
