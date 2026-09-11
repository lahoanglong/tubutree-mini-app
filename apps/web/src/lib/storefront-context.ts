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
 * giữ 3 ngày.
 */
const KEY = 'tubu_web_storefront';

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
}

const EMPTY: StorefrontContext = { slug: null, referralCode: null, kind: null };

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
    };
  } catch {
    return EMPTY;
  }
}

function write(ctx: StorefrontContext): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ctx));
  } catch {
    /* private mode / hết quota — mất ngữ cảnh chấp nhận được, không được làm hỏng trang */
  }
}

export function getStorefrontContext(): StorefrontContext {
  return read();
}

/** Gian hàng CTV có slug = referralCode viết thường, nên suy ngược ra được mã giới thiệu. */
export function rememberStorefront(slug: string, type?: string): void {
  const current = read();
  write({
    slug,
    kind: type ?? null,
    referralCode: type === 'CTV' ? slug.toUpperCase() : current.referralCode,
  });
}

/** Slug chỉ được gắn vào đơn khi là gian hàng CTV — xem ghi chú ở `kind`. */
export function ctvSlugFor(ctx: StorefrontContext): string | undefined {
  return ctx.kind === 'CTV' && ctx.slug ? ctx.slug : undefined;
}

export function rememberReferral(code: string): void {
  const current = read();
  write({ ...current, referralCode: code.trim().toUpperCase() || current.referralCode });
}

export function clearStorefrontContext(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
