import { create } from 'zustand';

const KEY = 'tubu_sf_ctx';
type Ctx = { slug: string | null; referralCode: string | null };

function load(): Ctx {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Ctx;
  } catch { /* ignore */ }
  return { slug: null, referralCode: null };
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
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    set(next);
  },
  clear: () => {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    set({ slug: null, referralCode: null });
  },
}));
