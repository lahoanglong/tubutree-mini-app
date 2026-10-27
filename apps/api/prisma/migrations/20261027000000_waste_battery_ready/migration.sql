-- Pin sẵn sàng nhận (chủ chốt 2026-10-27, "chủ tự bật sau"): nạp mức 10 viên = 1.000 Điểm Xanh, tối đa 20 viên mỗi ngày và 50 viên mỗi tháng,
-- nhưng GIỮ trạng thái COMING_SOON. Chủ bật (Đang nhận) trong Quản trị khi đã có hợp đồng xử lý chất thải nguy hại có giấy phép,
-- có văn bản trả lời của Sở NN&MT và bản Mini App mới đã Live. Trong lúc chưa ACTIVE, API khách giấu hẳn món nguy hại
-- (CUSTOMER_VISIBLE_ITEMS_WHERE), nên mức điểm và trần ở đây không lộ ra công khai.
-- Cờ "hazardous" từ nay nghĩa là món cần xử lý riêng (chỉ nhận khi khách mang tới điểm nhận), không còn nghĩa là không nhận,
-- nên CHECK cấm món nguy hại ở trạng thái ACTIVE phải bỏ. Không thêm lại được: phần viết tay của migration 20261020000000 có câu
-- ADD CONSTRAINT này, chạy lại nó sẽ lỗi ngay khi có món nguy hại ACTIVE (test race bỏ câu đó khi chạy lại).
-- Khi đã bật: kho TP.HCM nhận mọi món ACTIVE (waste-catalogue.service, waste-hold.service). Điểm đối tác chỉ nhận pin khi ADMIN gắn pin
-- cho điểm đó ("waste_point_items", chủ điểm tự gắn không được); chủ chốt chỉ gắn khi Sở trả lời về điểm đối tác và đã có quy trình
-- chuyển pin từ đại lý về kho hoặc đơn vị có phép. Migration này không gắn pin vào điểm đối tác nào.
-- prepInstructions chỉ đặt khi còn trống, để không ghi đè chữ admin đã soạn.
ALTER TABLE "waste_items" DROP CONSTRAINT IF EXISTS "waste_items_hazardous_not_active_chk";

UPDATE "waste_items"
SET "unitsPerPoint" = 10,
    "pointsPerGroup" = 1000,
    "dailyCapQty" = 20,
    "monthlyCapQty" = 50,
    "prepInstructions" = CASE WHEN COALESCE("prepInstructions", '') = '' THEN 'Dán băng keo hai đầu cực. Không nhận pin phồng, chảy nước, pin xe điện hay ắc quy.' ELSE "prepInstructions" END,
    "updatedAt" = NOW()
WHERE "code" = 'BATTERY' AND "hazardous" = true;
