/**
 * Cắt khoảng trắng và ký tự vô hình (rộng 0, đánh dấu hướng, BOM, soft hyphen...) ở HAI ĐẦU. Không đụng phần giữa: U+200D nối các
 * thành phần của emoji ghép (gia đình, nghề nghiệp...). `String.trim` bỏ khoảng trắng nhưng để lại U+200B/200C/200D/2060, nên tiêu
 * đề toàn ký tự đó từng lọt qua kiểm "không rỗng" mà hiển thị ra rỗng. Cũng bỏ ký tự lấp chỗ trống của Hangul (U+115F, U+1160,
 * U+3164, U+FFA0) và ô chữ nổi trống U+2800: hiện ra như khoảng trắng, hay dùng để đặt "tên trống" trên Zalo.
 */
const INVISIBLE = '\u00ad\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u2800\u3164\ufeff\uffa0';
const EDGE = new RegExp(`^[\\s${INVISIBLE}]+|[\\s${INVISIBLE}]+$`, 'g');
const ANYWHERE = new RegExp(`[${INVISIBLE}]`, 'g');

export const trimInvisible = (text: string): string => text.replace(EDGE, '');

/**
 * Bỏ ký tự vô hình Ở MỌI VỊ TRÍ (khoảng trắng thường giữ nguyên). Dùng cho chuỗi mà ký tự vô hình giữa chữ không có nghĩa gì,
 * như SĐT dán từ Zalo hay Word; KHÔNG dùng cho văn bản người đọc: U+200D nối các thành phần của emoji ghép.
 */
export const removeInvisible = (text: string): string => text.replace(ANYWHERE, '');
