/**
 * Tách mã vận đơn khỏi nội dung quét trên nhãn (mã trần, có gạch nối, URL, JSON, câu chữ, link của chính thẻ Tubu).
 * `normalizeClaimCode` giữ đúng luật của `normalizeTrackingCode` ở API (apps/api/src/modules/external-points/external-order.mapper.ts):
 * sửa một nơi phải sửa nơi kia; bộ ca chung nằm ở claim-code-cases.json và cả hai spec cùng chạy.
 */

/** Chữ hoa, bỏ khoảng trắng, gạch ngang và gạch dưới; chỉ nhận A-Z0-9 dài 8–30, còn lại null. */
export function normalizeClaimCode(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw : typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : null;
  if (text === null) return null;
  const code = text.toUpperCase().replace(/[\s_-]+/g, '');
  return /^[A-Z0-9]{8,30}$/.test(code) ? code : null;
}

export type ClaimScanKind = 'code' | 'card_link' | 'url' | 'none';

export interface ClaimScanResult {
  kind: ClaimScanKind;
  code: string | null;
}

const CARD_LINK = /(^|[/.])zalo\.me\/s\/\d+/i;
const URL_START = /^[a-z][a-z0-9+.-]*:\/\//i;
const WIFI = /^WIFI:/i;
const PREFERRED_KEY = /code|track|waybill|bill|^sn$|order|ma$/i;
/** Tham số theo dõi quảng cáo, phiên, id nội bộ: không bao giờ là mã vận đơn. */
const IGNORED_KEY = /^(utm_.*|ref|id|session.*|fbclid|gclid)$/i;
/** Khoá ưu tiên phải thắng mọi ứng viên không có khoá: chữ+số (2) cộng tiền tố hãng (1) tối đa 3. */
const PREFERRED_BOOST = 5;
const TOKEN = /[A-Za-z0-9][A-Za-z0-9_-]{6,}/g;
const SHOP_HOSTS = /(^|\.)(shopee\.vn|shp\.ee|lazada\.vn|lzd\.co|tiktok\.com|tiktokshop\.com)$/i;
const CARRIER_PREFIX = /^(SPX|GHN|GHTK|JT|LZ|LEX|VN|TTS|VTP|NJV|BEST|SHP|LGS)/;

/** Chuỗi toàn số có độ dài và số kiểm của GTIN-8/12/13/14. Nhiều mã vận đơn toàn số trùng số kiểm do ngẫu nhiên nên chỉ dùng để xếp hạng thấp, trừ EAN-13 đầu 893. */
export function isGtin(digits: string): boolean {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length - 1; i++) sum += Number(digits[digits.length - 2 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** Mã vạch hàng Việt Nam (EAN-13 đầu 893, số kiểm đúng): chắc chắn là mã sản phẩm, loại hẳn. */
const isVnProductBarcode = (digits: string): boolean => digits.length === 13 && digits.startsWith('893') && isGtin(digits);

const isPhoneLike = (digits: string): boolean => /^(0|84)\d{9}$/.test(digits);

/** Mã hợp lệ theo luật API và không giống mã sản phẩm hay số điện thoại; null nếu không. */
function acceptable(raw: string, requireDigit: boolean): string | null {
  const code = normalizeClaimCode(raw);
  if (!code) return null;
  if (requireDigit && !/\d/.test(code)) return null;
  if (/^\d+$/.test(code) && (isVnProductBarcode(code) || isPhoneLike(code))) return null;
  return code;
}

interface Candidate {
  code: string;
  boost: number;
}

/** Mã vận đơn thường có cả chữ lẫn số và tiền tố hãng; chuỗi chỉ toàn số xếp sau. Ngang điểm thì lấy cái xuất hiện trước. */
function best(cands: Candidate[]): string | null {
  let top: { code: string; score: number } | null = null;
  for (const c of cands) {
    let score = c.boost;
    if (/[A-Z]/.test(c.code) && /\d/.test(c.code)) score += 2;
    if (CARRIER_PREFIX.test(c.code)) score += 1;
    if (isGtin(c.code)) score -= 3;
    if (!top || score > top.score) top = { code: c.code, score };
  }
  return top?.code ?? null;
}

function tokensOf(text: string, boost = 0): Candidate[] {
  const out: Candidate[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const code = acceptable(m[0], true);
    if (code) out.push({ code, boost });
  }
  return out;
}

function leafCandidates(value: unknown, keyBoost: number, depth: number, out: Candidate[]): void {
  if (depth > 4) return;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value);
    const whole = acceptable(text, true);
    if (whole) out.push({ code: whole, boost: keyBoost });
    else out.push(...tokensOf(text, keyBoost));
  } else if (Array.isArray(value)) {
    for (const v of value) leafCandidates(v, keyBoost, depth + 1, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (IGNORED_KEY.test(k)) continue;
      leafCandidates(v, PREFERRED_KEY.test(k) ? PREFERRED_BOOST : 0, depth + 1, out);
    }
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function urlCandidates(u: URL): Candidate[] {
  const out: Candidate[] = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (IGNORED_KEY.test(k)) continue;
    const boost = PREFERRED_KEY.test(k) ? PREFERRED_BOOST : 0;
    const whole = acceptable(v, true);
    if (whole) out.push({ code: whole, boost });
    else out.push(...tokensOf(v, boost));
  }
  for (const seg of u.pathname.split('/').filter(Boolean)) {
    const code = acceptable(safeDecode(seg), true);
    if (code) out.push({ code, boost: 0 });
  }
  return out;
}

/** `code=` trong link thẻ Tubu (nhãn riêng từng đơn): chỉ nhận khi đúng dạng mã vận đơn. */
function codeParamOfCardLink(text: string): string | null {
  try {
    const raw = new URL(URL_START.test(text) ? text : `https://${text}`).searchParams.get('code');
    return raw ? acceptable(raw, false) : null;
  } catch {
    return null;
  }
}

/** Nội dung quét hoặc dán vào ô: ra mã đã chuẩn hoá, hoặc cho biết đó là link của thẻ Tubu, một URL không có mã, hay không đọc được. */
export function extractClaimCode(content: unknown): ClaimScanResult {
  const text = typeof content === 'string' ? content.trim() : typeof content === 'number' ? String(content) : '';
  if (!text || WIFI.test(text)) return { kind: 'none', code: null };
  if (CARD_LINK.test(text)) return { kind: 'card_link', code: codeParamOfCardLink(text) };

  // Nhiều mảnh cách nhau bởi khoảng trắng: chấm từng mảnh, không gộp (gộp "MÃ SĐT" thành một chuỗi 25 ký tự lách bộ lọc SĐT).
  // Không mảnh nào đứng riêng được thì mới thử gộp, cho mã in chia nhóm như "SPX VN 0123456789".
  const pieces = text.split(/\s+/).filter(Boolean);
  if (pieces.length > 1 && !text.startsWith('{') && !text.startsWith('[') && !URL_START.test(text)) {
    const code = best(pieces.flatMap((piece) => {
      const c = acceptable(piece, true);
      return c ? [{ code: c, boost: 0 }] : [];
    }));
    if (code) return { kind: 'code', code };
  }
  const plain = acceptable(text, false);
  if (plain) return { kind: 'code', code: plain };

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const cands: Candidate[] = [];
      leafCandidates(JSON.parse(text), 0, 0, cands);
      const code = best(cands);
      if (code) return { kind: 'code', code };
    } catch {
      /* không phải JSON hợp lệ: thử như câu chữ ở dưới */
    }
  }
  if (URL_START.test(text)) {
    let u: URL | null = null;
    try {
      u = new URL(text);
    } catch {
      u = null;
    }
    if (u && SHOP_HOSTS.test(u.hostname)) return { kind: 'url', code: null };
    const code = u ? best(urlCandidates(u)) : null;
    return code ? { kind: 'code', code } : { kind: 'url', code: null };
  }
  const code = best(tokensOf(text));
  return code ? { kind: 'code', code } : { kind: 'none', code: null };
}
