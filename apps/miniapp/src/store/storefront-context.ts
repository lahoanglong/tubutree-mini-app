import { create } from 'zustand';

const KEY = 'tubu_sf_ctx';
/** kind: 'ctv' = gian hàng CTV (/s/:slug, có combo + attribution storefrontSlug);
 *  'brand' = trang nhãn (/brand/:slug, chỉ điều hướng — KHÔNG gửi storefrontSlug để tránh ô nhiễm analytics CTV). */
type Ctx = { slug: string | null; referralCode: string | null; kind: 'ctv' | 'brand' };

function load(): Ctx {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return { kind: 'ctv', ...(JSON.parse(raw) as Partial<Ctx>) } as Ctx;
  } catch { /* ignore */ }
  return { slug: null, referralCode: null, kind: 'ctv' };
}

interface StorefrontCtxState extends Ctx {
  setContext: (ctx: Partial<Ctx>) => void;
  clear: () => void;
}

export const useStorefrontContext = create<StorefrontCtxState>((set, get) => ({
  ...load(),
  setContext: (ctx) => {
    // Phân biệt "absent (undefined → giữ giá trị cũ)" vs "explicit null (→ xoá field)":
    // mở link affiliate thuần /?ref=CODE truyền {slug:null} phải XOÁ slug session trước,
    // tránh gán nhầm storefrontSlug cũ vào đơn (sai analytics).
    const cur = get();
    const next = {
      slug: ctx.slug !== undefined ? ctx.slug : cur.slug,
      referralCode: ctx.referralCode !== undefined ? ctx.referralCode : cur.referralCode,
      kind: ctx.kind !== undefined ? ctx.kind : cur.kind,
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    set(next);
  },
  clear: () => {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    set({ slug: null, referralCode: null, kind: 'ctv' });
  },
}));
