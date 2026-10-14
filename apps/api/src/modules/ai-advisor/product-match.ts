import { foldVietnamese } from '../catalog/search-text';

/**
 * Từ đệm tiếng Việt (đã bỏ dấu) khách hay gõ trong câu hỏi dài — không mang nghĩa sản phẩm nên không được dùng để
 * tìm: trước đây "tôi", "cho", "mua" khớp tên mọi sản phẩm "… cho bé" và đẩy sản phẩm không liên quan lên đầu. Cố ý
 * KHÔNG đưa vào các từ bỏ dấu trùng tên hàng thật: "cỏ", "bàn chải", "gói", "đen", "hôi", "tủ", "bi".
 */
const STOP_WORDS = new Set([
  'toi', 'minh', 'em', 'anh', 'chi', 'shop', 'tubu', 'muon', 'can', 'cho', 'mua', 'tim', 'giup', 'xin', 'vui', 'hay',
  'nhe', 'nha', 'oi', 'la', 'va', 'khong', 'nhung', 'cua', 'voi', 'mot', 'cac', 'nay', 'duoc', 'nao', 'gi', 'rat', 'qua',
  'lam', 'thi', 'nen', 'cung', 'roi', 'dang', 'se',
]);

const MAX_TOKENS = 8;
/** Token ngắn hơn không đủ phân biệt sản phẩm. */
const MIN_TOKEN_LENGTH = 2;
/** Từ gõ dở ("tram" cho "tràm") chỉ được khớp tiền tố khi đủ dài, tránh "mat" dính "matte". */
const MIN_PREFIX_LENGTH = 4;

/** Từ khoá tìm sản phẩm: bỏ dấu, bỏ từ đệm, bỏ trùng, tối đa 8. */
export function productQueryTokens(query: string): string[] {
  const words = foldVietnamese(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(w));
  return Array.from(new Set(words)).slice(0, MAX_TOKENS);
}

/** Số từ khoá khớp NGUYÊN TỪ (hoặc tiền tố khi từ khoá đủ dài) trong tên sản phẩm. */
export function matchedTokenCount(tokens: string[], productName: string): number {
  const words = foldVietnamese(productName).split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.filter((t) => words.some((w) => w === t || (t.length >= MIN_PREFIX_LENGTH && w.startsWith(t)))).length;
}

/** Nhiều từ khoá thì phải khớp ít nhất 2 (một từ chung như "nước" không đủ), một từ khoá thì khớp từ đó. */
export function minTokenMatches(tokenCount: number): number {
  return tokenCount >= 2 ? 2 : 1;
}

/**
 * Lọc rồi xếp ứng viên theo số từ khoá khớp (nhiều trước). Sort ổn định nên khi hoà vẫn giữ thứ tự đầu vào — ứng viên
 * vào đây đã sắp theo nổi bật/đánh giá.
 */
export function rankProducts<T extends { name: string }>(tokens: string[], candidates: T[], limit: number): T[] {
  const min = minTokenMatches(tokens.length);
  return candidates
    .map((c) => ({ c, n: matchedTokenCount(tokens, c.name) }))
    .filter((x) => x.n >= min)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((x) => x.c);
}
