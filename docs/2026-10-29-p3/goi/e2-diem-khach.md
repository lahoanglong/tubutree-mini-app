# Gói e2-diem-khach: khách vãng lai không nhận điểm điểm danh và nhiệm vụ (E-2)

Chủ chốt sáng 29/10 (AskUserQuestion): **chặn điểm cho khách vãng lai**. Khách vãng lai vẫn điểm danh và nhận giọt nước tưới cây nhưng không được cộng điểm. Liên kết tài khoản xong thì nhận điểm từ lần sau, không cộng bù phần đã bỏ lỡ. Gói đụng điểm: có race test.

## Bối cảnh
- Khách vãng lai = tài khoản không phải "user thật" theo `isRealUser` / `REAL_USER_WHERE` (`apps/api/src/common/real-user.ts`): zaloId bắt đầu `guest_` và không có SĐT. Voucher chào mừng, mã công khai, mua chung, nhiệm vụ mời bạn đã chặn theo luật này. Dùng lại helper, không viết luật mới.
- Báo cáo gốc: `docs/2026-10-28-e2e/20-backlog.md` mục E-2 và báo cáo nhóm `docs/2026-10-28-e2e/1x-*.md` (tìm "E-2"). Tóm tắt: điểm danh hằng ngày và thưởng nhiệm vụ 7 ngày vẫn cộng Điểm Xanh cho khách vãng lai. Một script có thể nuôi khoảng 38.000 điểm mỗi máy giả mỗi tuần, rồi gộp vào tài khoản thật (MERGE).

## Việc
1. API: mọi đường cộng Điểm Xanh từ điểm danh (mọi mốc chuỗi ngày) và nhiệm vụ 7 ngày / nhiệm vụ người mới bỏ qua khi người nhận không phải user thật. Phần không phải điểm vẫn chạy như cũ: giọt nước, chuỗi ngày, đánh dấu nhiệm vụ đã xong. Tìm hết đường cộng điểm liên quan (grep `checkin`, `check-in`, `mission`, `streak`, `grantPoints`, `PointsLot`), kể cả job chạy nền.
2. Gộp tài khoản (guest gộp vào tài khoản thật): xem điểm của dòng guest có còn chảy sang tài khoản thật không. Sau thay đổi, guest không còn điểm từ hai nguồn này, nên không cần đổi luật gộp. Điểm guest đã có từ trước giữ nguyên (không thu hồi), ghi lại trong báo cáo.
3. Giao diện Mini App và web, khi khách vãng lai điểm danh hoặc xem nhiệm vụ:
   - Không hứa "+N điểm". Hiện câu ngắn kiểu "Đăng nhập Zalo để nhận Điểm Xanh" kèm nút đăng nhập/liên kết sẵn có.
   - Giọt nước vẫn hiện như cũ.
   - Hai nền giống nhau ở khổ 375.
   - Dùng cờ/trạng thái có sẵn từ API (thêm trường cho client nếu cần, cập nhật shared-types). Không đoán ở client theo zaloId.
4. Không đổi số điểm, mốc, thể lệ cho user thật. Chữ thể lệ/pháp lý không đổi. Nếu thể lệ hiện có câu hứa điểm cho mọi khách thì KHÔNG sửa chữ thể lệ, chỉ ghi vào báo cáo để chủ sửa.

## Kiểm bắt buộc
- Unit API cho từng đường cộng điểm: guest không nhận điểm nhưng nhận giọt nước/chuỗi; user thật không đổi. Thêm ca guest đã có SĐT là user thật.
- Race: guest điểm danh song song nhiều lần không phát sinh điểm; user thật vẫn nhận đúng một lần mỗi ngày (chạy lại spec race điểm danh/nhiệm vụ có sẵn).
- Vitest Mini + web cho lời "Đăng nhập Zalo để nhận Điểm Xanh". Playwright cho màn điểm danh/Vườn Xanh.
- gate.sh 0 FAIL.
