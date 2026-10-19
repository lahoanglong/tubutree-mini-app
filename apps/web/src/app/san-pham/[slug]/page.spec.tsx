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
  serverFails: false,
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProduct: async () => api.product,
}));
vi.mock('@/components/add-to-cart', () => ({ default: () => null }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: async () => Promise.reject(new Error('offline')), post: vi.fn() } }));
vi.mock('@/lib/core-http-server', () => ({
  createServerHttp: () => ({
    get: async (path: string) => {
      if (api.serverFails) throw new Error('API tạm lỗi');
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
  api.serverFails = false;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/san-pham/[slug] — tên nhãn dẫn sang trang nhãn hàng (BUYERWEB-18)', () => {
  it('nhãn đã công khai: tên nhãn là liên kết tới /brand/:slug', async () => {
    api.product = { ...PRODUCT, brandSlug: 'xanh-viet' };
    const c = await mount();
    const a = Array.from(c.querySelectorAll('a')).find((x) => x.textContent === 'Xanh Việt')!;
    expect(a.getAttribute('href')).toBe('/brand/xanh-viet');
  });

  it('nhãn chưa có trang: tên nhãn chỉ là chữ, không có liên kết chết', async () => {
    const c = await mount();
    expect(Array.from(c.querySelectorAll('a')).find((x) => x.textContent === 'Xanh Việt')).toBeUndefined();
    expect(c.textContent).toContain('Xanh Việt');
  });
});

describe('/san-pham/[slug] — kiểu Mini App ở điện thoại', () => {
  const PRODUCT_TUBU = { ...PRODUCT, brandSlug: 'xanh-viet', fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU' };

  it('trang hero: ảnh tràn mép, khối thông tin nền trắng có đệm, không đệm trang ở điện thoại', async () => {
    api.product = PRODUCT_TUBU;
    const c = await mount();
    expect(c.querySelector('main')!.className).toContain('max-md:px-0');
    expect(c.querySelector('[aria-roledescription="carousel"]')!.className).toContain('max-md:rounded-none');
    expect(c.querySelector('[data-testid="pdp-info"]')!.className).toContain('max-md:bg-stone-0');
  });

  it('hàng nhãn: chấm màu + tên + mũi tên, không gạch chân ở điện thoại; chia sẻ chỉ là biểu tượng', async () => {
    api.product = PRODUCT_TUBU;
    const c = await mount();
    const link = c.querySelector<HTMLAnchorElement>('a[href="/brand/xanh-viet"]')!;
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
  it('hiện số đánh giá, điểm trung bình và các đánh giá; khách chưa đăng nhập được mời đăng nhập để đánh giá', async () => {
    const c = await mount();
    const section = c.querySelector('section#danh-gia')!;
    expect(section.querySelector('h2')?.textContent).toBe('Đánh giá (2)');
    expect(section.textContent).toContain('4.5');
    expect(section.textContent).toContain('Gội êm');
    expect(section.textContent).toContain('Thơm nhẹ');
    const login = Array.from(section.querySelectorAll('a')).find((a) => a.textContent === 'Đăng nhập để đánh giá')!;
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
    salePrice: 150000, soldCount: 1, quota: 10, endAt: '2026-10-14T16:00:00.000Z',
  };

  it('không có đợt Giờ vàng: giá đang bán như cũ, không nhãn', async () => {
    const c = await mount();
    expect(c.querySelector('[data-testid="pdp-price"]')!.textContent).toBe('150.000đ');
    expect(c.querySelector('[data-testid="pdp-flash-badge"]')).toBeNull();
  });

  it('có đợt Giờ vàng: giá Giờ vàng, giá gốc gạch ngang và nhãn "Giờ vàng -40%"', async () => {
    api.flash = [FLASH];
    const c = await mount();
    expect(c.querySelector('[data-testid="pdp-price"]')!.textContent).toBe('120.000đ');
    expect(c.querySelector('[data-testid="pdp-flash-badge"]')!.textContent).toContain('Giờ vàng -40%');
    expect(Array.from(c.querySelectorAll('.line-through')).map((e) => e.textContent)).toContain('200.000đ');
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
    expect(c.querySelector('[data-testid="pdp-rating"]')!.textContent).toContain('4.5 · 8 đánh giá');
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

  it('dải Thường mua kèm và Cùng nhà thương hiệu lấy từ server (ISR), trỏ tới trang sản phẩm', async () => {
    api.related = [card(1)];
    api.together = [card(2)];
    const c = await mount();
    await flush();
    const h2 = Array.from(c.querySelectorAll('h2')).map((h) => h.textContent);
    expect(h2).toEqual(expect.arrayContaining(['Thường mua kèm', 'Cùng nhà Xanh Việt']));
    expect(Array.from(c.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(expect.arrayContaining(['/san-pham/sp-1', '/san-pham/sp-2']));
  });

  it('server lỗi lấy gợi ý: trang vẫn dựng đủ nội dung chính, dải gợi ý ẩn', async () => {
    api.serverFails = true;
    const c = await mount();
    await flush();
    expect(c.querySelector('h1')!.textContent).toBe('Dầu gội bồ kết');
    expect(Array.from(c.querySelectorAll('h2')).map((h) => h.textContent)).not.toContain('Thường mua kèm');
  });
});
