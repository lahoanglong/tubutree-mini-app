/**
 * Ghi nhớ "khách đang mua qua gian hàng nào".
 *
 * Mini App có store riêng cho việc này và gửi `storefrontSlug` + `referralCode` khi đặt đơn;
 * web thì không có gì cả, nên hai thứ mất hẳn:
 *  - Hoa hồng CTV: đơn đặt từ gian hàng CTV về `storefrontSlug = null` → CTV không được ghi
 *    nhận đơn nào, dù khách vào đúng link của họ.
 *  - Tiền khách trả: combo giảm giá của gian hàng tính theo `storefrontSlug`; thiếu nó thì
 *    khách trả giá cao hơn mức gian hàng đang quảng cáo.
 *
 * Dùng sessionStorage (sống theo tab) — attribution dài hạn đã có "chạm giới thiệu" phía server
 * giữ 3 ngày. Khách chưa đăng nhập thì chưa chạm được, nên nguồn từ link còn được ghi một "bản chờ" ở localStorage để lần
 * đăng nhập sau (kể cả tab mới) chạm bù.
 */
const KEY = 'tubu_web_storefront';
const PENDING_KEY = 'tubu_web_ref_pending';
/** Bản chờ nguồn giới thiệu chỉ có giá trị trong chừng này ngày kể từ lúc khách mở link. */
export const PENDING_REF_TTL_DAYS = 7;

export interface StorefrontContext {
  slug: string | null;
  referralCode: string | null;
  /**
   * Loại gian hàng đang xem. Quan trọng với `slug`: chỉ gian hàng CTV mới được gắn vào
   * `Order.storefrontSlug` — gắn slug của gian hàng NHÃN HÀNG vào đó làm bẩn báo cáo đơn theo
   * CTV và khiến combo được tính theo nhầm gian hàng. Mini App lọc đúng như vậy
   * (checkout.tsx: `kind === 'ctv' ? slug : undefined`), và BE cũng giữ nguyên tắc đó ở nhánh
   * fallback theo "chạm giới thiệu".
   */
  kind: string | null;
  /**
   * `referralCode` có thật sự là mã của CTV hay không: máy chủ chỉ ghi công mã CTV/đại lý, mã khách thường (nút chia sẻ sản
   * phẩm) bị bỏ qua. null = chưa biết (chưa đăng nhập nên chưa chạm, hoặc chạm lỗi mạng). Chỉ `true` mới khoá ô mã giới thiệu
   * ở thanh toán.
   */
  referralEligible: boolean | null;
}

const EMPTY: StorefrontContext = { slug: null, referralCode: null, kind: null, referralEligible: null };

const norm = (code: string | null | undefined) => (code ?? '').trim().toUpperCase();

/** Đổi mã thì quên kết quả cũ; giữ nguyên mã thì giữ kết quả máy chủ đã trả, nếu chưa có mới dùng gợi ý của nơi gọi. */
function eligibilityFor(current: StorefrontContext, nextCode: string | null, hint: boolean | null): boolean | null {
  if (!nextCode) return null;
  return norm(nextCode) === norm(current.referralCode) ? (current.referralEligible ?? hint) : hint;
}

function read(): StorefrontContext {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StorefrontContext>;
    return {
      slug: typeof parsed.slug === 'string' ? parsed.slug : null,
      referralCode: typeof parsed.referralCode === 'string' ? parsed.referralCode : null,
      kind: typeof parsed.kind === 'string' ? parsed.kind : null,
      referralEligible: typeof parsed.referralEligible === 'boolean' ? parsed.referralEligible : null,
    };
  } catch {
    return EMPTY;
  }
}

const listeners = new Set<() => void>();

/** Cho màn đang mở (vd badge giỏ ở layout gốc, không remount khi vào /s/[slug]) biết gian hàng ghi công vừa đổi. */
export function subscribeStorefrontContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  listeners.forEach((l) => l());
}

function write(ctx: StorefrontContext): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ctx));
  } catch {
    /* private mode / hết quota — mất ngữ cảnh chấp nhận được, không được làm hỏng trang */
  }
  notify();
}

export function getStorefrontContext(): StorefrontContext {
  return read();
}

/**
 * `slug` phải là slug gốc API trả về (không phải tham số URL: khách vào qua subdomain thì URL mang subdomain), và mã giới
 * thiệu lấy từ chủ gian hàng do API trả. CTV đổi subdomain thì subdomain không còn trùng mã giới thiệu (SELLER-4).
 */
export function rememberStorefront(slug: string, type?: string, ownerReferralCode?: string | null): void {
  const current = read();
  const code = type === 'CTV' && ownerReferralCode ? ownerReferralCode.trim().toUpperCase() : null;
  const referralCode = code || current.referralCode;
  write({
    slug,
    kind: type ?? null,
    referralCode,
    // Mã của chủ gian hàng CTV là mã CTV (API chỉ trả mã cho gian hàng CTV); các loại khác không đổi mã đang có.
    referralEligible: eligibilityFor(current, referralCode, code ? true : null),
  });
  if (type === 'CTV') savePendingRef({ referralCode: code, slug, kind: 'CTV' });
}

/** Slug chỉ được gắn vào đơn khi là gian hàng CTV — xem ghi chú ở `kind`. */
export function ctvSlugFor(ctx: StorefrontContext): string | undefined {
  return ctx.kind === 'CTV' && ctx.slug ? ctx.slug : undefined;
}

export function rememberReferral(code: string): void {
  const current = read();
  const referralCode = code.trim().toUpperCase() || current.referralCode;
  write({ ...current, referralCode, referralEligible: eligibilityFor(current, referralCode, null) });
}

/** Ghi kết quả "chạm giới thiệu" của máy chủ cho đúng mã đang nhớ; kết quả của mã đã đổi (đến muộn) bị bỏ. */
export function confirmReferralTouch(code: string, ok: boolean): void {
  const current = read();
  if (!current.referralCode || norm(current.referralCode) !== norm(code) || current.referralEligible === ok) return;
  write({ ...current, referralEligible: ok });
}

/**
 * Nguồn vào từ link (`?s=` gian hàng CTV, `?ref=` mã giới thiệu), cùng quy tắc `setContext` của Mini App:
 * thiếu `s` thì xoá slug cũ (link `/?ref=` thuần không được thừa hưởng gian hàng của lần xem trước, kẻo gán nhầm
 * `storefrontSlug` vào đơn); có `s` thì là gian hàng CTV.
 */
export function rememberEntryLink(slug: string | null, ref: string | null): void {
  if (!slug && !ref) return;
  const current = read();
  const referralCode = ref ? ref.trim().toUpperCase() || null : null;
  write({
    slug: slug ?? null,
    referralCode,
    kind: slug ? 'CTV' : current.kind,
    referralEligible: eligibilityFor(current, referralCode, null),
  });
  savePendingRef({ referralCode, slug: slug ?? null, kind: slug ? 'CTV' : null });
}

export interface PendingRef {
  referralCode: string | null;
  slug: string | null;
  kind: string | null;
  /** Epoch ms lúc khách mở link. */
  savedAt: number;
}

/** Chỉ giữ link mở gần nhất: khách mở link CTV khác thì nguồn mới thay nguồn cũ (last-touch như máy chủ). */
function savePendingRef(ref: Omit<PendingRef, 'savedAt'>): void {
  if (typeof window === 'undefined' || (!ref.referralCode && !ref.slug)) return;
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...ref, savedAt: Date.now() } satisfies PendingRef));
  } catch {
    /* private mode / hết quota — mất bản chờ chấp nhận được, sessionStorage vẫn giữ nguồn trong tab */
  }
}

/** Bản chờ còn trong hạn, hoặc null (không có, hỏng, hết hạn — hết hạn thì dọn luôn). */
export function readPendingRef(now: number = Date.now()): PendingRef | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingRef> | null;
    const referralCode = typeof p?.referralCode === 'string' && p.referralCode ? p.referralCode : null;
    const slug = typeof p?.slug === 'string' && p.slug ? p.slug : null;
    if (typeof p?.savedAt !== 'number' || (!referralCode && !slug)) return null;
    if (now - p.savedAt > PENDING_REF_TTL_DAYS * 24 * 60 * 60 * 1000) {
      clearPendingRef();
      return null;
    }
    return { referralCode, slug, kind: typeof p.kind === 'string' ? p.kind : null, savedAt: p.savedAt };
  } catch {
    return null;
  }
}

export function clearPendingRef(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export function clearStorefrontContext(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  notify();
}
