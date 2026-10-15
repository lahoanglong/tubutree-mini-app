-- Yêu cầu trả hàng đã duyệt trước bản P5 luôn đảo cả đơn và cộng kho ngay lúc duyệt, và không có dòng return_request_items nào
-- (bảng đó mới có từ P5; từ P5 mọi yêu cầu, kể cả trả cả đơn, đều có dòng). Migration P5 không đặt receivedAt cho chúng nên chúng
-- nằm mãi trong "Chờ nhận hàng về" mà màn hình admin không có nút nào để nhận. Đánh dấu đã nhận lúc duyệt; chỉ chạm hàng
-- APPROVED chưa nhận và không có dòng nào, nên chạy lại không đổi gì thêm.
UPDATE "return_requests"
   SET "receivedAt" = COALESCE("reviewedAt", "createdAt")
 WHERE "status" = 'APPROVED'
   AND "receivedAt" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "return_request_items" i WHERE i."returnRequestId" = "return_requests"."id");
