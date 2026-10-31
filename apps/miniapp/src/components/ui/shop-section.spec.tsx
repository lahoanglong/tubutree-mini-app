import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ notify: vi.fn(), addAll: vi.fn(), haptic: vi.fn() }));

vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../services/cart-batch', () => ({ addAllToCart: mocks.addAll }));
vi.mock('../../services/shop-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchActiveFlashSales: vi.fn(() => new Promise(() => {})),
  getPublicConfig: vi.fn(() => new Promise(() => {})),
}));

import { HttpError } from '../../services/http';
import { ShopSection, type ShopSectionItem, type ShopSectionProps } from './shop-section';

const item = (n: number, over: Partial<ShopSectionItem['product']> = {}, extra: Partial<ShopSectionItem> = {}): ShopSectionItem => ({
  id: `i${n}`,
  note: null,
  variationId: null,
  ...extra,
  product: {
    id: `p${n}`, slug: `sp-${n}`, name: `Sản phẩm ${n}`, brand: 'Tubu', thumbnail: null,
    basePrice: 100_000, salePrice: null, inStock: true, repVariationId: `v${n}`, ...over,
  },
});
const many = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));
const col = (over: Partial<ShopSectionProps['collection']>): ShopSectionProps['collection'] => ({
  id: 'c1', title: 'Bếp xanh', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, items: many(3), ...over,
});

let qc: QueryClient;
function wrap(ui: React.ReactElement) {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(['flash-sales', 'active'], []);
  qc.setQueryData(['public-config'], { catalogLaunchDate: null });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const tileCount = (testId: string) => screen.getByTestId(testId).querySelectorAll('[data-ds="product-tile"]').length;

beforeEach(() => {
  mocks.notify.mockReset();
  mocks.addAll.mockReset();
  mocks.haptic.mockReset();
});

describe('ShopSection vẽ theo layout', () => {
  it('CAROUSEL: kệ ngang tối đa 10 thẻ, quá thì có "Tất cả (14)" gọi onSeeAll đúng một lần', () => {
    const onSeeAll = vi.fn();
    wrap(<ShopSection collection={col({ layout: 'CAROUSEL', items: many(14) })} onSeeAll={onSeeAll} />);
    expect(screen.getByRole('heading', { name: 'Bếp xanh' })).toBeInTheDocument();
    expect(tileCount('shop-rail')).toBe(10);
    expect(screen.getByRole('region', { name: 'Bếp xanh' })).toBeInTheDocument();
    const all = screen.getByRole('button', { name: 'Xem tất cả 14 sản phẩm trong Bếp xanh' });
    expect(all).toHaveTextContent('Tất cả (14)');
    fireEvent.click(all);
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('GRID: lưới 2 cột tối đa 6 thẻ', () => {
    wrap(<ShopSection collection={col({ layout: 'GRID', items: many(9) })} onSeeAll={() => undefined} />);
    expect(tileCount('shop-grid')).toBe(6);
    expect(screen.getByTestId('catalog-grid').style.gridTemplateColumns).toBe('1fr 1fr');
    expect(screen.getByRole('button', { name: /Tất cả \(9\)|Xem tất cả 9 sản phẩm/ })).toBeInTheDocument();
  });

  it('STACK: một cột dòng tối đa 5, thẻ biến thể line', () => {
    wrap(<ShopSection collection={col({ layout: 'STACK', items: many(8) })} onSeeAll={() => undefined} />);
    expect(tileCount('shop-line')).toBe(5);
    expect(screen.getByTestId('catalog-grid').style.gridTemplateColumns).toBe('1fr');
    expect(screen.getByRole('button', { name: 'Xem tất cả 8 sản phẩm trong Bếp xanh' })).toBeInTheDocument();
  });

  it('không có onSeeAll, hoặc khối không bị cắt, thì không có nút "Tất cả"', () => {
    const a = wrap(<ShopSection collection={col({ layout: 'GRID', items: many(9) })} />);
    expect(screen.queryByRole('button', { name: /Xem tất cả/ })).toBeNull();
    a.unmount();
    wrap(<ShopSection collection={col({ layout: 'GRID', items: many(5) })} onSeeAll={() => undefined} />);
    expect(screen.queryByRole('button', { name: /Xem tất cả/ })).toBeNull();
  });

  it('layout lạ rơi về lưới; bộ rỗng không vẽ gì', () => {
    const a = wrap(<ShopSection collection={col({ layout: 'KHAC', items: many(2) })} />);
    expect(screen.getByTestId('shop-grid')).toBeInTheDocument();
    a.unmount();
    const { container } = wrap(<ShopSection collection={col({ items: [] })} />);
    expect(container.querySelector('section')).toBeNull();
  });

  it('showBrand=false bỏ dòng thương hiệu trên thẻ', () => {
    wrap(<ShopSection collection={col({ layout: 'GRID', items: many(2) })} showBrand={false} />);
    expect(screen.getByTestId('shop-grid').querySelector('[data-ds-part="brand"]')).toBeNull();
  });

  it('ghi chú của chủ shop nằm trong thẻ; thẻ không ghi chú giữ chỗ dòng đó', () => {
    const items = [item(1, {}, { note: 'Mình dùng mỗi ngày' }), item(2), item(3)];
    wrap(<ShopSection collection={col({ layout: 'GRID', items })} />);
    const grid = screen.getByTestId('shop-grid');
    expect(Array.from(grid.querySelectorAll('[data-ds-part="note"]')).map((n) => n.textContent)).toEqual(['Mình dùng mỗi ngày', '', '']);
    expect(grid.querySelectorAll('[data-testid="shop-note"]')).toHaveLength(0);
  });
});

describe('ShopSection combo', () => {
  const comboItems = [item(1), item(2, { basePrice: 50_000 }), item(3, { basePrice: 50_000 })];
  const combo = (over: Partial<ShopSectionProps['collection']> = {}) => col({ id: 'cb', title: 'Combo giặt', kind: 'COMBO', layout: 'GRID', comboDiscountPct: 10, items: comboItems, ...over });
  const addButton = () => screen.getByRole('button', { name: /^Thêm cả combo Combo giặt/ });

  it('vẽ ComboCard đủ món (không lưới thẻ), giá cả bộ tính từ giá thẻ, giảm sàn từng dòng', () => {
    wrap(<ShopSection collection={combo()} />);
    expect(screen.getByTestId('shop-combo')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog-grid')).toBeNull();
    expect(screen.getByText('Combo -10%')).toBeInTheDocument();
    expect(screen.getByText('Tiết kiệm 20.000đ')).toBeInTheDocument();
    expect(addButton()).toHaveAccessibleName('Thêm cả combo Combo giặt, 3 món, 180.000đ');
  });

  it('"Thêm cả combo": một lệnh với mọi món, làm mới giỏ, thông báo thành công; bấm đúp chỉ gửi một lần', async () => {
    let resolve!: (v: unknown) => void;
    mocks.addAll.mockReturnValue(new Promise((r) => { resolve = r; }));
    wrap(<ShopSection collection={combo()} />);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalledTimes(1));
    expect(mocks.addAll).toHaveBeenCalledWith([
      { variationId: 'v1', quantity: 1 },
      { variationId: 'v2', quantity: 1 },
      { variationId: 'v3', quantity: 1 },
    ]);
    resolve({});
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text: 'Đã thêm cả combo vào giỏ' })));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] });
  });

  it('phân loại: món của bộ sưu tập > phân loại CTV ghim > phân loại đại diện', async () => {
    mocks.addAll.mockResolvedValue({});
    const items = [item(1, { pinnedVariationId: 'pin1' }, { variationId: 'own1' }), item(2, { pinnedVariationId: 'pin2' }), item(3)];
    wrap(<ShopSection collection={combo({ items })} />);
    fireEvent.click(addButton());
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalled());
    expect(mocks.addAll.mock.calls[0]![0].map((l: { variationId: string }) => l.variationId)).toEqual(['own1', 'pin2', 'v3']);
  });

  it('lỗi của máy chủ: báo lỗi, giỏ không bị ghi (không làm mới, không setQueryData), bấm lại được', async () => {
    mocks.addAll.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({});
    wrap(<ShopSection collection={combo()} />);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const setData = vi.spyOn(qc, 'setQueryData');
    fireEvent.click(addButton());
    await waitFor(() =>
      expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text: 'Chưa thêm được combo, giỏ của bạn không thay đổi. Bạn thử lại nhé.' })),
    );
    expect(invalidate).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
    await waitFor(() => expect(addButton()).not.toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(addButton());
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalledTimes(2));
  });

  it('máy chủ từ chối cả lô bằng lời nghiệp vụ (CART_BATCH_REJECTED): đọc đúng lời đó cho khách', async () => {
    mocks.addAll.mockRejectedValue(new HttpError('x', 'CART_BATCH_REJECTED', { status: 409, data: { code: 'CART_BATCH_REJECTED', message: 'Sản phẩm Sản phẩm 2 đã hết hàng.' } }));
    wrap(<ShopSection collection={combo()} />);
    fireEvent.click(addButton());
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text: 'Sản phẩm Sản phẩm 2 đã hết hàng.' })));
  });

  it('thiếu phân loại ở một món: không gọi API, báo lỗi', () => {
    wrap(<ShopSection collection={combo({ items: [item(1), item(2, { repVariationId: undefined }), item(3)] })} />);
    fireEvent.click(addButton());
    expect(mocks.addAll).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('xem trước (preview): bấm nút không ghi giỏ, không báo gì', () => {
    wrap(<ShopSection collection={combo()} preview />);
    fireEvent.click(addButton());
    expect(mocks.addAll).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('một món hết hàng: nút thành "Combo tạm hết", không gọi API', () => {
    wrap(<ShopSection collection={combo({ items: [item(1), item(2, { inStock: false }), item(3)] })} />);
    const btn = screen.getByRole('button', { name: 'Combo tạm hết: Combo giặt' });
    fireEvent.click(btn);
    expect(mocks.addAll).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Combo -\d+%$/)).toBeNull();
  });

  it('combo không đủ hai sản phẩm khác nhau, hoặc không có % giảm, thì không phải combo: rơi về dòng', () => {
    const a = wrap(<ShopSection collection={combo({ items: [item(1), item(1)] })} />);
    expect(screen.queryByTestId('shop-combo')).toBeNull();
    expect(screen.getByTestId('shop-line')).toBeInTheDocument();
    a.unmount();
    wrap(<ShopSection collection={combo({ comboDiscountPct: null })} />);
    expect(screen.queryByTestId('shop-combo')).toBeNull();
    expect(screen.getByTestId('shop-line')).toBeInTheDocument();
  });
});
