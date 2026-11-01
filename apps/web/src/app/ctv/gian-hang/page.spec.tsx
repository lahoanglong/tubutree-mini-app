// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, typeInto, selectValue, type Rendered } from '@/test-utils/dom';

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
  picker: [] as unknown[],
  categories: [] as unknown[],
  kit: null as unknown,
  me: { isAffiliate: true, canRegister: true, canOpenStorefront: true } as unknown,
  fail: new Set<string>(),
  hold: new Set<string>(),
  gates: new Map<string, Promise<void>>(),
  calls: [] as Call[],
  share: vi.fn(),
  copied: [] as string[],
  created: null as unknown,
  patchResult: null as unknown,
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
vi.mock('@/components/account/cloudinary-upload', () => ({ uploadToCloudinary: async () => null }));

function httpError(status: number, message = 'lỗi máy chủ') {
  return Object.assign(new Error(message), { status });
}

vi.mock('@/lib/core-http', () => {
  const run = async (method: string, path: string, body?: unknown, opts?: { query?: unknown }) => {
    state.calls.push({ method, path, body, query: opts?.query });
    if (state.hold.has(`${method} ${path}`)) return new Promise(() => {});
    const gate = state.gates.get(`${method} ${path}`);
    if (gate) await gate;
    if (state.fail.has(`${method} ${path}`)) throw httpError(500, 'mất mạng');
    if (method === 'get') {
      if (path === '/storefront/me') {
        if (state.sfStatus !== 200) throw httpError(state.sfStatus, 'không có');
        return state.sf;
      }
      if (path === '/affiliate/me') return state.me;
      if (path === '/storefront/me/quests') return state.quests;
      if (path === '/storefront/me/stats') return state.stats;
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

import BackButton from '@/components/mini/back-button';
import StorefrontBuilderPage from './page';
import { metadata } from './layout';

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
const hasBtn = (name: string) => {
  try {
    btn(name);
    return true;
  } catch {
    return false;
  }
};
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
  state.picker = [{ ...PRODUCT, id: 'p2', name: 'Xà phòng', slug: 'xa-phong', maxAffiliateRate: 12 }];
  state.categories = [
    { id: 'cat1', name: 'Chăm sóc da', slug: 'cham-soc-da', image: null },
    { id: 'cat2', name: 'Nhà bếp', slug: 'nha-bep', image: 'https://cdn.example/bep.png' },
  ];
  state.kit = { productName: 'Trà xanh', images: [], captions: ['Xem /product/tra-xanh?ref=A nhé'], usps: ['Thơm'], faqs: [{ q: 'Dùng sao?', a: 'Pha nước nóng' }], videoUrls: ['https://v.example/1'], shareLink: '/product/tra-xanh?ref=A' };
  state.fail = new Set();
  state.hold = new Set();
  state.gates = new Map();
  state.calls = [];
  state.share = vi.fn(async () => 'shared');
  state.copied = [];
  state.created = null;
  state.patchResult = null;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void state.copied.push(t) } });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  nav.restore();
});

describe('/ctv/gian-hang — cổng vào theo phiên', () => {
  it('tiêu đề trang và noindex', () => {
    expect(metadata.title).toBe('Gian hàng của tôi — Tubu Tree');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('khách: nút đăng nhập mang returnTo=/ctv/gian-hang và không gọi API', async () => {
    state.phase = 'guest';
    const { container } = mount();
    await flush();
    expect(container.querySelector('a[href="/dang-nhap?returnTo=%2Fctv%2Fgian-hang"]')).not.toBeNull();
    expect(state.calls).toEqual([]);
  });

  it('đang khôi phục phiên: "Đang tải…", chưa gọi API', async () => {
    state.phase = 'loading';
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Đang tải…');
    expect(state.calls).toEqual([]);
  });

  it('mất kết nối lúc khôi phục: không mời đăng nhập lại', async () => {
    state.phase = 'unavailable';
    const { container } = mount();
    await flush();
    expect(container.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    expect(container.textContent).toMatch(/kết nối/i);
  });

  it('đang tải gian hàng: có đúng một h1 và khung chờ', () => {
    const { container } = mount();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('[data-skeleton]')).not.toBeNull();
  });

  it('lỗi tải khác 404: có Thử lại gọi lại API, không mời tạo gian hàng', async () => {
    state.sfStatus = 500;
    const { container } = mount();
    await flush();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(hasBtn('Tạo gian hàng')).toBe(false);
    const before = calls('get', '/storefront/me').length;
    click(btn('Thử lại'));
    await flush();
    expect(calls('get', '/storefront/me').length).toBe(before + 1);
  });

  it('có gian hàng: một h1, tên gian hàng là h2, nhãn trạng thái theo isPublished', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toBe('Gian hàng của tôi');
    expect(Array.from(container.querySelectorAll('h2')).some((h) => h.textContent === 'Cửa hàng Xanh')).toBe(true);
    expect(container.textContent).toContain('Bản nháp, chưa gửi duyệt');
    expect(container.querySelector('a[href="/ctv"]')).not.toBeNull();
  });
});

describe('đăng ký gian hàng 4 bước (404 = chưa có gian hàng)', () => {
  beforeEach(() => {
    state.sfStatus = 404;
  });

  it('bước 1: điều kiện, một h1, CTV thấy nút Bắt đầu', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(text()).toContain('Bước 1/4');
    expect(text()).toContain('Điều kiện mở gian hàng');
    expect(text()).toContain('Bạn đã là Cộng tác viên.');
    expect(hasBtn('Bắt đầu mở gian hàng')).toBe(true);
  });

  it('điều kiện đạt/chưa đạt có chữ cho trình đọc màn hình (dấu tích là hình ẩn)', async () => {
    const { container } = mount();
    await flush();
    const marks = Array.from(container.querySelectorAll('li .sr-only')).map((e) => e.textContent);
    expect(marks.length).toBeGreaterThanOrEqual(3);
    expect(marks.slice(0, 2)).toEqual(['Đã đạt: ', 'Đã đạt: ']);
  });

  it('bấm Bắt đầu: tạo gian hàng rồi sang bước thông tin', async () => {
    mount();
    await flush();
    state.sfStatus = 200;
    state.sf = storefront({ status: 'DRAFT', collections: [] });
    click(btn('Bắt đầu mở gian hàng'));
    await flush();
    expect(writes().map((c) => [c.method, c.path])).toEqual([['post', '/storefront']]);
    expect(text()).toContain('Bước 2/4');
    expect(text()).toContain('/s/shop-aff-1');
  });

  it('khách thường chưa là CTV: lối Đăng ký làm Cộng tác viên tới /ctv, không có nút tạo', async () => {
    state.me = { isAffiliate: false, canRegister: true };
    const { container } = mount();
    await flush();
    expect(text()).toContain('Bạn cần là Cộng tác viên trước khi mở gian hàng.');
    expect(hasBtn('Bắt đầu mở gian hàng')).toBe(false);
    expect(btn('Đăng ký làm Cộng tác viên').getAttribute('href')).toBe('/ctv');
    expect(writes()).toEqual([]);
    state.me = { isAffiliate: true, canRegister: true, canOpenStorefront: true };
  });

  it('tài khoản không thể làm CTV: giải thích, không có nút nào để tạo', async () => {
    state.me = { isAffiliate: false, canRegister: false };
    mount();
    await flush();
    expect(text()).toContain('Tài khoản này không mở gian hàng Cộng tác viên được.');
    expect(hasBtn('Bắt đầu mở gian hàng')).toBe(false);
    state.me = { isAffiliate: true, canRegister: true, canOpenStorefront: true };
  });
});

describe('đăng ký gian hàng: các bước sau khi có bản nháp', () => {
  beforeEach(() => {
    state.sf = storefront({ status: 'DRAFT' });
  });

  it('bản nháp vào bước 2; sửa tên rồi Tiếp tục lưu thông tin', async () => {
    mount();
    await flush();
    expect(text()).toContain('Bước 2/4');
    typeInto(document.body.querySelector('input')!, 'Shop mới');
    click(btn('Tiếp tục'));
    await flush();
    expect(writes().map((c) => [c.method, c.path, (c.body as { title?: string }).title])).toEqual([['patch', '/storefront/me', 'Shop mới']]);
    expect(text()).toContain('Bước 3/4');
  });

  it('tên trống: báo lỗi, không gọi API', async () => {
    mount();
    await flush();
    typeInto(document.body.querySelector('input')!, '');
    click(btn('Tiếp tục'));
    await flush();
    expect(text()).toContain('Nhập tên gian hàng.');
    expect(writes()).toEqual([]);
  });

  it('bước 3 chưa có sản phẩm: Tiếp tục tắt kèm lời nhắc; chọn mẫu gọi apply-template', async () => {
    state.sf = storefront({ status: 'DRAFT', collections: [] });
    mount();
    await flush();
    click(btn('Tiếp tục'));
    await flush();
    expect(text()).toContain('Bước 3/4');
    expect((btn('Tiếp tục') as HTMLButtonElement).disabled).toBe(true);
    expect(text()).toContain('Thêm ít nhất 1 sản phẩm để tiếp tục.');
    click(btn('Chọn danh mục'));
    await flush();
    expect(text()).toContain('Bắt đầu nhanh với 1 mẫu có sẵn');
    const cat = btn('Dùng mẫu Nhà bếp');
    expect(cat.className).toContain('min-h-11');
    click(cat);
    await flush();
    expect(writes().map((c) => [c.method, c.path, c.body]).slice(-1)).toEqual([['post', '/storefront/me/apply-template', { categoryId: 'cat2' }]]);
  });

  it('bước 4: xem trước, lời hứa duyệt, Gửi duyệt gọi publish(true)', async () => {
    mount();
    await flush();
    click(btn('Tiếp tục'));
    await flush();
    click(btn('Tiếp tục'));
    await flush();
    expect(text()).toContain('Bước 4/4');
    expect(document.body.querySelector('[data-testid="storefront-preview"]')).not.toBeNull();
    expect(text()).toContain('Tubu duyệt trong 1 ngày làm việc');
    click(btn('Gửi duyệt'));
    await flush();
    expect(writes().map((c) => [c.path, c.body]).slice(-1)).toEqual([['/storefront/me/publish', { isPublished: true }]]);
    expect(text()).toContain('Đã gửi duyệt.');
  });

  it('có lối mở trình chỉnh sửa đầy đủ', async () => {
    mount();
    await flush();
    click(btn('Mở trình chỉnh sửa đầy đủ'));
    await flush();
    expect(text()).toContain('Cài đặt');
  });
});

describe('gian hàng chờ duyệt (B-40)', () => {
  beforeEach(() => {
    state.sf = storefront({ isPublished: true, status: 'PENDING_APPROVAL', publicHiddenReason: 'Gian hàng đang chờ duyệt' });
  });

  it('ghi Chờ duyệt, không ghi Đang hiển thị, kèm lời hứa 1 ngày làm việc', async () => {
    mount();
    await flush();
    expect(text()).toContain('Chờ duyệt');
    expect(text()).not.toContain('Đang hiển thị');
    expect(text()).not.toContain('Gian hàng cập nhật sau vài phút');
    expect(document.body.querySelector('[data-testid="hidden-reason"]')?.textContent).toContain('1 ngày làm việc');
  });

  it('chia sẻ bị khoá, Xem trước mở bản xem trước, có nút Huỷ gửi duyệt', async () => {
    mount();
    await flush();
    expect((btn('Chia sẻ sau khi Tubu duyệt') as HTMLButtonElement).disabled).toBe(true);
    expect(btn('Xem trước').tagName).toBe('BUTTON');
    click(btn('Xem trước'));
    await flush();
    expect(dialog()?.querySelector('[data-testid="storefront-preview"]')).not.toBeNull();
  });

  it('Huỷ gửi duyệt nằm trong Cài đặt, không còn ở trang chính', async () => {
    mount();
    await flush();
    expect(hasBtn('Huỷ gửi duyệt')).toBe(false);
    await openConfig();
    expect(hasBtn('Huỷ gửi duyệt')).toBe(true);
  });
});

describe('chỉnh gian hàng: sản phẩm và bộ sưu tập', () => {
  it('hiện tên sản phẩm, giá bán ưu tiên giá khuyến mãi và tên bộ sưu tập', async () => {
    mount();
    await flush();
    await openFirstSection();
    expect(text()).toContain('Bộ sưu tập A');
    expect(text()).toContain('Trà xanh');
    expect(text()).toContain('80.000đ');
    expect(text()).not.toContain('100.000đ');
  });

  it('món khách không thấy được đánh dấu kèm lý do; món bình thường không có nhãn', async () => {
    state.sf = storefront({
      collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item({ id: 'i1', hiddenReason: 'Sản phẩm chưa được duyệt' }), item({ id: 'i2', productId: 'p9', product: { ...PRODUCT, id: 'p9', name: 'Xà phòng' } })] }],
    });
    mount();
    await flush();
    await openFirstSection();
    expect(text()).toContain('Khách không thấy: Sản phẩm chưa được duyệt');
    expect(text().match(/Khách không thấy/g)).toHaveLength(1);
  });

  it('món đã ghim có nhãn "Đã ghim" ngay trên hàng (ghim nằm trong menu "⋯"); món thường không có', async () => {
    state.sf = storefront({
      collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item({ id: 'i1', isPinned: true }), item({ id: 'i2', productId: 'p9', product: { ...PRODUCT, id: 'p9', name: 'Xà phòng' } })] }],
    });
    mount();
    await flush();
    await openFirstSection();
    expect(text().match(/Đã ghim/g)).toHaveLength(1);
    const badge = Array.from(document.querySelectorAll('span')).find((s) => s.textContent === 'Đã ghim')!;
    expect(badge.closest('.border-b')!.textContent).toContain('Trà xanh');
  });

  it('nhãn "Khách không thấy" được xuống dòng, không tràn khung 375px', async () => {
    state.sf = storefront({
      collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item({ id: 'i1', hiddenReason: 'Sản phẩm không còn cho CTV bán' })] }],
    });
    const { container } = mount();
    await flush();
    await openFirstSection();
    const badge = Array.from(container.querySelectorAll('span')).find((s) => s.textContent?.startsWith('Khách không thấy'))!;
    expect(badge.className).toContain('!whitespace-normal');
    expect(badge.className).toContain('max-w-full');
  });

  it('tên món bị ẩn đổi sang chữ nhạt đủ tương phản, không làm mờ bằng opacity (D6)', async () => {
    state.sf = storefront({
      collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item({ id: 'i1', isHidden: true })] }],
    });
    const { container } = mount();
    await flush();
    await openFirstSection();
    const name = container.querySelector('[data-testid="item-name"]')!;
    expect(name.textContent).toBe('Trà xanh');
    expect(name.className).toContain('text-stone-500');
    expect(name.className).not.toContain('opacity-');
  });

  it('ghim và ẩn gọi đúng API', async () => {
    mount();
    await flush();
    await openFirstSection();
    await openItemMenu();
    click(btn('Ghim lên đầu'));
    await flush();
    await openItemMenu();
    click(btn('Ẩn sản phẩm'));
    await flush();
    expect(writes().map((c) => [c.method, c.path, c.body])).toEqual([
      ['patch', '/storefront/me/items/i1', { isPinned: true }],
      ['patch', '/storefront/me/items/i1', { isHidden: true }],
    ]);
  });

  it('xoá sản phẩm phải qua bước xác nhận; Huỷ thì không gọi API', async () => {
    mount();
    await flush();
    await openFirstSection();
    await openItemMenu();
    click(btn('Xoá khỏi khối'));
    await flush();
    expect(dialog()?.textContent).toContain('Xoá sản phẩm này khỏi gian hàng?');
    click(btn('Huỷ', dialog()!));
    await flush();
    expect(writes()).toEqual([]);
    await openItemMenu();
    click(btn('Xoá khỏi khối'));
    await flush();
    click(btn('Xoá', dialog()!));
    await flush();
    expect(writes().map((c) => [c.method, c.path])).toEqual([['delete', '/storefront/me/items/i1']]);
  });

  it('sản phẩm đã ghim hoặc đã ẩn đổi nhãn nút để hoàn tác', async () => {
    state.sf = storefront({ collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item({ isPinned: true, isHidden: true })] }] });
    mount();
    await flush();
    await openFirstSection();
    await openItemMenu();
    expect(hasBtn('Bỏ ghim')).toBe(true);
    expect(hasBtn('Hiện sản phẩm')).toBe(true);
    expect(hasBtn('Ghim lên đầu')).toBe(false);
  });

  it('nút ⋯ ở hàng sản phẩm và ở đầu trang khối cao và rộng >= 44px, có chữ đọc được', async () => {
    mount();
    await flush();
    await openFirstSection();
    for (const n of ['Tuỳ chọn sản phẩm', 'Tuỳ chọn khối']) {
      expect(btn(n).className).toMatch(/h-11/);
      expect(btn(n).className).toMatch(/w-11/);
    }
  });

  it('các thao tác ẩn sau ⋯ đều có chữ, thao tác xoá đứng cuối', async () => {
    mount();
    await flush();
    await openFirstSection();
    await openItemMenu();
    const labels = Array.from(dialog()!.querySelectorAll('button'))
      .map((b) => b.textContent?.trim())
      .filter(Boolean);
    expect(labels.slice(-4)).toEqual(['Ghim lên đầu', 'Ẩn sản phẩm', 'Bài đăng mẫu', 'Xoá khỏi khối']);
  });

  it('lỗi ghim: báo lỗi trên trang', async () => {
    state.fail.add('patch /storefront/me/items/i1');
    mount();
    await flush();
    await openFirstSection();
    await openItemMenu();
    click(btn('Ghim lên đầu'));
    await flush();
    expect(text()).toContain('mất mạng');
  });

  it('"Bài đăng mẫu" mở bộ nội dung bán hàng của đúng sản phẩm, link đổi sang trang sản phẩm web', async () => {
    mount();
    await flush();
    await openFirstSection();
    expect(hasBtn('Nội dung')).toBe(false);
    // Từ G6 (P2 #30) "Bài đăng mẫu" nằm trong menu ⋯ của món, không còn nút chữ thứ hai trong hàng.
    expect(hasBtn('Bài đăng mẫu')).toBe(false);
    await openItemMenu();
    click(btn('Bài đăng mẫu'));
    await flush();
    expect(calls('get', '/affiliate/content-kit/tra-xanh')).toHaveLength(1);
    expect(dialog()?.textContent).toContain('Bài mẫu (chạm để sao chép)');
    expect(dialog()?.textContent).toContain('/san-pham/tra-xanh?ref=A');
    expect(dialog()?.textContent).not.toContain('/product/tra-xanh');
    expect(dialog()?.textContent).toContain('Điểm bán hàng');
    expect(dialog()?.textContent).toContain('Dùng sao?');
    click(btn('Sao chép link', dialog()!));
    await flush();
    expect(state.copied[0]).toMatch(/\/san-pham\/tra-xanh\?ref=A$/);
  });

  it('bộ nội dung lỗi: có Thử lại', async () => {
    state.fail.add('get /affiliate/content-kit/tra-xanh');
    mount();
    await flush();
    await openFirstSection();
    await openItemMenu();
    click(btn('Bài đăng mẫu'));
    await flush();
    expect(dialog()?.textContent).toContain('mất mạng');
    expect(hasBtn('Thử lại')).toBe(true);
  });

  it('lý do giới thiệu: mở sheet, nhập, Lưu gửi ghi chú đã cắt khoảng trắng', async () => {
    mount();
    await flush();
    await openFirstSection();
    click(btn('Thêm lý do giới thiệu'));
    await flush();
    typeInto(inputByLabel('Lý do giới thiệu'), '  Dùng 3 tháng  ');
    click(btn('Lưu', dialog()!));
    await flush();
    expect(writes().map((c) => [c.method, c.path, c.body])).toEqual([['patch', '/storefront/me/items/i1', { note: 'Dùng 3 tháng' }]]);
    expect(text()).toContain('Đã lưu lý do giới thiệu');
  });

  it('lý do đã có thì hiện trong dấu ngoặc kép thay cho lời mời', async () => {
    state.sf = storefront({ collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item({ note: 'Rất thơm' })] }] });
    mount();
    await flush();
    await openFirstSection();
    expect(text()).toContain('“Rất thơm”');
    expect(text()).not.toContain('Thêm lý do giới thiệu');
  });

  it('bộ sưu tập combo hiện nhãn combo kèm % và bố cục', async () => {
    state.sf = storefront({ collections: [{ id: 'c1', title: 'Combo A', kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 12, sortOrder: 0, items: [item()] }] });
    mount();
    await flush();
    expect(text()).toContain('Combo -12% · 1 món');
  });

  it('đổi tên khối: chỉ đổi tên, PATCH chỉ gửi title, kể cả với combo', async () => {
    state.sf = storefront({ collections: [{ id: 'c1', title: 'Combo A', kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 12, sortOrder: 0, items: [item()] }] });
    mount();
    await flush();
    await openFirstSection();
    await openCollectionMenu();
    click(btn('Đổi tên khối'));
    await flush();
    expect(dialog()?.querySelectorAll('select').length).toBe(0);
    expect(dialog()?.querySelectorAll('input').length).toBe(1);
    expect(dialog()?.textContent).not.toContain('Giảm giá combo');
    expect(dialog()?.textContent).not.toContain('Bố cục');
    typeInto(dialog()!.querySelector('input'), '  Tên mới ');
    click(btn('Lưu', dialog()!));
    await flush();
    expect(writes().map((c) => [c.method, c.path, c.body])).toEqual([['patch', '/storefront/me/collections/c1', { title: 'Tên mới' }]]);
  });

  it('xoá khối phải xác nhận; Huỷ thì không gọi API', async () => {
    mount();
    await flush();
    await openFirstSection();
    await openCollectionMenu();
    click(btn('Xoá khối'));
    await flush();
    expect(dialog()?.textContent).toContain('Xoá khối này?');
    click(btn('Huỷ', dialog()!));
    await flush();
    expect(writes()).toEqual([]);
    await openCollectionMenu();
    click(btn('Xoá khối'));
    await flush();
    click(btn('Xoá khối', dialog()!));
    await flush();
    expect(writes().map((c) => [c.method, c.path])).toEqual([['delete', '/storefront/me/collections/c1']]);
  });

  it('thêm sản phẩm: chọn từ danh sách gợi ý gọi addItem vào đúng bộ sưu tập, có nhãn hoa hồng', async () => {
    mount();
    await flush();
    await openFirstSection();
    click(btn('Thêm sản phẩm'));
    await flush();
    expect(dialog()?.textContent).toContain('+12% hoa hồng');
    click(btn('Thêm Xà phòng'));
    await flush();
    expect(writes().map((c) => [c.method, c.path, c.body])).toEqual([['post', '/storefront/me/collections/c1/items', { productId: 'p2' }]]);
  });

  it('thêm sản phẩm: tìm kiếm gửi từ khoá lên API', async () => {
    mount();
    await flush();
    await openFirstSection();
    click(btn('Thêm sản phẩm'));
    await flush();
    typeInto(inputByLabel('Tìm sản phẩm'), 'xà');
    await flush();
    expect(state.calls.some((c) => c.path === '/storefront/me/products' && JSON.stringify(c.query) === JSON.stringify({ search: 'xà' }))).toBe(true);
  });

  it('thêm sản phẩm: không có kết quả thì hiện trạng thái rỗng', async () => {
    state.picker = [];
    mount();
    await flush();
    await openFirstSection();
    click(btn('Thêm sản phẩm'));
    await flush();
    expect(dialog()?.textContent).toContain('Không tìm thấy sản phẩm phù hợp');
  });

  it('thêm sản phẩm: lỗi báo ngay trong sheet', async () => {
    state.fail.add('post /storefront/me/collections/c1/items');
    mount();
    await flush();
    await openFirstSection();
    click(btn('Thêm sản phẩm'));
    await flush();
    click(btn('Thêm Xà phòng'));
    await flush();
    expect(dialog()?.textContent).toContain('mất mạng');
  });
});

describe('đăng gian hàng và xem trước', () => {
  it('"Gửi duyệt" gọi publish(true) rồi báo đã gửi', async () => {
    mount();
    await flush();
    click(btn('Gửi duyệt'));
    await flush();
    expect(writes().map((c) => [c.path, c.body])).toEqual([['/storefront/me/publish', { isPublished: true }]]);
    expect(text()).toContain('Đã gửi duyệt');
  });

  it('gian hàng đã duyệt từ trước (vừa gỡ đăng): nút "Đăng lại", không hứa duyệt', async () => {
    state.sf = storefront({ status: 'DRAFT', approved: true, needsApproval: false });
    mount();
    await flush();
    expect(hasBtn('Gửi duyệt')).toBe(false);
    click(btn('Đăng lại'));
    await flush();
    expect(writes().map((c) => [c.path, c.body])).toEqual([['/storefront/me/publish', { isPublished: true }]]);
    expect(text()).toContain('Đã đăng lại gian hàng');
  });

  it('cờ duyệt tắt, chưa từng duyệt: nút "Đăng gian hàng", không nhắc gửi duyệt', async () => {
    state.sf = storefront({ status: 'DRAFT', approved: false, needsApproval: false });
    mount();
    await flush();
    expect(hasBtn('Gửi duyệt')).toBe(false);
    click(btn('Đăng gian hàng'));
    await flush();
    expect(writes().map((c) => c.path)).toEqual(['/storefront/me/publish']);
  });

  it('chưa có sản phẩm: "Gửi duyệt" tắt kèm lời nhắc, không gọi API', async () => {
    state.sf = storefront({ collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [] }] });
    mount();
    await flush();
    expect(text()).toContain('Thêm ít nhất 1 sản phẩm để đăng gian hàng.');
    expect((btn('Gửi duyệt') as HTMLButtonElement).disabled).toBe(true);
  });

  it('có sản phẩm: không có lời nhắc', async () => {
    mount();
    await flush();
    expect(text()).not.toContain('Thêm ít nhất 1 sản phẩm');
  });

  it('xem trước khi còn nháp: báo cần đăng, không có liên kết', async () => {
    mount();
    await flush();
    expect(btn('Xem trước').tagName).toBe('BUTTON');
    click(btn('Xem trước'));
    await flush();
    expect(dialog()?.textContent).toContain('Gian hàng chưa gửi duyệt nên khách chưa thấy');
    expect(dialog()?.querySelector('[data-testid="storefront-preview"]')).not.toBeNull();
    expect(dialog()?.querySelectorAll('[data-testid="product-card"]').length).toBeGreaterThan(0);
  });

  it('xem trước khi đã đăng: liên kết tới /s/<slug>', async () => {
    state.sf = storefront({ isPublished: true });
    mount();
    await flush();
    expect(btn('Xem trước').getAttribute('href')).toBe('/s/shop-aff-1');
  });

  it('đã đăng: nhắc trang web cập nhật sau vài phút; còn nháp thì không', async () => {
    state.sf = storefront({ isPublished: true });
    mount();
    await flush();
    expect(text()).toContain('Gian hàng cập nhật sau vài phút');
    expect(text()).toContain('Đang hiển thị');
  });

  it('còn nháp: chưa có nút chia sẻ và không có Gỡ đăng', async () => {
    mount();
    await flush();
    expect(hasBtn('Chia sẻ gian hàng')).toBe(false);
    await openConfig();
    expect(hasBtn('Gỡ đăng gian hàng')).toBe(false);
    expect(text()).not.toContain('Khách mở link gian hàng sẽ không thấy gì');
    expect(text()).not.toContain('Gian hàng cập nhật sau vài phút');
  });

  it('gỡ đăng phải xác nhận; Huỷ thì không gọi API, xác nhận gọi publish(false)', async () => {
    state.sf = storefront({ isPublished: true });
    mount();
    await flush();
    expect(hasBtn('Gỡ đăng gian hàng')).toBe(false);
    await openConfig();
    expect(text()).toContain('Khách mở link gian hàng sẽ không thấy gì cho tới khi bạn đăng lại.');
    expect(btn('Gỡ đăng gian hàng').querySelector('svg')).not.toBeNull();
    click(btn('Gỡ đăng gian hàng'));
    await flush();
    expect(dialog()?.textContent).toContain('Gỡ đăng gian hàng này?');
    click(btn('Huỷ', dialog()!));
    await flush();
    expect(writes()).toEqual([]);
    await openConfig();
    click(btn('Gỡ đăng gian hàng'));
    await flush();
    click(btn('Gỡ đăng', dialog()!));
    await flush();
    expect(writes().map((c) => [c.path, c.body])).toEqual([['/storefront/me/publish', { isPublished: false }]]);
    expect(text()).toContain('Đã gỡ đăng gian hàng');
  });

  it('khách không thấy gian hàng (bị admin gỡ…): hiện lý do cho chủ; bình thường thì không', async () => {
    state.sf = storefront({ publicHiddenReason: 'Gian hàng đã bị gỡ' });
    const a = mount();
    await flush();
    expect(a.container.querySelector('[data-testid="hidden-reason"]')?.textContent).toBe('Gian hàng đã bị gỡ');
    a.unmount();
    state.sf = storefront({ isPublished: true, status: 'LIVE' });
    const b = mount();
    await flush();
    expect(b.container.querySelector('[data-testid="hidden-reason"]')).toBeNull();
  });
});

describe('chia sẻ', () => {
  beforeEach(() => {
    state.sf = storefront({ isPublished: true });
  });

  it('mở sheet chia sẻ: link /s/<slug> kèm mã giới thiệu của chủ, có QR và 3 bài mẫu', async () => {
    mount();
    await flush();
    click(btn('Chia sẻ gian hàng'));
    await flush();
    expect(dialog()?.textContent).toContain('/s/shop-aff-1?ref=SHOP-AFF-1');
    expect(dialog()?.textContent).toContain('Lời đăng gợi ý');
    click(btn('Sao chép link', dialog()!));
    await flush();
    expect(state.copied[0]).toMatch(/\/s\/shop-aff-1\?ref=SHOP-AFF-1$/);
    expect(dialog()?.textContent).toContain('Đã sao chép');
  });

  it('nút Chia sẻ đi qua cầu nối nền tảng với đường dẫn có mã giới thiệu', async () => {
    mount();
    await flush();
    click(btn('Chia sẻ gian hàng'));
    await flush();
    click(btn('Chia sẻ', dialog()!));
    await flush();
    expect(state.share).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cửa hàng Xanh', path: '/s/shop-aff-1?ref=SHOP-AFF-1' }));
  });

  it('chia sẻ thất bại: báo để CTV chép tay', async () => {
    state.share = vi.fn(async () => 'failed');
    mount();
    await flush();
    click(btn('Chia sẻ gian hàng'));
    await flush();
    click(btn('Chia sẻ', dialog()!));
    await flush();
    expect(dialog()?.textContent).toContain('thủ công');
  });

  it('không sao chép được: báo lỗi, không báo thành công', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
    mount();
    await flush();
    click(btn('Chia sẻ gian hàng'));
    await flush();
    click(btn('Sao chép link', dialog()!));
    await flush();
    expect(dialog()?.textContent).toContain('Không sao chép được');
    expect(dialog()?.textContent).not.toContain('Đã sao chép');
  });
});

describe('link subdomain theo cờ', () => {
  it('cờ tắt: chỉ /s/<slug>, cấu hình không có ô subdomain và không gửi subdomain', async () => {
    state.sf = storefront({ subdomain: 'brand1', subdomainEnabled: false });
    mount();
    await flush();
    expect(text()).toContain('/s/shop-aff-1');
    expect(text()).not.toContain('brand1.tubutree.com');
    click(btn('Cài đặt'));
    await flush();
    expect(dialog()?.textContent).not.toContain('Subdomain riêng');
    click(btn('Lưu cấu hình gian hàng'));
    await flush();
    expect(JSON.parse(JSON.stringify(writes()[0]!.body))).not.toHaveProperty('subdomain');
  });

  it('cờ bật: hiện link subdomain và ô nhập; đổi thì gửi giá trị viết thường', async () => {
    state.sf = storefront({ subdomain: 'brand1', subdomainEnabled: true });
    mount();
    await flush();
    expect(text()).toContain('brand1.tubutree.com');
    click(btn('Cài đặt'));
    await flush();
    typeInto(dialog()!.querySelectorAll('input')[1] as HTMLInputElement, 'Brand2');
    click(btn('Lưu cấu hình gian hàng'));
    await flush();
    expect(writes()[0]!.body).toMatchObject({ subdomain: 'brand2' });
  });

  it('cờ bật, subdomain đang lưu không đổi: không gửi lại subdomain', async () => {
    state.sf = storefront({ subdomain: 'brand1', subdomainEnabled: true });
    mount();
    await flush();
    click(btn('Cài đặt'));
    await flush();
    click(btn('Lưu cấu hình gian hàng'));
    await flush();
    expect(JSON.parse(JSON.stringify(writes()[0]!.body))).not.toHaveProperty('subdomain');
  });
});

describe('hồ sơ và cấu hình gian hàng', () => {
  it('"Thêm ảnh bìa" là nút (không còn chữ xanh như link mà không bấm được) và mở sheet hồ sơ (G6 #29)', async () => {
    mount();
    await flush();
    click(btn('Thêm ảnh bìa'));
    await flush();
    expect(dialog()?.textContent).toContain('Hồ sơ gian hàng');
  });

  it('chưa có ảnh bìa: lời mời thêm ảnh bìa; có ảnh thì không', async () => {
    const a = mount();
    await flush();
    expect(a.container.textContent).toContain('Thêm ảnh bìa');
    a.unmount();
    state.sf = storefront({ coverUrl: 'https://cdn.example/cover.jpg' });
    const b = mount();
    await flush();
    expect(b.container.textContent).not.toContain('Thêm ảnh bìa');
  });

  it('lưu hồ sơ gửi ảnh đại diện, ảnh bìa, lời nhắn: ô trống gửi chuỗi rỗng, lời nhắn cắt khoảng trắng', async () => {
    state.sf = storefront({ avatarUrl: 'https://cdn.example/a.jpg', coverUrl: 'https://cdn.example/c.jpg' });
    mount();
    await flush();
    click(btn('Sửa hồ sơ'));
    await flush();
    expect(dialog()?.textContent).toContain('Hồ sơ gian hàng');
    typeInto(dialog()!.querySelector('textarea'), '  Review thật  ');
    click(btn('Lưu hồ sơ'));
    await flush();
    expect(writes().map((c) => [c.method, c.path, c.body])).toEqual([
      ['patch', '/storefront/me', { avatarUrl: 'https://cdn.example/a.jpg', coverUrl: 'https://cdn.example/c.jpg', headerNote: 'Review thật' }],
    ]);
    expect(text()).toContain('Đã cập nhật hồ sơ gian hàng');
    expect(dialog()).toBeNull();
  });

  it('hồ sơ chưa đủ ba mục: nhắc nhiệm vụ; lỗi lưu báo trong sheet', async () => {
    state.fail.add('patch /storefront/me');
    state.sf = storefront({ headerNote: null });
    mount();
    await flush();
    click(btn('Sửa hồ sơ'));
    await flush();
    expect(dialog()?.textContent).toContain('hoàn thành nhiệm vụ');
    click(btn('Lưu hồ sơ'));
    await flush();
    expect(dialog()?.textContent).toContain('mất mạng');
  });

  it('cấu hình CTV: gửi màu mặc định xanh lá, không gửi tài khoản ngân hàng hay kho', async () => {
    mount();
    await flush();
    click(btn('Cài đặt'));
    await flush();
    expect(dialog()?.textContent).toContain('Khách luôn thanh toán cho Tubu Tree.');
    expect(dialog()?.textContent).not.toContain('Kho gửi hàng');
    click(btn('Lưu cấu hình gian hàng'));
    await flush();
    expect(writes()[0]!.body).toEqual({ title: 'Cửa hàng Xanh', themeColor: '#16a34a' });
    expect(text()).toContain('Đã lưu cấu hình gian hàng!');
  });

  it('cấu hình: chọn màu "Xanh dương" gửi #2563eb; màu đã lưu được chọn sẵn', async () => {
    state.sf = storefront({ themeColor: '#7c3aed' });
    mount();
    await flush();
    click(btn('Cài đặt'));
    await flush();
    expect(btn('Tím').getAttribute('aria-pressed')).toBe('true');
    click(btn('Xanh dương'));
    click(btn('Lưu cấu hình gian hàng'));
    await flush();
    expect(writes()[0]!.body).toMatchObject({ themeColor: '#2563eb' });
  });

  it('mỗi ô màu có vùng chạm >= 44px', async () => {
    mount();
    await flush();
    click(btn('Cài đặt'));
    await flush();
    for (const n of ['Xanh lá', 'Ngọc', 'Xanh dương', 'Tím', 'Đất nung']) {
      expect(btn(n).className).toContain('min-h-11');
      expect(btn(n).className).toContain('min-w-11');
    }
  });

  it('gian hàng tự giao (đối tác): có ô kho và SĐT kho; xoá trắng gửi chuỗi rỗng, giá trị được cắt khoảng trắng', async () => {
    state.sf = storefront({ type: 'MERCHANT', warehouseAddress: '1 Lê Lợi', warehouseCity: 'HCM', warehousePhone: '0912345678' });
    mount();
    await flush();
    click(btn('Cài đặt'));
    await flush();
    expect(dialog()?.textContent).toContain('Kho gửi hàng');
    expect(dialog()?.textContent).toContain('Tiền hàng của bạn được đối soát');
    typeInto(inputByLabel('Địa chỉ kho xuất hàng'), '');
    typeInto(inputByLabel('Hotline kho liên hệ'), ' 0988111222 ');
    click(btn('Lưu cấu hình gian hàng'));
    await flush();
    expect(writes()[0]!.body).toMatchObject({ warehouseAddress: '', warehouseCity: 'HCM', warehousePhone: '0988111222' });
  });

  it('CTV của đại lý (isPartner=true) có ô kho; isPartner=false thì không', async () => {
    state.sf = storefront({ isPartner: true });
    const a = mount();
    await flush();
    click(btn('Cài đặt'));
    await flush();
    expect(inputByLabel('Hotline kho liên hệ')).not.toBeNull();
    a.unmount();
    state.sf = storefront({ isPartner: false });
    mount();
    await flush();
    click(btn('Cài đặt'));
    await flush();
    expect(inputByLabel('Hotline kho liên hệ')).toBeNull();
  });

  it('tài khoản ngân hàng cũ: báo không dùng để thu tiền và cho gỡ (gửi chuỗi rỗng)', async () => {
    state.sf = storefront({ bankName: 'VCB', bankAccountNo: '0011223344' });
    mount();
    await flush();
    click(btn('Cài đặt'));
    await flush();
    expect(dialog()?.textContent).toContain('****3344');
    click(btn('Gỡ tài khoản đã lưu'));
    await flush();
    expect(writes()[0]!.body).toEqual({ bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' });
  });

  it('cấu hình: đóng rồi mở lại thì form về dữ liệu đã lưu', async () => {
    mount();
    await flush();
    click(btn('Cài đặt'));
    await flush();
    typeInto(dialog()!.querySelector('input'), 'Đã sửa');
    click(btn('Đóng', dialog()!));
    await flush();
    click(btn('Cài đặt'));
    await flush();
    expect(dialog()!.querySelector('input')!.value).toBe('Cửa hàng Xanh');
  });

  it('ô nhập trong cấu hình đều có tên truy cập', async () => {
    state.sf = storefront({ type: 'MERCHANT', subdomainEnabled: true });
    mount();
    await flush();
    click(btn('Cài đặt'));
    await flush();
    for (const el of Array.from(dialog()!.querySelectorAll('input'))) {
      const named = el.getAttribute('aria-label') || (el.id && dialog()!.querySelector(`label[for="${el.id}"]`));
      expect(named).toBeTruthy();
    }
  });

  it('lỗi lưu cấu hình: báo trong sheet, sheet vẫn mở', async () => {
    state.fail.add('patch /storefront/me');
    mount();
    await flush();
    click(btn('Cài đặt'));
    await flush();
    click(btn('Lưu cấu hình gian hàng'));
    await flush();
    expect(dialog()?.textContent).toContain('mất mạng');
  });
});

describe('thống kê và hành trình gian hàng', () => {
  const live = () => {
    state.sf = storefront({ isPublished: true, status: 'LIVE' });
  };
  const openQuests = async () => {
    click(document.querySelector('button[data-reward]'));
    await flush();
  };

  it('thống kê 30 ngày hiện đơn, doanh thu, hoa hồng; top sản phẩm gập sau nút "Theo sản phẩm"', async () => {
    live();
    mount();
    await flush();
    const s = document.querySelector('[aria-label="Thống kê 30 ngày"]')!.textContent!;
    expect(s).toContain('9');
    expect(s).toContain('Đơn 30 ngày');
    expect(s).toContain('1.250.000đ');
    expect(s).toContain('125.000đ');
    expect(s).not.toContain('4 món · 320.000đ');
    click(btn('Theo sản phẩm'));
    await flush();
    expect(document.querySelector('[aria-label="Thống kê 30 ngày"]')!.textContent).toContain('4 món · 320.000đ');
  });

  it('điện thoại: tiêu đề thẻ thống kê và "Bố cục gian hàng" 16px như Mini App', async () => {
    live();
    mount();
    await flush();
    const stats = document.querySelector('[aria-label="Thống kê 30 ngày"] h2')!;
    expect(stats.className).toContain('max-md:text-[length:var(--type-title-sm-size)]');
    const layout = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent === 'Bố cục gian hàng')!;
    expect(layout.className).toContain('max-md:text-[length:var(--type-title-sm-size)]');
  });

  it('chưa có đơn: nhắn chia sẻ link; thống kê lỗi thì ẩn khối, không vỡ trang', async () => {
    live();
    state.stats = { ...STATS, byProduct: [] };
    const a = mount();
    await flush();
    expect(a.container.textContent).toContain('Chưa có đơn nào qua gian hàng');
    a.unmount();
    state.fail.add('get /storefront/me/stats');
    const b = mount();
    await flush();
    expect(b.container.textContent).not.toContain('Thống kê 30 ngày');
    expect(b.container.textContent).toContain('Cửa hàng Xanh');
  });

  it('nhiệm vụ: cấp độ, tổng điểm, tiến độ; nhiệm vụ đã nhận có nhãn Đã nhận (trong sheet mở từ dải Hành trình)', async () => {
    mount();
    await flush();
    expect(dialog()).toBeNull();
    await openQuests();
    const q = dialog()!.textContent!;
    expect(q).toContain('1/5');
    expect(q).toContain('Đã nhận 4 điểm');
    expect(q).toContain('0/1');
    expect(q).toContain('Đã nhận');
    expect(dialog()!.querySelectorAll('[role="progressbar"]').length).toBe(3);
  });

  it('nhiệm vụ đã đạt: nút nhận thưởng gọi claim và báo số điểm', async () => {
    mount();
    await flush();
    await openQuests();
    click(btn('Nhận 2 điểm', dialog()!));
    await flush();
    expect(writes().map((c) => [c.method, c.path])).toEqual([['post', '/storefront/me/quests/Q1/claim']]);
    expect(text()).toContain('+2 điểm 🎉');
  });

  it('nhiệm vụ chưa đạt không có nút nhận; lỗi nhận thì báo lỗi', async () => {
    state.fail.add('post /storefront/me/quests/Q1/claim');
    mount();
    await flush();
    await openQuests();
    expect(Array.from(dialog()!.querySelectorAll('button')).filter((b) => b.textContent?.startsWith('Nhận '))).toHaveLength(1);
    click(btn('Nhận 2 điểm', dialog()!));
    await flush();
    expect(text()).toContain('mất mạng');
  });
});

describe('không vỡ ở màn hẹp', () => {
  it('khung trang không rộng cố định, thanh hành động dính đáy', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelector('main')?.className).toContain('max-w-frame');
    expect(container.innerHTML).not.toMatch(/min-w-\[\d{3,}px\]|w-\[\d{4,}px\]/);
    expect(container.querySelector('.sticky')).not.toBeNull();
  });
});

// Kiểu Mini App ở điện thoại (pages/storefront-builder.tsx): nút phụ nền nhạt không viền, ảnh bìa gradient, không nhãn bố cục, thẻ phẳng.
describe('kiểu Mini App ở điện thoại', () => {
  it('Sửa hồ sơ / Cài đặt nền xanh nhạt không viền', async () => {
    state.sf = storefront({ isPublished: true });
    mount();
    await flush();
    for (const name of ['Sửa hồ sơ', 'Cài đặt']) {
      expect(btn(name).className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
      expect(btn(name).className).toContain('max-md:border-0');
    }
  });

  it('ảnh bìa thiếu: gradient xanh nhạt, chữ "Thêm ảnh bìa" không đậm; ảnh bìa lấy từ dữ liệu được bọc url("...")', async () => {
    const a = mount();
    await flush();
    const cover = a.container.querySelector<HTMLElement>('[data-testid="profile-cover"]')!;
    expect(cover.className).toContain('max-md:bg-[linear-gradient(135deg,var(--sage-100),var(--forest-100))]');
    const addCover = btn('Thêm ảnh bìa');
    expect(addCover.className).toContain('tubu-hit-44');
    expect(addCover.className).not.toMatch(/font-(medium|semibold|bold)/);
    a.unmount();
    state.sf = storefront({ coverUrl: 'https://cdn.example/c.jpg");background:red;("' });
    const b = mount();
    await flush();
    const style = b.container.querySelector<HTMLElement>('[data-testid="profile-cover"]')!.getAttribute('style')!;
    expect(style).toContain('url("https://cdn.example/c.jpg%22);background:red;(%22")');
  });

  it('chip bố cục không hiện ở điện thoại; thanh dưới nền nhạt, không xuống dòng', async () => {
    state.sf = storefront({ isPublished: true });
    mount();
    await flush();
    const layout = Array.from(document.querySelectorAll('span')).find((s) => s.textContent === 'Lưới');
    if (layout) expect(layout.className).toContain('max-md:hidden');
    const preview = document.querySelector<HTMLElement>('a[href^="/s/"]')!;
    expect(preview.className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
    expect(btn('Chia sẻ gian hàng').className).toContain('max-md:whitespace-nowrap');
  });
});

describe('sắp xếp bằng nút lên/xuống', () => {
  const col = (id: string, title: string, items: unknown[]) => ({ id, title, kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items });
  const food = (id: string, name: string, over: Record<string, unknown> = {}) => item({ id, productId: `p-${id}`, product: { ...PRODUCT, id: `p-${id}`, name }, ...over });
  const setThree = (over: Record<string, unknown> = {}) => {
    state.sf = storefront({
      collections: [
        col('c1', 'Bộ một', [food('i1', 'Món một', over), food('i2', 'Món hai'), food('i3', 'Món ba')]),
        col('c2', 'Bộ hai', []),
      ],
    });
  };
  // Mũi tên chỉ có khi bật "Sắp xếp" ở trang chi tiết khối; tên món lấy từ hàng món, không lẫn với khung xem trước.
  const openSort = async () => {
    await openFirstSection();
    click(btn('Sắp xếp'));
    await flush();
  };
  const names = () => Array.from(document.querySelectorAll('[data-testid="item-name"]')).map((d) => d.textContent);
  const arrow = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const locked = (label: string) => arrow(label).getAttribute('aria-disabled') === 'true';

  it('"Đưa Món hai lên" gửi đúng thứ tự mới và danh sách đổi ngay, trước khi máy chủ trả lời', async () => {
    setThree();
    state.hold.add('post /storefront/me/collections/c1/items/reorder');
    mount();
    await flush();
    await openSort();
    expect(names()).toEqual(['Món một', 'Món hai', 'Món ba']);
    click(arrow('Đưa Món hai lên'));
    await flush();
    expect(writes().map((c) => [c.path, c.body])).toEqual([['/storefront/me/collections/c1/items/reorder', { orderedIds: ['i2', 'i1', 'i3'] }]]);
    expect(names()).toEqual(['Món hai', 'Món một', 'Món ba']);
  });

  it('bấm liên tiếp hai lần: yêu cầu thứ hai chỉ gửi khi yêu cầu thứ nhất xong, đã gồm bước đầu, và chỉ tải lại gian hàng một lần ở cuối', async () => {
    setThree();
    let release!: () => void;
    state.gates.set('post /storefront/me/collections/c1/items/reorder', new Promise<void>((resolve) => { release = resolve; }));
    mount();
    await flush();
    await openSort();
    click(arrow('Đưa Món hai lên'));
    await flush();
    click(arrow('Đưa Món ba lên'));
    await flush();
    expect(names()).toEqual(['Món hai', 'Món ba', 'Món một']);
    expect(writes().map((c) => c.body)).toEqual([{ orderedIds: ['i2', 'i1', 'i3'] }]);
    state.sf = storefront({
      collections: [
        col('c1', 'Bộ một', [food('i2', 'Món hai'), food('i3', 'Món ba'), food('i1', 'Món một')]),
        col('c2', 'Bộ hai', []),
      ],
    });
    release();
    await flush();
    await flush();
    expect(writes().map((c) => c.body)).toEqual([{ orderedIds: ['i2', 'i1', 'i3'] }, { orderedIds: ['i2', 'i3', 'i1'] }]);
    expect(calls('get', '/storefront/me')).toHaveLength(2);
    expect(names()).toEqual(['Món hai', 'Món ba', 'Món một']);
  });

  it('máy chủ từ chối: danh sách về thứ tự cũ, có báo lỗi, rồi tải lại để khớp máy chủ', async () => {
    setThree();
    state.fail.add('post /storefront/me/collections/c1/items/reorder');
    mount();
    await flush();
    await openSort();
    click(arrow('Đưa Món một xuống'));
    await flush();
    expect(text()).toContain('mất mạng');
    expect(names()).toEqual(['Món một', 'Món hai', 'Món ba']);
    await flush();
    expect(calls('get', '/storefront/me')).toHaveLength(2);
  });

  it('bấm hai lần liên tiếp và cả hai đều lỗi: cuối cùng tải lại gian hàng, màn khớp thứ tự trên máy chủ', async () => {
    setThree();
    let release!: () => void;
    state.gates.set('post /storefront/me/collections/c1/items/reorder', new Promise<void>((resolve) => { release = resolve; }));
    state.fail.add('post /storefront/me/collections/c1/items/reorder');
    mount();
    await flush();
    await openSort();
    click(arrow('Đưa Món hai lên'));
    await flush();
    click(arrow('Đưa Món ba lên'));
    await flush();
    expect(names()).toEqual(['Món hai', 'Món ba', 'Món một']);
    release();
    await flush();
    await flush();
    expect(writes()).toHaveLength(2);
    expect(calls('get', '/storefront/me')).toHaveLength(2);
    expect(names()).toEqual(['Món một', 'Món hai', 'Món ba']);
  });

  it('nút ở đầu danh sách khoá "lên", ở cuối khoá "xuống" (aria-disabled)', async () => {
    setThree();
    mount();
    await flush();
    await openSort();
    expect(locked('Đưa Món một lên')).toBe(true);
    expect(locked('Đưa Món hai lên')).toBe(false);
    expect(locked('Đưa Món ba xuống')).toBe(true);
    expect(locked('Đưa Món hai xuống')).toBe(false);
  });

  it('món ghim luôn nằm trên: món thường đầu tiên không đưa lên qua món ghim', async () => {
    setThree({ isPinned: true });
    mount();
    await flush();
    await openSort();
    expect(locked('Đưa Món hai lên')).toBe(true);
    expect(locked('Đưa Món một xuống')).toBe(true);
    expect(locked('Đưa Món ba lên')).toBe(false);
  });

  it('bộ sưu tập cũng sắp xếp được: "Đưa khối Bộ một xuống" gửi thứ tự bộ mới', async () => {
    setThree();
    state.hold.add('post /storefront/me/collections/reorder');
    mount();
    await flush();
    click(btn('Sắp xếp'));
    await flush();
    click(arrow('Đưa khối Bộ một xuống'));
    await flush();
    expect(writes().map((c) => [c.path, c.body])).toEqual([['/storefront/me/collections/reorder', { orderedIds: ['c2', 'c1'] }]]);
    expect(Array.from(document.querySelectorAll('[data-testid="section-sort-row"]')).map((r) => r.textContent)).toEqual(['Bộ hai', 'Bộ một']);
  });
});

describe('thứ tự trên màn chính: Thống kê, Hành trình, rồi các khối', () => {
  const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const strip = () => document.querySelector('button[data-reward]')!;
  const stats = () => Array.from(document.querySelectorAll('h2')).find((h) => h.textContent === 'Thống kê 30 ngày')!;
  const firstSection = () => document.querySelector('[data-testid="section-card"]')!;

  it('dải Hành trình đứng trước các khối dù đã nhận đủ hay chưa; gian hàng LIVE thì Thống kê đứng trước dải', async () => {
    const a = mount();
    await flush();
    expect(before(strip(), firstSection())).toBe(true);
    a.unmount();
    state.sf = storefront({ isPublished: true, status: 'LIVE' });
    state.quests = { ...QUESTS, level: 5, levelMax: 5, quests: QUESTS.quests.map((q) => ({ ...q, claimed: true })) };
    mount();
    await flush();
    expect(before(stats(), strip())).toBe(true);
    expect(before(strip(), firstSection())).toBe(true);
  });
});

describe('kiểu Mini App ở điện thoại: nút thêm sản phẩm, ô số liệu, thanh đáy bước 1', () => {
  it('"Thêm sản phẩm" là nút phụ nền xanh nhạt không viền như Mini App', async () => {
    mount();
    await flush();
    await openFirstSection();
    const add = btn('Thêm sản phẩm');
    expect(add.className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
    expect(add.className).toContain('max-md:border-0');
  });

  it('ô số liệu thống kê dùng nền nhạt của Mini App (bg-subtle), không phải nền be', async () => {
    state.sf = storefront({ isPublished: true, status: 'LIVE' });
    mount();
    await flush();
    const tile = Array.from(document.querySelectorAll('div')).find((d) => d.className.includes('bg-stone-100') && d.textContent?.endsWith('Đơn 30 ngày'));
    expect(tile?.className).toContain('max-md:bg-[var(--color-bg-subtle)]');
  });

  it('bước 1: thanh nút đáy ghim vào đáy màn hình ở điện thoại và chừa chỗ cuối trang', async () => {
    state.sfStatus = 404;
    mount();
    await flush();
    const bar = document.querySelector<HTMLElement>('[data-sticky-bar]')!;
    expect(bar.textContent).toContain('Bắt đầu mở gian hàng');
    expect(bar.className).toContain('max-md:fixed');
    expect(bar.className).toContain('max-md:inset-x-0');
    expect(bar.className).toContain('max-md:pb-[calc(16px+var(--safe-bottom))]');
    expect(document.body.classList.contains('has-sticky-bar')).toBe(true);
  });

  it('bước 1 khi chưa là CTV: lối đăng ký cũng nằm trong thanh đáy ghim', async () => {
    state.sfStatus = 404;
    state.me = { isAffiliate: false, canRegister: true };
    mount();
    await flush();
    const bar = document.querySelector<HTMLElement>('[data-sticky-bar]')!;
    expect(bar.querySelector('a[href="/ctv"]')).not.toBeNull();
    expect(bar.className).toContain('max-md:fixed');
    state.me = { isAffiliate: true, canRegister: true, canOpenStorefront: true };
  });

  it('rời trang thì gỡ chỗ chừa đáy khỏi body', async () => {
    state.sfStatus = 404;
    const r = mount();
    await flush();
    r.unmount();
    mounted.pop();
    expect(document.body.classList.contains('has-sticky-bar')).toBe(false);
  });
});


describe('màn dựng theo khối (P10)', () => {
  const food = (key: string, name: string, over: Record<string, unknown> = {}) =>
    item({ id: `i-${key}`, productId: `p-${key}`, product: { ...PRODUCT, id: `p-${key}`, name }, ...over });
  const foods = (prefix: string, n: number) => Array.from({ length: n }, (_, k) => food(`${prefix}${k + 1}`, `Món ${prefix}${k + 1}`));
  const section = (id: string, title: string, items: unknown[], over: Record<string, unknown> = {}) => ({
    id, title, kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items, ...over,
  });
  const setThree = () => {
    state.sf = storefront({
      collections: [
        section('c1', 'Bộ một', foods('a', 3)),
        section('c2', 'Bộ hai', foods('b', 2), { layout: 'CAROUSEL' }),
        section('c3', 'Bộ ba', foods('c', 3), { kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 10 }),
      ],
    });
  };
  const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
  const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
  const cardBtn = (prefix: string) => $(`[data-testid="section-card"] button[aria-label^="${prefix}"]`);
  const openCard = async (prefix: string) => {
    click(cardBtn(prefix));
    await flush();
  };
  const radio = (label: string) => $$('[role="radio"]').find((r) => r.textContent?.includes(label))!;
  /** Ô kiểu chỉ được gửi sau một nhịp (đổi ô liên tiếp thành một lần ghi): chờ qua nhịp đó rồi cho các promise chạy hết. */
  const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  const settleStyle = async () => { await wait(420); await flush(); };
  const frame = () => $('[data-testid="shop-section-preview"]');
  const moveStatus = () => $('[data-testid="move-status"]')?.textContent ?? '';
  const arrow = (name: string) => $(`button[aria-label="${name}"]`);

  describe('màn chính', () => {
    it('mỗi khối là một thẻ có kiểu và số món; không còn nút đưa lên/xuống hay ô tên ở cuối trang', async () => {
      setThree();
      mount();
      await flush();
      expect($$('[data-testid="section-card"]')).toHaveLength(3);
      expect(text()).toContain('Lưới · 3 món');
      expect(text()).toContain('Kệ ngang · 2 món');
      expect(text()).toContain('Combo -10% · 3 món');
      expect($$('button[aria-label^="Đưa "]')).toHaveLength(0);
      expect(inputByLabel('Tên bộ sưu tập')).toBeNull();
      expect(hasBtn('Thêm khối')).toBe(true);
    });

    it('bảy khối khách thấy: nhắc tab Shop chỉ hiện sáu khối đầu, khối thứ bảy ghi "Chỉ hiện ở tab Danh mục"', async () => {
      state.sf = storefront({ collections: Array.from({ length: 7 }, (_, k) => section(`s${k + 1}`, `Khối ${k + 1}`, foods(`s${k + 1}-`, 3))) });
      mount();
      await flush();
      expect(text()).toContain('Tab Shop hiện 6 khối đầu; từ khối thứ 7 trở đi chỉ hiện ở tab Danh mục.');
      expect(cardBtn('Khối 7,')?.getAttribute('aria-label')).toContain('Chỉ hiện ở tab Danh mục');
      expect(cardBtn('Khối 1,')?.getAttribute('aria-label')).not.toContain('Chỉ hiện ở tab Danh mục');
    });

    it('khối chưa có món khách thấy được hiện cảnh báo; chưa có khối nào thì có lời mời thêm khối', async () => {
      state.sf = storefront({ collections: [section('c1', 'Bộ trống', []), section('c2', 'Bộ ẩn hết', [food('h', 'Món ẩn', { isHidden: true })])] });
      const view = mount();
      await flush();
      expect(text().split('Chưa có món nào khách thấy được.').length - 1).toBe(2);
      view.unmount();
      state.sf = storefront({ collections: [] });
      mount();
      await flush();
      expect(text()).toContain('Chưa có khối nào. Thêm khối đầu tiên để khách có gì xem.');
    });
  });

  describe('thêm khối', () => {
    const openSheet = async () => {
      setThree();
      mount();
      await flush();
      click(btn('Thêm khối'));
      await flush();
    };
    const nameInput = () => inputByLabel('Tên khối') as HTMLInputElement;
    const pctInput = () => inputByLabel('Giảm khi mua cả bộ') as HTMLInputElement;
    const createBtn = () => btn('Tạo và thêm món') as HTMLButtonElement;
    const posts = () => calls('post', '/storefront/me/collections');
    const made = (over: Record<string, unknown> = {}) => section('c9', 'Mới', [], over);

    it('khối Combo gửi kind, layout và comboDiscountPct', async () => {
      state.created = made({ kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 15 });
      await openSheet();
      click(radio('Combo'));
      typeInto(nameInput(), '  Combo hè  ');
      typeInto(pctInput(), '15');
      click(createBtn());
      await flush();
      expect(posts().map((c) => c.body)).toEqual([{ title: 'Combo hè', kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 15 }]);
    });

    it('khối Lưới gửi kind NORMAL và layout GRID, không có comboDiscountPct', async () => {
      state.created = made();
      await openSheet();
      click(radio('Lưới'));
      typeInto(nameInput(), 'Bán chạy');
      click(createBtn());
      await flush();
      expect(posts().map((c) => c.body)).toEqual([{ title: 'Bán chạy', kind: 'NORMAL', layout: 'GRID' }]);
    });

    it('tên điền sẵn theo kiểu; gõ tên rồi đổi kiểu thì giữ tên đã gõ; xoá trống thì nút tắt', async () => {
      await openSheet();
      expect(nameInput().value).toBe('Gợi ý của mình');
      click(radio('Danh sách'));
      expect(nameInput().value).toBe('Ba món mình chọn');
      typeInto(nameInput(), 'Của riêng tôi');
      click(radio('Kệ ngang'));
      expect(nameInput().value).toBe('Của riêng tôi');
      typeInto(nameInput(), '   ');
      expect(createBtn().disabled).toBe(true);
      expect(posts()).toHaveLength(0);
    });

    it('chọn Combo mới hiện ô %; % không hợp lệ ("abc", "0", trống) thì nút tạo tắt; 99 gửi nguyên (trần là cấu hình của máy chủ)', async () => {
      state.created = made();
      await openSheet();
      expect(pctInput()).toBeNull();
      click(radio('Combo'));
      expect(pctInput().value).toBe('10');
      for (const bad of ['abc', '0', '']) {
        typeInto(pctInput(), bad);
        expect(createBtn().disabled).toBe(true);
      }
      typeInto(pctInput(), '99');
      click(createBtn());
      await flush();
      expect(posts()[0]?.body).toMatchObject({ kind: 'COMBO', comboDiscountPct: 99 });
    });

    it('máy chủ từ chối: tên còn nguyên, báo lỗi, sheet không đóng', async () => {
      state.fail.add('post /storefront/me/collections');
      await openSheet();
      typeInto(nameInput(), 'Bán chạy');
      click(createBtn());
      await flush();
      expect(nameInput().value).toBe('Bán chạy');
      expect(createBtn().disabled).toBe(false);
      expect($('[role="status"]')?.textContent || text()).toContain('mất mạng');
    });

    it('tạo Combo mà máy chủ hạ % xuống (trần 20): báo "Mức giảm tối đa hiện là 20%."; không hạ thì không báo', async () => {
      state.created = made({ kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 20 });
      await openSheet();
      click(radio('Combo'));
      typeInto(pctInput(), '50');
      click(createBtn());
      await flush();
      expect(posts()[0]?.body).toMatchObject({ comboDiscountPct: 50 });
      expect(text()).toContain('Mức giảm tối đa hiện là 20%.');
    });

    it('tạo Combo mà máy chủ giữ nguyên % đã gửi: không có cảnh báo', async () => {
      state.created = made({ kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 15 });
      await openSheet();
      click(radio('Combo'));
      typeInto(pctInput(), '15');
      click(createBtn());
      await flush();
      expect(posts()).toHaveLength(1);
      expect(text()).not.toContain('Mức giảm tối đa hiện là');
    });

    it('tạo xong: mở trang chi tiết của khối mới và bảng chọn sản phẩm của nó', async () => {
      state.created = made();
      await openSheet();
      typeInto(nameInput(), 'Mới');
      state.sf = storefront({ collections: [...(state.sf!.collections as unknown[]), made()] });
      click(createBtn());
      await flush();
      expect($('[data-testid="section-detail"] h2')?.textContent).toBe('Mới');
      expect(text()).toContain('Xà phòng');
    });
  });

  describe('trang chi tiết khối', () => {
    it('bấm thẻ mở trang chi tiết, focus vào tiêu đề khối; nút quay lại trả focus về đúng thẻ', async () => {
      setThree();
      mount();
      await flush();
      await openCard('Bộ hai,');
      const h = $('[data-testid="section-detail"] h2')!;
      expect(h.textContent).toBe('Bộ hai');
      expect($$('h1')).toHaveLength(1);
      expect(document.activeElement).toBe(h);
      click(btn('Gian hàng của tôi', $('[data-testid="section-detail"]')!));
      await flush();
      expect($$('[data-testid="section-card"]')).toHaveLength(3);
      expect(document.activeElement).toBe(cardBtn('Bộ hai,'));
    });

    it('nút lùi trong trang chi tiết chỉ hiện từ md (dưới md nút lùi nổi của app là lối lùi duy nhất, như Mini) (G6 #30)', async () => {
      setThree();
      mount();
      await flush();
      await openCard('Bộ hai,');
      const back = btn('Gian hàng của tôi', $('[data-testid="section-detail"]')!);
      expect(back.className).toContain('hidden');
      expect(back.className).toContain('md:inline-flex');
    });

    it('điện thoại: ở trang chi tiết dải tiêu đề của trang nhường chỗ (sr-only, vẫn một h1), danh sách giữ dải tiêu đề là con trực tiếp của khung', async () => {
      setThree();
      mount();
      await flush();
      const main = () => document.querySelector('main')!;
      expect(main().querySelector(':scope > header[data-page-bleed]')).not.toBeNull();
      expect(main().className).not.toContain('max-md:pt-0');
      await openCard('Bộ hai,');
      const wrapped = main().querySelector(':scope > div.max-md\\:sr-only > header[data-page-bleed]');
      expect(wrapped).not.toBeNull();
      expect(wrapped!.querySelector('h1')!.textContent).toBe('Gian hàng của tôi');
      expect(main().querySelector(':scope > header[data-page-bleed]')).toBeNull();
      expect(main().className).toContain('max-md:pt-0');
      expect($$('h1')).toHaveLength(1);
      click(btn('Gian hàng của tôi', $('[data-testid="section-detail"]')!));
      await flush();
      expect(main().querySelector(':scope > header[data-page-bleed]')).not.toBeNull();
    });

    it('?khoi= trỏ tới khối không còn: trình dựng vẽ danh sách nên dải tiêu đề của trang vẫn hiện', async () => {
      setThree();
      nav.to('/ctv/gian-hang?khoi=khong-con', true);
      mount();
      await flush();
      expect($$('[data-testid="section-card"]')).toHaveLength(3);
      expect(document.querySelector('main > header[data-page-bleed]')).not.toBeNull();
      expect(document.querySelector('main > div.max-md\\:sr-only')).toBeNull();
    });

    it('trang chi tiết: hàng đầu chỉ còn ⋯ ở phải dưới md (nút lùi nổi ở góc trái), từ md lùi và ⋯ hai đầu; nút Thêm sản phẩm rộng hết hàng ở điện thoại', async () => {
      setThree();
      mount();
      await flush();
      await openCard('Bộ hai,');
      const detail = $('[data-testid="section-detail"]')!;
      const back = btn('Gian hàng của tôi', detail);
      expect(back.parentElement!.className).toContain('justify-end');
      expect(back.parentElement!.className).toContain('md:justify-between');
      expect(back.parentElement!.className).not.toContain('52px');
      const add = btn('Thêm sản phẩm', detail);
      expect(add.className).toContain('w-full');
    });

    describe('lùi từ trang chi tiết (nút lùi nổi và nút lùi của trình duyệt)', () => {
      const mountWithBack = () => {
        const r = render(<><BackButton className="md:!hidden" /><StorefrontBuilderPage /></>);
        mounted.push(r);
        return r;
      };
      const here = () => `${nav.loc.path}${nav.loc.search}`;
      const floatingBack = () => document.querySelector<HTMLElement>('button[aria-label="Quay lại"]');
      const cards = () => $$('[data-testid="section-card"]');

      it('mở khối là thêm một mục lịch sử của trang (?khoi=); nút "Quay lại" nổi trả về danh sách khối, không rời màn dựng', async () => {
        setThree();
        mountWithBack();
        await flush();
        await openCard('Bộ hai,');
        expect(here()).toBe('/ctv/gian-hang?khoi=c2');
        expect(nav.stack).toHaveLength(2);
        click(floatingBack());
        await flush();
        expect(cards()).toHaveLength(3);
        expect($('[data-testid="section-detail"]')).toBeNull();
        expect(here()).toBe('/ctv/gian-hang');
        expect(document.activeElement).toBe(cardBtn('Bộ hai,'));
      });

      it('mở và đóng khối không dùng router.push/replace (soft navigation có thể tải RSC): địa chỉ đổi qua History API', async () => {
        setThree();
        mount();
        await flush();
        await openCard('Bộ hai,');
        expect(here()).toBe('/ctv/gian-hang?khoi=c2');
        expect($('[data-testid="section-detail"] h2')?.textContent).toBe('Bộ hai');
        click(btn('Gian hàng của tôi', $('[data-testid="section-detail"]')!));
        await flush();
        expect(cards()).toHaveLength(3);
        expect(nav.routerCalls).toEqual([]);
      });

      it('nút lùi của trình duyệt cũng về danh sách khối, tiến lại thì mở lại đúng khối đó', async () => {
        setThree();
        mount();
        await flush();
        await openCard('Bộ hai,');
        act(() => nav.api.back());
        await flush();
        expect(cards()).toHaveLength(3);
        expect(here()).toBe('/ctv/gian-hang');
        act(() => nav.api.forward());
        await flush();
        expect($('[data-testid="section-detail"] h2')?.textContent).toBe('Bộ hai');
      });

      it('"Gian hàng của tôi" trong trang lùi đúng một mục lịch sử (cùng chỗ với nút lùi nổi)', async () => {
        setThree();
        mount();
        await flush();
        await openCard('Bộ một,');
        click(btn('Gian hàng của tôi', $('[data-testid="section-detail"]')!));
        await flush();
        expect(cards()).toHaveLength(3);
        expect(nav.idx).toBe(0);
      });

      const stackUrls = () => nav.stack.map((l) => `${l.path}${l.search}`);

      it.each([
        ['nút "Quay lại" nổi', () => floatingBack()],
        ['"Gian hàng của tôi" trong trang', () => btn('Gian hàng của tôi', $('[data-testid="section-detail"]')!)],
      ])('mở thẳng bằng link ?khoi= (không có danh sách phía trước): dựng sẵn mục danh sách, %s cùng về danh sách', async (_name, target) => {
        setThree();
        nav.to('/ctv/gian-hang?khoi=c2', true);
        mountWithBack();
        await flush();
        expect($('[data-testid="section-detail"] h2')?.textContent).toBe('Bộ hai');
        expect(stackUrls()).toEqual(['/ctv/gian-hang', '/ctv/gian-hang?khoi=c2']);
        click(target());
        await flush();
        expect(cards()).toHaveLength(3);
        expect($('[data-testid="section-detail"]')).toBeNull();
        expect(here()).toBe('/ctv/gian-hang');
        expect(nav.idx).toBe(0);
        expect(nav.routerCalls).not.toContain('replace /ctv/gian-hang');
      });

      it('F5 ở trang chi tiết (mục lịch sử còn dấu của màn dựng): không dựng thêm mục, "Gian hàng của tôi" lùi một bước', async () => {
        setThree();
        nav.to('/ctv/gian-hang', true);
        nav.to('/ctv/gian-hang?khoi=c2', false, { builderSection: true });
        mount();
        await flush();
        expect($('[data-testid="section-detail"] h2')?.textContent).toBe('Bộ hai');
        expect(stackUrls()).toEqual(['/ctv/gian-hang', '/ctv/gian-hang?khoi=c2']);
        click(btn('Gian hàng của tôi', $('[data-testid="section-detail"]')!));
        await flush();
        expect(cards()).toHaveLength(3);
        expect(nav.idx).toBe(0);
        expect(nav.stack).toHaveLength(2);
      });

      it('khối đang mở bị xoá: về danh sách khối, không kẹt ở trang chi tiết trống', async () => {
        setThree();
        mount();
        await flush();
        await openCard('Bộ một,');
        await openCollectionMenu();
        click(btn('Xoá khối'));
        await flush();
        click(btn('Xoá khối', dialog()!));
        await flush();
        expect(writes().map((c) => [c.method, c.path])).toEqual([['delete', '/storefront/me/collections/c1']]);
        expect(cards()).toHaveLength(3);
        expect(here()).toBe('/ctv/gian-hang');
      });

      it('?khoi= trỏ tới khối không còn: hiện danh sách khối', async () => {
        setThree();
        nav.to('/ctv/gian-hang?khoi=khong-co', true);
        mount();
        await flush();
        expect(cards()).toHaveLength(3);
        // Không có trang chi tiết để dựng mục danh sách phía trước.
        expect(nav.stack).toHaveLength(1);
      });
    });

    it('menu của khối và tên gọi trong trang chi tiết đều nói "khối", không lẫn "bộ sưu tập"', async () => {
      setThree();
      mount();
      await flush();
      await openCard('Bộ một,');
      await openCollectionMenu();
      const labels = $$('button', dialog()!).map((b) => b.textContent?.trim()).filter(Boolean);
      expect(labels).toEqual(expect.arrayContaining(['Đổi tên khối', 'Xoá khối']));
      expect(labels.join('|')).not.toMatch(/bộ sưu tập/i);
      click(btn('Đổi tên khối'));
      await flush();
      expect(dialog()?.textContent).toContain('Tên khối');
      expect(dialog()?.textContent).not.toMatch(/bộ sưu tập/i);
    });

    it('khung xem trước ghi rõ là chỉ để xem (nút "Thêm cả combo" trong đó không bấm được)', async () => {
      setThree();
      mount();
      await flush();
      await openCard('Bộ ba,');
      expect(text()).toContain('Chỉ để xem, chưa bấm được.');
      expect(frame()!.hasAttribute('inert')).toBe(true);
    });

    it.each([
      ['GRID', 'NORMAL', 'shop-grid'],
      ['CAROUSEL', 'NORMAL', 'shop-rail'],
      ['STACK', 'NORMAL', 'shop-line'],
      ['CAROUSEL', 'COMBO', 'shop-combo'],
    ])('xem trước dựng bằng ShopSection thật: layout %s kind %s -> %s', async (layout, kind, testId) => {
      state.sf = storefront({ collections: [section('c1', 'Bộ một', foods('a', 3), { layout, kind, comboDiscountPct: kind === 'COMBO' ? 10 : null })] });
      mount();
      await flush();
      await openCard('Bộ một,');
      expect($(`[data-testid="${testId}"]`, frame()!)).not.toBeNull();
      expect(frame()!.hasAttribute('inert')).toBe(true);
    });

    it('xem trước không có món ẩn; khối chưa có món khách thấy thì không vẽ khung xem trước', async () => {
      state.sf = storefront({
        collections: [section('c1', 'Bộ một', [food('v', 'Món hiện'), food('h', 'Món ẩn', { isHidden: true })]), section('c2', 'Bộ trống', [])],
      });
      mount();
      await flush();
      await openCard('Bộ một,');
      expect(frame()!.textContent).toContain('Món hiện');
      expect(frame()!.textContent).not.toContain('Món ẩn');
      expect(text()).toContain('Món ẩn');
      click(btn('Gian hàng của tôi', $('[data-testid="section-detail"]')!));
      await flush();
      await openCard('Bộ trống,');
      expect(frame()).toBeNull();
      expect(text()).toContain('Chưa có món nào khách thấy được.');
    });

    it('đổi bố cục chỉ gửi layout; bộ chọn đổi ngay khi đang gửi', async () => {
      setThree();
      state.hold.add('patch /storefront/me/collections/c1');
      mount();
      await flush();
      await openCard('Bộ một,');
      expect(radio('Lưới').getAttribute('aria-checked')).toBe('true');
      click(radio('Danh sách'));
      expect(radio('Danh sách').getAttribute('aria-checked')).toBe('true');
      await settleStyle();
      expect(writes().map((c) => [c.method, c.path, c.body])).toEqual([['patch', '/storefront/me/collections/c1', { layout: 'STACK' }]]);
      expect(radio('Danh sách').getAttribute('aria-checked')).toBe('true');
      expect(radio('Lưới').getAttribute('aria-checked')).toBe('false');
    });

    it('đổi bố cục xong: xem trước theo dữ liệu máy chủ trả về', async () => {
      setThree();
      mount();
      await flush();
      await openCard('Bộ một,');
      expect($('[data-testid="shop-grid"]', frame()!)).not.toBeNull();
      state.sf = storefront({ collections: [section('c1', 'Bộ một', foods('a', 3), { layout: 'STACK' }), ...(state.sf!.collections as unknown[]).slice(1)] });
      click(radio('Danh sách'));
      await settleStyle();
      expect($('[data-testid="shop-line"]', frame()!)).not.toBeNull();
    });

    it('đổi bố cục bị từ chối: bộ chọn về ô cũ và báo lỗi', async () => {
      setThree();
      state.fail.add('patch /storefront/me/collections/c1');
      mount();
      await flush();
      await openCard('Bộ một,');
      click(radio('Kệ ngang'));
      await settleStyle();
      expect(radio('Lưới').getAttribute('aria-checked')).toBe('true');
      expect(text()).toContain('mất mạng');
    });

    describe('chọn kiểu bằng bàn phím (mũi tên đổi ô ngay mỗi lần bấm)', () => {
      const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

      it('Lưới → Danh sách → Kệ ngang: ô cuối hiện ngay nhưng chỉ có một lần ghi, gửi ô cuối', async () => {
        setThree();
        mount();
        await flush();
        await openCard('Bộ một,');
        key(radio('Lưới'), 'ArrowRight');
        key(radio('Danh sách'), 'ArrowRight');
        expect(radio('Kệ ngang').getAttribute('aria-checked')).toBe('true');
        expect(writes()).toHaveLength(0);
        await settleStyle();
        expect(writes().map((c) => [c.method, c.path, c.body])).toEqual([['patch', '/storefront/me/collections/c1', { layout: 'CAROUSEL' }]]);
        await wait(500);
        expect(writes()).toHaveLength(1);
      });

      it('đổi đi rồi về đúng ô đang lưu: không gửi gì', async () => {
        setThree();
        mount();
        await flush();
        await openCard('Bộ một,');
        key(radio('Lưới'), 'ArrowRight');
        key(radio('Danh sách'), 'ArrowLeft');
        expect(radio('Lưới').getAttribute('aria-checked')).toBe('true');
        await settleStyle();
        expect(writes()).toHaveLength(0);
        expect(radio('Lưới').getAttribute('aria-checked')).toBe('true');
      });

      it('lần ghi trước chưa xong thì lần chọn kế tiếp chờ, không gửi chồng; xong rồi mới gửi ô cuối', async () => {
        setThree();
        let release!: () => void;
        state.gates.set('patch /storefront/me/collections/c1', new Promise<void>((r) => { release = r; }));
        mount();
        await flush();
        await openCard('Bộ một,');
        click(radio('Danh sách'));
        await settleStyle();
        expect(writes()).toHaveLength(1);
        state.gates.delete('patch /storefront/me/collections/c1');
        click(radio('Kệ ngang'));
        await wait(700);
        expect(writes()).toHaveLength(1);
        expect(radio('Kệ ngang').getAttribute('aria-checked')).toBe('true');
        release();
        await wait(400);
        await flush();
        expect(writes().map((c) => c.body)).toEqual([{ layout: 'STACK' }, { layout: 'CAROUSEL' }]);
      });
    });

    it('khối Thường khoá ô Combo, khối Combo khoá ba ô còn lại; bấm ô khoá không gọi API', async () => {
      setThree();
      mount();
      await flush();
      await openCard('Bộ một,');
      expect(radio('Combo').getAttribute('aria-disabled')).toBe('true');
      expect(text()).toContain('Kiểu Combo chọn lúc tạo khối.');
      click(radio('Combo'));
      click(btn('Gian hàng của tôi', $('[data-testid="section-detail"]')!));
      await flush();
      await openCard('Bộ ba,');
      for (const n of ['Lưới', 'Kệ ngang', 'Danh sách']) expect(radio(n).getAttribute('aria-disabled')).toBe('true');
      expect(text()).toContain('Khối Combo giữ kiểu Combo; bạn chỉnh được mức giảm.');
      click(radio('Lưới'));
      await flush();
      expect(writes()).toHaveLength(0);
    });
  });

  describe('% giảm của khối Combo', () => {
    const pct = () => inputByLabel('Giảm khi mua cả bộ') as HTMLInputElement;
    const save = () => btn('Lưu mức giảm') as HTMLButtonElement;
    const open = async () => {
      setThree();
      mount();
      await flush();
      await openCard('Bộ ba,');
    };

    it('khối Thường không có ô %; khối Combo có ô điền sẵn mức hiện tại', async () => {
      await open();
      expect(pct().value).toBe('10');
      click(btn('Gian hàng của tôi', $('[data-testid="section-detail"]')!));
      await flush();
      await openCard('Bộ một,');
      expect(pct()).toBeNull();
    });

    it('"abc", trống, "0" tắt nút Lưu; số hợp lệ thì lưu chỉ gửi comboDiscountPct', async () => {
      state.patchResult = { id: 'c3', comboDiscountPct: 15 };
      await open();
      for (const bad of ['abc', '', '0']) {
        typeInto(pct(), bad);
        expect(save().disabled).toBe(true);
      }
      typeInto(pct(), '15');
      click(save());
      await flush();
      expect(writes().map((c) => [c.path, c.body])).toEqual([['/storefront/me/collections/c3', { comboDiscountPct: 15 }]]);
      expect(text()).toContain('Đã lưu mức giảm 15%.');
    });

    it('trần cấu hình do máy chủ giữ: nhập 35 gửi đúng 35 (không bị cắt về 30 ở máy khách) và báo đã lưu 35', async () => {
      state.patchResult = { id: 'c3', comboDiscountPct: 35 };
      await open();
      typeInto(pct(), '35');
      click(save());
      await flush();
      expect(writes()[0]?.body).toEqual({ comboDiscountPct: 35 });
      expect(text()).toContain('Đã lưu mức giảm 35%.');
    });

    it('dòng gợi ý không ghi số trần cố định; mức đang là 30 mà nhập 50 thì nút Lưu vẫn bấm được và máy chủ trả lời trần', async () => {
      state.sf = storefront({ collections: [section('c3', 'Bộ ba', foods('c', 3), { kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 30 })] });
      state.patchResult = { id: 'c3', comboDiscountPct: 30 };
      mount();
      await flush();
      await openCard('Bộ ba,');
      expect($('[data-testid="combo-pct-hint"]')!.textContent).not.toMatch(/\d/);
      typeInto(pct(), '50');
      expect(save().disabled).toBe(false);
      click(save());
      await flush();
      expect(writes()[0]?.body).toEqual({ comboDiscountPct: 50 });
      expect(text()).toContain('Mức giảm tối đa hiện là 30%.');
      expect(pct().value).toBe('30');
      expect($('[data-testid="combo-pct-hint"]')!.textContent).toBe('Mức giảm tối đa hiện là 30%.');
      expect($('[data-testid="combo-pct-hint"]')!.className).toContain('text-warning-fg');
    });

    it('đang lưu: nút báo bận và bấm lại không gửi lần hai, không có hai thông báo', async () => {
      let release!: () => void;
      state.gates.set('patch /storefront/me/collections/c3', new Promise<void>((r) => { release = r; }));
      state.patchResult = { id: 'c3', comboDiscountPct: 15 };
      await open();
      typeInto(pct(), '15');
      click(save());
      await flush();
      const busy = btn('Đang lưu…');
      expect(busy.getAttribute('aria-busy')).toBe('true');
      click(busy);
      click(busy);
      await flush();
      expect(writes()).toHaveLength(1);
      release();
      await flush();
      expect(save().getAttribute('aria-busy')).toBeNull();
      expect(text().split('Đã lưu mức giảm 15%.').length - 1).toBe(1);
    });

    it('máy chủ kẹp thấp hơn (trần 20): ô hiện 20 và báo mức tối đa', async () => {
      state.patchResult = { id: 'c3', comboDiscountPct: 20 };
      await open();
      typeInto(pct(), '25');
      click(save());
      await flush();
      expect(text()).toContain('Mức giảm tối đa hiện là 20%.');
      expect(pct().value).toBe('20');
    });
  });

  describe('chế độ Sắp xếp', () => {
    const detailWith = async (items: unknown[]) => {
      state.sf = storefront({ collections: [section('c1', 'Bộ một', items), section('c2', 'Bộ hai', [])] });
      mount();
      await flush();
      await openCard('Bộ một,');
    };
    const abc = () => [food('a', 'Món A'), food('b', 'Món B'), food('c', 'Món C')];
    const order = () => $$('[data-testid="item-name"]').map((e) => e.textContent);

    it('ngoài chế độ Sắp xếp không có mũi tên; bật lên thì mỗi món có hai nút mang tên món', async () => {
      await detailWith(abc());
      expect($$('button[aria-label^="Đưa "]')).toHaveLength(0);
      click(btn('Sắp xếp'));
      expect(arrow('Đưa Món B lên')).not.toBeNull();
      expect(arrow('Đưa Món B xuống')).not.toBeNull();
      expect(hasBtn('Xong')).toBe(true);
      click(btn('Xong'));
      expect($$('button[aria-label^="Đưa "]')).toHaveLength(0);
    });

    it('Sắp xếp ẩn khung xem trước (danh sách ↑↓ lên màn đầu); Xong thì khung hiện lại', async () => {
      await detailWith(abc());
      expect(frame()).not.toBeNull();
      click(btn('Sắp xếp'));
      expect(frame()).toBeNull();
      expect(arrow('Đưa Món B lên')).not.toBeNull();
      click(btn('Xong'));
      expect(frame()).not.toBeNull();
    });

    it('nút ↑ của món đầu là aria-disabled (không disabled), giữ focus, không gọi API và báo "đã ở đầu danh sách"', async () => {
      await detailWith(abc());
      click(btn('Sắp xếp'));
      const up = arrow('Đưa Món A lên') as HTMLButtonElement;
      expect(up.getAttribute('aria-disabled')).toBe('true');
      expect(up.disabled).toBe(false);
      up.focus();
      click(up);
      await flush();
      expect(writes()).toHaveLength(0);
      expect(document.activeElement).toBe(up);
      expect(moveStatus()).toBe('Món A đã ở đầu danh sách');
    });

    it('dời món xuống: gửi thứ tự mới, danh sách đổi ngay, báo vị trí mới, focus ở lại đúng nút', async () => {
      state.hold.add('post /storefront/me/collections/c1/items/reorder');
      await detailWith(abc());
      click(btn('Sắp xếp'));
      expect(order()).toEqual(['Món A', 'Món B', 'Món C']);
      (arrow('Đưa Món A xuống') as HTMLElement).focus();
      click(arrow('Đưa Món A xuống'));
      await flush();
      expect(writes().map((c) => [c.path, c.body])).toEqual([['/storefront/me/collections/c1/items/reorder', { orderedIds: ['i-b', 'i-a', 'i-c'] }]]);
      expect(order()).toEqual(['Món B', 'Món A', 'Món C']);
      expect(moveStatus()).toBe('Đã đưa Món A xuống vị trí 2/3');
      expect(document.activeElement).toBe(arrow('Đưa Món A xuống'));
    });

    it('món thường đứng ngay dưới món ghim: bấm ↑ không dời, báo "Món ghim luôn nằm trên món thường."', async () => {
      await detailWith([food('a', 'Món A', { isPinned: true }), food('b', 'Món B')]);
      click(btn('Sắp xếp'));
      const up = arrow('Đưa Món B lên')!;
      expect(up.getAttribute('aria-disabled')).toBe('true');
      click(up);
      await flush();
      expect(writes()).toHaveLength(0);
      expect(moveStatus()).toBe('Món ghim luôn nằm trên món thường.');
    });

    it('màn chính: Sắp xếp thu mỗi khối thành một dòng có ↑↓; dời khối gửi reorder và báo vị trí', async () => {
      setThree();
      state.hold.add('post /storefront/me/collections/reorder');
      mount();
      await flush();
      click(btn('Sắp xếp'));
      expect($$('[data-testid="section-card"]')).toHaveLength(0);
      expect(arrow('Đưa khối Bộ một lên')!.getAttribute('aria-disabled')).toBe('true');
      expect(arrow('Đưa khối Bộ ba xuống')!.getAttribute('aria-disabled')).toBe('true');
      click(arrow('Đưa khối Bộ một xuống'));
      await flush();
      expect(writes().map((c) => [c.path, c.body])).toEqual([['/storefront/me/collections/reorder', { orderedIds: ['c2', 'c1', 'c3'] }]]);
      expect(moveStatus()).toBe('Đã đưa Bộ một xuống vị trí 2/3');
      click(btn('Xong'));
      await flush();
      expect($$('[data-testid="section-card"]')).toHaveLength(3);
    });
  });

  describe('Hành trình và thống kê trên màn chính', () => {
    it('Hành trình là một dải nói thưởng đang chờ; bấm mở sheet có nhiệm vụ, nút nhận là nút phụ', async () => {
      mount();
      await flush();
      const strip = $('button[data-reward]')!;
      expect(strip.textContent).toContain('1 phần thưởng đang chờ · 2 điểm');
      expect(dialog()).toBeNull();
      expect(hasBtn('Nhận 2 điểm')).toBe(false);
      click(strip);
      await flush();
      const claim = btn('Nhận 2 điểm', dialog()!);
      expect(claim.className).not.toContain('bg-forest-600');
      click(claim);
      await flush();
      expect(calls('post', '/storefront/me/quests/Q1/claim')).toHaveLength(1);
    });

    it('LIVE: ba ô thống kê nằm trước khối đầu tiên; nháp thì không gọi API thống kê', async () => {
      state.sf = storefront({ isPublished: true, status: 'LIVE' });
      const view = mount();
      await flush();
      const orders = $$('*').find((e) => e.children.length === 0 && e.textContent === 'Đơn 30 ngày')!;
      const firstCard = $('[data-testid="section-card"]')!;
      expect(orders.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      view.unmount();
      state.calls = [];
      state.sf = storefront();
      mount();
      await flush();
      expect(calls('get', '/storefront/me/stats')).toHaveLength(0);
      expect(text()).not.toContain('Đơn 30 ngày');
    });
  });
});

describe('từ lg: máy tính (G6 #35, H3 #7)', () => {
  // Hai nút lên hàng tiêu đề do CSS quyết định (không còn useMediaQuery): giả `matchMedia` ở hai khổ phải cho cùng một cây DOM.
  const realMatchMedia = window.matchMedia;
  const wide = (on: boolean) => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({ matches: on && query.includes('1024'), media: query, addEventListener() {}, removeEventListener() {} }),
    });
  };
  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
  });
  const slot = () => document.querySelector('[data-testid="builder-head-actions"]')!;
  const names = (root: Element) => Array.from(root.querySelectorAll('button, a')).map((e) => e.textContent?.trim());

  for (const on of [false, true]) {
    it(`${on ? 'từ lg' : 'khổ nhỏ'}: thanh dính đáy (lg:hidden) và ô hàng tiêu đề (hidden lg:flex) đều có đúng hai nút ngay lần vẽ đầu, CSS chọn bản nhìn thấy`, async () => {
      wide(on);
      mount();
      await flush();
      const bar = document.querySelector('[data-testid="builder-bar"]')!;
      expect(bar.className.split(/\s+/)).toContain('lg:hidden');
      expect(slot().className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'lg:flex']));
      expect(slot().closest('header')?.querySelector('h1')?.textContent).toBe('Gian hàng của tôi');
      expect(names(slot())).toHaveLength(2);
      expect(names(slot())[0]).toBe('Xem trước');
      expect(names(bar)).toEqual(expect.arrayContaining(['Xem trước']));
    });
  }

  it('hàng tiêu đề của trang cao tối thiểu 44px từ lg ở mọi trạng thái (tải, dựng) nên nút tới không làm tiêu đề dịch xuống (H3 #7)', async () => {
    mount();
    expect(document.querySelector('header')!.className.split(/\s+/)).toContain('lg:min-h-11');
    await flush();
    expect(document.querySelector('header')!.className.split(/\s+/)).toContain('lg:min-h-11');
  });

  it('nút "Xem trước" ở hàng tiêu đề vẫn mở bản xem trước, nút ở thanh dính cũng vậy (cùng một handler)', async () => {
    mount();
    await flush();
    click(btn('Xem trước', slot() as HTMLElement));
    await flush();
    expect(dialog()?.textContent).toContain('Xem trước');
  });

  it('chi tiết khối từ lg: hai cột, khung "Khách sẽ thấy" nằm cột phải thay vì để trống', async () => {
    wide(true);
    mount();
    await flush();
    await openFirstSection();
    const detail = document.querySelector('[data-testid="section-detail"]')!;
    expect(detail.className).toContain('lg:grid');
    expect(detail.closest('.lg\\:max-w-2xl')).toBeNull();
    const preview = document.querySelector('[data-testid="shop-section-preview"]')!;
    expect(preview.closest('section')?.className).toContain('lg:col-start-2');
  });

  it('vào chi tiết khối thì ô hàng tiêu đề và thanh dính trống; quay lại danh sách, ô được dựng lại và có hai nút', async () => {
    mount();
    await flush();
    await openFirstSection();
    expect(slot().textContent).toBe('');
    expect(document.querySelector('[data-testid="builder-bar"]')).toBeNull();
    act(() => nav.api.back());
    await flush();
    expect(slot().isConnected).toBe(true);
    expect(names(slot())).toHaveLength(2);
    expect(document.querySelector('[data-testid="builder-bar"]')).not.toBeNull();
  });
});
