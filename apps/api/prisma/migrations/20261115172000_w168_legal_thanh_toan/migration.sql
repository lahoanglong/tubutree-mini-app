-- W168 (Bộ Công Thương, Nghị định 52/2013 và 85/2021): đủ 5 chính sách và tiểu mục kiểm hàng khi nhận hàng. Không đổi schema.
--
-- 1) Thêm chính sách thứ 5 "Chính sách và hình thức thanh toán" (legal.thanh-toan) với nội dung đã soạn sẵn, thông tin thương nhân
--    theo Giấy chứng nhận ĐKDN. ON CONFLICT DO NOTHING: dòng đã có (seed rỗng hay bản admin đã dán) không bị đè. Chạy lại an toàn.
-- 2) Nối tiểu mục "Chính sách kiểm hàng khi nhận hàng" vào cuối bản đã lưu của legal.van-chuyen và legal.doi-tra, CHỈ khi dòng đang
--    là chuỗi có nội dung mà chưa có chữ "kiểm hàng" (so sánh sau chuẩn hoá Unicode NFC, không phân biệt hoa thường). Dòng rỗng giữ
--    nguyên vì web dùng bản nháp mặc định đã có tiểu mục này; bản admin đã tự viết mục kiểm hàng không bị đụng. Mỗi lần đổi ghi một
--    dòng system_config_history (id cố định theo khoá nên chạy lại không ghi thêm; lần sau cũng không còn dòng khớp điều kiện).

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  (
    'legal.thanh-toan',
    to_jsonb($tt$## 1. Phạm vi

Chính sách này nêu các hình thức thanh toán, cách hoàn tiền và cách CÔNG TY TNHH TUBU TREE ("Tubu Tree") bảo vệ giao dịch của bạn khi mua trên website và mini app Zalo của Tubu Tree.

- Đơn vị vận hành: CÔNG TY TNHH TUBU TREE
- Mã số thuế: 0319585995
- Địa chỉ: Số 33, đường 1B, phường Long Bình, Thành phố Hồ Chí Minh
- Hotline: 0984 606 774
- Email: tubutree@gmail.com

## 2. Các hình thức thanh toán

- Thanh toán khi nhận hàng (COD): bạn trả tiền cho nhân viên giao hàng khi nhận. Một số đơn có thể không áp dụng COD (ví dụ đơn giá trị cao), hệ thống sẽ báo ở bước thanh toán.
- Chuyển khoản ngân hàng (quét mã VietQR): bạn chuyển đúng số tiền và đúng nội dung chuyển khoản được hiển thị ở bước thanh toán. Đơn được ghi nhận khi Tubu Tree đối soát thấy tiền về tài khoản.
- Ví Tubu: dùng số dư trong ví để thanh toán đơn hàng.
- ZaloPay: áp dụng khi hình thức này được hiển thị ở bước thanh toán; nếu không thấy, đơn của bạn chưa thanh toán được bằng ZaloPay.
- Điểm Xanh: bạn có thể dùng để trừ vào tiền hàng theo điều kiện hiển thị ở bước thanh toán.

Cách thanh toán khả dụng có thể khác nhau theo từng đơn. Số tiền cần trả, gồm cả phí vận chuyển, luôn được hiển thị trước khi bạn bấm đặt hàng.

## 3. Thời điểm thu tiền

- Với đơn COD, Tubu Tree không thu tiền trước khi giao hàng.
- Chỉ khi bạn chủ động chọn chuyển khoản, Ví Tubu hoặc thanh toán trực tuyến thì khoản tiền mới được thu trước khi giao hàng. Mọi khoản thu này đều được đối soát và ghi nhận minh bạch: bạn xem được trạng thái thanh toán của đơn trong mục Đơn hàng và lịch sử giao dịch trong Ví Tubu.
- Tubu Tree không yêu cầu bạn chuyển tiền ngoài các hình thức nêu trên. Hãy báo ngay cho Tubu Tree nếu có người nhân danh Tubu Tree đề nghị bạn chuyển tiền theo cách khác.

## 4. Hoàn tiền

- Trường hợp được hoàn: đơn bị huỷ sau khi bạn đã thanh toán trước, đơn bị từ chối do hết hàng hoặc sai giá, hoặc yêu cầu đổi trả đã được duyệt theo [Chính sách đổi trả](/chinh-sach/doi-tra).
- Hoàn về đâu: vào Ví Tubu hoặc tài khoản ngân hàng bạn chọn. Đơn COD chưa giao chưa phát sinh khoản thu nên không có tiền cần hoàn.
- Thời gian: 7 ngày làm việc kể từ khi Tubu Tree duyệt yêu cầu (với đổi trả là kể từ khi nhận lại và kiểm tra sản phẩm). Thời gian ghi có còn phụ thuộc ngân hàng.
- Điểm Xanh hoặc mã giảm giá đã dùng cho đơn được xử lý theo điều kiện của từng chương trình.

## 5. Bảo mật giao dịch

- Tubu Tree không lưu số thẻ ngân hàng của bạn.
- Giao dịch qua cổng hoặc ví điện tử được xác thực tại chính cổng thanh toán đó. Tubu Tree chỉ nhận kết quả thanh toán (thành công hoặc thất bại), không nhận mật khẩu hay mã OTP của bạn.
- Đường truyền được mã hoá. Cách Tubu Tree xử lý thông tin cá nhân xem tại [Chính sách bảo mật](/chinh-sach/bao-mat).

## 6. Khiếu nại về thanh toán

Nếu bạn bị trừ tiền mà đơn chưa được ghi nhận, bị trừ sai số tiền hoặc chưa nhận được tiền hoàn, hãy liên hệ hotline 0984 606 774 hoặc email tubutree@gmail.com, kèm mã đơn và ảnh chụp giao dịch. Tubu Tree tiếp nhận, kiểm tra và phản hồi bạn. Tranh chấp chưa thương lượng được giải quyết theo [Điều khoản sử dụng](/chinh-sach/dieu-khoan).$tt$::text),
    'Nội dung trang Chính sách và hình thức thanh toán (markdown). Để trống = bản nháp mặc định',
    'legal',
    now()
  )
ON CONFLICT ("key") DO NOTHING;

WITH extra ("key", "addition") AS (
  VALUES
    ('legal.van-chuyen', $khvc$## Chính sách kiểm hàng khi nhận hàng

- Đồng kiểm: khi nhận hàng, bạn được cùng nhân viên giao hàng (bưu tá) kiểm tra ngoại quan kiện hàng và số lượng sản phẩm trước khi ký nhận hoặc thanh toán (với đơn COD). Đồng kiểm chưa bao gồm mở nắp hay dùng thử sản phẩm.
- Quay video: bạn nên quay video liên tục từ lúc mở kiện đến khi kiểm xong, thấy rõ nhãn vận đơn. Nếu thấy móp méo, rách, ướt, thiếu hoặc sai sản phẩm, hãy chụp ảnh và liên hệ ngay với Tubu Tree.
- Thời hạn báo: nếu hàng có vấn đề, bạn báo cho Tubu Tree trong thời hạn đổi trả nêu tại [Chính sách đổi trả](/chinh-sach/doi-tra), kèm ảnh hoặc video.
- Hoàn tiền: khi yêu cầu được chấp nhận, tiền được hoàn vào Ví Tubu hoặc tài khoản ngân hàng bạn chọn, xem [Chính sách đổi trả](/chinh-sach/doi-tra) và [Chính sách và hình thức thanh toán](/chinh-sach/thanh-toan).$khvc$::text),
    ('legal.doi-tra', $khdt$## Chính sách kiểm hàng khi nhận hàng

- Đồng kiểm: khi nhận hàng, bạn được cùng nhân viên giao hàng (bưu tá) kiểm tra ngoại quan kiện hàng và số lượng sản phẩm trước khi ký nhận hoặc thanh toán (với đơn COD). Đồng kiểm chưa bao gồm mở nắp hay dùng thử sản phẩm.
- Quay video: bạn nên quay video liên tục từ lúc mở kiện đến khi kiểm xong, thấy rõ nhãn vận đơn. Nếu thấy móp méo, rách, ướt, thiếu hoặc sai sản phẩm, hãy chụp ảnh và liên hệ ngay với Tubu Tree.
- Thời hạn báo: nếu hàng có vấn đề, bạn báo cho Tubu Tree trong thời hạn đổi trả nêu ở đầu chính sách này, kèm ảnh hoặc video.
- Hoàn tiền: khi yêu cầu được chấp nhận, Tubu Tree hoàn tiền theo mục Hoàn tiền của chính sách này, xem thêm [Chính sách và hình thức thanh toán](/chinh-sach/thanh-toan).$khdt$::text)
),
target AS (
  SELECT
    c."key",
    c."value" AS old_value,
    to_jsonb((c."value" #>> '{}') || E'\n\n' || e."addition") AS new_value
  FROM "system_configs" c
  JOIN extra e ON e."key" = c."key"
  WHERE jsonb_typeof(c."value") = 'string'
    AND btrim(c."value" #>> '{}') <> ''
    AND normalize(c."value" #>> '{}', NFC) NOT ILIKE '%kiểm hàng%'
),
changed AS (
  UPDATE "system_configs" c
  SET "value" = t.new_value, "updatedAt" = now()
  FROM target t
  WHERE c."key" = t."key"
  RETURNING c."key"
)
INSERT INTO "system_config_history" ("id", "key", "oldValue", "newValue", "changedBy")
SELECT 'sch_w168kh_' || md5(t."key"), t."key", t.old_value, t.new_value, 'migration:w168_legal_thanh_toan'
FROM target t
JOIN changed ch ON ch."key" = t."key"
ON CONFLICT ("id") DO NOTHING;
