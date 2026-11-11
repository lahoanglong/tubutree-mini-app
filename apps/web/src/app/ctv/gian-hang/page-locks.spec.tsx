// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

type Call = { method: string; path: string; body?: unknown; query?: unknown };

/**
 * Lịch sử giả của App Router: push/replace/back đổi `usePathname`/`useSearchParams` và `history.state.tubuDepth` (độ sâu mà nút lùi nổi đọc).
 * `window.history.pushState/replaceState` được vá như Next 15 (đồng bộ `useSearchParams` mà không gọi máy chủ); `routerCalls` ghi lại
 * mọi lần gọi `router.push/replace` (soft navigation có thể tải RSC) để test khẳng định màn dựng không dùng chúng.
 */
const nav = vi.hoisted(() => {
  interface Loc { path: string; search: string; state?: Record<string, unknown> }
  const first = (): Loc => ({ path: '/ctv/gian-hang', search: '' });
  const n = {
    stack: [first()],
    idx: 0,
    listeners: new Set<() => void>(),
    get loc(): Loc { return n.stack[n.idx]!; },
    subscribe(l: () => void) { n.listeners.add(l); return () => { n.listeners.delete(l); }; },
    routerCalls: [] as string[],
    emit() {
      History.prototype.replaceState.call(window.history, { tubuDepth: n.idx, ...n.loc.state }, '');
      n.listeners.forEach((l) => l());
    },
    reset() {
      n.stack = [first()];
      n.idx = 0;
      n.routerCalls = [];
      window.history.pushState = ((data: unknown, _unused: string, url?: string | URL | null) => n.to(String(url), false, data as Record<string, unknown> | undefined)) as History['pushState'];
      window.history.replaceState = ((data: unknown, _unused: string, url?: string | URL | null) => n.to(String(url), true, data as Record<string, unknown> | undefined)) as History['replaceState'];
      n.emit();
    },
    restore() {
      delete (window.history as { pushState?: unknown }).pushState;
      delete (window.history as { replaceState?: unknown }).replaceState;
    },
    step(d: number) { n.idx = Math.min(Math.max(n.idx + d, 0), n.stack.length - 1); n.emit(); },
    to(url: string, replace: boolean, state?: Record<string, unknown>) {
      const u = new URL(url, `http://x${n.loc.path}`);
      const loc: Loc = { path: u.pathname, search: u.search, ...(state && Object.keys(state).length ? { state } : {}) };
      if (replace) n.stack[n.idx] = loc;
      else { n.stack = [...n.stack.slice(0, n.idx + 1), loc]; n.idx += 1; }
      n.emit();
    },
    api: {} as { push: (u: string) => void; replace: (u: string) => void; back: () => void; forward: () => void },
  };
  n.api = {
    push: (u) => { n.routerCalls.push(`push ${u}`); n.to(u, false); },
    replace: (u) => { n.routerCalls.push(`replace ${u}`); n.to(u, true); },
    back: () => n.step(-1),
    forward: () => n.step(1),
  };
  return n;
});

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  sf: null as Record<string, unknown> | null,
  sfStatus: 200,
  quests: null as unknown,
  stats: null as unknown,
  tiers: null as unknown,
  picker: [] as unknown[],
  categories: [] as unknown[],
  kit: null as unknown,
  me: { isAffiliate: true, canRegister: true, canOpenStorefront: true } as unknown,
  fail: new Set<string>(),
  failStatus: new Map<string, number>(),
  hold: new Set<string>(),
  gates: new Map<string, Promise<void>>(),
  /** Lần gọi ĐẦU TIÊN tới khoá này đợi hàm trả lời hứa rồi lỗi 500; các lần sau theo `hold`/`fail` như thường. */
  once: new Map<string, Promise<void>>(),
  calls: [] as Call[],
  share: vi.fn(),
  copied: [] as string[],
  created: null as unknown,
  patchResult: null as unknown,
  /** Bật thì mỗi lượt tải ảnh lên Cloudinary treo ở `uploads` tới khi test gọi `resolve`; tắt thì trả null ngay (rơi về nén tại chỗ, lỗi trong jsdom). */
  holdUploads: false,
  uploads: [] as { resolve: (url: string | null) => void }[],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { id: 'ctv1' } }) }));
vi.mock('@/components/mini/product-grid', () => ({
  ProductGrid: ({ items }: { items: { id: string; name: string }[] }) => (
    <div>
      {items.map((p) => (
        <div key={p.id} data-testid="product-card">
          {p.name}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@/components/mini/product-rail', () => ({
  ProductRail: ({ items }: { items: { id: string; name: string }[] }) => (
    <div>
      {items.map((p) => (
        <div key={p.id} data-testid="product-card">
          {p.name}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const useLoc = () => useSyncExternalStore(nav.subscribe, () => nav.loc);
  return {
    useRouter: () => nav.api,
    usePathname: () => useLoc().path,
    useSearchParams: () => new URLSearchParams(useLoc().search),
  };
});
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { share: (...a: unknown[]) => state.share(...a) } }));
vi.mock('@/components/account/cloudinary-upload', () => ({
  uploadToCloudinary: () => (state.holdUploads ? new Promise<string | null>((resolve) => state.uploads.push({ resolve })) : Promise.resolve(null)),
}));

function httpError(status: number, message = 'lỗi máy chủ') {
  return Object.assign(new Error(message), { status });
}

vi.mock('@/lib/core-http', () => {
  const run = async (method: string, path: string, body?: unknown, opts?: { query?: unknown }) => {
    state.calls.push({ method, path, body, query: opts?.query });
    const once = state.once.get(`${method} ${path}`);
    if (once) {
      state.once.delete(`${method} ${path}`);
      await once;
      throw httpError(500, 'mất mạng');
    }
    if (state.hold.has(`${method} ${path}`)) return new Promise(() => {});
    const gate = state.gates.get(`${method} ${path}`);
    if (gate) await gate;
    if (state.fail.has(`${method} ${path}`)) throw httpError(500, 'mất mạng');
    const failStatus = state.failStatus.get(`${method} ${path}`);
    if (failStatus) throw httpError(failStatus, 'Bạn chưa hoàn thành nhiệm vụ này.');
    if (method === 'get') {
      if (path === '/storefront/me') {
        if (state.sfStatus !== 200) throw httpError(state.sfStatus, 'không có');
        return state.sf;
      }
      if (path === '/affiliate/me') return state.me;
      if (path === '/storefront/me/quests') return state.quests;
      if (path === '/storefront/me/stats') return state.stats;
      if (path === '/affiliate/tiers') return state.tiers;
      if (path === '/storefront/me/products') return state.picker;
      if (path === '/categories') return state.categories;
      if (path.startsWith('/affiliate/content-kit/')) return state.kit;
    }
    if (method === 'post' && path === '/storefront/me/collections' && state.created) return state.created;
    if (method === 'patch' && path.startsWith('/storefront/me/collections/') && state.patchResult) return state.patchResult;
    return { ok: true, claimed: true, code: 'Q1', rewardPoints: 2, pointsBalance: 12 };
  };
  return {
    coreHttp: {
      get: (p: string, o?: { query?: unknown }) => run('get', p, undefined, o),
      post: (p: string, b?: unknown) => run('post', p, b),
      patch: (p: string, b?: unknown) => run('patch', p, b),
      delete: (p: string) => run('delete', p),
      put: (p: string, b?: unknown) => run('put', p, b),
    },
  };
});

import { TemplateSheet } from '@/components/affiliate/storefront-sheets';
import StorefrontBuilderPage from './page';

const PRODUCT = { id: 'p1', name: 'Trà xanh', slug: 'tra-xanh', thumbnail: null, brand: 'Tubu', basePrice: 100_000, salePrice: 80_000, ratingAvg: 5, reviewCount: 1, inStock: true };
const item = (over: Record<string, unknown> = {}) => ({ id: 'i1', productId: 'p1', note: null, variationId: null, isPinned: false, isHidden: false, sortOrder: 0, product: PRODUCT, ...over });
const storefront = (over: Record<string, unknown> = {}) => ({
  id: 'sf1', slug: 'shop-aff-1', type: 'CTV', title: 'Cửa hàng Xanh', headerNote: 'Mua giúp mình nhé', avatarUrl: null, coverUrl: null, theme: 'default', themeColor: null,
  subdomain: null, isPublished: false, referralCode: 'SHOP-AFF-1', subdomainEnabled: false, publicHiddenReason: null,
  collections: [{ id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item()] }],
  ...over,
});
const QUESTS = {
  level: 1, levelMax: 5, totalEarnedPoints: 4,
  quests: [
    { code: 'Q1', title: 'Thêm 3 sản phẩm', hint: 'Thêm vào bộ sưu tập', goal: 3, progress: 3, done: true, claimed: false, rewardPoints: 2 },
    { code: 'Q2', title: 'Đăng gian hàng', hint: 'Bấm Lưu & Đăng', goal: 1, progress: 0, done: false, claimed: false, rewardPoints: 2 },
    { code: 'Q3', title: 'Viết hồ sơ', hint: '', goal: 1, progress: 1, done: true, claimed: true, rewardPoints: 2 },
  ],
};
const TIERS = [
  { name: 'Tân binh', emoji: '🌱', min: 0, milestoneRewardPoints: null },
  { name: 'Đồng', emoji: '🌿', min: 5_000_000, milestoneRewardPoints: 10 },
];
const tiersAt = (i: number) => ({ revenue: 0, tier: { name: TIERS[i]!.name, emoji: TIERS[i]!.emoji }, allTiers: TIERS });
const STATS = { orders7d: 2, orders30d: 9, revenue30d: 1_250_000, commission30d: 125_000, byProduct: [{ productSlug: 'tra-xanh', productName: 'Trà xanh', qty: 4, revenue: 320_000 }] };

let mounted: Rendered[] = [];
const mount = () => {
  const r = render(<StorefrontBuilderPage />);
  mounted.push(r);
  return r;
};
const writes = () => state.calls.filter((c) => c.method !== 'get');
const calls = (method: string, path: string) => state.calls.filter((c) => c.method === method && c.path === path);

/** Nút theo tên truy cập (aria-label hoặc chữ), khớp nguyên văn. */
function btn(name: string, root: ParentNode = document.body): HTMLElement {
  const els = Array.from(root.querySelectorAll<HTMLElement>('button, a'));
  const hit = els.find((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim() === name);
  if (!hit) throw new Error(`không thấy nút "${name}"`);
  return hit;
}
const openItemMenu = async () => {
  click(btn('Tuỳ chọn sản phẩm'));
  await flush();
};
const openCollectionMenu = async () => {
  click(btn('Tuỳ chọn khối'));
  await flush();
};
const openFirstSection = async () => {
  click(document.querySelector('[data-testid="section-card"] button'));
  await flush();
};
const openQuests = async () => {
  click(document.querySelector('button[data-reward]'));
  await flush();
};
const openConfig = async () => {
  click(btn('Cài đặt'));
  await flush();
};
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const inputByLabel = (label: string, root: ParentNode = document.body) => root.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
const text = () => document.body.textContent ?? '';

beforeEach(() => {
  nav.reset();
  state.phase = 'authenticated';
  state.sf = storefront();
  state.sfStatus = 200;
  state.quests = QUESTS;
  state.stats = STATS;
  state.tiers = tiersAt(0);
  state.picker = [{ ...PRODUCT, id: 'p2', name: 'Xà phòng', slug: 'xa-phong', maxAffiliateRate: 12 }];
  state.categories = [
    { id: 'cat1', name: 'Chăm sóc da', slug: 'cham-soc-da', image: null },
    { id: 'cat2', name: 'Nhà bếp', slug: 'nha-bep', image: 'https://cdn.example/bep.png' },
  ];
  state.kit = { productName: 'Trà xanh', images: [], captions: ['Xem /product/tra-xanh?ref=A nhé'], usps: ['Thơm'], faqs: [{ q: 'Dùng sao?', a: 'Pha nước nóng' }], videoUrls: ['https://v.example/1'], shareLink: '/product/tra-xanh?ref=A' };
  state.fail = new Set();
  state.failStatus = new Map();
  state.hold = new Set();
  state.gates = new Map();
  state.once = new Map();
  state.calls = [];
  state.share = vi.fn(async () => 'shared');
  state.copied = [];
  state.created = null;
  state.patchResult = null;
  state.holdUploads = false;
  state.uploads = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void state.copied.push(t) } });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  nav.restore();
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Khoá chống chạm đúp (Wave 76B). "Cùng khung hình" = hai `.click()` liền nhau trong MỘT `act`: React chưa vẽ lại giữa hai cú nên mọi `isPending`/`loading` còn cũ,
// chỉ khoá đồng bộ (ref) mới chặn được cú thứ hai.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const btnAll = (name: string, root: ParentNode = document.body) =>
  Array.from(root.querySelectorAll<HTMLElement>('button, a')).filter((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim() === name);
/** Chạm `n` lần trong MỘT `act` rồi chờ các lời gọi API (mutation chạy `mutationFn` sau vài microtask) chạy hết. */
const tap = async (el: HTMLElement, n = 2) => {
  act(() => {
    for (let i = 0; i < n; i += 1) el.click();
  });
  await flush();
};
/** Giữ một lời gọi API lại tới khi gọi hàm trả về; trả hàm nhả. */
const hold = (key: string) => {
  let release!: () => void;
  state.gates.set(key, new Promise<void>((r) => { release = r; }));
  return async () => {
    state.gates.delete(key);
    await act(async () => release());
    await flush();
  };
};
const expectBusy = (el: HTMLElement) => {
  expect(el.getAttribute('aria-busy')).toBe('true');
  expect(el.getAttribute('aria-disabled')).toBe('true');
  // `disabled` thật làm Chromium thả focus của nút đang giữ focus.
  expect((el as HTMLButtonElement).disabled).toBe(false);
};
const expectIdle = (el: HTMLElement) => {
  expect(el.hasAttribute('aria-busy')).toBe(false);
  expect(el.hasAttribute('aria-disabled')).toBe(false);
};
const alerts = () => Array.from(document.querySelectorAll('[role="alert"]')).map((e) => e.textContent ?? '');
const pressEscape = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
const closeButton = (root: ParentNode) => root.querySelector('[aria-label="Đóng"]');
const PUBLISH = 'post /storefront/me/publish';
const ME = 'get /storefront/me';
const twoItems = () => [item(), item({ id: 'i2', productId: 'p2', sortOrder: 1, product: { ...PRODUCT, id: 'p2', name: 'Xà phòng', slug: 'xa-phong' } })];
const twoCollections = () => [
  { id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item()] },
  { id: 'c2', title: 'Bộ sưu tập B', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 1, items: [item({ id: 'i3', productId: 'p3', product: { ...PRODUCT, id: 'p3', name: 'Dầu gội', slug: 'dau-goi' } })] },
];
const sectionCards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="section-card"] button'));

describe('khoá chống chạm đúp — đăng / gỡ đăng gian hàng (một lệnh chung)', () => {
  it('Gửi duyệt: hai cú chạm cùng khung hình trên CẢ HAI bản nút chỉ gọi publish một lần; khoá giữ tới khi gian hàng mới về; nút báo aria-busy, không disabled', async () => {
    mount();
    await flush();
    const buttons = btnAll('Gửi duyệt');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    const releasePublish = hold(PUBLISH);
    act(() => {
      for (const b of buttons) {
        b.click();
        b.click();
      }
    });
    await flush();
    expect(calls('post', '/storefront/me/publish')).toHaveLength(1);
    for (const b of buttons) {
      expectBusy(b);
      expect(b.textContent).toBe('Đang gửi…');
    }
    const releaseFresh = hold(ME);
    await releasePublish();
    expect(text()).toContain('Đã gửi duyệt');
    // Gian hàng mới chưa về: nút vẫn còn là "Gửi duyệt" của trạng thái cũ, bấm lúc này không được gửi lần hai.
    await tap(buttons[0]!);
    expect(calls('post', '/storefront/me/publish')).toHaveLength(1);
    expectBusy(buttons[0]!);
    await releaseFresh();
    expectIdle(buttons[0]!);
    click(buttons[0]!);
    await flush();
    expect(calls('post', '/storefront/me/publish')).toHaveLength(2);
  });

  it('Gửi duyệt lỗi: báo role=alert, khoá nhả để bấm lại được', async () => {
    state.fail.add(PUBLISH);
    mount();
    await flush();
    click(btn('Gửi duyệt'));
    await flush();
    expect(alerts().some((a) => a.includes('mất mạng'))).toBe(true);
    expectIdle(btn('Gửi duyệt'));
    state.fail.delete(PUBLISH);
    click(btn('Gửi duyệt'));
    await flush();
    expect(calls('post', '/storefront/me/publish')).toHaveLength(2);
    expect(text()).toContain('Đã gửi duyệt');
  });

  it('Gỡ đăng: hai cú chạm chỉ gọi một lần; hộp xác nhận không đóng được khi đang gửi (X, Esc, Huỷ); nút báo aria-busy; xong thì đóng', async () => {
    state.sf = storefront({ isPublished: true });
    mount();
    await flush();
    await openConfig();
    click(btn('Gỡ đăng gian hàng'));
    await flush();
    const confirm = dialog()!;
    expect(closeButton(confirm)).not.toBeNull();
    const releasePublish = hold(PUBLISH);
    const unpublish = btn('Gỡ đăng', confirm);
    await tap(unpublish);
    expect(calls('post', '/storefront/me/publish')).toHaveLength(1);
    expect(calls('post', '/storefront/me/publish')[0]!.body).toEqual({ isPublished: false });
    expectBusy(unpublish);
    expect(closeButton(dialog()!)).toBeNull();
    pressEscape();
    click(btn('Huỷ', dialog()!));
    expect(dialog()?.textContent).toContain('Gỡ đăng gian hàng này?');
    await releasePublish();
    expect(dialog()).toBeNull();
    expect(text()).toContain('Đã gỡ đăng gian hàng');
  });

  it('Gỡ đăng lỗi: hộp đóng, báo role=alert, khoá nhả để gỡ lại được', async () => {
    state.sf = storefront({ isPublished: true });
    state.fail.add(PUBLISH);
    mount();
    await flush();
    await openConfig();
    click(btn('Gỡ đăng gian hàng'));
    await flush();
    click(btn('Gỡ đăng', dialog()!));
    await flush();
    expect(dialog()).toBeNull();
    expect(alerts().some((a) => a.includes('mất mạng'))).toBe(true);
    state.fail.delete(PUBLISH);
    await openConfig();
    click(btn('Gỡ đăng gian hàng'));
    await flush();
    click(btn('Gỡ đăng', dialog()!));
    await flush();
    expect(calls('post', '/storefront/me/publish')).toHaveLength(2);
  });
});

describe('khoá chống chạm đúp — khối (thêm, đổi tên, xoá)', () => {
  const COLLECTIONS = 'post /storefront/me/collections';
  const openNewSection = async () => {
    click(btn('Thêm khối'));
    await flush();
  };

  it('Thêm khối: hai cú chạm chỉ tạo một khối; tên còn nguyên; sheet không đóng được lúc gửi; khoá giữ tới khi gian hàng mới về', async () => {
    mount();
    await flush();
    await openNewSection();
    typeInto(inputByLabel('Tên khối'), 'Bán chạy');
    const create = btn('Tạo và thêm món', dialog()!);
    const releaseCreate = hold(COLLECTIONS);
    await tap(create);
    expect(calls('post', '/storefront/me/collections')).toHaveLength(1);
    expectBusy(create);
    expect(closeButton(dialog()!)).toBeNull();
    pressEscape();
    expect(dialog()).not.toBeNull();
    const releaseFresh = hold(ME);
    await releaseCreate();
    expect(dialog()).toBeNull();
    // Gian hàng mới chưa về: mở lại và bấm tạo vẫn bị chặn.
    await openNewSection();
    expectBusy(btn('Đang tạo…', dialog()!));
    click(btn('Đang tạo…', dialog()!));
    await flush();
    expect(calls('post', '/storefront/me/collections')).toHaveLength(1);
    await releaseFresh();
    expectIdle(btn('Tạo và thêm món', dialog()!));
    click(btn('Tạo và thêm món', dialog()!));
    await flush();
    expect(calls('post', '/storefront/me/collections')).toHaveLength(2);
  });

  it('Thêm khối lỗi: role=alert NGAY TRONG sheet, tên còn nguyên, nhả khoá để thử lại', async () => {
    state.fail.add(COLLECTIONS);
    mount();
    await flush();
    await openNewSection();
    typeInto(inputByLabel('Tên khối'), 'Bán chạy');
    click(btn('Tạo và thêm món', dialog()!));
    await flush();
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);
    expect(inputByLabel('Tên khối')!.value).toBe('Bán chạy');
    expectIdle(btn('Tạo và thêm món', dialog()!));
    state.fail.delete(COLLECTIONS);
    click(btn('Tạo và thêm món', dialog()!));
    await flush();
    expect(calls('post', '/storefront/me/collections')).toHaveLength(2);
    expect(dialog()).toBeNull();
  });

  it('Đổi tên khối: hai cú chạm chỉ gửi một lần; sheet không đóng được lúc lưu; lỗi hiện role=alert trong sheet; nhả khoá để lưu lại', async () => {
    mount();
    await flush();
    await openFirstSection();
    await openCollectionMenu();
    click(btn('Đổi tên khối'));
    await flush();
    typeInto(dialog()!.querySelector('input'), 'Tên mới');
    const save = btn('Lưu', dialog()!);
    state.fail.add('patch /storefront/me/collections/c1');
    const release = hold('patch /storefront/me/collections/c1');
    await tap(save);
    expect(calls('patch', '/storefront/me/collections/c1')).toHaveLength(1);
    expectBusy(save);
    expect(closeButton(dialog()!)).toBeNull();
    await release();
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);
    expect(closeButton(dialog()!)).not.toBeNull();
    state.fail.delete('patch /storefront/me/collections/c1');
    click(btn('Lưu', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me/collections/c1')).toHaveLength(2);
    expect(dialog()).toBeNull();
  });

  it('Xoá khối: hai cú chạm chỉ xoá một lần, hộp xác nhận không đóng được lúc xoá và báo aria-busy; xoá khối KHÁC vẫn chạy, xoá lại khối cũ thì bị chặn tới khi gian hàng mới về', async () => {
    state.sf = storefront({ collections: twoCollections() });
    mount();
    await flush();
    await openFirstSection();
    await openCollectionMenu();
    click(btn('Xoá khối', dialog()!));
    await flush();
    const releaseDelete = hold('delete /storefront/me/collections/c1');
    const releaseFresh = hold(ME);
    const confirmBtn = btn('Xoá khối', dialog()!);
    await tap(confirmBtn);
    expect(calls('delete', '/storefront/me/collections/c1')).toHaveLength(1);
    expectBusy(confirmBtn);
    expect(closeButton(dialog()!)).toBeNull();
    pressEscape();
    click(btn('Huỷ', dialog()!));
    expect(dialog()?.textContent).toContain('Xoá khối này?');
    await releaseDelete();
    expect(dialog()).toBeNull();
    // Lệnh xoá c1 đã xong nhưng gian hàng mới chưa về (c1 còn trong danh sách): khối khác xoá được, c1 thì chưa.
    await flush();
    expect(sectionCards().length).toBe(2);
    click(sectionCards()[1]!);
    await flush();
    await openCollectionMenu();
    click(btn('Xoá khối', dialog()!));
    await flush();
    click(btn('Xoá khối', dialog()!));
    await flush();
    expect(calls('delete', '/storefront/me/collections/c2')).toHaveLength(1);
    expect(calls('delete', '/storefront/me/collections/c1')).toHaveLength(1);
    // Quay lại khối c1 (danh sách chưa có dữ liệu mới nên c1 vẫn còn) và xoá lần nữa: bị chặn vì lệnh xoá c1 chưa trả dữ liệu mới.
    await flush();
    expect(sectionCards().length).toBe(2);
    click(sectionCards()[0]!);
    await flush();
    await openCollectionMenu();
    click(btn('Xoá khối', dialog()!));
    await flush();
    click(btn('Xoá khối', dialog()!));
    await flush();
    expect(calls('delete', '/storefront/me/collections/c1')).toHaveLength(1);
    await releaseFresh();
  });

  it('Xoá khối lỗi: hộp đóng, báo role=alert, nhả khoá để xoá lại', async () => {
    state.fail.add('delete /storefront/me/collections/c1');
    mount();
    await flush();
    await openFirstSection();
    await openCollectionMenu();
    click(btn('Xoá khối', dialog()!));
    await flush();
    click(btn('Xoá khối', dialog()!));
    await flush();
    expect(dialog()).toBeNull();
    expect(alerts().some((a) => a.includes('mất mạng'))).toBe(true);
    state.fail.delete('delete /storefront/me/collections/c1');
    await openCollectionMenu();
    click(btn('Xoá khối', dialog()!));
    await flush();
    click(btn('Xoá khối', dialog()!));
    await flush();
    expect(calls('delete', '/storefront/me/collections/c1')).toHaveLength(2);
  });
});

describe('khoá chống chạm đúp — món trong khối (ghim/ẩn, lý do, xoá, thêm sản phẩm)', () => {
  const itemMenus = () => btnAll('Tuỳ chọn sản phẩm');

  it('Ghim và Ẩn dùng chung một khoá theo món: hai mục menu của một món sát nhau chỉ gửi mục đầu; món khác chạy song song', async () => {
    state.sf = storefront({ collections: [{ id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: twoItems() }] });
    mount();
    await flush();
    await openFirstSection();
    const releaseI1 = hold('patch /storefront/me/items/i1');
    click(itemMenus()[0]!);
    await flush();
    const pin = btn('Ghim lên đầu');
    const hide = btn('Ẩn sản phẩm');
    act(() => {
      pin.click();
      hide.click();
    });
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(1);
    expect(calls('patch', '/storefront/me/items/i1')[0]!.body).toEqual({ isPinned: true });
    // Mở lại menu của món i1 lúc lệnh còn bay: vẫn bị chặn. Món i2 thì đi tiếp.
    await flush();
    click(itemMenus()[0]!);
    await flush();
    click(btn('Ẩn sản phẩm'));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(1);
    click(itemMenus()[1]!);
    await flush();
    click(btn('Ẩn sản phẩm'));
    await flush();
    expect(calls('patch', '/storefront/me/items/i2')).toHaveLength(1);
    await releaseI1();
  });

  it('Ghim: khoá giữ tới khi gian hàng mới về, rồi nhả', async () => {
    mount();
    await flush();
    await openFirstSection();
    const releaseFresh = hold(ME);
    await openItemMenu();
    click(btn('Ghim lên đầu'));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(1);
    await openItemMenu();
    click(btn('Ẩn sản phẩm'));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(1);
    await releaseFresh();
    await openItemMenu();
    click(btn('Ẩn sản phẩm'));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(2);
  });

  it('Lý do giới thiệu: khoá giữ tới khi gian hàng mới về, rồi nhả', async () => {
    mount();
    await flush();
    await openFirstSection();
    const releaseFresh = hold(ME);
    click(btn('Thêm lý do giới thiệu'));
    await flush();
    typeInto(inputByLabel('Lý do giới thiệu'), 'Dùng 3 tháng');
    click(btn('Lưu', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(1);
    expect(dialog()).toBeNull();
    // Gian hàng cũ chưa về nên món vẫn chưa có lý do: mở lại, lưu lại thì bị chặn.
    click(btn('Thêm lý do giới thiệu'));
    await flush();
    typeInto(inputByLabel('Lý do giới thiệu'), 'Dùng 3 tháng');
    click(btn('Lưu', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(1);
    await releaseFresh();
    click(btn('Lưu', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(2);
  });

  it('Xoá khỏi khối: khoá giữ tới khi gian hàng mới về, rồi nhả', async () => {
    mount();
    await flush();
    await openFirstSection();
    const releaseFresh = hold(ME);
    await openItemMenu();
    click(btn('Xoá khỏi khối'));
    await flush();
    click(btn('Xoá', dialog()!));
    await flush();
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(1);
    expect(dialog()).toBeNull();
    await openItemMenu();
    click(btn('Xoá khỏi khối'));
    await flush();
    click(btn('Xoá', dialog()!));
    await flush();
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(1);
    await releaseFresh();
    click(btn('Xoá', dialog()!));
    await flush();
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(2);
  });

  it('Ghim lỗi: báo role=alert, nhả khoá để thử lại', async () => {
    state.fail.add('patch /storefront/me/items/i1');
    mount();
    await flush();
    await openFirstSection();
    await openItemMenu();
    click(btn('Ghim lên đầu'));
    await flush();
    expect(alerts().some((a) => a.includes('mất mạng'))).toBe(true);
    state.fail.delete('patch /storefront/me/items/i1');
    await openItemMenu();
    click(btn('Ghim lên đầu'));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(2);
  });

  it('Lý do giới thiệu: hai cú chạm chỉ lưu một lần; sheet không đóng được lúc lưu; chữ gõ thêm lúc gửi không bị xoá; lỗi role=alert trong sheet', async () => {
    mount();
    await flush();
    await openFirstSection();
    click(btn('Thêm lý do giới thiệu'));
    await flush();
    typeInto(inputByLabel('Lý do giới thiệu'), 'Dùng 3 tháng');
    const save = btn('Lưu', dialog()!);
    const release = hold('patch /storefront/me/items/i1');
    await tap(save);
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(1);
    expect(calls('patch', '/storefront/me/items/i1')[0]!.body).toEqual({ note: 'Dùng 3 tháng' });
    expectBusy(save);
    expect(closeButton(dialog()!)).toBeNull();
    pressEscape();
    click(btn('Huỷ', dialog()!));
    expect(dialog()).not.toBeNull();
    typeInto(inputByLabel('Lý do giới thiệu'), 'Dùng 3 tháng, da đỡ khô');
    await release();
    // Ô đã đổi sau lần gửi: không đóng sheet, giữ nguyên chữ mới để khách lưu tiếp.
    expect(dialog()).not.toBeNull();
    expect(inputByLabel('Lý do giới thiệu')!.value).toBe('Dùng 3 tháng, da đỡ khô');
    state.fail.add('patch /storefront/me/items/i1');
    click(btn('Lưu', dialog()!));
    await flush();
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);
    state.fail.delete('patch /storefront/me/items/i1');
    click(btn('Lưu', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(3);
    expect(dialog()).toBeNull();
  });

  it('Xoá khỏi khối: hai cú chạm chỉ xoá một lần, hộp không đóng được lúc xoá, báo aria-busy; lỗi thì hộp đóng, role=alert, xoá lại được', async () => {
    mount();
    await flush();
    await openFirstSection();
    await openItemMenu();
    click(btn('Xoá khỏi khối'));
    await flush();
    const confirmBtn = btn('Xoá', dialog()!);
    state.fail.add('delete /storefront/me/items/i1');
    const release = hold('delete /storefront/me/items/i1');
    await tap(confirmBtn);
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(1);
    expectBusy(confirmBtn);
    expect(closeButton(dialog()!)).toBeNull();
    pressEscape();
    expect(dialog()).not.toBeNull();
    await release();
    expect(dialog()).toBeNull();
    expect(alerts().some((a) => a.includes('mất mạng'))).toBe(true);
    state.fail.delete('delete /storefront/me/items/i1');
    await openItemMenu();
    click(btn('Xoá khỏi khối'));
    await flush();
    click(btn('Xoá', dialog()!));
    await flush();
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(2);
    expect(dialog()).toBeNull();
  });

  it('Thêm sản phẩm (PickerSheet): hai cú chạm chỉ thêm một lần; mọi nút Thêm aria-disabled, nút đang gửi aria-busy; khoá giữ tới khi gian hàng mới về; lỗi role=alert', async () => {
    state.picker = [
      { ...PRODUCT, id: 'p2', name: 'Xà phòng', slug: 'xa-phong', maxAffiliateRate: 12 },
      { ...PRODUCT, id: 'p3', name: 'Dầu gội', slug: 'dau-goi', maxAffiliateRate: 0 },
    ];
    mount();
    await flush();
    await openFirstSection();
    click(btn('Thêm sản phẩm'));
    await flush();
    const add = btn('Thêm Xà phòng', dialog()!);
    const other = btn('Thêm Dầu gội', dialog()!);
    const release = hold('post /storefront/me/collections/c1/items');
    const releaseFresh = hold(ME);
    await tap(add);
    expect(calls('post', '/storefront/me/collections/c1/items')).toHaveLength(1);
    expectBusy(add);
    expect(other.getAttribute('aria-disabled')).toBe('true');
    expect(other.hasAttribute('aria-busy')).toBe(false);
    expect((other as HTMLButtonElement).disabled).toBe(false);
    click(other);
    await flush();
    expect(calls('post', '/storefront/me/collections/c1/items')).toHaveLength(1);
    await release();
    click(other);
    await flush();
    expect(calls('post', '/storefront/me/collections/c1/items')).toHaveLength(1);
    await releaseFresh();
    expectIdle(other);
    state.fail.add('post /storefront/me/collections/c1/items');
    click(other);
    await flush();
    expect(calls('post', '/storefront/me/collections/c1/items')).toHaveLength(2);
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);
    state.fail.delete('post /storefront/me/collections/c1/items');
    click(other);
    await flush();
    expect(calls('post', '/storefront/me/collections/c1/items')).toHaveLength(3);
  });

  it('Thêm sản phẩm: nút "Xong" trong thân sheet không đóng được lúc đang thêm (lời báo lỗi còn chỗ hiện); xong thì đóng được', async () => {
    mount();
    await flush();
    await openFirstSection();
    click(btn('Thêm sản phẩm'));
    await flush();
    const ADD = 'post /storefront/me/collections/c1/items';
    state.fail.add(ADD);
    const release = hold(ADD);
    await tap(btn('Thêm Xà phòng', dialog()!), 1);
    const done = btn('Xong', dialog()!);
    expect(done.getAttribute('aria-disabled')).toBe('true');
    expect((done as HTMLButtonElement).disabled).toBe(false);
    expect(closeButton(dialog()!)).toBeNull();
    click(done);
    pressEscape();
    await flush();
    expect(dialog()?.textContent).toContain('Thêm sản phẩm');
    await release();
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);
    expect(btn('Xong', dialog()!).hasAttribute('aria-disabled')).toBe(false);
    click(btn('Xong', dialog()!));
    await flush();
    expect(dialog()).toBeNull();
  });
});

describe('khoá chống chạm đúp — hồ sơ, cấu hình gian hàng', () => {
  const PATCH_ME = 'patch /storefront/me';
  /** Nút chữ trong thân sheet (không phải nút X của khung, vốn mang aria-label cùng tên). */
  const bodyBtn = (name: string, root: ParentNode) =>
    Array.from(root.querySelectorAll<HTMLElement>('button')).find((e) => !e.hasAttribute('aria-label') && (e.textContent ?? '').trim() === name)!;

  it('Lưu hồ sơ: hai cú chạm chỉ gửi một lần; sheet không đóng được lúc lưu; lỗi role=alert trong sheet; nhả khoá để lưu lại', async () => {
    mount();
    await flush();
    click(btn('Sửa hồ sơ'));
    await flush();
    const save = btn('Lưu hồ sơ', dialog()!);
    state.fail.add(PATCH_ME);
    const release = hold(PATCH_ME);
    await tap(save);
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expectBusy(save);
    expect(closeButton(dialog()!)).toBeNull();
    pressEscape();
    expect(dialog()).not.toBeNull();
    await release();
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);
    expect(closeButton(dialog()!)).not.toBeNull();
    state.fail.delete(PATCH_ME);
    click(btn('Lưu hồ sơ', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me')).toHaveLength(2);
    expect(dialog()).toBeNull();
  });

  it('Lưu cấu hình: hai cú chạm chỉ gửi một lần; sheet không đóng được lúc lưu; lỗi role=alert; nhả khoá', async () => {
    mount();
    await flush();
    await openConfig();
    const save = btn('Lưu cấu hình gian hàng', dialog()!);
    state.fail.add(PATCH_ME);
    const release = hold(PATCH_ME);
    await tap(save);
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expectBusy(save);
    expect(closeButton(dialog()!)).toBeNull();
    await release();
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);
    state.fail.delete(PATCH_ME);
    click(btn('Lưu cấu hình gian hàng', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me')).toHaveLength(2);
    expect(dialog()).toBeNull();
  });

  it('Gỡ tài khoản ngân hàng đã lưu: hai cú chạm chỉ gửi một lần, nút báo aria-busy; xong thì bấm lại được', async () => {
    state.sf = storefront({ bankAccountNo: '1234567890', bankName: 'VCB' });
    mount();
    await flush();
    await openConfig();
    const clear = btn('Gỡ tài khoản đã lưu', dialog()!);
    const release = hold(PATCH_ME);
    await tap(clear);
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expect(calls('patch', '/storefront/me')[0]!.body).toEqual({ bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' });
    expectBusy(clear);
    expect(closeButton(dialog()!)).toBeNull();
    await release();
    expectIdle(btn('Gỡ tài khoản đã lưu', dialog()!));
    click(btn('Gỡ tài khoản đã lưu', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me')).toHaveLength(2);
  });

  it('Hồ sơ: nút "Đóng" trong thân sheet không đóng được lúc đang lưu (lỗi còn chỗ hiện); lưu xong lỗi thì đóng được', async () => {
    mount();
    await flush();
    click(btn('Sửa hồ sơ'));
    await flush();
    state.fail.add(PATCH_ME);
    const release = hold(PATCH_ME);
    await tap(btn('Lưu hồ sơ', dialog()!), 1);
    const close = bodyBtn('Đóng', dialog()!);
    expect(close.getAttribute('aria-disabled')).toBe('true');
    expect((close as HTMLButtonElement).disabled).toBe(false);
    click(close);
    await flush();
    expect(dialog()?.textContent).toContain('Hồ sơ gian hàng');
    await release();
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);
    expect(bodyBtn('Đóng', dialog()!).hasAttribute('aria-disabled')).toBe(false);
    click(bodyBtn('Đóng', dialog()!));
    await flush();
    expect(dialog()).toBeNull();
  });

  it('Cấu hình: nút Gỡ đăng trong thân sheet không đóng sheet lúc đang lưu hoặc đang gỡ ngân hàng; rảnh thì mở hộp xác nhận', async () => {
    state.sf = storefront({ isPublished: true, bankAccountNo: '1234567890', bankName: 'VCB' });
    mount();
    await flush();
    await openConfig();
    state.fail.add(PATCH_ME);
    const releaseSave = hold(PATCH_ME);
    await tap(btn('Lưu cấu hình gian hàng', dialog()!), 1);
    const unpublish = btn('Gỡ đăng gian hàng', dialog()!);
    expect(unpublish.getAttribute('aria-disabled')).toBe('true');
    expect((unpublish as HTMLButtonElement).disabled).toBe(false);
    click(unpublish);
    await flush();
    expect(dialog()?.textContent).toContain('Cài đặt gian hàng');
    expect(dialog()?.textContent).not.toContain('Gỡ đăng gian hàng này?');
    await releaseSave();
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);

    state.fail.delete(PATCH_ME);
    const releaseClear = hold(PATCH_ME);
    await tap(btn('Gỡ tài khoản đã lưu', dialog()!), 1);
    click(btn('Gỡ đăng gian hàng', dialog()!));
    await flush();
    expect(dialog()?.textContent).toContain('Cài đặt gian hàng');
    expect(dialog()?.textContent).not.toContain('Gỡ đăng gian hàng này?');
    await releaseClear();

    expect(btn('Gỡ đăng gian hàng', dialog()!).hasAttribute('aria-disabled')).toBe(false);
    click(btn('Gỡ đăng gian hàng', dialog()!));
    await flush();
    expect(dialog()?.textContent).toContain('Gỡ đăng gian hàng này?');
  });
});

describe('lưu ở tấm gian hàng: lời báo đã lưu trả Promise tải lại nên khoá giữ tới khi gian hàng mới về (W100B)', () => {
  it('Lưu hồ sơ: tấm đóng ngay, mở lại lúc gian hàng mới chưa về thì nút Lưu còn bận và không gửi lần hai; gian hàng mới về thì ô theo bản mới và lần Lưu sau gửi bản mới', async () => {
    mount();
    await flush();
    click(btn('Sửa hồ sơ'));
    await flush();
    typeInto(dialog()!.querySelector('textarea'), 'Lời nhắn mới');
    const releaseFresh = hold(ME);
    await tap(btn('Lưu hồ sơ', dialog()!), 1);
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expect(dialog()).toBeNull();
    click(btn('Sửa hồ sơ'));
    await flush();
    expectBusy(btn('Đang lưu…', dialog()!));
    click(btn('Đang lưu…', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    state.sf = storefront({ headerNote: 'Lời nhắn mới' });
    await releaseFresh();
    expectIdle(btn('Lưu hồ sơ', dialog()!));
    expect(dialog()!.querySelector('textarea')!.value).toBe('Lời nhắn mới');
    await tap(btn('Lưu hồ sơ', dialog()!), 1);
    expect(calls('patch', '/storefront/me')[1]!.body).toEqual({ avatarUrl: '', coverUrl: '', headerNote: 'Lời nhắn mới' });
  });

  // Wave 101B: dời khối chạy `cancelQueries` rồi `setQueryData` lên gian hàng; `setQueryData` xoá cờ "đã cũ" dù dữ liệu vẫn là bản trước lệnh lưu,
  // nên hàng rào độ mới hở và Lưu hồ sơ gửi lại lời nhắn cũ đè lên bản vừa lưu.
  it('Lưu hồ sơ rồi gian hàng mới treo quá 4 giây, khách dời khối lạc quan: mở lại hồ sơ vẫn bị chặn tới khi bản mới về, rồi Lưu gửi giá trị MỚI', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    try {
      state.sf = storefront({ collections: twoCollections() });
      mount();
      await flush();
      click(btn('Sửa hồ sơ'));
      await flush();
      typeInto(dialog()!.querySelector('textarea'), 'Lời nhắn mới');
      const releaseFresh = hold(ME);
      await tap(btn('Lưu hồ sơ', dialog()!), 1);
      expect(calls('patch', '/storefront/me')).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_500);
      });
      await flush(2);
      state.hold.add('post /storefront/me/collections/reorder');
      click(btn('Sắp xếp'));
      await flush();
      click(document.querySelector('button[aria-label="Đưa khối Bộ sưu tập A xuống"]'));
      await flush();
      expect(calls('post', '/storefront/me/collections/reorder')).toHaveLength(1);
      click(btn('Xong'));
      await flush();
      click(btn('Sửa hồ sơ'));
      await flush();
      expect(dialog()!.querySelector('textarea')!.value).toBe('Mua giúp mình nhé');
      const refetches = calls('get', '/storefront/me').length;
      await tap(btn('Lưu hồ sơ', dialog()!), 1);
      expect(calls('patch', '/storefront/me')).toHaveLength(1);
      expect(calls('get', '/storefront/me')).toHaveLength(refetches + 1);
      state.sf = storefront({ headerNote: 'Lời nhắn mới', collections: twoCollections() });
      await releaseFresh();
      expect(dialog()!.querySelector('textarea')!.value).toBe('Lời nhắn mới');
      await tap(btn('Lưu hồ sơ', dialog()!), 1);
      expect(calls('patch', '/storefront/me')).toHaveLength(2);
      expect((calls('patch', '/storefront/me')[1]!.body as { headerNote?: string }).headerNote).toBe('Lời nhắn mới');
    } finally {
      vi.useRealTimers();
    }
  });

  // Các lệnh dời xếp một hàng (`scope`): lệnh đầu lỗi khi lệnh sau còn xếp hàng thì không tải lại (chờ lệnh sau xong), nên cờ "đã cũ" chỉ còn do chỗ khôi phục thứ tự giữ.
  it('dời khối lỗi (khôi phục thứ tự) khi lệnh dời sau còn xếp hàng: hàng rào hồ sơ vẫn đứng, Lưu không gửi bản cũ', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    try {
      state.sf = storefront({ collections: twoCollections() });
      mount();
      await flush();
      click(btn('Sửa hồ sơ'));
      await flush();
      typeInto(dialog()!.querySelector('textarea'), 'Lời nhắn mới');
      hold(ME);
      await tap(btn('Lưu hồ sơ', dialog()!), 1);
      expect(calls('patch', '/storefront/me')).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_500);
      });
      await flush(2);
      let failFirst!: () => void;
      state.once.set('post /storefront/me/collections/reorder', new Promise<void>((r) => { failFirst = r; }));
      state.hold.add('post /storefront/me/collections/reorder');
      click(btn('Sắp xếp'));
      await flush();
      click(document.querySelector('button[aria-label="Đưa khối Bộ sưu tập A xuống"]'));
      await flush();
      click(document.querySelector('button[aria-label="Đưa khối Bộ sưu tập B xuống"]'));
      await flush();
      expect(calls('post', '/storefront/me/collections/reorder')).toHaveLength(1);
      await act(async () => failFirst());
      await flush(4);
      expect(calls('post', '/storefront/me/collections/reorder')).toHaveLength(2);
      click(btn('Xong'));
      await flush();
      click(btn('Sửa hồ sơ'));
      await flush();
      await tap(btn('Lưu hồ sơ', dialog()!), 1);
      expect(calls('patch', '/storefront/me')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Lưu cấu hình: tấm đóng ngay, mở lại lúc gian hàng mới chưa về thì nút Lưu còn bận và không gửi lần hai; gian hàng mới về thì ô theo bản mới và lần Lưu sau gửi bản mới', async () => {
    mount();
    await flush();
    await openConfig();
    typeInto(dialog()!.querySelector('input'), 'Tên mới');
    const releaseFresh = hold(ME);
    await tap(btn('Lưu cấu hình gian hàng', dialog()!), 1);
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expect(dialog()).toBeNull();
    await openConfig();
    expectBusy(btn('Đang lưu…', dialog()!));
    click(btn('Đang lưu…', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    state.sf = storefront({ title: 'Tên mới' });
    await releaseFresh();
    expectIdle(btn('Lưu cấu hình gian hàng', dialog()!));
    expect(dialog()!.querySelector<HTMLInputElement>('input')!.value).toBe('Tên mới');
    await tap(btn('Lưu cấu hình gian hàng', dialog()!), 1);
    expect((calls('patch', '/storefront/me')[1]!.body as { title?: string }).title).toBe('Tên mới');
  });

  it('Gỡ tài khoản ngân hàng: nút còn bận tới khi gian hàng mới về (lúc đó nút mới biến mất nếu máy chủ đã xoá)', async () => {
    state.sf = storefront({ bankAccountNo: '1234567890', bankName: 'VCB' });
    mount();
    await flush();
    await openConfig();
    const releaseFresh = hold(ME);
    await tap(btn('Gỡ tài khoản đã lưu', dialog()!), 1);
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expectBusy(btn('Gỡ tài khoản đã lưu', dialog()!));
    click(btn('Gỡ tài khoản đã lưu', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    state.sf = storefront();
    await releaseFresh();
    expect(Array.from(dialog()!.querySelectorAll('button')).some((b) => b.textContent === 'Gỡ tài khoản đã lưu')).toBe(false);
  });

  it('Đổi tên khối: tấm đóng ngay, mở lại lúc gian hàng mới chưa về thì nút Lưu còn bận và không gửi lần hai', async () => {
    mount();
    await flush();
    await openFirstSection();
    await openCollectionMenu();
    click(btn('Đổi tên khối'));
    await flush();
    typeInto(dialog()!.querySelector('input'), 'Tên mới');
    const releaseFresh = hold(ME);
    await tap(btn('Lưu', dialog()!), 1);
    expect(calls('patch', '/storefront/me/collections/c1')).toHaveLength(1);
    expect(dialog()).toBeNull();
    await openCollectionMenu();
    click(btn('Đổi tên khối'));
    await flush();
    expectBusy(btn('Đang lưu…', dialog()!));
    click(btn('Đang lưu…', dialog()!));
    await flush();
    expect(calls('patch', '/storefront/me/collections/c1')).toHaveLength(1);
    state.sf = storefront({ collections: [{ id: 'c1', title: 'Tên mới', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item()] }] });
    await releaseFresh();
    expectIdle(btn('Lưu', dialog()!));
    expect(dialog()!.querySelector<HTMLInputElement>('input')!.value).toBe('Tên mới');
    await tap(btn('Lưu', dialog()!), 1);
    expect(calls('patch', '/storefront/me/collections/c1')[1]!.body).toEqual({ title: 'Tên mới' });
  });
});

describe('khoá chống chạm đúp — nhiệm vụ Hành trình gian hàng', () => {
  const claimable = () =>
    Array.from(dialog()!.querySelectorAll<HTMLElement>('button')).filter((b) => /^(Nhận|Đang nhận)/.test(b.textContent ?? ''));
  const twoClaimable = () => ({
    ...QUESTS,
    quests: [
      { ...QUESTS.quests[0]!, code: 'Q1', title: 'Thêm 3 sản phẩm' },
      { ...QUESTS.quests[0]!, code: 'Q4', title: 'Viết 3 lý do' },
    ],
  });

  it('Nhận thưởng: hai cú chạm chỉ gọi một lần; nút báo aria-busy; khoá giữ tới khi danh sách nhiệm vụ mới về; nhiệm vụ khác chạy song song', async () => {
    state.quests = twoClaimable();
    mount();
    await flush();
    await openQuests();
    const [first, second] = claimable();
    const release = hold('post /storefront/me/quests/Q1/claim');
    const releaseFresh = hold('get /storefront/me/quests');
    await tap(first!);
    expect(calls('post', '/storefront/me/quests/Q1/claim')).toHaveLength(1);
    expectBusy(first!);
    expect(first!.textContent).toBe('Đang nhận…');
    expectIdle(second!);
    click(second!);
    await flush();
    expect(calls('post', '/storefront/me/quests/Q4/claim')).toHaveLength(1);
    await release();
    await tap(first!);
    expect(calls('post', '/storefront/me/quests/Q1/claim')).toHaveLength(1);
    await releaseFresh();
    expectIdle(first!);
    click(first!);
    await flush();
    expect(calls('post', '/storefront/me/quests/Q1/claim')).toHaveLength(2);
  });

  it('Nhận thưởng lỗi: role=alert NGAY dưới đúng nhiệm vụ lỗi, nhiệm vụ khác thành công sau đó không xoá lời báo; nhả khoá để thử lại', async () => {
    state.quests = twoClaimable();
    state.fail.add('post /storefront/me/quests/Q1/claim');
    mount();
    await flush();
    await openQuests();
    const [first, second] = claimable();
    click(first!);
    await flush();
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);
    click(second!);
    await flush();
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);
    expect(first!.closest('div[class*="border-t"]')?.querySelector('[role="alert"]')).not.toBeNull();
    state.fail.delete('post /storefront/me/quests/Q1/claim');
    click(first!);
    await flush();
    expect(calls('post', '/storefront/me/quests/Q1/claim')).toHaveLength(2);
    expect(dialog()!.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
});

describe('Nhận thưởng nhiệm vụ bị máy chủ từ chối vì trạng thái đã đổi (W98B, Mini ↔ web)', () => {
  const claim = () => Array.from(dialog()!.querySelectorAll<HTMLElement>('button')).find((b) => /^(Nhận|Đang nhận)/.test(b.textContent ?? ''))!;
  const questGets = () => calls('get', '/storefront/me/quests').length;

  it.each([400, 404, 409, 422])('HTTP %i: lời báo hiện dưới nhiệm vụ, danh sách nhiệm vụ tải lại một lần, khoá giữ tới khi về rồi nhả', async (status) => {
    mount();
    await flush();
    await openQuests();
    state.failStatus.set('post /storefront/me/quests/Q1/claim', status);
    const releaseFresh = hold('get /storefront/me/quests');
    const before = questGets();
    click(claim());
    await flush();
    expect(alerts()).toEqual(['Bạn chưa hoàn thành nhiệm vụ này.']);
    expect(questGets() - before).toBe(1);
    expectBusy(claim());
    click(claim());
    await flush();
    expect(calls('post', '/storefront/me/quests/Q1/claim')).toHaveLength(1);
    await releaseFresh();
    expectIdle(claim());
    state.failStatus.clear();
    click(claim());
    await flush();
    expect(calls('post', '/storefront/me/quests/Q1/claim')).toHaveLength(2);
  });

  it.each([401, 403, 500, 503])('HTTP %i (lỗi tạm): báo lỗi, không tải lại danh sách nhiệm vụ, nhả khoá ngay', async (status) => {
    mount();
    await flush();
    await openQuests();
    state.failStatus.set('post /storefront/me/quests/Q1/claim', status);
    hold('get /storefront/me/quests');
    const before = questGets();
    click(claim());
    await flush();
    expect(alerts()).toEqual(['Bạn chưa hoàn thành nhiệm vụ này.']);
    expect(questGets() - before).toBe(0);
    expectIdle(claim());
  });

  it('tải lại không bao giờ về: còn khoá ở 3 giây, nhả sau 4 giây', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    try {
      mount();
      await flush();
      await openQuests();
      state.failStatus.set('post /storefront/me/quests/Q1/claim', 409);
      state.hold.add('get /storefront/me/quests');
      click(claim());
      await flush();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expectBusy(claim());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await flush(2);
      expectIdle(claim());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('khoá chống chạm đúp — luồng đăng ký 4 bước', () => {
  const toStep3 = async () => {
    mount();
    await flush();
    await flush();
    click(btn('Tiếp tục'));
    await flush();
    expect(text()).toContain('Bước 3/4');
  };

  it('Bắt đầu mở gian hàng: hai cú chạm chỉ tạo một gian hàng; nút báo aria-busy, không disabled; lỗi role=alert; nhả khoá để thử lại', async () => {
    state.sf = null;
    state.sfStatus = 404;
    mount();
    await flush();
    const start = btn('Bắt đầu mở gian hàng');
    state.fail.add('post /storefront');
    const release = hold('post /storefront');
    await tap(start);
    expect(calls('post', '/storefront')).toHaveLength(1);
    expectBusy(start);
    await release();
    expect(alerts()).toEqual(['mất mạng']);
    expectIdle(btn('Bắt đầu mở gian hàng'));
    state.fail.delete('post /storefront');
    state.sfStatus = 200;
    state.sf = storefront({ status: 'DRAFT', collections: [] });
    click(btn('Bắt đầu mở gian hàng'));
    await flush();
    expect(calls('post', '/storefront')).toHaveLength(2);
    expect(text()).toContain('Bước 2/4');
  });

  it('Bước thông tin — Tiếp tục: hai cú chạm chỉ lưu một lần, nút báo aria-busy, không disabled; lỗi role=alert; nhả khoá để lưu lại', async () => {
    state.sf = storefront({ status: 'DRAFT' });
    mount();
    await flush();
    await flush();
    const next = btn('Tiếp tục');
    state.fail.add('patch /storefront/me');
    const release = hold('patch /storefront/me');
    await tap(next);
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expectBusy(next);
    await release();
    expect(alerts()).toEqual(['mất mạng']);
    expectIdle(btn('Tiếp tục'));
    state.fail.delete('patch /storefront/me');
    click(btn('Tiếp tục'));
    await flush();
    expect(calls('patch', '/storefront/me')).toHaveLength(2);
    expect(text()).toContain('Bước 3/4');
  });

  it('Bước thông tin: chữ nhập vẫn là chữ của lần gửi đầu dù khách gõ thêm lúc đang gửi', async () => {
    state.sf = storefront({ status: 'DRAFT' });
    mount();
    await flush();
    await flush();
    const input = document.body.querySelector('input')!;
    typeInto(input, 'Shop A');
    const release = hold('patch /storefront/me');
    click(btn('Tiếp tục'));
    await flush();
    typeInto(input, 'Shop B');
    await tap(btn('Tiếp tục'));
    await release();
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expect((calls('patch', '/storefront/me')[0]!.body as { title: string }).title).toBe('Shop A');
  });

  it('Chọn mẫu: hai cú chạm chỉ áp một mẫu; mọi ô mẫu aria-disabled, ô đang gửi aria-busy; sheet không đóng được lúc áp; xong thì đóng', async () => {
    state.sf = storefront({ status: 'DRAFT', collections: [] });
    await toStep3();
    click(btn('Chọn danh mục'));
    await flush();
    const kitchen = btn('Dùng mẫu Nhà bếp', dialog()!);
    const skin = btn('Dùng mẫu Chăm sóc da', dialog()!);
    const release = hold('post /storefront/me/apply-template');
    await tap(kitchen);
    expect(calls('post', '/storefront/me/apply-template')).toHaveLength(1);
    expectBusy(kitchen);
    expect(skin.getAttribute('aria-disabled')).toBe('true');
    expect(skin.hasAttribute('aria-busy')).toBe(false);
    click(skin);
    await flush();
    expect(calls('post', '/storefront/me/apply-template')).toHaveLength(1);
    expect(closeButton(dialog()!)).toBeNull();
    pressEscape();
    click(btn('Để sau, tự chọn sản phẩm', dialog()!));
    expect(dialog()).not.toBeNull();
    const releaseFresh = hold(ME);
    await release();
    expect(dialog()).toBeNull();
    // Gian hàng mới chưa về (vẫn chưa có khối): mở lại sheet, chọn mẫu lúc này vẫn bị chặn.
    click(btn('Chọn danh mục'));
    await flush();
    click(btn('Dùng mẫu Nhà bếp', dialog()!));
    await flush();
    expect(calls('post', '/storefront/me/apply-template')).toHaveLength(1);
    await releaseFresh();
    click(btn('Dùng mẫu Nhà bếp', dialog()!));
    await flush();
    expect(calls('post', '/storefront/me/apply-template')).toHaveLength(2);
  });

  it('Chọn mẫu lỗi: role=alert trên bước, sheet mở lại được, nhả khoá để chọn lại', async () => {
    state.sf = storefront({ status: 'DRAFT', collections: [] });
    await toStep3();
    click(btn('Chọn danh mục'));
    await flush();
    state.fail.add('post /storefront/me/apply-template');
    click(btn('Dùng mẫu Nhà bếp', dialog()!));
    await flush();
    expect(alerts()).toEqual(['mất mạng']);
    state.fail.delete('post /storefront/me/apply-template');
    click(btn('Dùng mẫu Nhà bếp', dialog()!));
    await flush();
    expect(calls('post', '/storefront/me/apply-template')).toHaveLength(2);
  });

  it('Thêm sản phẩm (mở bộ chọn, khối mặc định chưa có): hai cú chạm chỉ tạo một khối; nút báo aria-busy', async () => {
    state.sf = storefront({ status: 'DRAFT', collections: [] });
    await toStep3();
    const pick = btn('Thêm sản phẩm');
    const release = hold('post /storefront/me/collections');
    await tap(pick);
    expect(calls('post', '/storefront/me/collections')).toHaveLength(1);
    expectBusy(pick);
    await release();
    expectIdle(btn('Thêm sản phẩm'));
  });

  it('Bỏ món: khoá theo món (hai cú chạm một món chỉ gửi một lần, món khác chạy song song), báo bận đúng món, lỗi nhớ riêng từng món và không bị món khác xoá', async () => {
    state.sf = storefront({ status: 'DRAFT', collections: [{ id: 'c1', title: 'Bộ sưu tập A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: twoItems() }] });
    await toStep3();
    const removeA = btn('Bỏ Trà xanh');
    const removeB = btn('Bỏ Xà phòng');
    state.fail.add('delete /storefront/me/items/i1');
    const releaseA = hold('delete /storefront/me/items/i1');
    await tap(removeA);
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(1);
    expectBusy(removeA);
    expectIdle(removeB);
    click(removeB);
    await flush();
    expect(calls('delete', '/storefront/me/items/i2')).toHaveLength(1);
    await releaseA();
    // Món A lỗi SAU khi món B đã xong: lời báo của A còn, nằm ngay dưới dòng A.
    expect(alerts()).toEqual(['mất mạng']);
    expect(removeA.closest('div.border-b')?.querySelector('[role="alert"]')).not.toBeNull();
    expect(removeB.closest('div.border-b')?.querySelector('[role="alert"]')).toBeNull();
    expectIdle(removeA);
    // Chạm món B lần nữa (thành công): lời báo của món A không mất.
    click(removeB);
    await flush();
    expect(calls('delete', '/storefront/me/items/i2')).toHaveLength(2);
    expect(alerts()).toEqual(['mất mạng']);
    state.fail.delete('delete /storefront/me/items/i1');
    click(removeA);
    await flush();
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(2);
    expect(alerts()).toEqual([]);
  });

  it('Bỏ món: khoá giữ tới khi gian hàng mới về', async () => {
    state.sf = storefront({ status: 'DRAFT' });
    await toStep3();
    const remove = btn('Bỏ Trà xanh');
    const releaseFresh = hold(ME);
    click(remove);
    await flush();
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(1);
    expectBusy(remove);
    click(remove);
    await flush();
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(1);
    await releaseFresh();
    expectIdle(remove);
    click(remove);
    await flush();
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(2);
  });

  it('Bước gửi duyệt: hai cú chạm chỉ gửi một lần; nút báo aria-busy, không disabled; lỗi role=alert; nhả khoá để gửi lại', async () => {
    state.sf = storefront({ status: 'DRAFT' });
    mount();
    await flush();
    await flush();
    click(btn('Tiếp tục'));
    await flush();
    click(btn('Tiếp tục'));
    await flush();
    expect(text()).toContain('Bước 4/4');
    const submit = btn('Gửi duyệt');
    state.fail.add(PUBLISH);
    const release = hold(PUBLISH);
    await tap(submit);
    expect(calls('post', '/storefront/me/publish')).toHaveLength(1);
    expectBusy(submit);
    await release();
    expect(alerts()).toEqual(['mất mạng']);
    expectIdle(btn('Gửi duyệt'));
    state.fail.delete(PUBLISH);
    click(btn('Gửi duyệt'));
    await flush();
    expect(calls('post', '/storefront/me/publish')).toHaveLength(2);
    expect(text()).toContain('Đã gửi duyệt.');
  });
});

describe('luồng đăng ký 4 bước — lệnh xong muộn và bị từ chối (W102B)', () => {
  const getsOfMe = () => calls('get', '/storefront/me').length;
  const startInfoStep = async () => {
    state.sf = storefront({ status: 'DRAFT' });
    mount();
    await flush();
    await flush();
    expect(text()).toContain('Bước 2/4');
  };

  const titleInput = () => Array.from(document.querySelectorAll<HTMLInputElement>('input')).find((i) => i.maxLength === 120)!;
  const patchTitles = () => calls('patch', '/storefront/me').map((c) => (c.body as { title: string }).title);

  it('lưu thông tin: lúc lệnh còn bay "Quay lại" báo bận (aria-busy/aria-disabled, không disabled) và không đổi bước, kể cả bấm cùng khung hình với Tiếp tục; xong thì sang bước 3 và chỉ có một lệnh lưu, đúng chữ vừa gõ', async () => {
    await startInfoStep();
    typeInto(titleInput(), 'Tiệm Mới');
    const release = hold('patch /storefront/me');
    const next = btn('Tiếp tục');
    const back = btn('Quay lại');
    act(() => {
      next.click();
      back.click();
    });
    await flush();
    expect(text()).toContain('Bước 2/4');
    expectBusy(back);
    click(back);
    await flush();
    expect(text()).toContain('Bước 2/4');
    expect(calls('get', '/storefront/me')).toHaveLength(1);
    await release();
    expect(text()).toContain('Bước 3/4');
    expect(patchTitles()).toEqual(['Tiệm Mới']);
  });

  it('lưu thông tin lỗi: "Quay lại" nhả khoá ngay và bấm được', async () => {
    await startInfoStep();
    state.failStatus.set('patch /storefront/me', 500);
    click(btn('Tiếp tục'));
    await flush();
    expectIdle(btn('Quay lại'));
    click(btn('Quay lại'));
    await flush();
    expect(text()).toContain('Bước 1/4');
  });

  it('lưu thông tin bị từ chối 409: "Quay lại" giữ khoá tới khi gian hàng mới về rồi mới bấm được', async () => {
    await startInfoStep();
    state.failStatus.set('patch /storefront/me', 409);
    const releaseFresh = hold(ME);
    click(btn('Tiếp tục'));
    await flush();
    expectBusy(btn('Quay lại'));
    click(btn('Quay lại'));
    await flush();
    expect(text()).toContain('Bước 2/4');
    await releaseFresh();
    expectIdle(btn('Quay lại'));
    click(btn('Quay lại'));
    await flush();
    expect(text()).toContain('Bước 1/4');
  });

  it('vào lại bước thông tin lúc gian hàng mới chưa về (hết hạn chờ 4 giây): ô chưa gõ đi theo gian hàng khi nó về, ô đã gõ giữ chữ của khách', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    try {
      await startInfoStep();
      const releaseFresh = hold(ME);
      click(btn('Tiếp tục'));
      await flush();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_500);
      });
      await flush(2);
      expect(text()).toContain('Bước 3/4');
      click(btn('Quay lại'));
      await flush();
      expect(text()).toContain('Bước 2/4');
      expect(titleInput().value).toBe('Cửa hàng Xanh');
      const note = document.querySelector<HTMLTextAreaElement>('textarea')!;
      typeInto(note, 'Chữ khách đang gõ');
      state.sf = { ...state.sf!, title: 'Tiệm Mới', headerNote: 'Ghi chú mới' };
      await releaseFresh();
      expect(titleInput().value).toBe('Tiệm Mới');
      expect(note.value).toBe('Chữ khách đang gõ');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lưu thông tin xong đúng lúc khách còn ở bước đó: vẫn sang bước 3 (không chặn nhầm)', async () => {
    await startInfoStep();
    const release = hold('patch /storefront/me');
    click(btn('Tiếp tục'));
    await flush();
    await release();
    expect(text()).toContain('Bước 3/4');
  });

  it.each([400, 404, 409, 422])('lưu thông tin bị máy chủ từ chối %i: tải lại gian hàng RỒI mới nhả nút, lời báo hiện ngay', async (status) => {
    await startInfoStep();
    state.failStatus.set('patch /storefront/me', status);
    const before = getsOfMe();
    const releaseFresh = hold(ME);
    click(btn('Tiếp tục'));
    await flush();
    expect(getsOfMe()).toBeGreaterThan(before);
    expect(alerts()).toEqual(['Bạn chưa hoàn thành nhiệm vụ này.']);
    expectBusy(btn('Tiếp tục'));
    click(btn('Tiếp tục'));
    await flush();
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    await releaseFresh();
    expectIdle(btn('Tiếp tục'));
  });

  it.each([401, 403, 500])('lưu thông tin gặp %i: không tải lại gian hàng, nút nhả ngay', async (status) => {
    await startInfoStep();
    state.failStatus.set('patch /storefront/me', status);
    const before = getsOfMe();
    click(btn('Tiếp tục'));
    await flush();
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expect(getsOfMe()).toBe(before);
    expectIdle(btn('Tiếp tục'));
  });

  const toProductsStep = async (over: Record<string, unknown> = {}) => {
    state.sf = storefront({ status: 'DRAFT', ...over });
    mount();
    await flush();
    await flush();
    click(btn('Tiếp tục'));
    await flush();
    expect(text()).toContain('Bước 3/4');
  };
  const REJECTED = 'Bạn chưa hoàn thành nhiệm vụ này.';

  it.each([400, 404, 409, 422])('bước sản phẩm, bỏ món bị từ chối %i: tải lại gian hàng RỒI mới nhả nút, lời báo nằm dưới món đó', async (status) => {
    await toProductsStep();
    const remove = btn('Bỏ Trà xanh');
    state.failStatus.set('delete /storefront/me/items/i1', status);
    const before = getsOfMe();
    const releaseFresh = hold(ME);
    click(remove);
    await flush();
    expect(getsOfMe()).toBeGreaterThan(before);
    expect(alerts()).toEqual([REJECTED]);
    expectBusy(remove);
    click(remove);
    await flush();
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(1);
    await releaseFresh();
    expectIdle(remove);
  });

  it.each([401, 403, 500])('bước sản phẩm, bỏ món gặp %i: không tải lại gian hàng, nút nhả ngay', async (status) => {
    await toProductsStep();
    state.failStatus.set('delete /storefront/me/items/i1', status);
    const before = getsOfMe();
    click(btn('Bỏ Trà xanh'));
    await flush();
    expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(1);
    expect(getsOfMe()).toBe(before);
    expectIdle(btn('Bỏ Trà xanh'));
  });

  it('bước sản phẩm, chọn mẫu bị từ chối 400 (gian hàng đã có bộ sưu tập ở máy khác): tải lại gian hàng RỒI mới nhả ô mẫu', async () => {
    await toProductsStep({ collections: [] });
    click(btn('Chọn danh mục'));
    await flush();
    state.failStatus.set('post /storefront/me/apply-template', 400);
    const before = getsOfMe();
    const releaseFresh = hold(ME);
    const kitchen = btn('Dùng mẫu Nhà bếp', dialog()!);
    click(kitchen);
    await flush();
    expect(getsOfMe()).toBeGreaterThan(before);
    expectBusy(kitchen);
    click(kitchen);
    await flush();
    expect(calls('post', '/storefront/me/apply-template')).toHaveLength(1);
    await releaseFresh();
    expect(btn('Dùng mẫu Nhà bếp', dialog()!).getAttribute('aria-disabled')).toBeNull();
  });

  it('bước sản phẩm, chọn mẫu bị từ chối 400 và gian hàng mới về đã có bộ sưu tập: đóng tấm chọn mẫu, lời báo nằm trên trang (không sau tấm), ô "Chọn danh mục" biến mất', async () => {
    await toProductsStep({ collections: [] });
    click(btn('Chọn danh mục'));
    await flush();
    state.failStatus.set('post /storefront/me/apply-template', 400);
    const releaseFresh = hold(ME);
    click(btn('Dùng mẫu Nhà bếp', dialog()!));
    await flush();
    expect(dialog()).not.toBeNull();
    state.sf = storefront({ status: 'DRAFT' });
    await releaseFresh();
    await flush();
    expect(dialog()).toBeNull();
    expect(alerts()).toEqual([REJECTED]);
    expect(text()).not.toContain('Chọn danh mục');
    expect(text()).toContain('Trà xanh');
  });

  it.each([
    ['400, gian hàng mới về vẫn chưa có bộ sưu tập', 400],
    ['500 (không tải lại)', 500],
  ])('bước sản phẩm, chọn mẫu bị từ chối %s: tấm ở lại và lời báo nằm TRONG tấm (không có lời báo thứ hai sau tấm)', async (_name, status) => {
    await toProductsStep({ collections: [] });
    click(btn('Chọn danh mục'));
    await flush();
    state.failStatus.set('post /storefront/me/apply-template', status);
    click(btn('Dùng mẫu Nhà bếp', dialog()!));
    await flush();
    await flush();
    expect(dialog()).not.toBeNull();
    expect(alerts()).toHaveLength(1);
    expect(dialog()!.querySelector('[role="alert"]')).not.toBeNull();
    expect(btn('Dùng mẫu Nhà bếp', dialog()!).getAttribute('aria-disabled')).toBeNull();
  });

  it('bước sản phẩm, lời báo mẫu bị từ chối: đóng tấm "Để sau" thì lời báo ra trang, mở lại tấm thì lời báo cũ mất', async () => {
    await toProductsStep({ collections: [] });
    click(btn('Chọn danh mục'));
    await flush();
    state.failStatus.set('post /storefront/me/apply-template', 500);
    click(btn('Dùng mẫu Nhà bếp', dialog()!));
    await flush();
    await flush();
    click(btn('Để sau, tự chọn sản phẩm', dialog()!));
    await flush();
    expect(dialog()).toBeNull();
    expect(alerts()).toHaveLength(1);
    click(btn('Chọn danh mục'));
    await flush();
    expect(alerts()).toHaveLength(0);
  });

  it('bước sản phẩm, mở bộ chọn (tạo khối mặc định) bị từ chối 404: tải lại gian hàng RỒI mới nhả nút Thêm sản phẩm; 500 thì không tải lại', async () => {
    await toProductsStep({ collections: [] });
    state.failStatus.set('post /storefront/me/collections', 404);
    let before = getsOfMe();
    const releaseFresh = hold(ME);
    click(btn('Thêm sản phẩm'));
    await flush();
    expect(getsOfMe()).toBeGreaterThan(before);
    expectBusy(btn('Thêm sản phẩm'));
    await releaseFresh();
    expectIdle(btn('Thêm sản phẩm'));
    state.failStatus.set('post /storefront/me/collections', 500);
    before = getsOfMe();
    click(btn('Thêm sản phẩm'));
    await flush();
    expect(calls('post', '/storefront/me/collections')).toHaveLength(2);
    expect(getsOfMe()).toBe(before);
    expectIdle(btn('Thêm sản phẩm'));
  });
});

describe('khoá giữ có hạn 4 giây khi dữ liệu mới không bao giờ về (W98B)', () => {
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  /** Còn khoá ở 3 giây, nhả sau 4 giây (cộng dư để Promise hạn xong). */
  const stillBusyThenReleased = async (el: () => HTMLElement) => {
    await advance(3_000);
    expectBusy(el());
    await advance(1_500);
    await flush(2);
    expectIdle(el());
  };

  it('Nhận thưởng nhiệm vụ: danh sách nhiệm vụ không về thì nút nhả sau 4 giây, nhận lại được', async () => {
    mount();
    await flush();
    await openQuests();
    const claim = () => Array.from(dialog()!.querySelectorAll<HTMLElement>('button')).find((b) => /^(Nhận|Đang nhận)/.test(b.textContent ?? ''))!;
    state.hold.add('get /storefront/me/quests');
    click(claim());
    await flush();
    expect(calls('post', '/storefront/me/quests/Q1/claim')).toHaveLength(1);
    await stillBusyThenReleased(claim);
    click(claim());
    await flush();
    expect(calls('post', '/storefront/me/quests/Q1/claim')).toHaveLength(2);
  });

  it('Ghim sản phẩm trong khối: gian hàng mới không về thì khoá nhả sau 4 giây', async () => {
    mount();
    await flush();
    await openFirstSection();
    state.hold.add(ME);
    await openItemMenu();
    click(btn('Ghim lên đầu'));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(1);
    await openItemMenu();
    click(btn('Ẩn sản phẩm'));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(1);
    await advance(3_000);
    await openItemMenu();
    click(btn('Ẩn sản phẩm'));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(1);
    await advance(1_500);
    await flush(2);
    await openItemMenu();
    click(btn('Ẩn sản phẩm'));
    await flush();
    expect(calls('patch', '/storefront/me/items/i1')).toHaveLength(2);
  });

  describe('luồng đăng ký 4 bước', () => {
    it('Bước thông tin — Tiếp tục: gian hàng mới không về thì sang bước sản phẩm sau 4 giây', async () => {
      state.sf = storefront({ status: 'DRAFT' });
      mount();
      await flush();
      await flush();
      state.hold.add(ME);
      click(btn('Tiếp tục'));
      await flush();
      expect(calls('patch', '/storefront/me')).toHaveLength(1);
      expect(text()).toContain('Bước 2/4');
      await advance(3_000);
      expect(text()).toContain('Bước 2/4');
      await advance(1_500);
      await flush(2);
      expect(text()).toContain('Bước 3/4');
    });

    it('Chọn mẫu: gian hàng mới không về thì khoá nhả sau 4 giây, chọn lại được', async () => {
      state.sf = storefront({ status: 'DRAFT', collections: [] });
      mount();
      await flush();
      await flush();
      click(btn('Tiếp tục'));
      await flush();
      click(btn('Chọn danh mục'));
      await flush();
      state.hold.add(ME);
      click(btn('Dùng mẫu Nhà bếp', dialog()!));
      await flush();
      expect(calls('post', '/storefront/me/apply-template')).toHaveLength(1);
      expect(dialog()).toBeNull();
      await advance(3_000);
      click(btn('Chọn danh mục'));
      await flush();
      click(btn('Dùng mẫu Nhà bếp', dialog()!));
      await flush();
      expect(calls('post', '/storefront/me/apply-template')).toHaveLength(1);
      await advance(1_500);
      await flush(2);
      click(btn('Dùng mẫu Nhà bếp', dialog()!));
      await flush();
      expect(calls('post', '/storefront/me/apply-template')).toHaveLength(2);
    });

    it('Bỏ món: gian hàng mới không về thì khoá nhả sau 4 giây', async () => {
      state.sf = storefront({ status: 'DRAFT' });
      mount();
      await flush();
      await flush();
      click(btn('Tiếp tục'));
      await flush();
      const remove = btn('Bỏ Trà xanh');
      state.hold.add(ME);
      click(remove);
      await flush();
      expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(1);
      await stillBusyThenReleased(() => remove);
      click(remove);
      await flush();
      expect(calls('delete', '/storefront/me/items/i1')).toHaveLength(2);
    });

    it('Gửi duyệt: gian hàng mới không về thì nút nhả sau 4 giây (lời báo đã hiện ngay)', async () => {
      state.sf = storefront({ status: 'DRAFT' });
      mount();
      await flush();
      await flush();
      click(btn('Tiếp tục'));
      await flush();
      click(btn('Tiếp tục'));
      await flush();
      const submit = btn('Gửi duyệt');
      state.hold.add(ME);
      click(submit);
      await flush();
      expect(calls('post', '/storefront/me/publish')).toHaveLength(1);
      expect(text()).toContain('Đã gửi duyệt.');
      await stillBusyThenReleased(() => btn('Gửi duyệt'));
    });
  });
});

describe('"Thử lại" khi tải lỗi khoá cú bấm đôi (ErrorState trả lời hứa tải lại)', () => {
  it('lỗi tải gian hàng: hai cú chạm chỉ tải lại một lần, nút báo aria-busy; tải lỗi tiếp thì nhả khoá', async () => {
    state.fail.add(ME);
    mount();
    await flush();
    expect(calls('get', '/storefront/me')).toHaveLength(1);
    const retry = btn('Thử lại');
    const release = hold(ME);
    await tap(retry);
    expect(calls('get', '/storefront/me')).toHaveLength(2);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    await release();
    // Tải lại thất bại: màn lỗi dựng lại với nút mới, bấm được.
    expectIdle(btn('Thử lại'));
    click(btn('Thử lại'));
    await flush();
    expect(calls('get', '/storefront/me')).toHaveLength(3);
  });

  it('bước điều kiện lỗi tải hồ sơ CTV: hai cú chạm chỉ tải lại một lần', async () => {
    state.sf = null;
    state.sfStatus = 404;
    state.fail.add('get /affiliate/me');
    mount();
    await flush();
    expect(calls('get', '/affiliate/me')).toHaveLength(1);
    const release = hold('get /affiliate/me');
    await tap(btn('Thử lại'));
    expect(calls('get', '/affiliate/me')).toHaveLength(2);
    await release();
  });

  it('bước chọn mẫu lỗi tải danh mục: hai cú chạm chỉ tải lại một lần', async () => {
    state.sf = storefront({ status: 'DRAFT', collections: [] });
    state.fail.add('get /categories');
    mount();
    await flush();
    await flush();
    click(btn('Tiếp tục'));
    await flush();
    click(btn('Chọn danh mục'));
    await flush();
    expect(calls('get', '/categories')).toHaveLength(1);
    const release = hold('get /categories');
    await tap(btn('Thử lại', dialog()!));
    expect(calls('get', '/categories')).toHaveLength(2);
    await release();
  });

  it('bộ chọn sản phẩm lỗi tải: hai cú chạm chỉ tải lại một lần', async () => {
    state.fail.add('get /storefront/me/products');
    mount();
    await flush();
    await openFirstSection();
    click(btn('Thêm sản phẩm'));
    await flush();
    const before = calls('get', '/storefront/me/products').length;
    const release = hold('get /storefront/me/products');
    await tap(btn('Thử lại', dialog()!));
    expect(calls('get', '/storefront/me/products')).toHaveLength(before + 1);
    await release();
  });
});

describe('TemplateSheet (chọn mẫu khi tạo gian hàng): hai cách tạo dùng chung một khoá', () => {
  const mountSheet = (onCreated: () => unknown = vi.fn()) => {
    const r = render(<TemplateSheet open onClose={() => {}} onCreated={onCreated} />);
    mounted.push(r);
    return r;
  };

  it('hai cú chạm vào mẫu chỉ tạo một gian hàng; bấm "Bỏ qua" lúc đó cũng bị chặn; sheet không đóng được; xong thì bấm lại được', async () => {
    const onCreated = vi.fn();
    mountSheet(onCreated);
    await flush();
    const template = btn('Dùng mẫu Nhà bếp', dialog()!);
    const blank = btn('Bỏ qua, tự tạo gian hàng trống', dialog()!);
    const release = hold('post /storefront');
    await tap(template);
    expect(calls('post', '/storefront')).toHaveLength(1);
    expectBusy(template);
    expect(blank.getAttribute('aria-disabled')).toBe('true');
    expect((blank as HTMLButtonElement).disabled).toBe(false);
    click(blank);
    await flush();
    expect(calls('post', '/storefront')).toHaveLength(1);
    expect(closeButton(dialog()!)).toBeNull();
    await release();
    expect(calls('post', '/storefront/me/apply-template')).toHaveLength(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expectIdle(blank);
    click(blank);
    await flush();
    expect(calls('post', '/storefront')).toHaveLength(2);
  });

  it('hai cú chạm vào "Bỏ qua" chỉ tạo một gian hàng trống; lỗi role=alert; nhả khoá để thử lại', async () => {
    mountSheet();
    await flush();
    state.fail.add('post /storefront');
    const blank = btn('Bỏ qua, tự tạo gian hàng trống', dialog()!);
    const release = hold('post /storefront');
    await tap(blank);
    expect(calls('post', '/storefront')).toHaveLength(1);
    expectBusy(blank);
    await release();
    expect(Array.from(dialog()!.querySelectorAll('[role="alert"]')).map((e) => e.textContent)).toEqual(['mất mạng']);
    expectIdle(blank);
    state.fail.delete('post /storefront');
    click(blank);
    await flush();
    expect(calls('post', '/storefront')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Khoá nút Lưu lúc ảnh còn đang lên (Mini ↔ web, Wave 85B ↔ Wave 90A): ô ảnh thật, chỉ giả lượt tải lên Cloudinary.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

describe('khoá nút Lưu lúc ảnh còn đang lên — hồ sơ gian hàng và bước thông tin', () => {
  const PATCH_ME = 'patch /storefront/me';
  const pickImage = (label: string) => {
    const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="Chọn tệp ${label}"]`)!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'a.png', { type: 'image/png' })] });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const finishUpload = async (index: number, url: string) => {
    await act(async () => state.uploads[index]!.resolve(url));
    await flush();
  };
  const openProfile = async () => {
    state.holdUploads = true;
    mount();
    await flush();
    click(btn('Sửa hồ sơ'));
    await flush();
  };
  const openInfoStep = async () => {
    state.holdUploads = true;
    state.sf = storefront({ status: 'DRAFT' });
    mount();
    await flush();
    await flush();
  };

  it('Lưu hồ sơ: ảnh đang lên thì nút báo aria-busy + aria-disabled, đổi chữ, chạm không gửi; ảnh về thì nhả và gửi đúng ảnh mới', async () => {
    await openProfile();
    pickImage('ảnh đại diện');
    await flush();
    const save = btn('Đang tải ảnh…', dialog()!);
    expectBusy(save);
    await tap(save);
    expect(calls('patch', '/storefront/me')).toHaveLength(0);
    expect(dialog()).not.toBeNull();

    await finishUpload(0, 'https://res.cloudinary.com/x/avatar.jpg');
    expectIdle(btn('Lưu hồ sơ', dialog()!));
    await tap(btn('Lưu hồ sơ', dialog()!), 1);
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expect(calls('patch', '/storefront/me')[0]!.body).toMatchObject({ avatarUrl: 'https://res.cloudinary.com/x/avatar.jpg' });
  });

  it('Lưu hồ sơ: hai ô ảnh tải cùng lúc, ô đầu xong vẫn khoá, ô cuối xong mới nhả', async () => {
    await openProfile();
    pickImage('ảnh đại diện');
    pickImage('ảnh bìa');
    await flush();
    expect(state.uploads).toHaveLength(2);
    await finishUpload(0, 'https://res.cloudinary.com/x/avatar.jpg');
    expectBusy(btn('Đang tải ảnh…', dialog()!));
    await tap(btn('Đang tải ảnh…', dialog()!), 1);
    expect(calls('patch', '/storefront/me')).toHaveLength(0);
    await finishUpload(1, 'https://res.cloudinary.com/x/cover.jpg');
    expectIdle(btn('Lưu hồ sơ', dialog()!));
  });

  it('Lưu hồ sơ: đang lưu thì hai ô ảnh khoá (aria-disabled), chọn ảnh lúc này không tải lên', async () => {
    await openProfile();
    const release = hold(PATCH_ME);
    await tap(btn('Lưu hồ sơ', dialog()!), 1);
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expect(dialog()!.querySelector('button[aria-label="Tải lên ảnh đại diện"]')!.getAttribute('aria-disabled')).toBe('true');
    expect(dialog()!.querySelector('button[aria-label="Tải lên ảnh bìa"]')!.getAttribute('aria-disabled')).toBe('true');
    pickImage('ảnh đại diện');
    await flush();
    expect(state.uploads).toHaveLength(0);
    await release();
  });

  it('Bước thông tin: ảnh đang lên thì Tiếp tục báo aria-busy + aria-disabled, đổi chữ, chạm không gửi; ảnh về thì nhả và gửi đúng ảnh mới', async () => {
    await openInfoStep();
    pickImage('ảnh bìa');
    await flush();
    const next = btn('Đang tải ảnh…');
    expectBusy(next);
    await tap(next);
    expect(calls('patch', '/storefront/me')).toHaveLength(0);

    await finishUpload(0, 'https://res.cloudinary.com/x/cover.jpg');
    expectIdle(btn('Tiếp tục'));
    await tap(btn('Tiếp tục'), 1);
    expect(calls('patch', '/storefront/me')).toHaveLength(1);
    expect(calls('patch', '/storefront/me')[0]!.body).toMatchObject({ coverUrl: 'https://res.cloudinary.com/x/cover.jpg' });
  });

  it('Bước thông tin: hai ô ảnh tải cùng lúc, ô đầu xong vẫn khoá, ô cuối xong mới nhả', async () => {
    await openInfoStep();
    pickImage('ảnh đại diện');
    pickImage('ảnh bìa');
    await flush();
    await finishUpload(1, 'https://res.cloudinary.com/x/cover.jpg');
    expectBusy(btn('Đang tải ảnh…'));
    await finishUpload(0, 'https://res.cloudinary.com/x/avatar.jpg');
    expectIdle(btn('Tiếp tục'));
  });

  it('Bước thông tin: đang lưu thì hai ô ảnh khoá (aria-disabled), chọn ảnh lúc này không tải lên', async () => {
    await openInfoStep();
    const release = hold(PATCH_ME);
    await tap(btn('Tiếp tục'), 1);
    expect(document.body.querySelector('button[aria-label="Tải lên ảnh đại diện"]')!.getAttribute('aria-disabled')).toBe('true');
    expect(document.body.querySelector('button[aria-label="Tải lên ảnh bìa"]')!.getAttribute('aria-disabled')).toBe('true');
    pickImage('ảnh đại diện');
    await flush();
    expect(state.uploads).toHaveLength(0);
    await release();
  });
});
