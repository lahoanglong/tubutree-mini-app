/**
 * Khách vào app từ đâu (sàn, thẻ trong hộp hàng, OA, link bio, CTV...), đọc từ tham số link mở app:
 * `?src=` (hoặc `utm_source`, hoặc `card=<đợt>`), `utm_campaign`, `utm_medium`. Mã nguồn mặc định:
 * shopee, lazada, tiktok, fb, oa, linkbio, ctv, card-<đợt>; mã khác miễn khớp ENTRY_TOKEN_PATTERN.
 *
 * Khuôn dùng chung với API (apps/api/src/common/attribution.ts) và web (apps/web/src/lib/entry-source.ts): sửa một nơi
 * phải sửa cả ba. Tham số bẩn bị bỏ im lặng, không bao giờ làm hỏng việc mở app.
 */
export const ENTRY_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const REF_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

export const ORGANIC_SOURCE = 'organic';

export interface LaunchAttribution {
  source: string;
  campaign?: string;
  medium?: string;
  /** `?ref=` của link giới thiệu (bạn bè hoặc CTV). */
  refCode?: string;
  /** `?l=` mã link CTV tạo, dùng đếm click (affiliate_links.shortCode). */
  linkCode?: string;
}

/** Chuẩn hoá (cắt khoảng trắng, chữ thường) rồi đối chiếu khuôn; sai khuôn hay không phải chuỗi → undefined. */
export function normalizeEntryToken(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  return ENTRY_TOKEN_PATTERN.test(v) ? v : undefined;
}

/** `card=2610` và `card=card-2610` cùng là `card-2610`. */
function cardToken(raw: string | null): string | undefined {
  const v = normalizeEntryToken(raw);
  if (!v) return undefined;
  return normalizeEntryToken(v.startsWith('card-') ? v : `card-${v}`);
}

/**
 * Thứ tự chọn nguồn: src, utm_source, card, rồi ngầm hiểu từ dạng link: `?s=` (gian hàng CTV) hoặc `?l=` (link CTV tạo) → ctv,
 * chỉ có `?ref=` → ref.
 * Ứng viên bẩn bị bỏ qua và xét ứng viên kế. Không có nguồn dùng được → null (phiên tính là organic).
 */
export function parseEntryParams(params: URLSearchParams): LaunchAttribution | null {
  const card = cardToken(params.get('card'));
  const refRaw = params.get('ref')?.trim() ?? null;
  const refCode = refRaw && REF_CODE_PATTERN.test(refRaw) ? refRaw : undefined;
  const slug = params.get('s')?.trim();

  const linkRaw = params.get('l')?.trim() ?? null;
  const linkCode = linkRaw && LINK_CODE_PATTERN.test(linkRaw) ? linkRaw : undefined;

  const explicit = normalizeEntryToken(params.get('src')) ?? normalizeEntryToken(params.get('utm_source'));
  // Link gian hàng CTV (?s=) và link CTV tạo (?l=) chỉ CTV mới có; ?ref= trần có thể là bạn bè hoặc CTV nên chỉ gọi là "ref".
  const source = explicit ?? card ?? (slug || linkCode ? 'ctv' : undefined) ?? (refCode ? 'ref' : undefined);
  if (!source) return null;

  const out: LaunchAttribution = { source };
  const campaign = normalizeEntryToken(params.get('utm_campaign')) ?? (explicit && card ? card : undefined);
  if (campaign) out.campaign = campaign;
  const medium = normalizeEntryToken(params.get('utm_medium'));
  if (medium) out.medium = medium;
  if (refCode) out.refCode = refCode;
  if (linkCode) out.linkCode = linkCode;
  return out;
}

/** ZMPRouter là BrowserRouter có basename `/zapps/<appId>` nên tham số nằm ở `location.search`; vẫn đọc cả phần sau dấu `?` của `location.hash` cho link cũ, search thắng khi trùng khoá. */
export function parseLaunchUrl(search: string, hash: string): LaunchAttribution | null {
  const params = new URLSearchParams(search);
  const q = hash.indexOf('?');
  if (q >= 0) {
    for (const [k, v] of new URLSearchParams(hash.slice(q + 1))) if (!params.has(k)) params.set(k, v);
  }
  return parseEntryParams(params);
}

// undefined = chưa đọc. Đọc ĐÚNG MỘT lần lúc mở app: về sau ZMPRouter đổi URL theo từng màn nên đọc lại sẽ mất nguồn.
let session: LaunchAttribution | null | undefined;

export function getSessionAttribution(): LaunchAttribution | null {
  if (session === undefined) {
    try {
      session = parseLaunchUrl(window.location.search || '', window.location.hash || '');
    } catch {
      session = null;
    }
  }
  return session;
}

/** Nguồn của phiên đang chạy, gắn vào phong bì mọi sự kiện analytics. */
export function sessionEntrySource(): string {
  return getSessionAttribution()?.source ?? ORGANIC_SOURCE;
}

export function __resetEntrySourceForTest(): void {
  session = undefined;
}
