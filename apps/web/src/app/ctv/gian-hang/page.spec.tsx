// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, selectValue, type Rendered } from '@/test-utils/dom';

type Call = { method: string; path: string; body?: unknown; query?: unknown };

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  sf: null as Record<string, unknown> | null,
  sfStatus: 200,
  quests: null as unknown,
  stats: null as unknown,
  picker: [] as unknown[],
  categories: [] as unknown[],
  kit: null as unknown,
  fail: new Set<string>(),
  calls: [] as Call[],
  share: vi.fn(),
  copied: [] as string[],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { id: 'ctv1' } }) }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { share: (...a: unknown[]) => state.share(...a) } }));
vi.mock('@/components/account/cloudinary-upload', () => ({ uploadToCloudinary: async () => null }));

function httpError(status: number, message = 'lỗi máy chủ') {
  return Object.assign(new Error(message), { status });
}

vi.mock('@/lib/core-http', () => {
  const run = async (method: string, path: string, body?: unknown, opts?: { query?: unknown }) => {
    state.calls.push({ method, path, body, query: opts?.query });
    if (state.fail.has(`${method} ${path}`)) throw httpError(500, 'mất mạng');
    if (method === 'get') {
      if (path === '/storefront/me') {
        if (state.sfStatus !== 200) throw httpError(state.sfStatus, 'không có');
        return state.sf;
      }
      if (path === '/storefront/me/quests') return state.quests;
      if (path === '/storefront/me/stats') return state.stats;
      if (path === '/storefront/me/products') return state.picker;
      if (path === '/categories') return state.categories;
      if (path.startsWith('/affiliate/content-kit/')) return state.kit;
    }
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
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const inputByLabel = (label: string, root: ParentNode = document.body) => root.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
const text = () => document.body.textContent ?? '';

beforeEach(() => {
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
  state.calls = [];
  state.share = vi.fn(async () => 'shared');
  state.copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void state.copied.push(t) } });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
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
    expect(container.textContent).toContain('Nháp — chưa đăng');
    expect(container.querySelector('a[href="/ctv"]')).not.toBeNull();
  });
});

describe('tạo gian hàng và chọn mẫu', () => {
  beforeEach(() => {
    state.sfStatus = 404;
  });

  it('404: mời tạo gian hàng, một h1', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.textContent).toContain('Tạo gian hàng để chia sẻ sản phẩm bạn tâm đắc.');
  });

  it('chọn một mẫu: tạo gian hàng rồi áp mẫu đúng danh mục', async () => {
    mount();
    await flush();
    click(btn('Tạo gian hàng'));
    await flush();
    expect(text()).toContain('Bắt đầu nhanh với 1 mẫu có sẵn');
    click(btn('Dùng mẫu Nhà bếp'));
    await flush();
    expect(writes().map((c) => [c.method, c.path, c.body])).toEqual([
      ['post', '/storefront', undefined],
      ['post', '/storefront/me/apply-template', { categoryId: 'cat2' }],
    ]);
  });

  it('bỏ qua mẫu: chỉ tạo gian hàng trống, không áp mẫu', async () => {
    mount();
    await flush();
    click(btn('Tạo gian hàng'));
    await flush();
    click(btn('Bỏ qua, tự tạo gian hàng trống'));
    await flush();
    expect(writes().map((c) => c.path)).toEqual(['/storefront']);
  });

  it('lỗi khi tạo: báo ngay trong sheet', async () => {
    state.fail.add('post /storefront');
    mount();
    await flush();
    click(btn('Tạo gian hàng'));
    await flush();
    click(btn('Dùng mẫu Nhà bếp'));
    await flush();
    expect(dialog()?.textContent).toContain('mất mạng');
  });

  it('ô chọn mẫu là nút thật cao >= 44px', async () => {
    mount();
    await flush();
    click(btn('Tạo gian hàng'));
    await flush();
    const b = btn('Dùng mẫu Nhà bếp');
    expect(b.tagName).toBe('BUTTON');
    expect(b.className).toContain('min-h-11');
  });
});

describe('chỉnh gian hàng: sản phẩm và bộ sưu tập', () => {
  it('hiện tên sản phẩm, giá bán ưu tiên giá khuyến mãi và tên bộ sưu tập', async () => {
    mount();
    await flush();
    expect(text()).toContain('Bộ sưu tập A');
    expect(text()).toContain('Trà xanh');
    expect(text()).toContain('80.000đ');
    expect(text()).not.toContain('100.000đ');
  });

  it('món khách không thấy được đánh dấu kèm lý do; món bình thường không có nhãn', async () => {
    state.sf = storefront({
      collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item({ id: 'i1', hiddenReason: 'Sản phẩm chưa được duyệt' }), item({ id: 'i2', product: { ...PRODUCT, name: 'Xà phòng' } })] }],
    });
    mount();
    await flush();
    expect(text()).toContain('Khách không thấy: Sản phẩm chưa được duyệt');
    expect(text().match(/Khách không thấy/g)).toHaveLength(1);
  });

  it('ghim và ẩn gọi đúng API', async () => {
    mount();
    await flush();
    click(btn('Ghim lên đầu'));
    await flush();
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
    click(btn('Xoá khỏi bộ sưu tập'));
    await flush();
    expect(dialog()?.textContent).toContain('Xoá sản phẩm này khỏi gian hàng?');
    click(btn('Huỷ', dialog()!));
    await flush();
    expect(writes()).toEqual([]);
    click(btn('Xoá khỏi bộ sưu tập'));
    await flush();
    click(btn('Xoá', dialog()!));
    await flush();
    expect(writes().map((c) => [c.method, c.path])).toEqual([['delete', '/storefront/me/items/i1']]);
  });

  it('sản phẩm đã ghim hoặc đã ẩn đổi nhãn nút để hoàn tác', async () => {
    state.sf = storefront({ collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [item({ isPinned: true, isHidden: true })] }] });
    mount();
    await flush();
    expect(hasBtn('Bỏ ghim')).toBe(true);
    expect(hasBtn('Hiện sản phẩm')).toBe(true);
    expect(hasBtn('Ghim lên đầu')).toBe(false);
  });

  it('nút biểu tượng cao và rộng >= 44px', async () => {
    mount();
    await flush();
    for (const n of ['Ghim lên đầu', 'Ẩn sản phẩm', 'Xoá khỏi bộ sưu tập', 'Sửa bộ sưu tập', 'Xoá bộ sưu tập']) {
      expect(btn(n).className).toMatch(/h-11/);
      expect(btn(n).className).toMatch(/w-11/);
    }
  });

  it('lỗi ghim: báo lỗi trên trang', async () => {
    state.fail.add('patch /storefront/me/items/i1');
    mount();
    await flush();
    click(btn('Ghim lên đầu'));
    await flush();
    expect(text()).toContain('mất mạng');
  });

  it('"Nội dung" mở bộ nội dung bán hàng của đúng sản phẩm, link đổi sang trang sản phẩm web', async () => {
    mount();
    await flush();
    click(btn('Nội dung'));
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
    click(btn('Nội dung'));
    await flush();
    expect(dialog()?.textContent).toContain('mất mạng');
    expect(hasBtn('Thử lại')).toBe(true);
  });

  it('lý do giới thiệu: mở sheet, nhập, Lưu gửi ghi chú đã cắt khoảng trắng', async () => {
    mount();
    await flush();
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
    expect(text()).toContain('“Rất thơm”');
    expect(text()).not.toContain('Thêm lý do giới thiệu');
  });

  it('tạo bộ sưu tập cần tên; mặc định chỉ gửi {title} đã cắt khoảng trắng', async () => {
    mount();
    await flush();
    const create = btn('Tạo bộ sưu tập') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    typeInto(inputByLabel('Tên bộ sưu tập (khách sẽ thấy)'), '  Mới  ');
    expect((btn('Tạo bộ sưu tập') as HTMLButtonElement).disabled).toBe(false);
    click(btn('Tạo bộ sưu tập'));
    await flush();
    expect(writes().map((c) => [c.method, c.path, c.body])).toEqual([['post', '/storefront/me/collections', { title: 'Mới' }]]);
    expect((inputByLabel('Tên bộ sưu tập (khách sẽ thấy)') as HTMLInputElement).value).toBe('');
  });

  it('tạo bộ sưu tập combo: gửi kind, bố cục và % giảm; % ngoài 0..100 bị chặn', async () => {
    mount();
    await flush();
    typeInto(inputByLabel('Tên bộ sưu tập (khách sẽ thấy)'), 'Combo Tết');
    selectValue(document.querySelector('select'), 'COMBO');
    await flush();
    const pct = Array.from(document.querySelectorAll('input')).find((i) => i.closest('div')?.textContent?.includes('Giảm giá combo'))!;
    typeInto(pct, '150');
    expect((btn('Tạo bộ sưu tập') as HTMLButtonElement).disabled).toBe(true);
    expect(text()).toContain('Nhập số nguyên từ 0 đến 100.');
    typeInto(pct, '15');
    const layout = document.querySelectorAll('select')[1]!;
    selectValue(layout, 'CAROUSEL');
    click(btn('Tạo bộ sưu tập'));
    await flush();
    expect(writes().map((c) => c.body)).toEqual([{ title: 'Combo Tết', kind: 'COMBO', comboDiscountPct: 15, layout: 'CAROUSEL' }]);
  });

  it('bộ sưu tập combo hiện nhãn combo kèm % và bố cục', async () => {
    state.sf = storefront({ collections: [{ id: 'c1', title: 'Combo A', kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 12, sortOrder: 0, items: [item()] }] });
    mount();
    await flush();
    expect(text()).toContain('Combo giảm giá 12%');
    expect(text()).toContain('Cuộn ngang');
  });

  it('sửa bộ sưu tập thường: đổi tên và bố cục, không có ô % giảm', async () => {
    mount();
    await flush();
    click(btn('Sửa bộ sưu tập'));
    await flush();
    expect(dialog()?.textContent).not.toContain('Giảm giá combo');
    const name = dialog()!.querySelector('input')!;
    typeInto(name, '  Tên mới ');
    selectValue(dialog()!.querySelector('select'), 'STACK');
    click(btn('Lưu', dialog()!));
    await flush();
    expect(writes().map((c) => [c.method, c.path, c.body])).toEqual([['patch', '/storefront/me/collections/c1', { title: 'Tên mới', layout: 'STACK' }]]);
  });

  it('sửa bộ sưu tập combo: gửi cả % giảm; % sai thì khoá nút Lưu', async () => {
    state.sf = storefront({ collections: [{ id: 'c1', title: 'Combo A', kind: 'COMBO', layout: 'GRID', comboDiscountPct: 12, sortOrder: 0, items: [item()] }] });
    mount();
    await flush();
    click(btn('Sửa bộ sưu tập'));
    await flush();
    const pct = Array.from(dialog()!.querySelectorAll('input'))[1]!;
    expect(pct.value).toBe('12');
    typeInto(pct, 'abc');
    expect((btn('Lưu', dialog()!) as HTMLButtonElement).disabled).toBe(true);
    typeInto(pct, '20');
    click(btn('Lưu', dialog()!));
    await flush();
    expect(writes()[0]!.body).toEqual({ title: 'Combo A', layout: 'GRID', comboDiscountPct: 20 });
  });

  it('xoá bộ sưu tập phải xác nhận; Huỷ thì không gọi API', async () => {
    mount();
    await flush();
    click(btn('Xoá bộ sưu tập'));
    await flush();
    expect(dialog()?.textContent).toContain('Xoá bộ sưu tập này?');
    click(btn('Huỷ', dialog()!));
    await flush();
    expect(writes()).toEqual([]);
    click(btn('Xoá bộ sưu tập'));
    await flush();
    click(btn('Xoá bộ sưu tập', dialog()!));
    await flush();
    expect(writes().map((c) => [c.method, c.path])).toEqual([['delete', '/storefront/me/collections/c1']]);
  });

  it('thêm sản phẩm: chọn từ danh sách gợi ý gọi addItem vào đúng bộ sưu tập, có nhãn hoa hồng', async () => {
    mount();
    await flush();
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
    click(btn('Thêm sản phẩm'));
    await flush();
    expect(dialog()?.textContent).toContain('Không tìm thấy sản phẩm phù hợp');
  });

  it('thêm sản phẩm: lỗi báo ngay trong sheet', async () => {
    state.fail.add('post /storefront/me/collections/c1/items');
    mount();
    await flush();
    click(btn('Thêm sản phẩm'));
    await flush();
    click(btn('Thêm Xà phòng'));
    await flush();
    expect(dialog()?.textContent).toContain('mất mạng');
  });
});

describe('đăng gian hàng và xem trước', () => {
  it('"Lưu & Đăng" gọi publish(true) rồi báo đã đăng', async () => {
    mount();
    await flush();
    click(btn('Lưu & Đăng'));
    await flush();
    expect(writes().map((c) => [c.path, c.body])).toEqual([['/storefront/me/publish', { isPublished: true }]]);
    expect(text()).toContain('Đã đăng gian hàng');
  });

  it('chưa có sản phẩm: "Lưu & Đăng" tắt kèm lời nhắc, không gọi API', async () => {
    state.sf = storefront({ collections: [{ id: 'c1', title: 'A', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items: [] }] });
    mount();
    await flush();
    expect(text()).toContain('Thêm ít nhất 1 sản phẩm để đăng gian hàng.');
    expect((btn('Lưu & Đăng') as HTMLButtonElement).disabled).toBe(true);
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
    expect(text()).toContain('Gian hàng đang là nháp');
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
    expect(text()).toContain('Trang web cập nhật sau vài phút');
    expect(text()).toContain('Đang hiển thị');
  });

  it('còn nháp: chưa có nút chia sẻ và không có Gỡ đăng', async () => {
    mount();
    await flush();
    expect(hasBtn('Chia sẻ gian hàng')).toBe(false);
    expect(hasBtn('Gỡ đăng')).toBe(false);
    expect(text()).not.toContain('Trang web cập nhật sau vài phút');
  });

  it('gỡ đăng phải xác nhận; Huỷ thì không gọi API, xác nhận gọi publish(false)', async () => {
    state.sf = storefront({ isPublished: true });
    mount();
    await flush();
    click(btn('Gỡ đăng'));
    await flush();
    expect(dialog()?.textContent).toContain('Gỡ đăng gian hàng này?');
    click(btn('Huỷ', dialog()!));
    await flush();
    expect(writes()).toEqual([]);
    click(btn('Gỡ đăng'));
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
    state.sf = storefront();
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
    expect(dialog()?.textContent).toContain('Caption gợi ý');
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
    click(btn('Cấu hình'));
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
    click(btn('Cấu hình'));
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
    click(btn('Cấu hình'));
    await flush();
    click(btn('Lưu cấu hình gian hàng'));
    await flush();
    expect(JSON.parse(JSON.stringify(writes()[0]!.body))).not.toHaveProperty('subdomain');
  });
});

describe('hồ sơ và cấu hình gian hàng', () => {
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
    click(btn('Sửa hồ sơ gian hàng'));
    await flush();
    expect(dialog()?.textContent).toContain('hoàn thành nhiệm vụ');
    click(btn('Lưu hồ sơ'));
    await flush();
    expect(dialog()?.textContent).toContain('mất mạng');
  });

  it('cấu hình CTV: gửi màu mặc định xanh lá, không gửi tài khoản ngân hàng hay kho', async () => {
    mount();
    await flush();
    click(btn('Cấu hình'));
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
    click(btn('Cấu hình'));
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
    click(btn('Cấu hình'));
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
    click(btn('Cấu hình'));
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
    click(btn('Cấu hình'));
    await flush();
    expect(inputByLabel('Hotline kho liên hệ')).not.toBeNull();
    a.unmount();
    state.sf = storefront({ isPartner: false });
    mount();
    await flush();
    click(btn('Cấu hình'));
    await flush();
    expect(inputByLabel('Hotline kho liên hệ')).toBeNull();
  });

  it('tài khoản ngân hàng cũ: báo không dùng để thu tiền và cho gỡ (gửi chuỗi rỗng)', async () => {
    state.sf = storefront({ bankName: 'VCB', bankAccountNo: '0011223344' });
    mount();
    await flush();
    click(btn('Cấu hình'));
    await flush();
    expect(dialog()?.textContent).toContain('****3344');
    click(btn('Gỡ tài khoản đã lưu'));
    await flush();
    expect(writes()[0]!.body).toEqual({ bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' });
  });

  it('cấu hình: đóng rồi mở lại thì form về dữ liệu đã lưu', async () => {
    mount();
    await flush();
    click(btn('Cấu hình'));
    await flush();
    typeInto(dialog()!.querySelector('input'), 'Đã sửa');
    click(btn('Đóng', dialog()!));
    await flush();
    click(btn('Cấu hình'));
    await flush();
    expect(dialog()!.querySelector('input')!.value).toBe('Cửa hàng Xanh');
  });

  it('ô nhập trong cấu hình đều có tên truy cập', async () => {
    state.sf = storefront({ type: 'MERCHANT', subdomainEnabled: true });
    mount();
    await flush();
    click(btn('Cấu hình'));
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
    click(btn('Cấu hình'));
    await flush();
    click(btn('Lưu cấu hình gian hàng'));
    await flush();
    expect(dialog()?.textContent).toContain('mất mạng');
  });
});

describe('thống kê và hành trình gian hàng', () => {
  it('thống kê 30 ngày hiện đơn, doanh thu, hoa hồng và top sản phẩm', async () => {
    mount();
    await flush();
    const s = document.querySelector('[aria-label="Thống kê 30 ngày"]')!.textContent!;
    expect(s).toContain('9');
    expect(s).toContain('Đơn (7 ngày: 2)');
    expect(s).toContain('1.250.000đ');
    expect(s).toContain('125.000đ');
    expect(s).toContain('4 món · 320.000đ');
  });

  it('chưa có đơn: nhắn chia sẻ link; thống kê lỗi thì ẩn khối, không vỡ trang', async () => {
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

  it('nhiệm vụ: cấp độ, tổng điểm, tiến độ; nhiệm vụ đã nhận có nhãn Đã nhận', async () => {
    mount();
    await flush();
    const q = document.querySelector('[aria-label="Hành trình gian hàng"]')!.textContent!;
    expect(q).toContain('1/5');
    expect(q).toContain('Đã nhận 4 điểm');
    expect(q).toContain('0/1');
    expect(q).toContain('Đã nhận');
    expect(document.querySelectorAll('[role="progressbar"]').length).toBe(3);
  });

  it('nhiệm vụ đã đạt: nút nhận thưởng gọi claim và báo số điểm', async () => {
    mount();
    await flush();
    click(btn('+2 điểm'));
    await flush();
    expect(writes().map((c) => [c.method, c.path])).toEqual([['post', '/storefront/me/quests/Q1/claim']]);
    expect(text()).toContain('+2 điểm 🎉');
  });

  it('nhiệm vụ chưa đạt không có nút nhận; lỗi nhận thì báo lỗi', async () => {
    state.fail.add('post /storefront/me/quests/Q1/claim');
    mount();
    await flush();
    expect(document.querySelectorAll('[aria-label="Hành trình gian hàng"] button')).toHaveLength(1);
    click(btn('+2 điểm'));
    await flush();
    expect(text()).toContain('mất mạng');
  });
});

describe('không vỡ ở màn hẹp', () => {
  it('khung trang không rộng cố định, thanh hành động dính đáy', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelector('main')?.className).toContain('max-w-5xl');
    expect(container.innerHTML).not.toMatch(/min-w-\[\d{3,}px\]|w-\[\d{4,}px\]/);
    expect(container.querySelector('.sticky')).not.toBeNull();
  });
});
