// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// BUYERWEB-17: trang chi tiết chỉ hiện đúng một ảnh. BUYERWEB-16: thiếu JSON-LD Product, canonical, og:image đủ.

const api = vi.hoisted(() => ({
  product: null as unknown,
  flash: [] as unknown[],
  reviews: null as unknown,
  related: [] as unknown,
  together: [] as unknown,
  bundles: { combos: [], addons: [] } as unknown,
  serverFails: false,
  auth: { status: 'idle', initialized: true, sessionUnavailable: false, user: null } as Record<string, unknown>,
  coupons: [] as unknown[],
  config: { freeshipThreshold: 199000, subscribeDiscountPct: 0.12 } as unknown,
  compare: null as unknown,
  purchased: [] as unknown[],
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProduct: async () => api.product,
}));
vi.mock('@/components/add-to-cart', () => ({ default: () => <div data-testid="add-to-cart" /> }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (path === '/me/coupons') return api.coupons;
      if (path === '/me/purchased-items') return { items: api.purchased, nextCursor: null };
      return Promise.reject(new Error('offline'));
    },
    post: vi.fn(),
  },
}));
vi.mock('@/lib/core-http-server', () => ({
  createServerHttp: () => ({
    get: async (path: string) => {
      if (api.serverFails) throw new Error('API tạm lỗi');
      if (path.endsWith('/bundles')) return api.bundles;
      if (path === '/flash-sales/active') return api.flash;
      if (path === '/config/public') return api.config;
      // Cờ so sánh tắt: máy chủ trả 404.
      if (path.endsWith('/compare')) {
        if (!api.compare) throw new Error('404');
        return api.compare;
      }
      return path.endsWith('/related') ? api.related : api.together;
    },
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => api.flash, useRunningFlash: () => ({ flash: (api.flash as { endAt?: string }[]).filter((f) => !f.endAt || Date.parse(f.endAt) > Date.now()), now: Date.now() }), FlashSalesSeed: ({ children }: { children: unknown }) => children }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => api.auth }));
vi.mock('@/lib/use-welcome-offer', () => ({ useWelcomeOffer: () => null }));
vi.mock('@/lib/reviews-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reviews-client')>()),
  fetchProductReviews: async () => api.reviews,
  fetchCanReview: async () => {
    if (api.auth.status !== 'authenticated') throw new Error('khách chưa đăng nhập không hỏi can-review');
    return { canReview: false, reason: 'NOT_PURCHASED' };
  },
}));

import { PDP_BLOCK_ORDER } from '@tubutree/app-core/commerce/pdp-info';
import ProductPage, { generateMetadata } from './page';

const PRODUCT = {
  id: 'p1', slug: 'dau-goi-bo-ket', brand: 'Xanh Việt', name: 'Dầu gội bồ kết', shortDesc: 'Sạch dịu nhẹ',
  description: '<p>Thành phần</p><ul><li>Bồ kết</li><li>Gừng</li></ul>', images: ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg'],
  thumbnail: 'https://cdn/a.jpg', basePrice: 200000, salePrice: 150000, certifications: ['Hữu cơ'],
  variations: [{ id: 'v1', sku: 'DG-250', name: '250ml', retailPrice: 200000, salePrice: 150000, stock: 5 }],
  ratingAvg: 4.5, reviewCount: 8,
};

const COMPARE = {
  current: { productId: 'p1', slug: 'dau-goi-bo-ket', name: 'Dầu gội bồ kết', price: 150000, unitPrice: { per: '100ml', value: 60000 }, size: '250ml', keyIngredients: ['Bồ kết', 'Gừng'] },
  others: [
    { productId: 'p2', slug: 'dau-goi-buoi', name: 'Dầu gội bưởi', price: 120000, unitPrice: null, size: null, keyIngredients: [] },
    { productId: 'p3', slug: 'dau-goi-sa', name: 'Dầu gội sả', price: 150000, unitPrice: { per: '100ml', value: 50000 }, size: '300ml', keyIngredients: ['Sả'] },
  ],
};
const PURCHASED = {
  variationId: 'v1', productId: 'p1', slug: 'dau-goi-bo-ket', productName: 'Dầu gội bồ kết', variationName: '250ml', brand: 'Xanh Việt', thumbnail: null,
  price: 200000, salePrice: 150000, stock: 5, inStock: true, timesBought: 1, lastPurchasedAt: '2026-10-05T03:00:00.000Z',
};
const BUNDLE_END = new Date(Date.now() + 86_400_000).toISOString();
const BUNDLES_FOR_ORDER = {
  combos: [
    {
      id: 'c1', kind: 'BUNDLE_PCT', title: 'Combo gội xả', pct: 10, endAt: BUNDLE_END, anchorProductId: null,
      items: ['a', 'b'].map((id) => ({ productId: id, variationId: `v-${id}`, maxQty: 1, addonPrice: null, inStock: true, product: { id, slug: `sp-${id}`, brand: 'Tubu', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${id}` } })),
    },
  ],
  addons: [],
};

let mounted: Rendered[] = [];
const mount = async () => {
  const ui = await ProductPage({ params: Promise.resolve({ slug: 'dau-goi-bo-ket' }) });
  const r = render(ui);
  mounted.push(r);
  await flush();
  return r.container;
};

const REVIEWS = {
  average: 4.5,
  count: 2,
  videoCount: 0,
  distribution: { '5': 1, '4': 1 },
  items: [
    { id: 'r1', rating: 5, comment: 'Gội êm', images: [], videoUrl: null, createdAt: '2026-09-01T00:00:00.000Z', author: 'Lan', avatar: null, verifiedPurchase: true },
    { id: 'r2', rating: 4, comment: 'Thơm nhẹ', images: [], videoUrl: null, createdAt: '2026-08-01T00:00:00.000Z', author: 'Minh', avatar: null, verifiedPurchase: true },
  ],
};

beforeEach(() => {
  api.product = PRODUCT;
  api.flash = [];
  api.reviews = REVIEWS;
  api.related = [];
  api.together = [];
  api.bundles = { combos: [], addons: [] };
  api.serverFails = false;
  api.auth = { status: 'idle', initialized: true, sessionUnavailable: false, user: null };
  api.coupons = [];
  api.compare = null;
  api.purchased = [];
  api.config = { freeshipThreshold: 199000, subscribeDiscountPct: 0.12 };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/san-pham/[slug] — ghi "Đã xem gần đây"', () => {
  it('mở trang sản phẩm thì máy ghi mục đã xem (slug, tên, thumbnail); web trước đây không ghi nên dải Đã xem không bao giờ hiện', async () => {
    localStorage.clear();
    await mount();
    expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!)).toEqual([expect.objectContaining({ slug: 'dau-goi-bo-ket', name: 'Dầu gội bồ kết', thumbnail: 'https://cdn/a.jpg' })]);
  });

  it('không có thumbnail thì lưu ảnh đầu của images (như Mini App), không có ảnh nào thì null', async () => {
    localStorage.clear();
    api.product = { ...PRODUCT, thumbnail: null, images: ['https://cdn/first.jpg', 'https://cdn/b.jpg'] };
    await mount();
    expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!)[0].thumbnail).toBe('https://cdn/first.jpg');
    localStorage.clear();
    api.product = { ...PRODUCT, thumbnail: null, images: [] };
    await mount();
    expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!)[0].thumbnail).toBeNull();
  });
});

describe('/san-pham/[slug] — tên nhãn dẫn sang trang nhãn hàng (BUYERWEB-18)', () => {
  it('tên nhãn mở danh mục lọc theo nhãn như Mini App (brandBrowsePath), kể cả nhãn chưa có trang riêng', async () => {
    for (const brandSlug of ['xanh-viet', undefined]) {
      api.product = { ...PRODUCT, brandSlug };
      const c = await mount();
      const a = c.querySelector<HTMLAnchorElement>('a[aria-label="Xem sản phẩm thương hiệu Xanh Việt"]')!;
      expect(a.getAttribute('href')).toBe('/san-pham?brand=Xanh%20Vi%E1%BB%87t');
    }
  });
});

describe('/san-pham/[slug] — chip xuất xứ cạnh tên nhãn (PO B3)', () => {
  const originOf = (c: HTMLElement) => c.querySelector<HTMLAnchorElement>('[data-testid="pdp-origin-link"]');

  it('Pineboo: chip "Fuwa3e · Thanh Hóa" dẫn bản đồ Fuwa3e, nằm cùng nhóm với nhãn, vùng chạm 44px và có aria-label', async () => {
    api.product = { ...PRODUCT, brand: 'Pineboo', name: 'Xịt tràm cho bé Pineboo 150ml' };
    const c = await mount();
    const chip = originOf(c)!;
    expect(chip.textContent).toBe('Fuwa3e · Thanh Hóa');
    expect(chip.getAttribute('href')).toBe('/cau-chuyen?brand=fuwa3e');
    expect(chip.getAttribute('aria-label')).toBe('Xem xuất xứ Fuwa3e · Thanh Hóa trên bản đồ');
    expect(chip.className).toContain('min-h-11');
    expect(chip.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const brandLink = c.querySelector<HTMLAnchorElement>('a[aria-label="Xem sản phẩm thương hiệu Pineboo"]')!;
    expect(brandLink.parentElement).toBe(chip.parentElement);
    // Nhóm nhãn + chip tự xuống dòng (flex-wrap, min-w-0) nên cụm Tim/Chia sẻ không bị đẩy tràn ở 320px.
    expect(chip.parentElement!.className).toContain('flex-wrap');
    expect(chip.parentElement!.className).toContain('min-w-0');
    expect(chip.parentElement!.nextElementSibling!.className).toContain('flex-none');
  });

  it('nhãn có ghim riêng chỉ hiện tên tỉnh: Sokfarm → "Trà Vinh", Fuwa3e → "Thanh Hóa"', async () => {
    for (const [brand, label, id] of [['Sokfarm', 'Trà Vinh', 'sokfram'], ['Fuwa3e', 'Thanh Hóa', 'fuwa3e']] as const) {
      api.product = { ...PRODUCT, brand };
      const chip = originOf(await mount())!;
      expect(chip.textContent).toBe(label);
      expect(chip.getAttribute('href')).toBe(`/cau-chuyen?brand=${id}`);
    }
  });

  it('nhãn chưa có ghim hoặc vỏ "Tubu Tree" thì không có chip', async () => {
    for (const brand of ['Xanh Việt', 'Tubu Tree']) {
      api.product = { ...PRODUCT, brand };
      expect(originOf(await mount())).toBeNull();
    }
  });
});

describe('/san-pham/[slug] — kiểu Mini App ở điện thoại', () => {
  const PRODUCT_TUBU = { ...PRODUCT, brandSlug: 'xanh-viet', fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU' };

  it('"Chỉ còn N sản phẩm" nằm trong khối thông tin chính dưới Điểm Xanh (như Mini App), không nằm trong dải Phân loại; gian hàng tạm nghỉ thì không nhắc', async () => {
    api.product = { ...PRODUCT_TUBU, variations: [{ ...PRODUCT.variations[0]!, stock: 3 }] };
    const c = await mount();
    const note = c.querySelector('[data-testid="pdp-low-stock"]')!;
    expect(note.textContent).toBe('Chỉ còn 3 sản phẩm');
    expect(c.querySelector('[data-section="pdp-main"]')!.contains(note)).toBe(true);
    api.product = { ...PRODUCT_TUBU, fulfilment: 'MERCHANT', fulfiller: { kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: 'Gốm Minh An', shippingFee: null, freeShipFrom: null }, variations: [{ ...PRODUCT.variations[0]!, stock: 3 }] };
    expect((await mount()).querySelector('[data-testid="pdp-low-stock"]')).toBeNull();
  });

  it('trang hero: ảnh tràn mép, khối thông tin nền trắng có đệm, không đệm trang ở điện thoại', async () => {
    api.product = PRODUCT_TUBU;
    const c = await mount();
    expect(c.querySelector('main')!.className).toContain('max-md:px-0');
    expect(c.querySelector('[aria-roledescription="carousel"]')!.className).toContain('max-md:rounded-none');
    // Mỗi khối là một dải trắng riêng (nền canvas hở 8px giữa hai dải như Mini App), cột thông tin tự nó không tô nền.
    expect(c.querySelector('[data-testid="pdp-info"]')!.className).not.toContain('max-md:bg-');
    expect(c.querySelector('[data-section="pdp-main"]')!.className).toContain('max-md:bg-[var(--color-bg-surface)]');
  });

  it('chống tràn ngang ở điện thoại: lưới một cột minmax(0,1fr), cột thông tin min-w-0 (jsdom không đo layout, e2e 390px kiểm thật)', async () => {
    api.product = PRODUCT_TUBU;
    const c = await mount();
    const info = c.querySelector('[data-testid="pdp-info"]')!;
    expect(info.className.split(' ')).toContain('min-w-0');
    expect(info.parentElement!.className.split(' ')).toContain('grid-cols-1');
    expect(info.parentElement!.className).toContain('md:grid-cols-2');
  });

  it('hàng nhãn: chấm màu + tên + mũi tên, không gạch chân ở điện thoại; chia sẻ chỉ là biểu tượng', async () => {
    api.product = PRODUCT_TUBU;
    const c = await mount();
    const link = c.querySelector<HTMLAnchorElement>('a[aria-label="Xem sản phẩm thương hiệu Xanh Việt"]')!;
    expect(link.className).toContain('max-md:no-underline');
    expect(link.querySelector('[data-testid="brand-dot"]')).not.toBeNull();
    expect(link.querySelector('svg')).not.toBeNull();
    const share = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Chia sẻ')!;
    expect(share.querySelector('span')!.className).toContain('max-md:sr-only');
  });

  it('tên sản phẩm chữ UI 18px ở điện thoại, serif từ md', async () => {
    const c = await mount();
    expect(c.querySelector('h1')!.className).toContain('max-md:text-lg');
  });

  it('thứ tự như Mini App: giao hàng (khối shipping) → mô tả ngắn và chứng nhận cùng một dải lợi ích (benefits)', async () => {
    api.product = PRODUCT_TUBU;
    const c = await mount();
    const q = (t: string) => c.querySelector(`[data-testid="${t}"]`)!;
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(q('pdp-fulfiller'), q('pdp-short-desc'))).toBe(true);
    expect(before(q('pdp-short-desc'), q('pdp-certs'))).toBe(true);
    const benefits = c.querySelector('[data-pdp-block="benefits"]')!;
    expect(benefits.contains(q('pdp-short-desc'))).toBe(true);
    expect(benefits.contains(q('pdp-certs'))).toBe(true);
    expect(benefits.className).toContain('max-md:bg-[var(--color-bg-surface)]');
    expect(c.querySelector('[data-section="pdp-main"]')!.contains(q('pdp-short-desc'))).toBe(false);
    expect(q('pdp-fulfiller').className).toContain('max-md:font-semibold');
    expect(q('pdp-certs').firstElementChild!.className).toContain('max-md:border-0');
  });

  it('có dòng Điểm Xanh dưới giá như Mini App (nói chung khi chưa biết mốc tích điểm)', async () => {
    const c = await mount();
    expect(c.querySelector('[data-testid="pdp-points-earn"]')!.textContent).toBe('Nhận Điểm Xanh khi đơn giao thành công');
  });

  it('"Đã bán" dồn sang phải dòng giá ở điện thoại', async () => {
    api.product = { ...PRODUCT, sold: 12 };
    const c = await mount();
    const sold = Array.from(c.querySelectorAll('span')).find((s) => s.textContent === 'Đã bán 12')!;
    expect(sold.className).toContain('max-md:ml-auto');
  });
});

describe('/san-pham/[slug] — chia sẻ (D5-04)', () => {
  it('có nút Chia sẻ trỏ về đúng đường dẫn sản phẩm', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const c = await mount();
    const btn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Chia sẻ')!;
    click(btn);
    await flush();
    expect(share).toHaveBeenCalledWith({ title: 'Dầu gội bồ kết', text: 'Tubu Tree tặng khách mới mã giảm giá cho đơn đầu. Sạch dịu nhẹ', url: `${window.location.origin}/san-pham/dau-goi-bo-ket` });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
});

describe('/san-pham/[slug] — thư viện ảnh (BUYERWEB-17)', () => {
  it('hiện đủ ảnh sản phẩm: mỗi ảnh một slide, ảnh đầu tải sớm, còn lại tải lười', async () => {
    const c = await mount();
    const imgs = Array.from(c.querySelectorAll<HTMLImageElement>('[aria-roledescription="slide"] img'));
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg']);
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'lazy', 'lazy']);
    expect(imgs[0]!.alt).toBe('Dầu gội bồ kết — ảnh 1');
  });

  it('dải ảnh nhỏ chọn ảnh: bấm ảnh 3 thì đánh dấu đang chọn và đếm 3/3; mũi tên sau bị ẩn ở ảnh cuối', async () => {
    const c = await mount();
    expect(c.textContent).toContain('1/3');
    expect(c.querySelector<HTMLButtonElement>('button[aria-label="Ảnh trước"]')!.disabled).toBe(true);
    click(c.querySelector('button[aria-label="Xem ảnh 3"]'));
    expect(c.querySelector('button[aria-label="Xem ảnh 3"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(c.querySelector('button[aria-label="Xem ảnh 1"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(c.textContent).toContain('3/3');
    expect(c.querySelector<HTMLButtonElement>('button[aria-label="Ảnh sau"]')!.disabled).toBe(true);
    click(c.querySelector('button[aria-label="Ảnh trước"]'));
    expect(c.textContent).toContain('2/3');
  });

  it('chỉ có một ảnh: không có mũi tên, dải ảnh nhỏ hay bộ đếm', async () => {
    api.product = { ...PRODUCT, images: [] };
    const c = await mount();
    expect(c.querySelectorAll('[aria-roledescription="slide"] img')).toHaveLength(1);
    expect(c.querySelector('button[aria-label="Ảnh sau"]')).toBeNull();
    expect(c.querySelector('ul[aria-label="Chọn ảnh"]')).toBeNull();
  });

  it('không có ảnh nào: hiện biểu tượng lá thay vì ảnh vỡ', async () => {
    api.product = { ...PRODUCT, images: [], thumbnail: null };
    const c = await mount();
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('svg')).not.toBeNull();
  });

  it('ảnh hỏng (404 từ host đối tác) được thay bằng biểu tượng lá, các ảnh khác vẫn xem được', async () => {
    const c = await mount();
    const first = c.querySelector<HTMLImageElement>('[aria-roledescription="slide"] img')!;
    const { act } = await import('react');
    act(() => {
      first.dispatchEvent(new Event('error'));
    });
    expect(c.querySelectorAll('[aria-roledescription="slide"] img')).toHaveLength(2);
  });

  it('mô tả HTML của đối tác vẽ thành đoạn và danh sách thật, không lộ thẻ thành chữ', async () => {
    const c = await mount();
    const section = c.querySelector('[data-pdp-block="description"]')!;
    expect(section.querySelector('h2')!.textContent).toBe('Mô tả sản phẩm');
    expect(section.textContent).toContain('Thành phần');
    expect(Array.from(section.querySelectorAll('ul li')).map((li) => li.textContent)).toEqual(['Bồ kết', 'Gừng']);
    expect(section.textContent).not.toMatch(/<\/?[a-z]+/i);
  });

  it('page renders SSR description text and ingredients even when story present', async () => {
    api.product = {
      ...PRODUCT,
      ingredients: [{ name: 'Bồ kết', percentage: '12%', benefit: 'Sạch dịu' }],
      storyConfig: {
        version: 1,
        enabled: true,
        scenes: [{ kind: 'hud_callouts', closing: 'An lành', points: [{ id: 'p1', xPct: 40, yPct: 40, label: 'Bồ kết', side: 'left' }] }],
      },
    };
    const c = await mount();
    expect(c.querySelector('[data-testid="product-story"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="pdp-story-open"]')).toBeNull();
    const section = c.querySelector('[data-pdp-block="description"]')!;
    expect(section.textContent).toContain('Bồ kết');
    expect(c.textContent).toContain('Sạch dịu');
  });

  it('dải câu chuyện: một bản duy nhất ở phần dưới, sau Thành phần và trước Mô tả; không nằm ở cột thông tin', async () => {
    api.product = {
      ...PRODUCT,
      ingredients: [{ name: 'Bồ kết', percentage: '12%', benefit: 'Sạch dịu' }],
      storyConfig: {
        version: 1,
        enabled: true,
        scenes: [{ kind: 'hud_callouts', closing: 'An lành', points: [{ id: 'p1', xPct: 40, yPct: 40, label: 'Bồ kết', side: 'left' }] }],
      },
    };
    const c = await mount();
    const all = c.querySelectorAll('[data-pdp-block="story"]');
    expect(all).toHaveLength(1);
    const story = all[0]!;
    expect(c.querySelector('[data-testid="pdp-info"]')!.contains(story)).toBe(false);
    const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(c.querySelector('[data-pdp-block="ingredients"]')!, story)).toBe(true);
    expect(after(story, c.querySelector('[data-pdp-block="description"]')!)).toBe(true);
  });

  it('không có câu chuyện riêng đang bật: không có khối câu chuyện (kịch bản mẫu chỉ lặp Thành phần)', async () => {
    api.product = { ...PRODUCT, ingredients: [{ name: 'Bồ kết', percentage: '12%', benefit: 'Sạch dịu' }] };
    const c = await mount();
    expect(c.querySelector('[data-pdp-block="story"]')).toBeNull();
    expect(c.querySelector('[data-testid="product-story"]')).toBeNull();
  });

  it('truy cập: một h1, nút có tên, vùng chạm đủ 44px', async () => {
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});

// R8: trang sản phẩm web có khối đánh giá (danh sách công khai và lối viết đánh giá) như Mini App.
describe('/san-pham/[slug] — khối đánh giá (R8)', () => {
  it('hiện số đánh giá, điểm trung bình và 2 đánh giá chọn sẵn; khách chưa đăng nhập không có nút "Viết đánh giá" (chỉ khách có lần mua đánh giá được)', async () => {
    const c = await mount();
    const section = c.querySelector('section#danh-gia')!;
    expect(section.getAttribute('data-pdp-block')).toBe('reviews');
    expect(section.querySelector('h2')?.textContent).toBe('Đánh giá (2)');
    expect(section.textContent).toContain('4,5');
    expect(section.textContent).toContain('Gội êm');
    expect(section.textContent).toContain('Thơm nhẹ');
    expect(section.querySelector('[data-testid="review-write"]')).toBeNull();
    expect(Array.from(section.querySelectorAll('a, button')).some((el) => el.textContent === 'Viết đánh giá')).toBe(false);
  });

  it('chưa có đánh giá nào: khối chỉ còn tiêu đề và một dòng, không hình minh hoạ, không nút', async () => {
    api.reviews = { ...REVIEWS, average: 0, count: 0, distribution: {}, items: [] };
    const c = await mount();
    const section = c.querySelector('[data-pdp-block="reviews"]')!;
    expect(section.querySelector('h2')!.textContent).toBe('Đánh giá');
    expect(section.querySelector('[data-testid="pdp-reviews-empty"]')!.textContent).toBe('Chưa có đánh giá');
    expect(section.querySelectorAll('button, a, img, svg')).toHaveLength(0);
  });

  it('nhiều đánh giá: tóm tắt + chip lọc + 2 đánh giá chọn sẵn + "Xem thêm đánh giá" mở danh sách đầy đủ; không còn khối "Đánh giá nhanh" riêng', async () => {
    api.reviews = { ...REVIEWS, count: 5 };
    const c = await mount();
    await flush();
    expect(c.querySelector('section[aria-label="Đánh giá nhanh"]')).toBeNull();
    expect(c.querySelectorAll('[data-testid="quick-review"]')).toHaveLength(0);
    const section = c.querySelector('[data-pdp-block="reviews"]')!;
    expect(section.querySelectorAll('[data-testid="review-picked"] li')).toHaveLength(2);
    expect(section.querySelector('[role="group"][aria-label="Lọc đánh giá"]')).not.toBeNull();
    click(section.querySelector('[data-testid="reviews-more"]'));
    await flush();
    expect(section.querySelector('[data-testid="reviews-more"]')).toBeNull();
    const chips = section.querySelector('[role="group"][aria-label="Lọc đánh giá"]')!;
    expect(chips).not.toBeNull();
    expect(document.activeElement).toBe(chips);
  });
});

describe('/san-pham/[slug] — SEO (BUYERWEB-16)', () => {
  it('nhúng JSON-LD Product đọc được: tên, giá VND, tồn kho, ảnh, đánh giá', async () => {
    const c = await mount();
    const script = c.querySelector('script[type="application/ld+json"]')!;
    const ld = JSON.parse(script.textContent ?? '');
    expect(ld['@type']).toBe('Product');
    expect(ld.name).toBe('Dầu gội bồ kết');
    expect(ld.url).toBe('https://app.tubutree.com/san-pham/dau-goi-bo-ket');
    expect(ld.image).toEqual(['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg']);
    expect(ld.offers).toMatchObject({ priceCurrency: 'VND', price: 150000, availability: 'https://schema.org/InStock' });
    expect(ld.aggregateRating).toEqual({ '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 8, bestRating: 5, worstRating: 1 });
  });

  it('JSON-LD không thể bị phá bằng tên sản phẩm chứa </script>', async () => {
    api.product = { ...PRODUCT, name: 'X</script><script>alert(1)</script>' };
    const c = await mount();
    expect(c.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(2);
    expect(c.querySelectorAll('script:not([type])')).toHaveLength(0);
    expect(JSON.parse(c.querySelector('script[type="application/ld+json"]')!.textContent ?? '').name).toContain('</script>');
  });

  it('generateMetadata: canonical không kèm tham số, og:image tối đa 4 ảnh, twitter card lớn, mô tả sạch HTML', async () => {
    api.product = { ...PRODUCT, images: Array.from({ length: 6 }, (_, i) => `https://cdn/${i}.jpg`), shortDesc: '<b>Sạch</b> dịu nhẹ' };
    const m = await generateMetadata({ params: Promise.resolve({ slug: 'dau-goi-bo-ket' }) });
    expect(m.alternates?.canonical).toBe('/san-pham/dau-goi-bo-ket');
    expect(m.description).toBe('Sạch dịu nhẹ');
    const og = m.openGraph as { images: string[]; url: string; siteName: string };
    expect(og.images).toHaveLength(4);
    expect(og.images[0]).toBe('https://cdn/a.jpg');
    expect(m.title).toBe('Dầu gội bồ kết — Xanh Việt');
    expect(og.url).toBe('/san-pham/dau-goi-bo-ket');
    expect(og.siteName).toBe('Tubu Tree');
    expect((m.twitter as { card: string }).card).toBe('summary_large_image');
  });

  it('không có ảnh: og:image và twitter dùng ảnh mặc định của site (thẻ chia sẻ không trống)', async () => {
    api.product = { ...PRODUCT, images: [], thumbnail: null };
    const m = await generateMetadata({ params: Promise.resolve({ slug: 'x' }) });
    expect((m.openGraph as { images: { url: string }[] }).images).toEqual([expect.objectContaining({ url: '/opengraph-image.png' })]);
    expect((m.twitter as { card: string; images: string[] }).card).toBe('summary_large_image');
    expect((m.twitter as { images: string[] }).images).toEqual(['/opengraph-image.png']);
  });

  it('nhãn Tubu Tree không lặp trong <title>; thiếu mô tả thì dựng từ tên + nhãn (luôn có meta description)', async () => {
    api.product = { ...PRODUCT, brand: 'Tubu Tree', name: 'Xịt tràm cho bé Pineboo 150ml', shortDesc: '', description: '' };
    const m = await generateMetadata({ params: Promise.resolve({ slug: 'x' }) });
    expect(m.title).toBe('Xịt tràm cho bé Pineboo 150ml');
    expect((m.openGraph as { title: string }).title).toBe('Xịt tràm cho bé Pineboo 150ml — Tubu Tree');
    expect(m.description).toBe('Xịt tràm cho bé Pineboo 150ml — sản phẩm thiên nhiên tại Tubu Tree.');
  });

  it('có BreadcrumbList JSON-LD khớp vệt breadcrumb hiển thị (Trang chủ › nhãn › sản phẩm), URL tuyệt đối', async () => {
    api.product = PRODUCT;
    const c = await mount();
    const lds = Array.from(c.querySelectorAll('script[type="application/ld+json"]')).map((s) => JSON.parse(s.textContent!));
    const crumbs = lds.find((d) => d['@type'] === 'BreadcrumbList');
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Trang chủ', PRODUCT.brand, PRODUCT.name]);
    expect(crumbs.itemListElement.every((i: { item: string }) => i.item.startsWith('https://'))).toBe(true);
  });

  it('sản phẩm không tồn tại: tiêu đề "Không tìm thấy", không canonical', async () => {
    api.product = null;
    const m = await generateMetadata({ params: Promise.resolve({ slug: 'x' }) });
    expect(m.title).toContain('Không tìm thấy');
    expect(m.alternates).toBeUndefined();
  });
});

describe('/san-pham/[slug] — ai giao hàng (R2-MERCHANT-7, R2-BUYERWEB-10)', () => {
  it('hàng gian hàng tự giao: tên gian hàng hiện tại, phí giao riêng, ngưỡng miễn phí và giới hạn thanh toán', async () => {
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'MERCHANT', name: 'Gốm Minh An', shippingFee: 30000, freeShipFrom: 500000 } };
    const c = await mount();
    const line = c.querySelector('[data-testid="pdp-fulfiller"]')!;
    expect(line.textContent).toContain('Do Gốm Minh An giao');
    expect(line.textContent).toContain('phí giao 30.000');
    expect(line.textContent).toContain('miễn phí từ 500.000');
    expect(line.textContent).toContain('COD hoặc Ví Tubu');
    expect(line.textContent).toContain('không nhận chuyển khoản');
  });

  it('API chưa trả fulfiller: vẫn báo hàng đối tác tự giao, phí giao riêng', async () => {
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT' };
    const c = await mount();
    const line = c.querySelector('[data-testid="pdp-fulfiller"]')!;
    expect(line.textContent).toContain('Gian hàng đối tác tự giao');
    expect(line.textContent).toContain('phí giao riêng');
  });

  it('hàng Tubu giao: ghi Tubu Tree giao, không có giới hạn thanh toán', async () => {
    api.product = { ...PRODUCT, fulfilment: 'TUBU', fulfiller: { kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null } };
    const c = await mount();
    const line = c.querySelector('[data-testid="pdp-fulfiller"]')!;
    expect(line.textContent).toContain('Tubu Tree giao');
    expect(line.textContent).not.toContain('COD');
  });

  it('sản phẩm cũ không có thông tin giao: không hiện dòng', async () => {
    const c = await mount();
    expect(c.querySelector('[data-testid="pdp-fulfiller"]')).toBeNull();
  });
});

describe('/san-pham/[slug] — dòng "Vận chuyển ›" ngắn, lưu ý dài nằm ngoài nút', () => {
  const asButton = (el: Element | null) => el?.closest('[role="button"]') ?? null;

  it('hàng Tubu giao hộ đối tác: dòng bấm được chứa ai giao, lời báo giá lẻ là chữ thường dưới dòng', async () => {
    api.product = { ...PRODUCT, fulfilment: 'TUBU', partnerOwned: true, fulfiller: { kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null } };
    const c = await mount();
    const row = asButton(c.querySelector('[data-testid="pdp-fulfiller"]'))!;
    expect(row).not.toBeNull();
    expect(row.textContent).not.toContain('không dùng Điểm Xanh');
    expect(asButton(c.querySelector('[data-testid="pdp-partner-note"]'))).toBeNull();
  });

  it('hàng gian hàng tự giao: dòng chỉ để đọc (không nút, không "›"), không có Cam kết Tubu để cuộn tới', async () => {
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'MERCHANT', name: 'Gốm Minh An', shippingFee: 30000, freeShipFrom: null } };
    const c = await mount();
    expect(asButton(c.querySelector('[data-testid="pdp-fulfiller"]'))).toBeNull();
    expect(asButton(c.querySelector('[data-testid="pdp-partner-note"]'))).toBeNull();
  });

  it('gian hàng tạm nghỉ: thông báo role=status không nằm trong nút nào, và không còn dòng Vận chuyển rỗng', async () => {
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: 'Gốm Minh An', shippingFee: null, freeShipFrom: null } };
    const c = await mount();
    const note = c.querySelector('[data-testid="pdp-unavailable"]')!;
    expect(note.getAttribute('role')).toBe('status');
    expect(asButton(note)).toBeNull();
    expect(Array.from(c.querySelectorAll('[role="button"]')).some((b) => b.textContent?.startsWith('Vận chuyển'))).toBe(false);
  });

  it('ghi chú vận chuyển nằm trong khối shipping ngay dưới dòng Ưu đãi/Vận chuyển, sau khối phân loại; không xếp lại bằng order', async () => {
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: 'Gốm Minh An', shippingFee: null, freeShipFrom: null } };
    const c = await mount();
    const notes = c.querySelector('[data-section="pdp-notes"]')!;
    expect(c.querySelector('[data-pdp-block="shipping"]')!.contains(notes)).toBe(true);
    expect(notes.className).not.toContain('tubu-pdp-order');
    expect(c.querySelector('[data-pdp-block="variations"]')!.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('/san-pham/[slug] — gian hàng tạm nghỉ hoặc đã ngừng bán (R3-MERCHANT-3)', () => {
  it('gian hàng tạm nghỉ: báo rõ chưa nhận đơn, không còn dòng phí giao/thanh toán', async () => {
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: 'Gốm Minh An', shippingFee: null, freeShipFrom: null } };
    const c = await mount();
    const note = c.querySelector('[data-testid="pdp-unavailable"]')!;
    expect(note.textContent).toContain('Gốm Minh An đang tạm nghỉ, chưa nhận đơn');
    expect(c.querySelector('[data-testid="pdp-fulfiller"]')).toBeNull();
  });

  it('gian hàng đã ngừng bán: nói đã ngừng bán', async () => {
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'UNAVAILABLE', reason: 'STORE_CLOSED', name: 'Nến Shop B', shippingFee: null, freeShipFrom: null } };
    const c = await mount();
    expect(c.querySelector('[data-testid="pdp-unavailable"]')!.textContent).toContain('Nến Shop B đã ngừng bán trên Tubu Tree');
  });

  it('gian hàng nhận đơn bình thường: không có thông báo', async () => {
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'MERCHANT', name: 'Gốm Minh An', shippingFee: 30000, freeShipFrom: null } };
    const c = await mount();
    expect(c.querySelector('[data-testid="pdp-unavailable"]')).toBeNull();
  });
});

describe('/san-pham/[slug] — giá Giờ vàng khớp giỏ và đơn (R4-BUYER-4)', () => {
  const FLASH = {
    itemId: 'f1', variationId: 'v1', productSlug: 'dau-goi-bo-ket', flashPrice: 120000, retailPrice: 200000,
    salePrice: 150000, soldCount: 1, quota: 10, endAt: '2099-10-14T16:00:00.000Z',
  };

  it('không có đợt Giờ vàng: giá đang bán như cũ, không nhãn', async () => {
    const c = await mount();
    expect(c.querySelector('[data-testid="pdp-price"]')!.textContent).toBe('150.000đ');
    expect(c.querySelector('[data-testid="pdp-flash-badge"]')).toBeNull();
  });

  it('có đợt Giờ vàng: thanh Giờ vàng dưới ảnh có giá Giờ vàng, giá đang bán gạch ngang và -20%; giá lớn đầu trang không lặp lại', async () => {
    api.flash = [FLASH];
    const c = await mount();
    const bar = c.querySelector('[data-testid="flash-price-bar"]')!;
    expect(bar.textContent).toContain('120.000đ');
    expect(bar.textContent).toContain('150.000đ');
    expect(bar.textContent).toContain('-20%');
    expect(bar.querySelector('[role="timer"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="pdp-price"]')).toBeNull();
    expect(c.querySelector('[data-testid="pdp-flash-badge"]')).toBeNull();
  });
});

describe('/san-pham/[slug] — hàng của gian hàng đối tác không dùng Điểm Xanh (R4-BUYER-3)', () => {
  it('Tubu giao hộ hàng của gian hàng đối tác: vẫn ghi Tubu Tree giao và nói rõ giá lẻ, không dùng Điểm Xanh', async () => {
    api.product = { ...PRODUCT, fulfilment: 'TUBU', partnerOwned: true, fulfiller: { kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null } };
    const c = await mount();
    expect(c.querySelector('[data-testid="pdp-fulfiller"]')!.textContent).toContain('Tubu Tree giao hàng');
    expect(c.querySelector('[data-testid="pdp-partner-note"]')!.textContent).toBe('Hàng của gian hàng đối tác: chỉ bán theo giá lẻ, không dùng Điểm Xanh.');
  });

  it('hàng của gian hàng tự giao: có lời báo không dùng Điểm Xanh', async () => {
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'MERCHANT', name: 'Gốm Minh An', shippingFee: 30000, freeShipFrom: null } };
    const c = await mount();
    expect(c.querySelector('[data-testid="pdp-partner-note"]')!.textContent).toContain('không dùng Điểm Xanh');
  });

  it('hàng Tubu: không có lời báo; gian hàng tạm nghỉ: chỉ có thông báo tạm nghỉ', async () => {
    api.product = { ...PRODUCT, fulfilment: 'TUBU', fulfiller: { kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null } };
    expect((await mount()).querySelector('[data-testid="pdp-partner-note"]')).toBeNull();
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: 'Gốm Minh An', shippingFee: null, freeShipFrom: null } };
    const c = await mount();
    expect(c.querySelector('[data-testid="pdp-partner-note"]')).toBeNull();
    expect(c.querySelector('[data-testid="pdp-unavailable"]')).not.toBeNull();
  });
});

describe('/san-pham/[slug] — đủ chức năng như Mini App', () => {
  const card = (n: number) => ({ id: `r${n}`, slug: `sp-${n}`, brand: 'Xanh Việt', name: `Gợi ý ${n}`, thumbnail: null, basePrice: 90000, salePrice: null, isFeatured: false, inStock: true });
  const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).map((b) => b.textContent);

  it('có tim yêu thích cạnh nút chia sẻ, sao đánh giá và số đã bán', async () => {
    api.product = { ...PRODUCT, sold: 1250 };
    const c = await mount();
    expect(c.querySelector('button[aria-label="Thêm yêu thích"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="pdp-rating"]')!.textContent).toContain('4,5 · 8 đánh giá');
    expect(c.textContent).toContain('Đã bán 1,3k+');
  });

  it('hàng Tubu: có dòng freeship, dòng Đặt định kỳ và Mở nhóm mua chung', async () => {
    api.product = { ...PRODUCT, fulfilment: 'TUBU', fulfiller: { kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null } };
    const c = await mount();
    await flush();
    expect(buttons(c).some((t) => /Mở nhóm mua chung/.test(t ?? ''))).toBe(true);
    expect(buttons(c).some((t) => /Đặt định kỳ/.test(t ?? ''))).toBe(true);
  });

  it('hàng gian hàng tự giao hoặc hàng đối tác: không có freeship, đặt định kỳ, mua chung', async () => {
    for (const over of [
      { fulfilment: 'MERCHANT', fulfiller: { kind: 'MERCHANT', name: 'Gốm', shippingFee: 30000, freeShipFrom: null } },
      { fulfilment: 'TUBU', partnerOwned: true, fulfiller: { kind: 'TUBU', name: 'Tubu Tree', shippingFee: null, freeShipFrom: null } },
    ]) {
      api.product = { ...PRODUCT, ...over };
      const c = await mount();
      await flush();
      expect(buttons(c).some((t) => /Mở nhóm mua chung|Đặt định kỳ/.test(t ?? ''))).toBe(false);
      if (over.fulfilment === 'MERCHANT') expect(c.querySelector('[data-testid="pdp-freeship"]')).toBeNull();
    }
  });

  it('có mục Thành phần, dải cam kết và mô tả; không còn danh sách "Cam kết Tubu" lặp dải cam kết; không có thành phần thì không có mục Thành phần', async () => {
    api.product = { ...PRODUCT, ingredients: [{ name: 'Bồ kết', percentage: '30%' }] };
    const c = await mount();
    const h2 = Array.from(c.querySelectorAll('h2')).map((h) => h.textContent);
    expect(h2).toEqual(expect.arrayContaining(['Thành phần', 'Mô tả sản phẩm']));
    expect(h2).not.toContain('Cam kết Tubu');
    const promises = c.querySelector('[data-pdp-block="promises"]')!;
    expect(promises.querySelector('[data-testid="product-trust-strip"]')).not.toBeNull();
    // Lối chính sách vận chuyển có đúng một lần (dải đã trỏ vận chuyển khi chưa biết số ngày đổi trả thì không thêm lối riêng).
    expect(promises.querySelectorAll('a[href="/chinh-sach/van-chuyen"]')).toHaveLength(1);
    api.product = PRODUCT;
    const c2 = await mount();
    expect(Array.from(c2.querySelectorAll('h2')).map((h) => h.textContent)).not.toContain('Thành phần');
  });

  it('dải Khách thường mua cùng (ở khối mua kèm) và Cùng thương hiệu (cuối trang) lấy từ server (ISR), trỏ tới trang sản phẩm', async () => {
    api.related = [card(1)];
    api.together = [card(2), card(3), card(4)];
    const c = await mount();
    await flush();
    const h2 = Array.from(c.querySelectorAll('h2')).map((h) => h.textContent);
    expect(h2).toEqual(expect.arrayContaining(['Cùng thương hiệu']));
    const addons = c.querySelector('[data-pdp-block="addons"]')!;
    expect(addons.textContent).toMatch(/Khách thường mua cùng|Gợi ý mua kèm hợp vị/);
    expect(c.querySelector('[data-pdp-block="suggestions"]')!.textContent).not.toContain('Khách thường mua cùng');
    expect(h2).not.toContain('Cùng nhà Xanh Việt');
    expect(c.querySelector('[aria-label="Cùng thương hiệu Xanh Việt"]')).not.toBeNull();
    expect(Array.from(c.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(expect.arrayContaining(['/san-pham/sp-1', '/san-pham/sp-2']));
  });

  it('server lỗi lấy gợi ý: trang vẫn dựng đủ nội dung chính, dải gợi ý ẩn', async () => {
    api.serverFails = true;
    const c = await mount();
    await flush();
    expect(c.querySelector('h1')!.textContent).toBe('Dầu gội bồ kết');
    expect(Array.from(c.querySelectorAll('h2')).map((h) => h.textContent)).not.toContain('Khách thường mua cùng');
  });
});

describe('/san-pham/[slug] — bố cục máy tính và khối mới (P8)', () => {
  const FLASH = { itemId: 'f1', variationId: 'v1', productSlug: 'dau-goi-bo-ket', flashPrice: 120000, retailPrice: 200000, salePrice: 150000, soldCount: 1, quota: 10, endAt: '2099-10-14T16:00:00.000Z' };

  it('ảnh và thông tin nằm trong một thẻ (PdpLayout): ô ảnh (cả ảnh lẫn thanh Giờ vàng) dính từ lg, cột thông tin không dính và không tự cuộn riêng', async () => {
    const c = await mount();
    const card = c.querySelector('[data-testid="pdp-card"]')!;
    const info = card.querySelector('[data-testid="pdp-info"]')!;
    expect(info).not.toBeNull();
    expect(card.querySelector('[aria-roledescription="carousel"]')).not.toBeNull();
    expect(card.className).toContain('lg:grid-cols-[440px_minmax(0,1fr)]');
    const cell = card.querySelector('[data-testid="pdp-gallery-cell"]')!;
    expect(cell.contains(card.querySelector('[aria-roledescription="carousel"]'))).toBe(true);
    expect(cell.contains(info)).toBe(false);
    expect(cell.className).toContain('lg:[@media(min-height:48rem)]:sticky');
    expect(cell.className).toContain('lg:self-start');
    const stickyTokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter((t) => /(^|:)sticky$/.test(t));
    expect(Array.from(info.querySelectorAll('*')).flatMap(stickyTokens)).toEqual([]);
    expect(stickyTokens(info)).toEqual([]);
    expect(c.innerHTML).not.toMatch(/overflow-y-auto/);
  });

  it('từ lg phần dưới là lưới hai cột xếp dày: Thành phần | Mô tả, Đánh giá | So sánh; câu chuyện, mua kèm, cam kết và dải gợi ý chiếm cả hàng', async () => {
    api.product = { ...PRODUCT, ingredients: [{ name: 'Bồ kết', percentage: null, benefit: null }] };
    api.compare = COMPARE;
    api.related = [{ id: 'r1', slug: 'sp-1', brand: 'Xanh Việt', name: 'Gợi ý 1', thumbnail: null, basePrice: 90000, salePrice: null, isFeatured: false, inStock: true }];
    const c = await mount();
    await flush();
    const grid = c.querySelector('[data-testid="pdp-below-cols"]')!;
    expect(grid.className).toContain('lg:grid-cols-2');
    expect(grid.className).toContain('lg:grid-flow-row-dense');
    const cell = (block: string) => c.querySelector(`[data-pdp-block="${block}"]`)!.closest('[data-testid="pdp-below-cols"] > *')!;
    const spans = (block: string) => cell(block).className.split(' ').includes('lg:col-span-2');
    expect(spans('ingredients')).toBe(false);
    expect(spans('description')).toBe(false);
    expect(spans('reviews')).toBe(false);
    expect(spans('compare')).toBe(false);
    expect(spans('promises')).toBe(true);
    expect(spans('suggestions')).toBe(true);
    // Mọi ô lưới là con trực tiếp của lưới (không có cột bọc), nên thứ tự HTML vẫn là PDP_BLOCK_ORDER.
    expect(Array.from(grid.children).every((el) => el.className.includes('min-w-0'))).toBe(true);
    expect(c.innerHTML).not.toMatch(/overflow-y-auto/);
  });

  it('lg: thiếu một trong hai ô của cặp thì ô còn lại chiếm cả hàng (không để nửa hàng trống)', async () => {
    const c = await mount();
    await flush();
    const cell = (block: string) => c.querySelector(`[data-pdp-block="${block}"]`)!.closest('[data-testid="pdp-below-cols"] > *')!;
    expect(c.querySelector('[data-pdp-block="ingredients"]')).toBeNull();
    expect(c.querySelector('[data-pdp-block="compare"]')).toBeNull();
    expect(cell('description').className).toContain('lg:col-span-2');
    expect(cell('reviews').className).toContain('lg:col-span-2');
  });

  it('thanh Giờ vàng nằm ngay dưới ảnh, trước khối thông tin', async () => {
    api.flash = [FLASH];
    const c = await mount();
    const bar = c.querySelector('[data-testid="flash-price-bar"]')!;
    const gallery = c.querySelector('[aria-roledescription="carousel"]')!;
    const info = c.querySelector('[data-testid="pdp-info"]')!;
    expect(gallery.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('một dòng "Vận chuyển ›" gom giao hàng và freeship; hàng Tubu ghi Tubu Tree giao hàng', async () => {
    api.product = { ...PRODUCT, fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU' };
    const c = await mount();
    const row = Array.from(c.querySelectorAll<HTMLElement>('[role="button"]')).find((b) => b.textContent?.startsWith('Vận chuyển'))!;
    expect(row).toBeDefined();
    expect(row.querySelector('[data-testid="pdp-fulfiller"]')!.textContent).toContain('Tubu Tree giao hàng');
    expect(row.querySelector('svg')).not.toBeNull();
  });

  it('thứ tự khối theo PDP_BLOCK_ORDER (chung với Mini App), mỗi gốc khối có data-pdp-block, đủ mọi khối khi có dữ liệu', async () => {
    api.auth = { status: 'authenticated', initialized: true, sessionUnavailable: false, user: { id: 'u1', fullName: 'Lan An' } };
    api.purchased = [PURCHASED];
    api.product = {
      ...PRODUCT,
      fulfiller: { kind: 'TUBU' },
      fulfilment: 'TUBU',
      ingredients: [{ name: 'Bồ kết', percentage: null, benefit: null }],
      storyConfig: { version: 1, enabled: true, scenes: [{ kind: 'hud_callouts', closing: 'An lành', points: [{ id: 'p1', xPct: 40, yPct: 40, label: 'Bồ kết', side: 'left' }] }] },
    };
    api.bundles = BUNDLES_FOR_ORDER;
    api.compare = COMPARE;
    api.related = [{ id: 'r1', slug: 'sp-1', brand: 'Xanh Việt', name: 'Gợi ý 1', thumbnail: null, basePrice: 90000, salePrice: null, isFeatured: false, inStock: true }];
    const c = await mount();
    await flush(8);
    const blocks = Array.from(c.querySelectorAll('[data-pdp-block]')).map((el) => el.getAttribute('data-pdp-block'));
    expect(blocks).toEqual([...PDP_BLOCK_ORDER]);
  });

  it('khối không có dữ liệu thì không có phần tử (không dải trống): vẫn đúng thứ tự cho các khối còn lại', async () => {
    const c = await mount();
    await flush();
    const blocks = Array.from(c.querySelectorAll('[data-pdp-block]')).map((el) => el.getAttribute('data-pdp-block'));
    expect(blocks).toEqual(PDP_BLOCK_ORDER.filter((b) => blocks.includes(b)));
    for (const absent of ['rebuy', 'ingredients', 'story', 'addons', 'compare'] as const) expect(blocks).not.toContain(absent);
  });

  it('Giờ vàng: "Đã bán" dời lên dòng đánh giá (dòng giá trống); hết Giờ vàng thì về dòng giá', async () => {
    api.product = { ...PRODUCT, sold: 12 };
    api.flash = [FLASH];
    const c = await mount();
    const sold = () => Array.from(c.querySelectorAll('span')).filter((s) => s.textContent === 'Đã bán 12');
    expect(sold()).toHaveLength(1);
    expect(sold()[0]!.parentElement).toBe(c.querySelector('[data-testid="pdp-rating"]')!.parentElement);
    mounted.forEach((m) => m.unmount());
    mounted = [];
    api.flash = [];
    const c2 = await mount();
    const sold2 = Array.from(c2.querySelectorAll('span')).filter((s) => s.textContent === 'Đã bán 12');
    expect(sold2).toHaveLength(1);
    expect(sold2[0]!.parentElement).not.toBe(c2.querySelector('[data-testid="pdp-rating"]')!.parentElement);
  });

  it('khối mua đứng ngay sau thông tin chính, trước "Đặt định kỳ", Vận chuyển và chứng nhận (nút mua nằm trong 1280×800); cột thông tin không xếp lại bằng order', async () => {
    api.product = { ...PRODUCT, fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU' };
    const c = await mount();
    const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const add = c.querySelector('[data-testid="add-to-cart"]')!;
    const certs = c.querySelector('[data-testid="pdp-certs"]')!;
    const subscribe = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Đặt định kỳ'))!;
    expect(subscribe).toBeDefined();
    expect(after(c.querySelector('[data-pdp-block="main"]')!, add)).toBe(true);
    expect(after(add, subscribe)).toBe(true);
    expect(after(subscribe, c.querySelector('[data-pdp-block="shipping"]')!)).toBe(true);
    expect(after(add, certs)).toBe(true);
    // Khung khối phân loại là khối thường (không `contents`): chip và Số lượng ở đúng chỗ HTML, lớp order bên trong AddToCart hết tác dụng.
    expect(add.parentElement!.getAttribute('data-pdp-block')).toBe('variations');
    expect(add.parentElement!.className).not.toContain('contents');
    const info = c.querySelector('[data-testid="pdp-info"]')!;
    expect(info.querySelector('[class*="tubu-pdp-order-"]')).toBeNull();
  });

  it('"Đặt định kỳ" nêu đúng số % máy chủ cấu hình (0.12 → 12%)', async () => {
    api.product = { ...PRODUCT, fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU' };
    const c = await mount();
    const subscribe = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Đặt định kỳ'))!;
    expect(subscribe.textContent).toBe('Đặt định kỳ — tiết kiệm 12%');
  });

  it('khách đã mua món này: dòng "Mua lại" nằm ngay trên "Đặt định kỳ" trong cùng dải', async () => {
    api.auth = { status: 'authenticated', initialized: true, sessionUnavailable: false, user: { id: 'u1', fullName: 'Lan An' } };
    api.purchased = [PURCHASED];
    api.product = { ...PRODUCT, fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU' };
    const c = await mount();
    await flush(6);
    const rebuy = c.querySelector('[data-pdp-block="rebuy"]')!;
    const subscribe = c.querySelector('[data-pdp-block="subscribe"]')!;
    expect(rebuy.textContent).toContain('Bạn đã mua ngày 05/10');
    expect(rebuy.parentElement).toBe(subscribe.parentElement);
    expect(rebuy.compareDocumentPosition(subscribe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe('Combo ưu đãi và Mua kèm giá tốt (P15)', () => {
    const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
    const cardOf = (id: string) => ({ id, slug: `sp-${id}`, brand: 'Tubu', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${id}` });
    const itemOf = (id: string, addonPrice: number | null = null) => ({ productId: id, variationId: `v-${id}`, maxQty: 1, addonPrice, inStock: true, product: cardOf(id) });
    const BUNDLES = {
      combos: [{ id: 'c1', kind: 'BUNDLE_PCT', title: 'Combo gội xả', pct: 10, endAt: FUTURE, anchorProductId: null, items: [itemOf('a'), itemOf('b')] }],
      addons: [{ id: 'a1', kind: 'ADDON', title: 'Kèm', pct: null, endAt: FUTURE, anchorProductId: 'p1', items: [itemOf('x', 60_000)] }],
    };

    it('chưa có bộ nào: không có khối giữ chỗ', async () => {
      const c = await mount();
      expect(c.querySelector('[data-testid="pdp-bundle-slots"]')).toBeNull();
    });

    it('có bộ từ máy chủ: khối nằm ngay trong HTML dựng sẵn (không chờ trình duyệt tải thêm, nên không xê dịch trang)', async () => {
      api.bundles = BUNDLES;
      const html = await import('react-dom/server').then(async ({ renderToString }) => {
        const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
        const ui = await ProductPage({ params: Promise.resolve({ slug: 'dau-goi-bo-ket' }) });
        return renderToString(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
      });
      expect(html).toContain('data-testid="pdp-combos"');
      expect(html).toContain('Combo gội xả');
      expect(html).toContain('data-testid="pdp-addons"');
      expect(html).toContain('Chỉ khi mua cùng Dầu gội bồ kết');
    });

    it('có combo thật: là khối mua kèm duy nhất, ở phần dưới sau Mô tả và trước Đánh giá; không có thêm bộ gợi ý hay dải mua cùng', async () => {
      api.bundles = BUNDLES;
      api.together = [1, 2, 3, 4].map((n) => ({ id: `t${n}`, slug: `sp-t${n}`, brand: 'Tubu', name: `Mua cùng ${n}`, thumbnail: null, basePrice: 50_000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-t${n}` }));
      api.product = { ...PRODUCT, fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU' };
      const c = await mount();
      await flush();
      const addons = c.querySelectorAll('[data-pdp-block="addons"]');
      expect(addons).toHaveLength(1);
      expect(addons[0]!.querySelector('[data-testid="pdp-bundle-slots"]')).not.toBeNull();
      expect(c.querySelector('[data-testid="pdp-info"]')!.contains(addons[0]!)).toBe(false);
      expect(c.querySelector('[data-testid="fbt"]')).toBeNull();
      expect(c.textContent).not.toContain('Khách thường mua cùng');
      const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(after(c.querySelector('[data-pdp-block="description"]')!, addons[0]!)).toBe(true);
      expect(after(addons[0]!, c.querySelector('[data-pdp-block="reviews"]')!)).toBe(true);
    });

    it('không có bộ và không có dải mua cùng: không có khối mua kèm (không dải rỗng)', async () => {
      const c = await mount();
      await flush();
      expect(c.querySelector('[data-pdp-block="addons"]')).toBeNull();
      expect(c.querySelector('[data-testid="pdp-bundle-slots"]')).toBeNull();
    });

    it('máy chủ lỗi: trang vẫn dựng, trình duyệt thử tải rồi ẩn khối khi cũng lỗi', async () => {
      api.serverFails = true;
      const c = await mount();
      expect(c.querySelector('[data-testid="add-to-cart"]')).not.toBeNull();
      expect(c.querySelector('[data-testid="pdp-bundle-slots"]')).toBeNull();
    });
  });
});

// Dây `divider` của PdpCoupons ở page.tsx: đường kẻ dưới hàng "Ưu đãi" chỉ có khi sau nó còn hàng "Vận chuyển" (Mini kẻ giữa các hàng, hàng cuối không kẻ).
// pdp-extras.spec chỉ kiểm prop; spec cấp trang này kiểm điều kiện thật với khách đã đăng nhập (khách chưa đăng nhập không có ví mã nên PdpCoupons trả null).
describe('/san-pham/[slug] — đường kẻ dưới hàng Ưu đãi (divider) ở cấp trang', () => {
  const COUPON = { code: 'ALL', type: 'AMOUNT', value: 20000, minOrder: null, maxDiscount: null, endAt: '2026-12-01' };
  const offersRows = (c: HTMLElement) => {
    const section = c.querySelector<HTMLElement>('[data-section="pdp-offers"]')!;
    const rowOf = (label: string) =>
      Array.from(section.querySelectorAll<HTMLElement>('div')).find((d) => d.style.display === 'flex' && d.style.minHeight === '44px' && d.textContent?.startsWith(label)) ?? null;
    return { offers: rowOf('Ưu đãi'), shipping: rowOf('Vận chuyển') };
  };
  const hasLine = (el: HTMLElement) => el.style.boxShadow.includes('inset 0 -1px 0');
  const signIn = () => {
    api.auth = { status: 'authenticated', initialized: true, sessionUnavailable: false, user: { id: 'u1', fullName: 'Lan An' } };
    api.coupons = [COUPON];
  };

  it('chỉ có "Ưu đãi" (gian hàng tạm nghỉ, không có hàng Vận chuyển): hàng Ưu đãi là hàng cuối nên không có đường kẻ dưới', async () => {
    signIn();
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: 'Gốm Minh An', shippingFee: null, freeShipFrom: null } };
    const { offers, shipping } = offersRows(await mount());
    expect(offers, 'khách đã đăng nhập có mã dùng được thì phải có hàng Ưu đãi').not.toBeNull();
    expect(shipping).toBeNull();
    expect(hasLine(offers!)).toBe(false);
  });

  it('Tubu giao hàng: có cả Ưu đãi và Vận chuyển; Ưu đãi có đường kẻ dưới, Vận chuyển (hàng cuối) không', async () => {
    signIn();
    api.product = { ...PRODUCT, fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU' };
    const { offers, shipping } = offersRows(await mount());
    expect(offers).not.toBeNull();
    expect(shipping).not.toBeNull();
    expect(hasLine(offers!)).toBe(true);
    expect(hasLine(shipping!)).toBe(false);
  });

  it('gian hàng đối tác tự giao (MERCHANT): hàng Vận chuyển vẫn vẽ nên Ưu đãi có đường kẻ dưới', async () => {
    signIn();
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'MERCHANT', name: 'Gốm Minh An', shippingFee: 30000, freeShipFrom: null } };
    const { offers, shipping } = offersRows(await mount());
    expect(offers).not.toBeNull();
    expect(shipping).not.toBeNull();
    expect(hasLine(offers!)).toBe(true);
  });
});

describe('/san-pham/[slug] — dải cam kết (W45A) trong khối Cam kết cuối trang', () => {
  it('hàng Tubu giao: dải ba trụ cột nằm trong khối promises (sau Đánh giá), kèm Mở nhóm mua chung; lối chính sách vận chuyển một lần', async () => {
    api.product = { ...PRODUCT, fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU' };
    api.config = { freeshipThreshold: 199000, subscribeDiscountPct: 0.12, returnWindowDays: 7 };
    const c = await mount();
    await flush();
    const promises = c.querySelector('[data-pdp-block="promises"]')!;
    const strip = promises.querySelector('[data-testid="product-trust-strip"]')!;
    expect(strip.querySelectorAll('li')).toHaveLength(3);
    expect(c.querySelectorAll('[data-testid="product-trust-strip"]')).toHaveLength(1);
    expect(c.querySelector('[data-pdp-block="reviews"]')!.compareDocumentPosition(promises) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Array.from(promises.querySelectorAll('button')).some((b) => /Mở nhóm mua chung/.test(b.textContent ?? ''))).toBe(true);
    // Đổi trả có số ngày: dải trỏ chính sách đổi trả, khối thêm lối chính sách vận chuyển riêng (một lần).
    expect(promises.querySelectorAll('a[href="/chinh-sach/van-chuyen"]')).toHaveLength(1);
  });

  it.each([
    ['gian hàng tự giao', { kind: 'MERCHANT', name: 'Gốm Minh An', shippingFee: 30000, freeShipFrom: null }],
    ['gian hàng tạm nghỉ', { kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: 'Gốm Minh An', shippingFee: null, freeShipFrom: null }],
  ])('%s: không có dải cam kết của Tubu', async (_n, fulfiller) => {
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller };
    const c = await mount();
    expect(c.querySelector('[data-testid="product-trust-strip"]')).toBeNull();
    expect(c.querySelector('[data-pdp-block="promises"]')).not.toBeNull();
  });
});

describe('/san-pham/[slug] — So với món tương tự', () => {
  it('cờ tắt hoặc máy chủ lỗi (404): không có khối, không báo lỗi', async () => {
    const c = await mount();
    expect(c.querySelector('[data-pdp-block="compare"]')).toBeNull();
    expect(c.textContent).not.toContain('So với món tương tự');
  });

  it('máy chủ trả món đang xem nhưng không có món so: không có khối', async () => {
    api.compare = { ...COMPARE, others: [] };
    const c = await mount();
    expect(c.querySelector('[data-pdp-block="compare"]')).toBeNull();
  });

  it('có dữ liệu: bảng ba cột (Món này + 2 món), đủ hàng Giá, Giá/100ml, Dung tích, Thành phần chính; ô thiếu ghi "—"; lối Xem có tên đọc và vùng chạm 44px', async () => {
    api.compare = COMPARE;
    const c = await mount();
    const block = c.querySelector<HTMLElement>('[data-pdp-block="compare"]')!;
    expect(block.querySelector('h2')!.textContent).toBe('So với món tương tự');
    const table = block.querySelector('table')!;
    expect(table.className).toContain('table-fixed');
    expect(Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['Món này', 'Dầu gội bưởi', 'Dầu gội sả']);
    const rowHeads = Array.from(table.querySelectorAll('tbody th[scope="row"]')).map((th) => th.textContent);
    expect(rowHeads).toEqual(['Giá', 'Giá/100ml', 'Dung tích', 'Thành phần chính']);
    const rowOf = (label: string) => Array.from(table.querySelectorAll('tbody tr')).find((tr) => tr.querySelector('th')?.textContent === label)!;
    expect(Array.from(rowOf('Dung tích').querySelectorAll('td')).map((td) => td.textContent)).toEqual(['250ml', '—', '300ml']);
    expect(Array.from(rowOf('Giá/100ml').querySelectorAll('td')).map((td) => td.textContent)).toEqual(['Giá 60.000đ', '—', 'Giá 50.000đ']);
    const links = Array.from(table.querySelectorAll('a'));
    expect(links.map((a) => [a.getAttribute('href'), a.getAttribute('aria-label')])).toEqual([
      ['/san-pham/dau-goi-buoi', 'Xem Dầu gội bưởi'],
      ['/san-pham/dau-goi-sa', 'Xem Dầu gội sả'],
    ]);
    expect(smallTouchTargets(block)).toEqual([]);
    expect(unnamedControls(block)).toEqual([]);
  });
});
