/**
 * Khách vào web từ đâu (sàn, thẻ trong hộp hàng, OA, link bio, CTV...): `?src=` (hoặc `utm_source`, hoặc `card=<đợt>`),
 * `utm_campaign`, `utm_medium`. Mã mặc định: shopee, lazada, tiktok, fb, oa, linkbio, ctv, card-<đợt>; mã khác miễn khớp
 * ENTRY_TOKEN_PATTERN. Khuôn dùng chung với API (apps/api/src/common/attribution.ts) và miniapp (utils/entry-source.ts):
 * sửa một nơi phải sửa cả ba. Tham số bẩn bị bỏ im lặng.
 *
 * Web chưa có analytics phía client nên chỉ giữ CHẠM ĐẦU: cookie 30 ngày, gửi kèm đăng nhập Zalo để API ghi vào tài khoản MỚI.
 */
import { tenantSubdomain } from './tenant-subdomain';

export const ENTRY_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const REF_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

export const FIRST_TOUCH_COOKIE = 'tubu_ft';
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface LaunchAttribution {
  source: string;
  campaign?: string;
  medium?: string;
}

/** Nguồn chạm đầu gửi lên API (`firstTouch` của /auth/zalo-oauth). */
export interface FirstTouch {
  source: string;
  campaign?: string;
  at?: string;
}

export function normalizeEntryToken(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  return ENTRY_TOKEN_PATTERN.test(v) ? v : undefined;
}

function cardToken(raw: string | null): string | undefined {
  const v = normalizeEntryToken(raw);
  if (!v) return undefined;
  return normalizeEntryToken(v.startsWith('card-') ? v : `card-${v}`);
}

const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/;

/**
 * Thứ tự chọn nguồn: src, utm_source, card, rồi ngầm hiểu từ dạng link: trang gian hàng (`/s/<slug>` hoặc subdomain `<slug>.<miền>`)
 * hoặc `?l=` (link CTV tạo) → ctv, chỉ có `?ref=` → ref.
 * Ứng viên bẩn bị bỏ qua. Không có nguồn dùng được → null. `host` là `location.host` (có thể kèm cổng): subdomain gian hàng được
 * middleware rewrite `/` → `/s/<slug>` nên trình duyệt chỉ thấy đường dẫn `/`.
 */
export function parseEntryParams(params: URLSearchParams, pathname = '', host = ''): LaunchAttribution | null {
  const card = cardToken(params.get('card'));
  const ref = params.get('ref')?.trim();
  const hasRef = Boolean(ref && REF_CODE_PATTERN.test(ref));
  // Địa chỉ IP (máy dev truy cập qua mạng LAN) không phải tên miền có subdomain, dù middleware vẫn tách chuỗi theo dấu chấm.
  const onStorefront = /^\/s\/[^/]+/.test(pathname) || (!IPV4_HOST.test(host) && tenantSubdomain(host) !== null);
  const link = params.get('l')?.trim();
  const hasLink = Boolean(link && LINK_CODE_PATTERN.test(link));

  const explicit = normalizeEntryToken(params.get('src')) ?? normalizeEntryToken(params.get('utm_source'));
  // Trang gian hàng CTV và link CTV tạo (?l=) chỉ CTV mới có; ?ref= trần có thể là bạn bè hoặc CTV nên chỉ gọi là "ref".
  const source = explicit ?? card ?? (onStorefront || hasLink ? 'ctv' : undefined) ?? (hasRef ? 'ref' : undefined);
  if (!source) return null;

  const out: LaunchAttribution = { source };
  const campaign = normalizeEntryToken(params.get('utm_campaign')) ?? (explicit && card ? card : undefined);
  if (campaign) out.campaign = campaign;
  const medium = normalizeEntryToken(params.get('utm_medium'));
  if (medium) out.medium = medium;
  return out;
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Chạm đầu đã lưu ở máy này; cookie hỏng hay sai khuôn → undefined. */
export function readFirstTouchCookie(): FirstTouch | undefined {
  const raw = readCookie(FIRST_TOUCH_COOKIE);
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const source = normalizeEntryToken(v.source);
    if (!source) return undefined;
    const out: FirstTouch = { source };
    const campaign = normalizeEntryToken(v.campaign);
    if (campaign) out.campaign = campaign;
    if (typeof v.at === 'string' && !Number.isNaN(Date.parse(v.at))) out.at = v.at;
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Lần đầu máy này vào bằng link có nguồn thì ghi cookie 30 ngày; đã có cookie thì giữ nguyên (chạm ĐẦU, không ghi đè). Vào trang
 * trần không phải một "nguồn" để lưu nên lần quét thẻ sau đó vẫn là chạm đầu có thật. Cookie không HttpOnly vì JS phải đọc để
 * gửi kèm đăng nhập; nó chỉ chứa nhãn kênh, không phải bí mật.
 */
export function captureFirstTouch(
  loc: Pick<Location, 'search' | 'pathname' | 'protocol'> & { host?: string } = window.location,
  now: Date = new Date(),
): void {
  try {
    if (readFirstTouchCookie()) return;
    const launch = parseEntryParams(new URLSearchParams(loc.search), loc.pathname, loc.host);
    if (!launch) return;
    const ft: FirstTouch = { source: launch.source, at: now.toISOString() };
    if (launch.campaign) ft.campaign = launch.campaign;
    const secure = loc.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      `${FIRST_TOUCH_COOKIE}=${encodeURIComponent(JSON.stringify(ft))}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  } catch {
    /* cookie bị chặn (chế độ riêng tư): chỉ mất số liệu nguồn, không ảnh hưởng mua hàng */
  }
}
