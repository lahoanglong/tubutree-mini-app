import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KNOWN_MEDIA_MISMATCHES } from '@tubutree/app-core/commerce/catalog-quality-audit';

const mocks = vi.hoisted(() => ({ fetchProducts: vi.fn(), fetchProduct: vi.fn() }));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchProducts: mocks.fetchProducts,
  fetchProduct: mocks.fetchProduct,
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import CatalogQualitySection from './admin-catalog-quality';

const BAD = KNOWN_MEDIA_MISMATCHES[0]!;
const LIST = [
  { slug: `${BAD.baseSlug}-c1337b`, name: 'Nước rửa chén Fuwa3e 100ml', thumbnail: BAD.badThumbnail, inStock: true },
  { slug: 'sp-thieu-anh', name: 'Sản phẩm thiếu ảnh', thumbnail: null, inStock: true },
  { slug: 'sp-trong-mo-ta', name: 'Sản phẩm trống mô tả', thumbnail: 'https://x/ok.png', inStock: false },
  { slug: 'sp-on', name: 'Sản phẩm ổn', thumbnail: 'https://x/on.png', inStock: true },
];
const DESCRIPTIONS: Record<string, string> = {
  [LIST[0]!.slug]: 'Mô tả đủ',
  'sp-thieu-anh': 'Có mô tả',
  'sp-trong-mo-ta': '<p>&nbsp;</p>',
  'sp-on': 'Ổn',
};

const page = (rows: unknown[]) => ({ data: rows, meta: { page: 1, limit: 100, total: rows.length } });

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CatalogQualitySection />
    </QueryClientProvider>,
  );
};
const run = async (name = 'Kiểm tra ngay') => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
  await waitFor(() => expect(screen.queryByText(/^Đang đọc|^Đang bắt đầu/)).toBeNull());
};
const items = () => within(screen.getByRole('list', { name: 'Sản phẩm cần sửa' })).getAllByRole('listitem');

beforeEach(() => {
  mocks.fetchProducts.mockReset().mockResolvedValue(page(LIST));
  mocks.fetchProduct.mockReset().mockImplementation(async (slug: string) => ({ description: DESCRIPTIONS[slug] ?? null }));
});
afterEach(() => vi.restoreAllMocks());

describe('Mini quản trị: kiểm tra chất lượng Catalog', () => {
  it('lúc đầu chưa gọi mạng, chỉ có nút Kiểm tra ngay; nút tiêu đề thu gọn/mở rộng được', () => {
    mount();
    expect(mocks.fetchProducts).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2, name: 'Kiểm tra chất lượng Catalog' })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Thu gọn' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Mở rộng' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Kiểm tra ngay' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng' }));
    expect(screen.getByRole('button', { name: 'Kiểm tra ngay' })).toBeInTheDocument();
  });

  it('bấm kiểm tra: đọc danh sách một trang rồi mô tả từng sản phẩm, báo số đếm và từng dòng lỗi', async () => {
    mount();
    await run();
    expect(mocks.fetchProducts).toHaveBeenCalledTimes(1);
    expect(mocks.fetchProducts).toHaveBeenCalledWith({ page: 1, limit: 100 });
    expect(mocks.fetchProduct).toHaveBeenCalledTimes(4);
    const status = screen.getAllByRole('status').map((x) => x.textContent);
    expect(status).toContain('Đã kiểm 4 sản phẩm: 3 sản phẩm cần sửa, trong đó 2 đang còn hàng.');
    expect(screen.getByRole('button', { name: 'Tất cả (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ảnh lệch tên (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thiếu ảnh (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trống mô tả (1)' })).toBeInTheDocument();
    expect(items()).toHaveLength(3);
    expect(items()[0]!.textContent).toContain('Nước rửa chén Fuwa3e 100ml');
    expect(items()[0]!.textContent).toContain('Vệ sinh bồn cầu Eco Enzyme 100ml');
    expect(screen.queryByText('Sản phẩm ổn')).toBeNull();
    expect(screen.getByText('Hết hàng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kiểm tra lại' })).toBeInTheDocument();
  });

  it('lọc theo loại lỗi và đánh dấu chip đang chọn', async () => {
    mount();
    await run();
    fireEvent.click(screen.getByRole('button', { name: 'Thiếu ảnh (1)' }));
    expect(items()).toHaveLength(1);
    expect(items()[0]!.textContent).toContain('Sản phẩm thiếu ảnh');
    expect(screen.getByRole('button', { name: 'Thiếu ảnh (1)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả (3)' }));
    expect(items()).toHaveLength(3);
  });

  it('không lỗi nào: báo sạch, không dựng danh sách', async () => {
    mocks.fetchProducts.mockResolvedValue(page([{ slug: 'a', name: 'A', thumbnail: 'https://x/a.png', inStock: true }]));
    mocks.fetchProduct.mockResolvedValue({ description: 'Có chữ' });
    mount();
    await run();
    expect(screen.getAllByRole('status').map((x) => x.textContent)).toContain('Đã kiểm 1 sản phẩm, không có lỗi.');
    expect(screen.queryByRole('list', { name: 'Sản phẩm cần sửa' })).toBeNull();
  });

  it('lỗi đọc danh sách: báo lỗi kèm Thử lại; thử lại thành công thì hiện kết quả', async () => {
    mocks.fetchProducts.mockRejectedValueOnce(new Error('mạng'));
    mount();
    await run();
    expect(screen.getByText('Không đọc được catalog. Kiểm tra mạng rồi thử lại.')).toBeInTheDocument();
    expect(screen.queryByText(/^Đã kiểm/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    });
    await waitFor(() => expect(screen.getByText(/^Đã kiểm 4 sản phẩm/)).toBeInTheDocument());
    expect(screen.queryByText('Không đọc được catalog. Kiểm tra mạng rồi thử lại.')).toBeNull();
  });

  it('một sản phẩm đọc mô tả lỗi: báo số sản phẩm chưa kiểm mô tả và không báo oan trống mô tả cho nó', async () => {
    mocks.fetchProduct.mockImplementation(async (slug: string) => {
      if (slug === 'sp-trong-mo-ta') throw new Error('500');
      return { description: DESCRIPTIONS[slug] ?? null };
    });
    mount();
    await run();
    expect(screen.getByText(/Chưa đọc được mô tả của 1 sản phẩm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trống mô tả (0)' })).toBeInTheDocument();
    expect(screen.getAllByRole('status').map((x) => x.textContent)).toContain('Đã kiểm 4 sản phẩm: 2 sản phẩm cần sửa, trong đó 2 đang còn hàng.');
  });

  it('bấm hai lần liền chỉ chạy một lượt', async () => {
    mount();
    const btn = screen.getByRole('button', { name: 'Kiểm tra ngay' });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await waitFor(() => expect(screen.getByText(/^Đã kiểm 4 sản phẩm/)).toBeInTheDocument());
    expect(mocks.fetchProducts).toHaveBeenCalledTimes(1);
  });
});
