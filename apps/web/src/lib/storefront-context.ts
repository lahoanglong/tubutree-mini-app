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
 * giữ 3 ngày. Khách chưa đăng nhập thì chưa chạm được, nên nguồn từ link còn được ghi vào "bản chờ" ở localStorage để lần
 * đăng nhập sau (kể cả tab mới) chạm bù.
 */
import { parseTouchMark, serializeTouchMark, touchMarkAfter, touchMarkMatches, type TouchMark } from '@tubutree/app-core/referral-touch';

const KEY = 'tubu_web_storefront';
const PENDING_KEY = 'tubu_web_ref_pending';
const CTV_TOUCHED_KEY = 'tubu_web_ctv_touched';
/**
 * Bản chờ nguồn giới thiệu chỉ có giá trị trong chừng này ngày kể từ lúc khách mở link. Chạm bù gửi kèm lúc bấm (savedAt) nên hạn ghi
 * công phía máy chủ (affiliate.attribution_days) tính từ lúc bấm; bản chờ quá hạn đó bị máy chủ bỏ qua, giữ lâu hơn cũng vô ích.
 */
export const PENDING_REF_TTL_DAYS = 7;
/** Số link gần nhất được giữ chờ: đủ để một link mã khách thường mở sau không làm mất link CTV mở trước. */
export const PENDING_REF_MAX = 3;
/** Độ dài tối đa máy chủ nhận cho mã giới thiệu và slug khi chạm (TouchDto): dài hơn thì lần nào cũng bị từ chối nên không đáng giữ chờ. */
const MAX_TOUCH_FIELD_LENGTH = 64;

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
  /** Epoch ms lúc khách bấm link nguồn: máy chủ tính hạn ghi công từ đây, kể cả khi chạm được gửi sau (đăng nhập muộn). */
  clickedAt: number | null;
}

const EMPTY: StorefrontContext = { slug: null, referralCode: null, kind: null, referralEligible: null, clickedAt: null };

const norm = (code: string | null | undefined) => (code ?? '').trim().toUpperCase();

/** Đổi mã thì quên kết quả cũ; giữ nguyên mã thì giữ kết quả máy chủ đã trả, nếu chưa có mới dùng gợi ý của nơi gọi. */
function eligibilityFor(current: StorefrontContext, nextCode: string | null, hint: boolean | null): boolean | null {
  if (!nextCode) return null;
  return norm(nextCode) === norm(current.referralCode) ? (current.referralEligible ?? hint) : hint;
}

/** Cùng mã thì giữ lúc bấm đã ghi; mã mới (hoặc chưa có lúc bấm) thì là lượt bấm vừa xảy ra. */
function clickedAtFor(current: StorefrontContext, nextCode: string | null): number | null {
  if (!nextCode) return null;
  return norm(nextCode) === norm(current.referralCode) && current.clickedAt !== null ? current.clickedAt : Date.now();
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
      clickedAt: typeof parsed.clickedAt === 'number' ? parsed.clickedAt : null,
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
    clickedAt: clickedAtFor(current, referralCode),
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
  write({ ...current, referralCode, referralEligible: eligibilityFor(current, referralCode, null), clickedAt: clickedAtFor(current, referralCode) });
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
    // Mở lại link là một lượt bấm mới, kể cả cùng mã: hạn ghi công được làm mới như trước.
    clickedAt: Date.now(),
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

const samePendingSource = (a: Pick<PendingRef, 'referralCode' | 'slug'>, b: Pick<PendingRef, 'referralCode' | 'slug'>) =>
  norm(a.referralCode) === norm(b.referralCode) && norm(a.slug) === norm(b.slug);

function writePendingRefs(list: PendingRef[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* private mode / hết quota — mất bản chờ chấp nhận được, sessionStorage vẫn giữ nguồn trong tab */
  }
}

/**
 * Nhớ link vừa mở ở cuối danh sách (mới nhất), tối đa PENDING_REF_MAX link. Chạm bù lúc đăng nhập đi từ cũ đến mới để máy chủ
 * chọn như last-touch: mã khách thường bị máy chủ bỏ qua, nên link CTV mở trước đó vẫn được ghi công.
 */
function savePendingRef(ref: Omit<PendingRef, 'savedAt'>): void {
  if (typeof window === 'undefined' || (!ref.referralCode && !ref.slug)) return;
  if ((ref.referralCode?.length ?? 0) > MAX_TOUCH_FIELD_LENGTH || (ref.slug?.length ?? 0) > MAX_TOUCH_FIELD_LENGTH) return;
  const now = Date.now();
  const kept = readPendingRefs(now).filter((p) => !samePendingSource(p, ref));
  writePendingRefs([...kept, { ...ref, savedAt: now }].slice(-PENDING_REF_MAX));
}

/** Các bản chờ còn trong hạn, cũ nhất trước (rỗng nếu không có hoặc hỏng; bản hết hạn bị dọn luôn). */
export function readPendingRefs(now: number = Date.now()): PendingRef[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const all: PendingRef[] = [];
    for (const p of parsed as Array<Partial<PendingRef> | null>) {
      const referralCode = typeof p?.referralCode === 'string' && p.referralCode ? p.referralCode : null;
      const slug = typeof p?.slug === 'string' && p.slug ? p.slug : null;
      if (typeof p?.savedAt !== 'number' || (!referralCode && !slug)) continue;
      all.push({ referralCode, slug, kind: typeof p.kind === 'string' ? p.kind : null, savedAt: p.savedAt });
    }
    const alive = all.filter((p) => now - p.savedAt <= PENDING_REF_TTL_DAYS * 24 * 60 * 60 * 1000).sort((a, b) => a.savedAt - b.savedAt);
    if (alive.length !== parsed.length) writePendingRefs(alive);
    return alive;
  } catch {
    return [];
  }
}

/**
 * Mã đã được máy chủ ghi công qua gian hàng CTV (chạm kiểu ctv, ok:true) trong tab này. Mở gian hàng đối tác/nhãn sau đó không chạm
 * lại cùng mã kiểu brand: máy chủ upsert cả dòng chạm và sẽ xoá slug gian hàng CTV khỏi nó (đơn sau không còn gắn gian hàng CTV, combo,
 * storefrontSlug) dù hoa hồng không đổi. Ở sessionStorage chứ không phải biến module để tải lại trang hay quay về từ đăng nhập Zalo
 * không làm mất (Mini App giữ cho cả phiên chạy).
 */
export function markCtvTouched(userId: string, code: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CTV_TOUCHED_KEY, serializeTouchMark(userId, code));
  } catch {
    /* private mode / hết quota — mất dấu chấp nhận được, chỉ có thể chạm kiểu brand thừa */
  }
}

/** Dấu chạm CTV thuộc về người đang đăng nhập (dòng chạm ở máy chủ theo từng người dùng), nên đăng xuất phải xoá: máy dùng chung thì người sau không được thừa hưởng. */
export function clearCtvTouched(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CTV_TOUCHED_KEY);
  } catch {
    /* ignore */
  }
}

export function wasCtvTouched(userId: string | null | undefined, code: string): boolean {
  return touchMarkMatches(readCtvTouchMark(), userId, code);
}

function readCtvTouchMark(): TouchMark | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseTouchMark(sessionStorage.getItem(CTV_TOUCHED_KEY));
  } catch {
    return null;
  }
}

/** Cập nhật dấu theo kết quả máy chủ vừa trả (xem touchMarkAfter): chạm brand ghi công mã khác thì dấu cũ không còn đúng. */
export function updateCtvTouchMark(userId: string, code: string, kind: 'ctv' | 'brand', ok: boolean): void {
  const before = readCtvTouchMark();
  const after = touchMarkAfter(before, userId, code, kind, ok);
  if (after === before) return;
  if (after) markCtvTouched(after.userId, after.code);
  else clearCtvTouched();
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
  clearCtvTouched();
  notify();
}
