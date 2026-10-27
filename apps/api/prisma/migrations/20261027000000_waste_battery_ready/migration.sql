-- Pin sẵn sàng nhận (chủ chốt 2026-10-27, "chủ tự bật sau"): nạp mức 10 viên = 1.000 Điểm Xanh, tối đa 20 viên mỗi ngày và 50 viên mỗi tháng,
-- nhưng GIỮ trạng thái COMING_SOON. Chủ bật (Đang nhận) trong Quản trị khi đã có hợp đồng xử lý chất thải nguy hại có giấy phép,
-- có văn bản trả lời của Sở NN&MT và bản Mini App mới đã Live.
-- Cờ "hazardous" từ nay nghĩa là món cần xử lý riêng (chỉ nhận khi khách mang tới điểm nhận), không còn nghĩa là không nhận,
-- nên CHECK cấm món nguy hại ở trạng thái ACTIVE phải bỏ. Không thêm lại được: phần viết tay của migration 20261020000000 có câu
-- ADD CONSTRAINT này, chạy lại nó sẽ lỗi ngay khi có món nguy hại ACTIVE (test race bỏ câu đó khi chạy lại).
-- Khi đã bật: kho TP.HCM nhận mọi món ACTIVE (waste-catalogue.service, waste-hold.service); chỉ điểm đối tác mới theo "waste_point_items".
-- Migration này không gắn pin vào điểm đối tác nào: chủ điểm hoặc admin gắn sau.
ALTER TABLE "waste_items" DROP CONSTRAINT IF EXISTS "waste_items_hazardous_not_active_chk";

UPDATE "waste_items"
SET "unitsPerPoint" = 10,
    "pointsPerGroup" = 1000,
    "dailyCapQty" = 20,
    "monthlyCapQty" = 50,
    "prepInstructions" = 'Dán băng keo hai đầu cực. Không nhận pin phồng, chảy nước, pin xe điện hay ắc quy.',
    "updatedAt" = NOW()
WHERE "code" = 'BATTERY' AND "hazardous" = true;
