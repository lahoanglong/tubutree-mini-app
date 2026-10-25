/**
 * Tách mã vận đơn khỏi nội dung quét trên nhãn (mã trần, có gạch nối, URL, JSON, link của chính thẻ Tubu).
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
const PREFERRED_KEY = /code|track|waybill|bill|^sn$|order|ma$/i;
const TOKEN = /[A-Za-z0-9][A-Za-z0-9_-]{6,}/g;

// Chuỗi lấy từ URL, JSON hay câu chữ phải có ít nhất một chữ số: từ như "tracking" hay "shopee" dài đủ 8 chữ nhưng không phải mã.
const looksLikeCode = (token: string): string | null => {
  const code = normalizeClaimCode(token);
  return code && /\d/.test(code) ? code : null;
};

function fromTokens(text: string): string | null {
  for (const m of text.matchAll(TOKEN)) {
    const code = looksLikeCode(m[0]);
    if (code) return code;
  }
  return null;
}

function fromJson(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof value === 'string' || typeof value === 'number') return looksLikeCode(String(value));
  if (Array.isArray(value)) {
    for (const v of value) {
      const c = fromJson(v, depth + 1);
      if (c) return c;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const ordered = [...entries.filter(([k]) => PREFERRED_KEY.test(k)), ...entries.filter(([k]) => !PREFERRED_KEY.test(k))];
    for (const [, v] of ordered) {
      const c = fromJson(v, depth + 1);
      if (c) return c;
    }
  }
  return null;
}

function fromUrl(text: string): string | null {
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  const params = [...u.searchParams.entries()];
  const ordered = [...params.filter(([k]) => PREFERRED_KEY.test(k)), ...params.filter(([k]) => !PREFERRED_KEY.test(k))];
  for (const [, v] of ordered) {
    const c = looksLikeCode(v) ?? fromTokens(v);
    if (c) return c;
  }
  const segments = u.pathname.split('/').filter(Boolean).reverse();
  for (const seg of segments) {
    const c = looksLikeCode(decodeURIComponent(seg));
    if (c) return c;
  }
  return null;
}

/** Nội dung quét hoặc dán vào ô: ra mã đã chuẩn hoá, hoặc cho biết đó là link của thẻ Tubu, một URL không có mã, hay không đọc được. */
export function extractClaimCode(content: unknown): ClaimScanResult {
  const text = typeof content === 'string' ? content.trim() : typeof content === 'number' ? String(content) : '';
  if (!text) return { kind: 'none', code: null };
  if (CARD_LINK.test(text)) return { kind: 'card_link', code: null };

  const plain = normalizeClaimCode(text);
  if (plain) return { kind: 'code', code: plain };

  const isUrl = URL_START.test(text);
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const code = fromJson(JSON.parse(text));
      if (code) return { kind: 'code', code };
    } catch {
      /* không phải JSON hợp lệ: thử như câu chữ ở dưới */
    }
  }
  if (isUrl) {
    const code = fromUrl(text);
    return code ? { kind: 'code', code } : { kind: 'url', code: null };
  }
  const code = fromTokens(text);
  return code ? { kind: 'code', code } : { kind: 'none', code: null };
}
