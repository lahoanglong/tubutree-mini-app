/**
 * Bộ chặn tuyên bố cho chữ sản phẩm do mã dựng sẵn (kịch bản câu chuyện theo SKU, mô tả và thành phần dự phòng). Chỉ spec import; không vào bundle.
 *
 * Hai nhóm, vì hai mức rủi ro khác nhau:
 * - `MEDICAL_CLAIMS`: công dụng y tế hay diệt khuẩn. Không bao giờ được xuất hiện trong chữ dựng sẵn, kể cả khi bao bì có in.
 * - `PROOF_CLAIMS`: chứng nhận, con số, so sánh hơn, nhãn an toàn tuyệt đối. Bao bì có in cũng không chép lại: cần giấy tờ đi kèm mà catalog chưa có.
 */
export const MEDICAL_CLAIMS =
  /chữa|điều trị|trị (?:bệnh|mụn|nám|ho|cảm|viêm|sẹo)|bệnh|kháng viêm|kháng khuẩn|diệt khuẩn|sát khuẩn|khử khuẩn|tiệt trùng|vô trùng|vi khuẩn|vi rút|virus|dị ứng|y khoa|bác sĩ|lâm sàng|kiểm nghiệm|xua đuổi|côn trùng|muỗi|giảm đau|hạ sốt|thải độc|detox|ung thư|tiểu đường|\bmụn\b|\bnám\b|\bsẹo\b|mọc tóc|trẻ hoá|trẻ hóa|làm trắng/i;

export const PROOF_CLAIMS =
  /chứng nhận|chứng chỉ|usda|haccp|ocop|pasteur|viện |\bgmp\b|\biso\b|control union|vegan|thuần chay|không hoá chất|không hóa chất|hoá chất độc hại|hóa chất độc hại|an toàn|lành tính|tuyệt đối|hàng đầu|tốt nhất|số 1|số một|thượng hạng|nhập khẩu|israel|xuất xứ|\d+(?:[.,]\d+)? ?%|low ?gi\b|hấp thu chậm|đạt chuẩn|tiêu chuẩn/i;

/** Bao bì Pineboo ghi eco-enzyme lên men từ vỏ dứa; không có thân tre, sợi tre hay bông tre nào. Chặn lại lỗi từ mô tả sai thương hiệu. */
export const BAMBOO_CLAIMS = /sợi tre|thân tre|bông tre|giấy tre|tăm bông|khăn giấy|bột tre|tre tự nhiên/i;
