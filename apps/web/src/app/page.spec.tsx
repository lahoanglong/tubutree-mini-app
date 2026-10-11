import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// C-025 (A1-014): trang chủ web nhận ?q= (từ ô tìm kiếm ở header) và chuyển cho GET /products?q=.

const mocks = vi.hoisted(() => ({ getProducts: vi.fn(), getBrands: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProducts: mocks.getProducts,
  getBrands: mocks.getBrands,
}));

import HomePage, { generateMetadata } from './page';

const PRODUCT = {
  id: 'p1', slug: 'dau-goi', brand: 'Tubu', name: 'Dầu gội bồ kết', thumbnail: null, basePrice: 200000,
  salePrice: null, isFeatured: false, inStock: true,
};
const render = async (sp: Record<string, string | string[] | undefined>) =>
  renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  mocks.getProducts.mockReset().mockResolvedValue([PRODUCT]);
  mocks.getBrands.mockReset().mockResolvedValue([{ brand: 'Tubu', count: 3 }, { brand: 'A&B', count: 1 }]);
});

describe('HomePage — tìm kiếm', () => {
  it('không có ?q: gọi API như cũ (không có tham số q), không hiện dòng kết quả tìm kiếm', async () => {
    const out = await render({});
    expect(mocks.getProducts).toHaveBeenCalledWith({});
    expect(out).not.toContain('Kết quả tìm kiếm');
  });

  it('?q=: chuyển từ khoá đã chuẩn hoá cho API, nói rõ đang xem kết quả và có lối xoá tìm kiếm', async () => {
    const out = await render({ q: '  dầu   gội ' });
    expect(mocks.getProducts).toHaveBeenCalledWith({ q: 'dầu gội' });
    expect(out).toContain('Kết quả tìm kiếm cho');
    expect(out).toContain('dầu gội');
    expect(out).toMatch(/<a [^>]*href="\/"[^>]*>Xóa tìm kiếm<\/a>/);
  });

  it('lọc thương hiệu giữ từ khoá, xoá tìm kiếm giữ thương hiệu', async () => {
    const out = await render({ q: 'gội', brand: 'A&B' });
    expect(mocks.getProducts).toHaveBeenCalledWith({ brand: 'A&B', q: 'gội' });
    expect(out).toContain('href="/?brand=Tubu&amp;q=g%E1%BB%99i#san-pham"');
    expect(out).toContain('href="/?brand=A%26B#san-pham"');
  });

  it('không có kết quả cho từ khoá: câu báo riêng cho tìm kiếm, không đổ lỗi cho bộ lọc thương hiệu', async () => {
    mocks.getProducts.mockResolvedValue([]);
    const out = await render({ q: 'xyz' });
    expect(out).toContain('Không tìm thấy sản phẩm nào cho');
    expect(out).toContain('xyz');
  });

  it('?q lặp lại (mảng) hoặc rỗng không làm trang lỗi', async () => {
    await render({ q: ['a', 'b'] });
    expect(mocks.getProducts).toHaveBeenLastCalledWith({ q: 'a' });
    await render({ q: '   ' });
    expect(mocks.getProducts).toHaveBeenLastCalledWith({});
  });

  it('trang kết quả tìm kiếm không cho công cụ tìm kiếm lập chỉ mục (vô hạn biến thể URL)', async () => {
    expect(await generateMetadata({ searchParams: Promise.resolve({ q: 'gội' }) })).toEqual({ robots: { index: false, follow: true } });
    expect(await generateMetadata({ searchParams: Promise.resolve({}) })).toEqual({});
  });

  it('giữ cấu trúc heading: đúng một h1, h2 trước h3', async () => {
    const out = await render({ q: 'gội' });
    expect(out.match(/<h1[ >]/g)).toHaveLength(1);
    expect(out.indexOf('<h2')).toBeLessThan(out.indexOf('<h3'));
  });
});
