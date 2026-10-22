# Báo cáo UAT trước khi mở khách

Bản cuối, viết 2026-10-22 khoảng 19:05. Thay bản sáng 2026-10-20. Mọi số dưới đây có lệnh và log ở `PROGRESS.md`.

## 1. Kết luận

**Mã đã sẵn sàng. Chưa mở cho khách được** vì ba việc chưa làm:

1. **Việc của chủ** (mục 5): khoá Pancake thật, DNS, thử chuyển khoản QR thật, FAQ, nội dung pháp lý, khoá Zalo OA/ZNS.
2. **Mã chưa vào main.** Mọi bản sửa nằm trên nhánh cục bộ `uat/2026-10-20`. Chưa push, chưa mở PR. Cần lệnh của chủ (mục 6).
3. **Chưa deploy.** Có 11 migration mới, nên phải backup DB trước (mục 6).

Bản ứng viên phát hành là `uat/rc2` (5c98c2fe), gộp đủ ba phần:
- nhánh UAT;
- main 2f4dd3f7, gồm PR #24 (web giống Mini App);
- PR #25 (web/uat7 098bc0cb) của phiên web.

Trên bản này:

| Kiểm | Kết quả |
|---|---|
| Gate đủ (tsc, lint, eslint, migrate, jest, race, vitest, build) | xanh, 26/26 bước |
| Playwright Mini App | 170 passed |
| Playwright web | 292 passed, 6 skipped, 0 failed |
| UAT chạy lại 6 làn | xem mục 2 |

Không có lỗi P0. Mọi lỗi P1 đã có bản sửa, trừ D8-5: nội dung pháp lý do chủ tự điền.

## 2. UAT theo vai trò

Lần đầu chạy trên mã 05e6ae97, khi chưa có bản sửa nào. Lần chạy lại dùng bản ứng viên `uat/rc` (bf5ce38a), tức nhánh UAT gộp main. Mỗi làn dùng DB mới copy từ DB mẫu dựng lại ngày 22/10. Lần chạy lại chạy mọi script của làn, không chỉ ca FAIL.

| Làn | Vai | Lần đầu (PASS / FAIL / BLOCKED) | Chạy lại |
|---|---|---|---|
| U1 | khách mới từ QR hộp, mua, chuyển khoản | 31 / 4 / 0 | 35 / 0 / 0 |
| U2 | khách quay lại: Điểm Xanh, hạng, gói định kỳ | 33 / 1 / 0 | 34 / 0 / 0 |
| U3 | CTV, đại lý, nhận hàng | 39 / 5 / 1 | 50 / 0 / 1 (thêm 6 ca mới) |
| U4 | đổi rác, cộng đồng, trò chơi | 36 / 3 / 1 | 39 / 0 / 1 |
| U5 | admin, nhân viên, kế toán, chủ thương hiệu | 34 / 4 / 1 | 38 / 0 / 1 |
| U6 | khách trên web, khổ 390 và 1440 | 49 / 8 / 4 | 56 / 1 / 4 |

Chi tiết lần chạy lại ở `uat/rerun/U*.md`, lần đầu ở `uat/U*.md`.

**Mọi ca FAIL lần đầu nay đã PASS**, trừ U6-09. U6-09 FAIL vì trang chính sách còn chỗ trống "[Tên công ty]"; đây là nội dung pháp lý chủ tự điền (D8-5), không phải lỗi mã.

Không có hồi quy, tức không ca nào PASS lần đầu mà nay FAIL. Có một số script UAT phải sửa vì giao diện đổi có chủ đích:
- chữ "Huỷ" (Q13);
- Việt hoá tên mục (Q16, Q20);
- web giống Mini App ở khổ điện thoại (PR #24);
- hộp xác nhận mới.

Mỗi lần sửa script đều ghi lý do trong báo cáo của làn.

U3 thêm 6 ca mới, kiểm đúng các ví dụ của chủ:
- Q2, thuế cộng dồn: A 1,5 triệu và B 1 triệu cùng tháng thì B giữ 250.000đ.
- Q2b, từ chối A: thuế dư tự hoàn theo cả ba đường (B còn chờ, B đã duyệt, B rút về Ví).
- Q8, trả bù: thưởng quý được trả bù cho đơn chốt muộn.
- Q8b, chụp bậc: đổi bậc sau khi quý đã trả không đổi số của quý đó.

Lần chạy lại tìm thêm 5 điểm nhỏ (P3):

| Mã | Nội dung | Xử lý |
|---|---|---|
| U1-B03 (quay lại) | Đơn đầu 199.000đ nay được miễn phí giao vì đạt ngưỡng Q12. Khách áp mã FREESHIP thì giỏ báo "Đã áp dụng", sang thanh toán lại báo chưa áp. Tiền đúng. | đang sửa (gói u1b03-nguong) |
| U3-B03 | Admin chưa đổi được bậc thưởng quý đại lý: khoá cấu hình chưa có nên lưu bị từ chối. Q8b cần việc này. | đang sửa (gói q8-bac-admin) |
| U4-R01 | Trang chủ web còn chữ "6 vùng đất" (Q14) | đã sửa trong PR #25 (kiểm trên `uat/rc2`) |
| U6-B05 | Web chưa đọc cờ `ownsBrand`, nên vẫn gọi `/brand/owner/me` và nhận 404 | đã sửa trong PR #25 (kiểm trên `uat/rc2`) |
| U6-B11 | Web bỏ dòng "điểm đang chờ" (U6-B06) nhưng bỏ luôn dòng điểm đang chờ xử lý đổi/trả. Mini App cũng không có dòng này. | hỏi chủ |

U6-90 (hệ số hạng khi tích điểm) đã kiểm lại: hệ số đúng, không có cặp đơn trùng.

Ca BLOCKED cần dịch vụ thật nên không chạy được trên máy:
- U3-45: ZNS;
- U4-19: Gomdon;
- U5-55: vị trí Zalo;
- U6-95 đến U6-98: Zalo thật, chuyển khoản thật, Pancake thật, OA/ZaloPay.

Các ca này cần thử tay trên bản gần production (mục 5).

## 3. Bản sửa và số test

Review tìm 140 mục: P0 0, P1 11, P2 41, P3 88 (`00-tong-hop.md`). UAT tìm thêm lỗi theo từng làn, đánh mã `U*-B*`.

Bản sửa chia thành 44 nhánh gói, gộp qua `uat/int` theo 6 đợt. Gói nào cũng làm theo TDD và có review Opus. Gói đụng tiền, điểm, quyền, tin gửi khách hoặc migration có review 2–3 lượt. Đợt 6 làm theo quyết định của chủ (`98-cau-hoi.md`):
- Q1 hạng chỉ tính đơn tự mua lẻ;
- Q2 thuế TNCN cộng dồn theo tháng, từ chối lệnh rút thì tự hoàn thuế giữ dư;
- Q8 trả bù thưởng quý đại lý trong 60 ngày, bậc chụp theo quý;
- Q10 bậc giảm gói định kỳ;
- Q12 miễn phí giao từ 199.000đ;
- Q15 Mini App bỏ axios;
- Q18 mua chung;
- Q19 đảo đơn;
- Q22 đổi chu kỳ gói;
- Q13, Q14, Q16 chữ.

11 migration mới:

```
20261020010000_waste_item_warehouse_only
20261020100000_best_answer_reward_note_template
20261020100000_review_return_reversal
20261020110000_coupons_admin_list_index
20261020120000_dealer_bonus_topup_template
20261020120000_groupbuy_success_template_percent
20261020120000_notification_template_tone_style
20261020120000_pit_threshold_description
20261020120000_q19_reversal_effects_marker
20261022100000_payout_tax_refunded
20261022110000_dealer_quarter_bonus_tiers
```

Số test, đầu đợt so với bản ứng viên:

| Bộ | Đầu đêm 05e6ae97 | `uat/rc2` 5c98c2fe |
|---|---|---|
| jest api | 426 suite / 9308 test | 444 / 9854 |
| race (Postgres thật) | 253 / 1964 | 277 / 2120 |
| vitest Mini App (VN và UTC) | 283 / 4313 | 295 / 4524 |
| vitest web (VN và UTC) | 358 / 6178 | 406 / 6929 |
| vitest app-core | 41 / 489 | 42 / 501 |
| Playwright Mini App | 170 | 170 passed |
| Playwright web | 292 | 298: 292 passed, 6 skipped |

Không bộ nào giảm số test.

Một lỗi có sẵn trên main đã được sửa: test race `cron-leader` lúc đỏ lúc xanh (đo được 6/15 lần đỏ). Nguyên nhân là khi nhả lease, giờ hết hạn bị làm tròn lên. Sau khi sửa, 0/15 lần đỏ. Lỗi này không ảnh hưởng PROD.

## 4. Phối hợp với phiên web

Phiên web nhận 7 lô lỗi và đổi giao diện (ghi ở `PROGRESS.md` mục "Phối hợp"):
- PR #24 đã vào main.
- PR #25 (nháp) theo các quyết định đợt 6: chữ Q13/Q14/Q16, freeship dự phòng 199.000đ, Q22.
- PR #25 cũng sửa test thể lệ đổi rác cho hợp với API mới, và thêm bước CI ghi thể lệ vào DB của CI.

## 5. Việc chủ cần làm

Trước khi mở khách:

1. Điền khoá Pancake thật (PANCAKE_API_KEY, PANCAKE_SHOP_ID) khi deploy.
2. Cấu hình DNS cho web và API.
3. Thử chuyển khoản thật qua màn QR trên bản gần production. Thử tay các ca BLOCKED ở mục 2.
4. Nhập FAQ ở tab Cấu hình.
5. Nhập nội dung pháp lý cho legal.dieu-khoan, legal.bao-mat, legal.doi-tra, legal.van-chuyen: tên công ty, mã số thuế, địa chỉ, số ngày (D8-5, U6-09).
6. Đặt VITE_ZALO_OA_ID và VITE_CLOUDINARY_* khi build Mini App.
7. Đặt khoá Zalo OA, ZNS và mẫu ZNS đã duyệt (`docs/GO-LIVE-KEYS.md`). Gửi thử một tin vào OA trước khi bật tự trả lời.
8. Chạy grant-admin với ADMIN_PHONE đúng dạng. Nạp seed với `--with-business-defaults` (runbook bước 7b).
9. Xác nhận hotline, email CSKH, shippingEta.
10. Khi có SSL: bật HSTS, giữ CSP Report-Only tuần đầu.

Câu hỏi không chặn việc mở khách, hỏi kế toán khi rảnh (`98-cau-hoi.md`):

- **Q2c:** thuế hoàn cho một lệnh rút đã chi có thể làm đổi báo cáo của tháng đã kê khai. Có chốt sổ theo tháng không?
- **Q2d:** CTV được hoàn thuế vào Ví chỉ thấy một dòng trong sổ ví. Có cần gửi thông báo riêng không?
- **Q2e:** admin tắt khấu trừ rồi mới từ chối lệnh rút thì thuế đã giữ được hoàn hết. Hiện giữ cách này.
- **Chữ mẫu tin DEALER_BONUS_PAID:** câu cũ "cộng vào công nợ" nên đổi thành "công nợ … được giảm". Cần một migration sửa có điều kiện.
- **Q5 chat qua Zalo cá nhân:** đang chờ chủ chốt thiết kế.

Việc hoãn có chủ đích, ít gặp: R3-1 đến R3-3. Khi gộp tài khoản khách vãng lai lúc đăng nhập Zalo, nếu khách đang tạo địa chỉ cùng lúc thì có thể lỗi 503 hoặc lệch địa chỉ mặc định. Cách sửa đã ghi ở `PROGRESS.md`.

## 6. Kế hoạch gộp vào main và deploy

Đã gộp thử trên máy, không xung đột:
- `uat/2026-10-20` + main → `uat/rc`;
- `uat/rc` + web/uat7 → `uat/rc2`.

Mọi kiểm ở mục 1 chạy trên `uat/rc2`.

Thứ tự đề xuất, chờ lệnh chủ:

1. Gộp PR #25 (web/uat7) vào main trước, hoặc cùng lúc với PR UAT. Bước CI mới của PR #25 ghi thể lệ đổi rác vào DB của CI. Thiếu bước này, test thể lệ có thể đỏ trên CI khi API mới vào main.
2. Push `uat/2026-10-20` và mở PR vào main. Chờ CI xanh rồi gộp.
3. Deploy theo `docs/launch/deploy-rollback-runbook.md`, với ba lưu ý:
   - Backup DB trước khi migrate. 11 migration mới nằm ngoài danh sách tương thích image.
   - Deploy API cùng lúc hoặc trước web. Lý do: web mới gửi `expectedAmount` khi duyệt hay chi lệnh rút, mà API cũ trả 400 khi gặp trường này.
   - Sau deploy, báo admin và kế toán tải lại mọi tab Quản trị.

Phiên này không push, không mở PR, không deploy.
