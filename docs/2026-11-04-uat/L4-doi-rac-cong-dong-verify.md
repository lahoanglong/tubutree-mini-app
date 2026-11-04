# L4 đổi rác cộng đồng: kiểm lại đối kháng

Mã: worktree `uat-1104` @ 98803f006 (= PROD). Lane 4 (API 3241) đang chạy lúc kiểm.

## L4-B01: chữ "vui lòng" trong thể lệ Đổi rác (P3)

**Kết luận: NEEDS_OWNER (P3).** Lỗi nằm ở nội dung chủ soạn, không ở mã app.

1. **Tái hiện:** có. `GET /api/waste/rules` trả 200, `text` kết thúc bằng "12. Liên hệ\nKhách cần hỗ trợ hoặc khiếu nại vui lòng nhắn Zalo OA của Tubu Tree.", `version` "2026-10-17.1". Cả ba ảnh `shots/L4-doi-rac-cong-dong/{mini375,web375,web1280}-returning-recycle-rules.png` đều có.
2. **Nguồn chữ:**
   - Mã không chứa câu này. Mặc định của `waste.rules_text` là chuỗi rỗng ở `apps/api/prisma/seed.ts:356` và `apps/api/prisma/migrations/20261020000000_waste_exchange/migration.sql:578`. Lệnh `grep -i "vui lòng"` trên `apps/api/src/modules/waste` không ra kết quả nào.
   - Trong DB lane 4, `system_configs.waste.rules_text` có `updatedAt` 2026-11-03T21:40Z. Lane đã nạp giá trị này qua `00-setup.mjs` từ bản nháp của chủ `/Users/longla/Desktop/doi-rac-ban-nhap/01-the-le-waste.rules_text.txt:65` (sửa lần cuối 27/10). Lane nạp thể lệ để vòng qua lỗi `seed-data.mjs extra` làm sập khi `waste.enabled` bật mà thể lệ rỗng.
3. **Luật:** giọng chữ đợt 8 không dùng "Vui lòng" (`docs/2026-11-03-golive/brief.md:14`, "Quyết định đã chốt"). Bản nháp vi phạm luật này. Theo checklist ra mắt (`docs/launch/recycle-rewards-launch-checklist.md:26`), thể lệ do admin viết. Vì vậy chỉ chủ sửa được bản nháp, hoặc giá trị đã dán vào admin PROD (nếu đã dán; tôi không đọc PROD).
4. **Mức:** P3 hợp lý. Chỉ là chữ, không đụng điểm, ví hay luồng.

**Đề xuất sửa:** chủ sửa dòng 65 của bản nháp thành "Khách cần hỗ trợ hoặc khiếu nại thì nhắn Zalo OA của Tubu Tree." trước khi dán vào admin (Đổi rác, Cấu hình chung). Nếu PROD đã có thể lệ này thì sửa luôn ở admin PROD. Không cần đổi mã app.

Ghi thêm (không tính FAIL): sửa thể lệ trong admin không làm đổi `version` của bản đồng ý thể lệ (DOIRAC-09, `docs/2026-10-28-e2e/13-doirac.md:38`). Vì vậy sửa chữ sau khi mở chương trình thì bản đồng ý của khách vẫn ghi phiên bản cũ.

Cuối việc: đã chạy `lane-down.sh 4` (không `--drop`).
