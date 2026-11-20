-- w11-02 (Bộ Công Thương): nội dung chính sách đã lưu trên PROD khớp luật đang chạy. Không đổi schema.
--
-- legal.bao-mat: Đổi rác lấy quà chỉ còn hai đường đang mở (mang tới điểm nhận, shipper lấy tận nhà/thu kèm đơn hàng); bỏ câu nhắc
--   đường gửi về kho đang tắt (waste.lane_mailin). Nêu thêm căn cứ Nghị định 52/2013/NĐ-CP và 85/2021/NĐ-CP. Gomdon nhận thông tin cả khi
--   khách chọn shipper lấy tận nhà.
-- legal.van-chuyen: thời gian giao theo lịch kho PO duyệt 19/11/2026 (shipping.warehouse_schedule: TP.HCM 1–2, tỉnh khác 2–4 ngày làm việc,
--   cắt đơn 15:00, Thứ 2 – Thứ 7), thay câu cũ nói ngày nhận dự kiến tính theo ngày lịch; ngày hiển thị trong ứng dụng vẫn chỉ để tham khảo.
--
-- Chỉ thay đúng từng câu cũ (so sánh sau chuẩn hoá Unicode NFC). Bản admin đã sửa khác câu cũ thì câu đó giữ nguyên; dòng không còn câu
-- cũ nào thì không bị ghi. Dòng có đổi thì dòng đầu "Hiệu lực từ ngày X." thành "Hiệu lực từ ngày X. Cập nhật ngày <hôm nay, giờ Việt Nam>."
-- để khách thấy văn bản đã đổi. Mỗi dòng đổi ghi một dòng system_config_history (id cố định theo khoá nên chạy lại không ghi thêm; lần sau
-- cũng không còn câu cũ để thay).

WITH patched AS (
  SELECT
    c."key",
    c."value" AS old_value,
    normalize(c."value" #>> '{}', NFC) AS nfc_body,
    replace(replace(replace(normalize(c."value" #>> '{}', NFC),
        $o1$Luật Bảo vệ dữ liệu cá nhân 2025 (số 91/2025/QH15) và Nghị định 356/2025/NĐ-CP hướng dẫn luật này.$o1$,
        $n1$Luật Bảo vệ dữ liệu cá nhân 2025 (số 91/2025/QH15) và Nghị định 356/2025/NĐ-CP hướng dẫn luật này, cùng các quy định về bảo vệ thông tin cá nhân trong thương mại điện tử tại Nghị định 52/2013/NĐ-CP, Nghị định 85/2021/NĐ-CP và các văn bản sửa đổi, bổ sung, thay thế.$n1$),
        $o2$cách gửi (mang tới điểm nhận, gửi về kho hoặc thu kèm đơn hàng), mã vận đơn khi gửi về kho, kết quả kiểm đếm$o2$,
        $n2$cách gửi (mang tới điểm nhận, shipper lấy tận nhà hoặc thu kèm đơn hàng), mã vận đơn của chuyến lấy hàng (nếu có), kết quả kiểm đếm$n2$),
        $o3$Nếu bạn chọn thu gom vỏ, bao bì kèm đơn hàng (Đổi rác lấy quà), thông tin này$o3$,
        $n3$Nếu bạn chọn shipper lấy tận nhà hoặc thu gom vỏ, bao bì kèm đơn hàng (Đổi rác lấy quà), thông tin này$n3$) AS body
  FROM "system_configs" c
  WHERE c."key" = 'legal.bao-mat' AND jsonb_typeof(c."value") = 'string'
  UNION ALL
  SELECT
    c."key",
    c."value" AS old_value,
    normalize(c."value" #>> '{}', NFC) AS nfc_body,
    replace(replace(normalize(c."value" #>> '{}', NFC),
        $o1$- Các tỉnh thành khác: 3–5 ngày làm việc.$o1$,
        $n1$- Các tỉnh thành khác: 2–4 ngày làm việc.$n1$),
        $o2$- Với hàng do Tubu Tree giao, ứng dụng hiển thị ngày giao dự kiến ở bước thanh toán và chi tiết đơn. Ngày này tính theo ngày lịch kể từ lúc bạn đặt hàng nên chỉ để tham khảo; thời gian giao áp dụng là thời gian ở hai dòng trên.$o2$,
        $n2$- Kho Tubu Tree xuất hàng từ Thứ 2 đến Thứ 7, trừ ngày lễ. Đơn đặt trước 15:00 của ngày kho làm việc thường được xuất kho trong ngày, đặt sau giờ này thì xuất kho vào ngày làm việc kế tiếp. Ngày nhận dự kiến hiển thị trong ứng dụng chỉ để tham khảo; thời gian giao áp dụng là thời gian ở hai dòng trên.$n2$) AS body
  FROM "system_configs" c
  WHERE c."key" = 'legal.van-chuyen' AND jsonb_typeof(c."value") = 'string'
),
target AS (
  SELECT
    "key",
    old_value,
    to_jsonb(regexp_replace(body, '^(Hiệu lực từ ngày [0-9/]+\.)( Cập nhật ngày [0-9/]+\.)?',
      '\1 Cập nhật ngày ' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') || '.')) AS new_value
  FROM patched
  WHERE body <> nfc_body
),
changed AS (
  UPDATE "system_configs" c
  SET "value" = t.new_value, "updatedAt" = now()
  FROM target t
  WHERE c."key" = t."key"
  RETURNING c."key"
)
INSERT INTO "system_config_history" ("id", "key", "oldValue", "newValue", "changedBy")
SELECT 'sch_w1102_' || md5(t."key"), t."key", t.old_value, t.new_value, 'migration:w11_02_legal_live_rules'
FROM target t
JOIN changed ch ON ch."key" = t."key"
ON CONFLICT ("id") DO NOTHING;
