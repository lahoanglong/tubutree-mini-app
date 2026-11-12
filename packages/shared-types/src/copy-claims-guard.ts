/**
 * Bộ chặn tuyên bố cho chữ sản phẩm do mã dựng sẵn (kịch bản câu chuyện theo SKU, mô tả và thành phần dự phòng). Cũng dùng ở API để lọc bản nháp AI và ngữ cảnh AI tư vấn (xem `sanitizeCopyText`).
 *
 * Gói này vào bundle Mini (WebView cũ): không dùng lookbehind trong regex, một cái là cả bundle lỗi cú pháp.
 *
 * Hai nhóm, vì hai mức rủi ro khác nhau:
 * - `MEDICAL_CLAIMS`: công dụng y tế hay diệt khuẩn. Không bao giờ được xuất hiện trong chữ dựng sẵn, kể cả khi bao bì có in.
 * - `PROOF_CLAIMS`: chứng nhận, con số, so sánh hơn, nhãn an toàn tuyệt đối. Bao bì có in cũng không chép lại: cần giấy tờ đi kèm mà catalog chưa có.
 *
 * Mẫu chọn hẹp (từ ghép hoặc có biên từ) để không chặn nhầm chữ đã duyệt; chữ "trị" đứng riêng xử lý ở `hasStandaloneTri` vì "giá trị", "quản trị" là chữ thường dùng.
 */
export const MEDICAL_CLAIMS =
  /chữa|điều trị|trị (?:bệnh|mụn|nám|ho|cảm|viêm|sẹo)|bệnh|kháng viêm|kháng khuẩn|diệt khuẩn|sát khuẩn|khử khuẩn|tiệt trùng|vô trùng|vi khuẩn|vi rút|virus|dị ứng|y khoa|bác sĩ|lâm sàng|kiểm nghiệm|xua đuổi|côn trùng|muỗi|giảm đau|hạ sốt|thải độc|detox|ung thư|tiểu đường|\bmụn\b|\bnám\b|\bsẹo\b|mọc tóc|trẻ hoá|trẻ hóa|làm trắng|\bgàu\b|gãy rụng|rụng tóc|sáng da|\bchàm\b|kháng nấm|trị nấm|nấm da|nấm móng|\bngứa\b|\bhăm\b|khỏi hẳn|phòng ngừa|\bngừa\b|trị liệu/i;

export const PROOF_CLAIMS =
  /chứng nhận|chứng chỉ|usda|haccp|ocop|pasteur|viện |hữu cơ|organic|đặc sản|\bgmp\b|\biso\b|control union|vegan|thuần chay|không hoá chất|không hóa chất|hoá chất độc hại|hóa chất độc hại|an toàn|lành tính|tuyệt đối|hàng đầu|tốt nhất|số 1|số một|thượng hạng|nhập khẩu|israel|xuất xứ|\d+(?:[.,]\d+)? ?%|low ?gi\b|hấp thu chậm|đạt chuẩn|tiêu chuẩn|\bfda\b|ecocert|phần trăm|gấp \d+ lần/i;

/** Từ "tự nhiên/thiên nhiên" là lời quảng cáo chưa có kiểm chứng; chữ dựng sẵn chỉ chép điều bao bì ghi cụ thể (loại enzyme, bột ngô...). */
export const NATURAL_CLAIMS = /tự nhiên|thiên nhiên/i;

/** Bao bì Pineboo ghi eco-enzyme lên men từ vỏ dứa; không có thân tre, sợi tre hay bông tre nào. Chặn lại lỗi từ mô tả sai thương hiệu. */
export const BAMBOO_CLAIMS = /sợi tre|thân tre|bông tre|giấy tre|tăm bông|khăn giấy|bột tre|tre tự nhiên/i;

/** Cụm có "trị" nhưng không phải công dụng y tế; bỏ trước khi tìm "trị" đứng riêng. */
const VALID_TRI = /giá trị|quản trị|chính trị|trị giá/gi;
/** "trị" là một từ riêng (trị gàu, trị tróc...). Biên từ theo chữ cái Unicode vì `\b` của JS chỉ biết ASCII. */
const STANDALONE_TRI = /(?:^|[^\p{L}])trị(?![\p{L}])/iu;

const hasStandaloneTri = (text: string): boolean => STANDALONE_TRI.test(text.replace(VALID_TRI, ' '));

const hasMedicalClaim = (text: string): boolean => MEDICAL_CLAIMS.test(text) || hasStandaloneTri(text);

/**
 * `claims`: chỉ công dụng y tế và chứng nhận/con số (đủ cho chữ nguồn ngoài đưa vào prompt AI tư vấn).
 * `strict`: thêm "tự nhiên/thiên nhiên" và nhầm thân tre (bản nháp mô tả sản phẩm do AI soạn, ngang chuẩn chữ dự phòng).
 */
export type SanitizeCopyLevel = 'claims' | 'strict';

export interface SanitizedCopy {
  /** Chữ thuần đã chuẩn hoá và bỏ câu vi phạm, các câu nối bằng một dấu cách. Rỗng nếu mọi câu đều vi phạm. */
  text: string;
  /** Các câu đã bị bỏ (cắt 120 ký tự), để hiện cho admin biết AI viết gì đã bị chặn. */
  removed: string[];
}

const BLOCK_TAG = /<\/(?:p|div|li|h[1-6]|br)\s*>|<br\s*\/?>/gi;
const ANY_TAG = /<[^>]*>/g;
const ENTITY = /&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|nbsp);/gi;
const NAMED_ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Khoảng trắng không phải U+0020: NBSP, các khoảng em/en, khoảng hẹp, khoảng toàn góc. Mắt người đọc là dấu cách, regex thì không.
const SPACE_LIKE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
// Ký tự rộng 0 và gạch nối mềm chen giữa chữ: người đọc vẫn thấy nguyên từ nhưng regex trượt.
const ZERO_WIDTH = /[\u00ad\u200b-\u200d\u2060\ufeff]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]+/g;

function decodeEntity(match: string, body: string): string {
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }
  return NAMED_ENTITY[body.toLowerCase()] ?? match;
}

/**
 * Đưa chữ về đúng dạng người đọc thấy trên trang sản phẩm web (`plainText` ở apps/web/src/lib/product-seo.ts): thẻ khối thành xuống dòng, mọi thẻ khác
 * xoá HẲN (không chèn dấu cách, nên `Ch<i></i>ữa` đọc là "Chữa"), thực thể giải mã MỘT lượt (`&amp;#7919;` vẫn là chữ `&#7919;`, đúng như web hiện), rồi NFC,
 * bỏ ký tự rộng 0, đổi khoảng trắng lạ thành dấu cách. Giữ các dòng; mỗi dòng gập khoảng trắng và cắt hai đầu.
 * Bộ chặn phải chạy trên bản này: chạy trên chữ thô thì NBSP, thực thể số hay thẻ chèn giữa chữ qua mặt được regex.
 */
export function normalizeCopyText(input: string): string {
  return input
    .replace(BLOCK_TAG, '\n')
    .replace(ANY_TAG, '')
    .replace(ENTITY, decodeEntity)
    .replace(ZERO_WIDTH, '')
    .normalize('NFC')
    .replace(SPACE_LIKE, ' ')
    .replace(CONTROL, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function claimsInNormalized(text: string, level: SanitizeCopyLevel): string[] {
  const out: string[] = [];
  if (hasMedicalClaim(text)) out.push('medical');
  if (PROOF_CLAIMS.test(text)) out.push('proof');
  if (level === 'strict' && NATURAL_CLAIMS.test(text)) out.push('natural');
  if (level === 'strict' && BAMBOO_CLAIMS.test(text)) out.push('bamboo');
  return out;
}

/** Các nhóm tuyên bố mà `text` vi phạm (nhãn ngắn cho admin): `medical`, `proof`, `natural`, `bamboo`. Chuẩn hoá `text` trước khi xét. */
export function claimsIn(text: string, level: SanitizeCopyLevel = 'strict'): string[] {
  return claimsInNormalized(normalizeCopyText(text), level);
}

/** Tách câu ở dấu kết câu theo sau bởi khoảng trắng (không tách "1.000đ", "v2.0"), và ở mỗi xuống dòng. Không dùng lookbehind. */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const parts = line.match(/[\s\S]*?[.!?…](?=\s|$)|[\s\S]+$/g);
    if (parts) out.push(...parts);
  }
  return out;
}

/**
 * Chuẩn hoá chữ (xem `normalizeCopyText`) rồi bỏ từng CÂU chứa tuyên bố bị cấm (cả câu, không cắt giữa câu để khỏi còn nửa lời hứa).
 * Câu cuối không dấu chấm vẫn được xét như một câu. Không cắt độ dài: người gọi tự cắt sau khi lọc.
 */
export function sanitizeCopyText(input: string, level: SanitizeCopyLevel = 'strict'): SanitizedCopy {
  const kept: string[] = [];
  const removed: string[] = [];
  for (const raw of splitSentences(normalizeCopyText(input))) {
    const s = raw.trim();
    if (s === '') continue;
    if (claimsInNormalized(s, level).length > 0) removed.push(s.length > 120 ? `${s.slice(0, 119)}…` : s);
    else kept.push(s);
  }
  return { text: kept.join(' '), removed };
}
