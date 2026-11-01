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
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProduct: async () => api.product,
}));
vi.mock('@/components/add-to-cart', () => ({ default: () => <div data-testid="add-to-cart" /> }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: async () => Promise.reject(new Error('offline')), post: vi.fn() } }));
vi.mock('@/lib/core-http-server', () => ({
  createServerHttp: () => ({
    get: async (path: string) => {
      if (api.serverFails) throw new Error('API tạm lỗi');
      if (path.endsWith('/bundles')) return api.bundles;
      return path.endsWith('/related') ? api.related : api.together;
    },
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => api.flash }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'idle', initialized: true, sessionUnavailable: false }) }));
vi.mock('@/lib/reviews-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reviews-client')>()),
  fetchProductReviews: async () => api.reviews,
  fetchCanReview: async () => {
    throw new Error('khách chưa đăng nhập không hỏi can-review');
  },
}));

import ProductPage, { generateMetadata } from './page';

const PRODUCT = {
  id: 'p1', slug: 'dau-goi-bo-ket', brand: 'Xanh Việt', name: 'Dầu gội bồ kết', shortDesc: 'Sạch dịu nhẹ',
  description: '<p>Thành phần</p><ul><li>Bồ kết</li><li>Gừng</li></ul>', images: ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg'],
  thumbnail: 'https://cdn/a.jpg', basePrice: 200000, salePrice: 150000, certifications: ['Hữu cơ'],
  variations: [{ id: 'v1', sku: 'DG-250', name: '250ml', retailPrice: 200000, salePrice: 150000, stock: 5 }],
  ratingAvg: 4.5, reviewCount: 8,
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
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/san-pham/[slug] — tên nhãn dẫn sang trang nhãn hàng (BUYERWEB-18)', () => {
  it('tên nhãn mở danh mục lọc theo nhãn như Mini App (brandBrowsePath), kể cả nhãn chưa có trang riêng', async () => {
    for (const brandSlug of ['xanh-viet', undefined]) {
      api.product = { ...PRODUCT, brandSlug };
      const c = await mount();
      const a = c.querySelector<HTMLAnchorElement>('a[aria-label="Xem sản phẩm nhãn Xanh Việt"]')!;
      expect(a.getAttribute('href')).toBe('/san-pham?brand=Xanh%20Vi%E1%BB%87t');
    }
  });
});

describe('/san-pham/[slug] — kiểu Mini App ở điện thoại', () => {
  const PRODUCT_TUBU = { ...PRODUCT, brandSlug: 'xanh-viet', fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU' };

  it('"Còn N sản phẩm" nằm trong khối thông tin chính dưới Điểm Xanh (như Mini App), không nằm trong dải Phân loại; gian hàng tạm nghỉ thì không nhắc', async () => {
    api.product = { ...PRODUCT_TUBU, variations: [{ ...PRODUCT.variations[0]!, stock: 3 }] };
    const c = await mount();
    const note = c.querySelector('[data-testid="pdp-low-stock"]')!;
    expect(note.textContent).toBe('Còn 3 sản phẩm');
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
    const link = c.querySelector<HTMLAnchorElement>('a[aria-label="Xem sản phẩm nhãn Xanh Việt"]')!;
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

  it('thứ tự như Mini App: mô tả ngắn → giao hàng → freeship → chứng nhận', async () => {
    api.product = PRODUCT_TUBU;
    const c = await mount();
    const q = (t: string) => c.querySelector(`[data-testid="${t}"]`)!;
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(q('pdp-short-desc'), q('pdp-fulfiller'))).toBe(true);
    expect(before(q('pdp-fulfiller'), q('pdp-certs'))).toBe(true);
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
    expect(share).toHaveBeenCalledWith({ title: 'Dầu gội bồ kết', url: `${window.location.origin}/san-pham/dau-goi-bo-ket` });
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

  it('mô tả HTML của đối tác hiện thành văn bản sạch, không lộ thẻ', async () => {
    const c = await mount();
    const section = Array.from(c.querySelectorAll('section')).find((s) => s.textContent?.includes('Mô tả sản phẩm'))!;
    expect(section.textContent).toContain('Thành phần');
    expect(section.textContent).toContain('• Bồ kết');
    expect(section.textContent).not.toMatch(/<\/?(p|ul|li)>/);
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
  it('hiện số đánh giá, điểm trung bình và các đánh giá; khách chưa đăng nhập thấy nút "Viết đánh giá" dẫn tới đăng nhập', async () => {
    const c = await mount();
    const section = c.querySelector('section#danh-gia')!;
    expect(section.querySelector('h2')?.textContent).toBe('Đánh giá (2)');
    expect(section.textContent).toContain('4,5');
    expect(section.textContent).toContain('Gội êm');
    expect(section.textContent).toContain('Thơm nhẹ');
    const login = Array.from(section.querySelectorAll('a')).find((a) => a.textContent === 'Viết đánh giá')!;
    expect(login.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi-bo-ket');
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
    expect(ld.aggregateRating).toEqual({ '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 8 });
  });

  it('JSON-LD không thể bị phá bằng tên sản phẩm chứa </script>', async () => {
    api.product = { ...PRODUCT, name: 'X</script><script>alert(1)</script>' };
    const c = await mount();
    expect(c.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
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
    expect(og.url).toBe('/san-pham/dau-goi-bo-ket');
    expect(og.siteName).toBe('Tubu Tree');
    expect((m.twitter as { card: string }).card).toBe('summary_large_image');
  });

  it('không có ảnh: twitter card thường, og:image rỗng', async () => {
    api.product = { ...PRODUCT, images: [], thumbnail: null };
    const m = await generateMetadata({ params: Promise.resolve({ slug: 'x' }) });
    expect((m.openGraph as { images: string[] }).images).toEqual([]);
    expect((m.twitter as { card: string }).card).toBe('summary');
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

  it('điện thoại: ghi chú vận chuyển xếp order 4, trên chip phân loại (5) và Số lượng (6) để Số lượng sát phân loại', async () => {
    api.product = { ...PRODUCT, fulfilment: 'MERCHANT', fulfiller: { kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: 'Gốm Minh An', shippingFee: null, freeShipFrom: null } };
    const c = await mount();
    expect(c.querySelector('[data-section="pdp-notes"]')!.className).toContain('max-md:order-4');
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

  it('có mục Thành phần, Cam kết Tubu và mô tả; không có thành phần thì không có mục Thành phần', async () => {
    api.product = { ...PRODUCT, ingredients: [{ name: 'Bồ kết', percentage: '30%' }] };
    const c = await mount();
    const h2 = Array.from(c.querySelectorAll('h2')).map((h) => h.textContent);
    expect(h2).toEqual(expect.arrayContaining(['Thành phần', 'Cam kết Tubu', 'Mô tả sản phẩm']));
    api.product = PRODUCT;
    const c2 = await mount();
    expect(Array.from(c2.querySelectorAll('h2')).map((h) => h.textContent)).not.toContain('Thành phần');
  });

  it('dải Khách thường mua cùng và Cùng thương hiệu lấy từ server (ISR), trỏ tới trang sản phẩm', async () => {
    api.related = [card(1)];
    api.together = [card(2), card(3), card(4)];
    const c = await mount();
    await flush();
    const h2 = Array.from(c.querySelectorAll('h2')).map((h) => h.textContent);
    expect(h2).toEqual(expect.arrayContaining(['Khách thường mua cùng', 'Cùng thương hiệu']));
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

  it('ảnh và thông tin nằm trong một thẻ (PdpLayout), cột thông tin không dính và không tự cuộn riêng', async () => {
    const c = await mount();
    const card = c.querySelector('[data-testid="pdp-card"]')!;
    expect(card.querySelector('[data-testid="pdp-info"]')).not.toBeNull();
    expect(card.querySelector('[aria-roledescription="carousel"]')).not.toBeNull();
    expect(card.className).toContain('lg:grid-cols-[440px_minmax(0,1fr)]');
    expect(c.innerHTML).not.toMatch(/lg:sticky|overflow-y-auto/);
  });

  it('từ lg nửa dưới hai cột: Thành phần + Cam kết + Mô tả bên trái, Đánh giá bên phải; dải gợi ý vẫn cả bề ngang bên dưới', async () => {
    const c = await mount();
    await flush();
    const cols = c.querySelector('[data-testid="pdp-below-cols"]')!;
    expect(cols.className).toContain('lg:grid-cols-2');
    const [left, right] = Array.from(cols.children) as HTMLElement[];
    expect(left!.textContent).toContain('Cam kết Tubu');
    expect(left!.textContent).toContain('Mô tả sản phẩm');
    expect(left!.querySelector('#danh-gia')).toBeNull();
    expect(right!.querySelector('#danh-gia')).not.toBeNull();
    // Dải gợi ý là anh em kế tiếp của hai cột, không nằm trong cột nào.
    expect(cols.nextElementSibling!.className).toContain('max-md:pb-6');
    expect(c.innerHTML).not.toMatch(/lg:sticky|overflow-y-auto/);
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

  it('Đánh giá nhanh: 2 đánh giá có chữ ngay trên danh sách đầy đủ', async () => {
    const c = await mount();
    await flush();
    expect(c.querySelectorAll('[data-testid="quick-review"]')).toHaveLength(2);
    const quick = c.querySelector('section[aria-label="Đánh giá nhanh"]')!;
    const full = c.querySelector('#danh-gia')!;
    expect(quick.compareDocumentPosition(full) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('thứ tự như Mini App (Q8): khối mua → Đánh giá nhanh → Thành phần, Cam kết, Mô tả → danh sách đầy đủ', async () => {
    api.product = { ...PRODUCT, ingredients: [{ name: 'Bồ kết', percentage: null, benefit: null }] };
    const c = await mount();
    await flush();
    const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const info = c.querySelector('[data-testid="pdp-info"]')!;
    const quick = c.querySelector('section[aria-label="Đánh giá nhanh"]')!;
    const ingredients = Array.from(c.querySelectorAll('h2')).find((h) => h.textContent === 'Thành phần')!;
    expect(ingredients).toBeDefined();
    expect(after(info, quick)).toBe(true);
    expect(after(quick, ingredients)).toBe(true);
    expect(after(quick, c.querySelector('#pdp-promises')!)).toBe(true);
    expect(after(quick, c.querySelector('#pdp-description')!)).toBe(true);
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

  it('máy tính: khối mua đứng trước chứng nhận và "Đặt định kỳ" trong HTML (nút mua nằm trong 1280×800); điện thoại kéo hai khối đó lên bằng order', async () => {
    const c = await mount();
    const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const add = c.querySelector('[data-testid="add-to-cart"]')!;
    const certs = c.querySelector('[data-testid="pdp-certs"]')!;
    const subscribe = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Đặt định kỳ'))!;
    expect(subscribe).toBeDefined();
    expect(after(add, certs)).toBe(true);
    expect(after(add, subscribe)).toBe(true);
    // Điện thoại giữ thứ tự như Mini App: chứng nhận (order 1) → Đặt định kỳ (2); khối mua tách phần Phân loại và Số lượng ra bằng `contents` (xem add-to-cart.spec).
    expect(certs.className).toContain('max-md:order-1');
    expect(subscribe.closest('.max-md\\:order-2')).not.toBeNull();
    expect(add.parentElement!.className).toContain('max-md:contents');
  });

  describe('Combo ưu đãi và Mua kèm deal sốc (P15)', () => {
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

    it('điện thoại: thứ tự khối như Mini App (Ưu đãi/Vận chuyển → Combo/Mua kèm → Đánh giá nhanh → Mở nhóm mua chung); máy tính giữ khối mua trước trong HTML', async () => {
      api.bundles = BUNDLES;
      api.product = { ...PRODUCT, fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU' };
      const c = await mount();
      await flush();
      const info = c.querySelector('[data-testid="pdp-info"]')!;
      const order = (el: Element) => Number(/max-md:order-(\d+)/.exec(el.closest('[class*="max-md:order-"]')?.className ?? '')?.[1] ?? 0);
      // sort ổn định: cùng order thì giữ thứ tự DOM, đúng như flex xếp.
      const visual = Array.from(info.querySelectorAll('[data-section]'))
        .map((el) => ({ id: el.getAttribute('data-section')!, order: order(el) }))
        .sort((a, b) => a.order - b.order)
        .map((x) => x.id);
      expect(visual).toEqual(['pdp-main', 'pdp-certs', 'pdp-subscribe', 'pdp-offers', 'pdp-bundles', 'pdp-quick-reviews', 'pdp-groupbuy']);
      const add = c.querySelector('[data-testid="add-to-cart"]')!;
      const slots = c.querySelector('[data-testid="pdp-bundle-slots"]')!;
      const quick = c.querySelector('[data-section="pdp-quick-reviews"]')!;
      const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(after(add, slots)).toBe(true);
      expect(after(slots, quick)).toBe(true);
    });

    it('không có đánh giá có chữ và không có bộ: không dựng Đánh giá nhanh, không khối bộ (không dải rỗng)', async () => {
      api.reviews = { ...REVIEWS, items: REVIEWS.items.map((r) => ({ ...r, comment: null })) };
      const c = await mount();
      await flush();
      expect(c.querySelector('[data-section="pdp-quick-reviews"]')).toBeNull();
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
