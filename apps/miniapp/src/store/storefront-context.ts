import { create } from 'zustand';

const KEY = 'tubu_sf_ctx';
/** kind: 'ctv' = gian hàng CTV (/s/:slug, có combo + attribution storefrontSlug);
 *  'brand' = trang nhãn (/brand/:slug, chỉ điều hướng — KHÔNG gửi storefrontSlug để tránh ô nhiễm analytics CTV);
 *  'partner' = gian hàng đối tác/nhãn hàng ở /s/:slug: như 'brand' không gửi storefrontSlug, nhưng nút quay lại vẫn về /s/:slug
 *  (không phải /brand/:slug, trang của thực thể khác). */
/** `referralEligible`: mã giới thiệu có thật sự là của CTV (máy chủ ghi công được) hay chưa biết (null); chỉ mã đã xác nhận mới khoá ô nhập ở thanh toán. */
type Ctx = { slug: string | null; referralCode: string | null; kind: 'ctv' | 'brand' | 'partner'; referralEligible: boolean | null };

const DEFAULT_CTX: Ctx = { slug: null, referralCode: null, kind: 'ctv', referralEligible: null };

const norm = (code: string | null | undefined) => (code ?? '').trim().toUpperCase();

function load(): Ctx {
  try {
    const raw = sessionStorage.getItem(KEY);
    // Merge trên DEFAULT_CTX đầy đủ (không chỉ `kind`) — nếu JSON lưu là {} / thiếu field /
    // null (payload cũ/hỏng), slug/referralCode phải rơi về null theo đúng kiểu Ctx, không phải undefined.
    if (raw) return { ...DEFAULT_CTX, ...(JSON.parse(raw) as Partial<Ctx>) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CTX };
}

interface StorefrontCtxState extends Ctx {
  setContext: (ctx: Partial<Ctx>) => void;
  /** Ghi kết quả "chạm giới thiệu" của máy chủ cho đúng mã đang nhớ; kết quả của mã đã đổi (đến muộn) bị bỏ. */
  confirmReferral: (code: string, ok: boolean) => void;
  clear: () => void;
}

function persist(next: Ctx): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

export const useStorefrontContext = create<StorefrontCtxState>((set, get) => ({
  ...load(),
  setContext: (ctx) => {
    // Phân biệt "absent (undefined → giữ giá trị cũ)" vs "explicit null (→ xoá field)":
    // mở link affiliate thuần /?ref=CODE truyền {slug:null} phải XOÁ slug session trước,
    // tránh gán nhầm storefrontSlug cũ vào đơn (sai analytics).
    const cur = get();
    const referralCode = ctx.referralCode !== undefined ? ctx.referralCode : cur.referralCode;
    // Đổi mã thì quên kết quả cũ. Mở lại đúng mã đó thì giữ kết quả máy chủ đã trả (vd chính chủ gian hàng: ok:false) thay vì
    // đoán lại theo gợi ý của màn gọi (gian hàng CTV luôn gợi ý "hợp lệ").
    const referralEligible = !referralCode
      ? null
      : norm(referralCode) === norm(cur.referralCode)
        ? (cur.referralEligible ?? ctx.referralEligible ?? null)
        : (ctx.referralEligible ?? null);
    const next: Ctx = {
      slug: ctx.slug !== undefined ? ctx.slug : cur.slug,
      referralCode,
      kind: ctx.kind !== undefined ? ctx.kind : cur.kind,
      referralEligible,
    };
    persist(next);
    set(next);
  },
  confirmReferral: (code, ok) => {
    const cur = get();
    if (!cur.referralCode || norm(cur.referralCode) !== norm(code) || cur.referralEligible === ok) return;
    persist({ slug: cur.slug, referralCode: cur.referralCode, kind: cur.kind, referralEligible: ok });
    set({ referralEligible: ok });
  },
  clear: () => {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    set({ slug: null, referralCode: null, kind: 'ctv', referralEligible: null });
  },
}));
