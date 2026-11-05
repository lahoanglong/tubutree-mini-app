/**
 * Cắt khoảng trắng và ký tự vô hình (rộng 0, đánh dấu hướng, BOM, soft hyphen...) ở HAI ĐẦU. Không đụng phần giữa: U+200D nối các
 * thành phần của emoji ghép (gia đình, nghề nghiệp...). `String.trim` bỏ khoảng trắng nhưng để lại U+200B/200C/200D/2060, nên tiêu
 * đề toàn ký tự đó từng lọt qua kiểm "không rỗng" mà hiển thị ra rỗng.
 */
const EDGE = /^[\s\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+|[\s\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+$/g;

export const trimInvisible = (text: string): string => text.replace(EDGE, '');
