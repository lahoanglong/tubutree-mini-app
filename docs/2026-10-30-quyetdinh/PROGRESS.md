# Đợt quyết định 30/10: đợt 1

Gốc: main d915f19b5. Nhánh gộp: `review/qd-2026-10-30`. Quyết định của chủ: `docs/2026-10-28-e2e/21-quyet-dinh.md` mục E.

Đợt 1 chỉ gồm các mục không đụng file mà phiên b4 đang sửa ở PR #80, #81, #82. Đợt 2 làm sau khi các PR đó merge:
- E-46: chuyển hoa hồng vào Ví lúc 8:00 và gộp tin.
- Ghi công CTV tính hạn từ lúc bấm link, kèm hai P3 về dấu chạm CTV của P3b.
- E-80: tin khi lên hạng.
- E-6: tự áp mã giảm.
- E-77: xoá khoá `home.new_customer_layout`.

Quy trình mỗi gói: worker Sonnet làm, Opus review đối kháng, worker sửa lại. Gói đụng điểm phải qua ít nhất 2 lượt review. Sau khi gộp, bản gộp được Opus review thêm một lần.

## Kết quả theo gói

| Gói | HEAD | Lượt review | Mục |
|---|---|---|---|
| khach | 22f8afcca | 2 (cả hai lượt cho merge, chỉ có P3) | E-47, E-88, nhãn Mới |
| doirac | c0786cee3 | 3 (lượt 1 có 1 P2, lượt 2 có 2 P2, lượt 3 cho merge) | E-126, E-38(a), E-128, tin-canhan-14/20 |

### Luật mới
- **E-47.** Nhiệm vụ "Đơn hàng đầu tiên" của gian hàng CTV (5.000 điểm) chỉ tính hoa hồng khác REJECTED, có đơn DELIVERED, `placedForCustomer=false`, và người đặt khác chính CTV. Thưởng đã cấp không bị thu hồi. CTV đã nhận thưởng thì thanh tiến độ hiện đủ.
- **E-88.** Thân mẫu ORDER_CONFIRMED đổi thành `Đơn {{order_code}} đã được xác nhận.{{payment_note}} Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿`.
  - Đơn có `paymentStatus=PAID` lúc gửi tin (chuyển khoản, ZaloPay, Ví): biến `payment_note` là " Tubu Tree đã nhận đủ thanh toán."
  - Đơn COD: biến rỗng, câu giữ như cũ.
  - Migration chỉ đổi mẫu khi thân trên DB còn đúng câu seed cũ.
- **Nhãn Mới.** Thêm khoá công khai `catalog.launch_date` (`YYYY-MM-DD` hoặc rỗng/null, mặc định rỗng).
  - SP tạo trước 00:00 giờ VN của ngày này không gắn "Mới".
  - Khi chưa đặt ngày, hành vi giữ như cũ.
  - Trong lúc config chưa tải về, nhãn không hiện.
- **E-126.** Cron `waste.gift-expiry` chạy phút 15 mỗi giờ, kể cả khi cờ đổi rác tắt, vì đổi quà và trao quà ở kho không theo cờ.
  - Quà READY chỉ quá hạn khi đã qua hết ngày VN ghi trên hạn nhận.
  - Quà quá hạn của khách thường: cron huỷ, hoàn đúng `pointsCost` qua đường hoàn của luồng huỷ quà, ghi event GIFT_EXPIRED, gửi một tin trong app `WASTE_GIFT_EXPIRED`.
  - Khách bị khoá (khoá đổi rác hoặc khoá tài khoản), có yêu cầu bị thu hồi, hoặc đã xoá tài khoản: cron không tự huỷ. Quà nằm ở hàng "Quá hạn nhận" cho admin quyết có hoàn hay không, dùng chung điều kiện với nút Huỷ.
  - Quầy không trao được quà quá hạn.
- **E-38(a).** Quầy tra đúng mã thì thấy cả quà đã trao và đã huỷ, chỉ đọc, kèm lý do huỷ. Không lộ thêm thông tin khách.
- **E-128.** Khoá `waste.rules_version` (mặc định `2026-10-17.1`, nên deploy xong không ai phải đồng ý lại).
  - Client mới gửi phiên bản thể lệ đã đọc; API từ chối phiên bản cũ, và khách tick lại là gửi được.
  - Bản Mini Live cũ không gửi phiên bản thì vẫn được nhận.
- **tin-canhan-14/20.** `/auth/me` trả `hasDeskPoint`. Cá nhân (Mini + web) hiện "Nhận hàng tại điểm" cho nhân viên điểm đối tác, kể cả khi họ mang vai CUSTOMER. Hàng này vẫn chờ cờ đổi rác bật.

### Migration (4 thư mục, chỉ thêm hoặc cập nhật có guard)
- `20261030100000_waste_gift_expired_template`: chèn mẫu tin, ON CONFLICT DO NOTHING.
- `20261030100001_waste_rules_version`: chèn khoá, ON CONFLICT DO NOTHING.
- `20261030100002_waste_gift_claim_days_description`: chỉ đổi mô tả khi còn câu cũ.
- `20261030110000_order_confirmed_payment_note`: chỉ đổi thân mẫu khi còn câu cũ.
- `catalog.launch_date` không có migration, vì seed-reference tạo khoá này ở mỗi lần deploy (`dep2-window.sh`).

## Việc của chủ quanh lần deploy
- Xác nhận: cron quà quá hạn chạy cả khi cờ đổi rác tắt. Brief ban đầu ghi "bỏ qua khi cờ tắt", nhưng khách vẫn đổi quà và kho vẫn trao quà khi cờ tắt, nên cron phải chạy. Muốn cron theo cờ thì báo, sửa một dòng.
- Trước ngày deploy: đếm quà READY đã quá hạn trên PROD bằng lệnh chỉ đọc ở runbook mục 1.15, để biết lượt cron đầu sẽ huỷ và hoàn bao nhiêu quà.
- Sau deploy: xem thân mẫu ORDER_CONFIRMED (lệnh ở runbook 1.15). Admin đã sửa chữ mẫu này từ trước thì migration không đổi, phải tự thêm `{{payment_note}}`.
- Deploy API trước, sau đó mới đẩy Mini Live (runbook mục 1.15). Nếu rollback API sau khi Mini mới đã Live thì phải kéo Mini về luôn.
- Lượt cron :15 đầu tiên sau deploy sẽ huỷ và hoàn điểm mọi quà READY đã quá hạn của khách thường. Quà của khách bị khoá, bị thu hồi hoặc đã xoá tài khoản thì admin xử lý ở Đổi rác › Quà › Quá hạn nhận.
- Đặt ngày mở bán ở admin: Cấu hình › Tất cả tham số › `catalog.launch_date`, gõ trong ngoặc kép, ví dụ `"2026-10-26"`. Chưa đặt thì 111 SP tạo ngày 25/10 vẫn gắn "Mới" tới khoảng 24/11.
- Mỗi lần sửa nội dung thể lệ đổi rác thì tăng `waste.rules_version`.
- Khi đăng ký mẫu ZNS cho ORDER_CONFIRMED, câu ZNS phải có cả dạng đã thanh toán và dạng COD, vì `payment_note` có khoảng trắng ở đầu.

## Còn lại, để chủ quyết hoặc làm sau (P3)
- Quest đơn đầu: CTV nhận thưởng được ngay khi đơn giao, kể cả lúc còn trong hạn đổi trả (đúng chữ "đã giao" của chủ). Muốn chặt hơn thì chỉ tính hoa hồng đã chốt.
- Quest đơn đầu: CTV dùng tài khoản phụ tự đặt đơn thì không phân biệt được với khách thật. Rủi ro này có từ trước; luật mới chặt hơn luật cũ.
- Tin quà quá hạn gửi sau khi transaction commit. Nếu tiến trình chết đúng giữa hai bước thì mất tin đó, nhưng điểm vẫn đúng. Luồng admin huỷ quà cũng làm y như vậy.
- Cache cấu hình 60 giây trong từng tiến trình: khi chạy nhiều bản API, khoảng 60 giây sau lúc admin đổi `waste.rules_version`, khách có thể bị báo "Thể lệ đã cập nhật" lặp lại.
- Lời 400 của nút Huỷ quà chưa nhắc ca khách đã xoá tài khoản.
- Rollback về image cũ: màn sửa mẫu tin của bản cũ sẽ từ chối lưu thân mẫu có `{{payment_note}}`. Tin vẫn gửi đúng câu cũ, vì bản cũ thay biến lạ bằng chuỗi rỗng. Đã ghi vào runbook 1.15.
- `gate.sh` nên ghi SHA của HEAD vào dòng đầu file kết quả.

## Kiểm chứng bản gộp
Bản gộp đã gồm commit ab9e8db47 (sửa race spec). Máy hay gặp lỗi node "Abort trap: 6" khi tải cao; mọi bước đỏ vì lỗi này đều đã chạy lại.
- **Gate: 0 FAIL.**
  - Jest API: 509 bộ, 11.865 ca.
  - Vitest: Mini 5.309 (cả theo giờ UTC), web 8.087, app-core 1.302.
  - tsc 5 gói, eslint 3 app, lint-parity.
  - Entry Mini 709/222 KB.
  - Lần chạy đầu, vite build bị Abort trap; chạy lại thì qua.
- **Race: 37 bộ**, gồm đổi rác, quest, tin, cấu hình, tiền. 36 bộ qua ngay. Riêng `waste-event-sweep` còn một ca dùng hạn "1 giờ trước", không còn là quá hạn theo luật ngày VN. Đã sửa (ab9e8db47) và chạy lại: 45/45.
- **Playwright:**
  - Mini: 220 qua.
  - Web: 378 qua, không ca nào chập chờn. Lần đầu bị Abort trap ở bước seed; chạy lại thì qua.
- **Opus review bản gộp (ab9e8db47): cho merge**, không có P1 hay P2. Có 4 P3:
  - Fixture quầy hai nền đặt hạn quà 16/12/2026, nên test sẽ tự hỏng từ 18/12/2026. Đã đổi sang năm 2099. Vitest quầy: Mini 58, web 70.
  - Cron không theo cờ. Đây là chủ ý, chờ chủ xác nhận ở mục trên.
  - Có thể mất tin, đã ghi ở mục P3.
  - Rollback và mẫu `{{payment_note}}`: đã ghi vào runbook.
- **Chưa merge vào main** cho tới khi phiên b4 deploy xong #80, #81, #82, #84. Lý do: bản deploy đó không được kéo theo cron huỷ quà khi chủ chưa đếm quà trên PROD.
