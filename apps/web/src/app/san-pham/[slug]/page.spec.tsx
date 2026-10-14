// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// BUYERWEB-17: trang chi tiết chỉ hiện đúng một ảnh. BUYERWEB-16: thiếu JSON-LD Product, canonical, og:image đủ.

const api = vi.hoisted(() => ({ product: null as unknown }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProduct: async () => api.product,
}));
vi.mock('@/components/add-to-cart', () => ({ default: () => null }));

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

beforeEach(() => {
  api.product = PRODUCT;
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
