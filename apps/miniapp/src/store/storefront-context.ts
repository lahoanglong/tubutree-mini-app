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
    const next = { slug: ctx.slug ?? get().slug, referralCode: ctx.referralCode ?? get().referralCode };
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    set(next);
  },
  clear: () => {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    set({ slug: null, referralCode: null });
  },
}));
