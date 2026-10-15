/** Domain được PHÉP chèn link ngoài trong bài/bình luận: khác domain này đều bị coi là link lạ. */
const LINK_WHITELIST_DOMAINS = ['tubutree.com', 'zalo.me', 'zaloapp.com'];

/**
 * Từ/cụm từ cấm mặc định: spam/lừa đảo/cờ bạc/vay nóng phổ biến. Admin đổi được qua SystemConfig
 * `community.banned_keywords` (cùng định dạng, mảng chuỗi); khoá chưa có thì dùng danh sách này.
 *
 * Quy ước so khớp, theo RANH GIỚI TỪ ("sex" không dính "unisex"):
 *  - Cụm KHÔNG dấu (vd "vay nong") khớp cả bản có dấu lẫn không dấu.
 *  - Cụm CÓ dấu (vd "cá độ") chỉ khớp khi gõ đúng dấu: bỏ dấu thì trùng với câu đời thường ("cá độ" ~ "cả đó",
 *    "cá cược" ~ "cả cuộc", "hàng giả" ~ "hàng gia dụng", "cờ bạc" ~ "cỏ bạc hà"). Đánh đổi: bản không dấu của các
 *    cụm này không bị hạ cờ, nên thêm các cụm dài không dấu đủ rõ nghĩa ("ca do bong da").
 * Đây là rào chắn SƠ BỘ, không thay kiểm duyệt người: chỉ để hạ auto-PUBLISHED xuống PENDING.
 */
export const DEFAULT_BANNED_KEYWORDS: readonly string[] = [
  'lua dao',
  'lua tien',
  'casino',
  'vay nong',
  'vay lai',
  'tin dung den',
  'da cap',
  'rua tien',
  'hang nhai',
  'khieu dam',
  'sex',
  'ma tuy',
  'vu khi',
  'lam bang gia',
  'chiem doat tai san',
  'ca do bong da',
  'ca cuoc bong da',
  'cá độ',
  'cá cược',
  'hàng giả',
  'cờ bạc',
];

const MAX_KEYWORDS = 300;
const MAX_KEYWORD_LENGTH = 60;

const WORD_CHAR = '[\\p{L}\\p{N}]';

/** Bỏ dấu tiếng Việt + hạ thường, dùng để so khớp cụm không dấu. */
export function stripDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wholeWord(keyword: string): RegExp {
  return new RegExp(`(?<!${WORD_CHAR})${escapeRegExp(keyword)}(?!${WORD_CHAR})`, 'u');
}

interface CompiledKeywords {
  folded: RegExp[];
  accented: RegExp[];
}

const compiledCache = new WeakMap<readonly string[], CompiledKeywords>();

function compile(keywords: readonly string[]): CompiledKeywords {
  const cached = compiledCache.get(keywords);
  if (cached) return cached;
  const folded: RegExp[] = [];
  const accented: RegExp[] = [];
  for (const raw of keywords) {
    const phrase = raw.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!phrase) continue;
    (stripDiacritics(phrase) === phrase ? folded : accented).push(wholeWord(phrase));
  }
  const compiled = { folded, accented };
  compiledCache.set(keywords, compiled);
  return compiled;
}

/** Giá trị SystemConfig → danh sách dùng được; sai kiểu (không phải mảng chuỗi) rơi về mặc định để việc đăng bài không hỏng. */
export function parseBannedKeywords(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return DEFAULT_BANNED_KEYWORDS;
  return value as string[];
}

/** Lỗi nhập danh sách từ cấm ở trang Cấu hình (null = hợp lệ). Mảng rỗng hợp lệ: tắt lọc từ, vẫn lọc link lạ. */
export function bannedKeywordsProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'phải là mảng chuỗi ["cá độ", "vay nong", ...]';
  if (value.length > MAX_KEYWORDS) return `tối đa ${MAX_KEYWORDS} cụm`;
  for (const v of value) {
    if (typeof v !== 'string' || !v.trim()) return 'mỗi cụm phải là chuỗi không rỗng';
    if (v.length > MAX_KEYWORD_LENGTH) return `mỗi cụm tối đa ${MAX_KEYWORD_LENGTH} ký tự ("${v.slice(0, 20)}…" quá dài)`;
  }
  return null;
}

/**
 * Lọc nội dung đơn giản (§6.14 moderation gap): text chứa từ cấm HOẶC link ngoài domain không nằm trong whitelist hay
 * không. KHÔNG chặn hẳn, chỉ dùng để hạ cờ, ép bài/bình luận vào hàng chờ PENDING dù tác giả isTrusted, vì rào cản
 * "đã mua 1 lần" quá thấp: một tài khoản mua hàng 1 lần vẫn có thể chèn link ngoài/nội dung vi phạm.
 */
export function containsBannedContent(text: string, keywords: readonly string[] = DEFAULT_BANNED_KEYWORDS): boolean {
  if (!text) return false;
  const { folded, accented } = compile(keywords);
  const normalized = stripDiacritics(text);
  if (folded.some((re) => re.test(normalized))) return true;
  const exact = text.normalize('NFC').toLowerCase();
  if (accented.some((re) => re.test(exact))) return true;

  const urlRegex = /https?:\/\/([^\s/"'<>]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    const host = match[1]!.split(/[/:?#]/)[0]!.toLowerCase();
    const whitelisted = LINK_WHITELIST_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
    if (!whitelisted) return true;
  }
  return false;
}
