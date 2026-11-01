import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleDTO, BundleItemDTO, ProductBundles } from '@tubutree/app-core/api/bundle';
import type { ProductCard } from '@tubutree/app-core/api/catalog';

const mocks = vi.hoisted(() => ({ notify: vi.fn(), addAll: vi.fn(), haptic: vi.fn(), fetchBundles: vi.fn() }));

vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../services/cart-batch', () => ({ addAllToCart: mocks.addAll }));
vi.mock('../../services/bundle-api', () => ({ getProductBundles: mocks.fetchBundles }));

import { PdpBundles } from './pdp-bundles';

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 1_000).toISOString();

const card = (id: string, o: Partial<ProductCard> = {}): ProductCard => ({
  id, slug: `sp-${id}`, brand: 'Tubu', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${id}`, ...o,
});
const item = (id: string, o: Partial<BundleItemDTO> = {}): BundleItemDTO => ({
  productId: id, variationId: `v-${id}`, maxQty: 1, addonPrice: null, inStock: true, product: card(id), ...o,
});
const combo = (id: string, items: BundleItemDTO[], o: Partial<BundleDTO> = {}): BundleDTO => ({
  id, kind: 'BUNDLE_PCT', title: `Combo ${id}`, pct: 10, endAt: FUTURE, anchorProductId: null, items, ...o,
});
const addon = (id: string, items: BundleItemDTO[], o: Partial<BundleDTO> = {}): BundleDTO => ({
  id, kind: 'ADDON', title: `Kèm ${id}`, pct: null, endAt: FUTURE, anchorProductId: 'anchor', items, ...o,
});

function renderBlock(data: ProductBundles | Error) {
  if (data instanceof Error) mocks.fetchBundles.mockRejectedValue(data);
  else mocks.fetchBundles.mockResolvedValue(data);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const out = render(
    <QueryClientProvider client={qc}>
      <PdpBundles slug="sp-anchor" productName="Xà phòng sả" />
    </QueryClientProvider>,
  );
  return { ...out, qc };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.addAll.mockResolvedValue({});
});

describe('PdpBundles: ẩn hẳn khi không có gì để mời', () => {
  it('không có bộ nào: container rỗng, không tiêu đề, không giữ chỗ', async () => {
    const { container } = renderBlock({ combos: [], addons: [] });
    await waitFor(() => expect(mocks.fetchBundles).toHaveBeenCalledWith('sp-anchor'));
    expect(container).toBeEmptyDOMElement();
  });

  it('API lỗi: ẩn, không báo lỗi lên khách', async () => {
    const { container } = renderBlock(new Error('mạng'));
    await waitFor(() => expect(mocks.fetchBundles).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('bộ đã quá hạn theo giờ máy chủ: ẩn', async () => {
    const { container } = renderBlock({ combos: [combo('c1', [item('a'), item('b')], { endAt: PAST })], addons: [addon('a1', [item('x', { addonPrice: 10_000 })], { endAt: PAST })] });
    await waitFor(() => expect(mocks.fetchBundles).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PdpBundles: Combo ưu đãi', () => {
  it('mỗi combo một thẻ với tổng và tổng sau giảm; tối đa 2 thẻ', async () => {
    renderBlock({ combos: ['c1', 'c2', 'c3'].map((id) => combo(id, [item(`${id}a`), item(`${id}b`)])), addons: [] });
    const region = await screen.findByRole('region', { name: 'Combo ưu đãi' });
    expect(within(region).getAllByRole('button', { name: /^Thêm cả combo/ })).toHaveLength(2);
    // 2 món 100.000đ giảm 10%: tổng 200.000đ, còn 180.000đ, tiết kiệm 20.000đ
    expect(within(region).getAllByText('Tiết kiệm 20.000đ')).toHaveLength(2);
    expect(within(region).getAllByText('180.000đ')[0]).toBeInTheDocument();
  });

  it('"Thêm cả combo" gửi đủ món mỗi món một đơn vị, rồi làm mới giỏ và báo thành công', async () => {
    const { qc } = renderBlock({ combos: [combo('c1', [item('a'), item('b')])], addons: [] });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: /^Thêm cả combo/ }));
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalledWith([{ variationId: 'v-a', quantity: 1 }, { variationId: 'v-b', quantity: 1 }]));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text: 'Đã thêm cả combo vào giỏ' })));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['cart'] });
  });

  it('thêm lỗi: báo lỗi, không làm mới giỏ như đã thêm', async () => {
    mocks.addAll.mockRejectedValue(new Error('x'));
    const { qc } = renderBlock({ combos: [combo('c1', [item('a'), item('b')])], addons: [] });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: /^Thêm cả combo/ }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['cart'] });
  });

  it('có món hết hàng: nút "Combo tạm hết", không gửi giỏ', async () => {
    renderBlock({ combos: [combo('c1', [item('a'), item('b', { inStock: false })])], addons: [] });
    const btn = await screen.findByRole('button', { name: 'Combo tạm hết: Combo c1' });
    fireEvent.click(btn);
    expect(mocks.addAll).not.toHaveBeenCalled();
  });
});

describe('PdpBundles: Mua kèm deal sốc', () => {
  const data = (): ProductBundles => ({
    combos: [],
    addons: [addon('a1', [item('x', { addonPrice: 40_000 }), item('y', { addonPrice: 70_000, product: card('y', { basePrice: 80_000 }) })])],
  });

  it('dòng role=checkbox có tên đọc đủ giá và % giảm; điều kiện mua cùng món chính', async () => {
    renderBlock(data());
    const region = await screen.findByRole('region', { name: 'Mua kèm deal sốc' });
    expect(within(region).getByText('Chỉ khi mua cùng Xà phòng sả')).toBeInTheDocument();
    expect(within(region).getByRole('checkbox', { name: 'Chọn mua kèm Sản phẩm x, 40.000đ, giảm 60%' })).toHaveAttribute('aria-checked', 'false');
    expect(within(region).getByRole('checkbox', { name: 'Chọn mua kèm Sản phẩm y, 70.000đ, giảm 13%' })).toBeInTheDocument();
  });

  it('chưa chọn: nút nhắc chọn món và bị khoá', async () => {
    renderBlock(data());
    const btn = await screen.findByRole('button', { name: 'Chọn món muốn mua kèm' });
    expect(btn).toBeDisabled();
  });

  it('chọn và bỏ chọn cập nhật "Thêm n món vào giỏ" và "Tiết kiệm"', async () => {
    renderBlock(data());
    const x = await screen.findByRole('checkbox', { name: /Sản phẩm x/ });
    const y = screen.getByRole('checkbox', { name: /Sản phẩm y/ });
    fireEvent.click(x);
    expect(x).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Thêm 1 món vào giỏ' })).toBeInTheDocument();
    expect(screen.getByText('Tiết kiệm 60.000đ')).toBeInTheDocument();
    fireEvent.click(y);
    expect(screen.getByRole('button', { name: 'Thêm 2 món vào giỏ' })).toBeInTheDocument();
    expect(screen.getByText('Tiết kiệm 70.000đ')).toBeInTheDocument(); // 60.000 + 10.000
    fireEvent.click(x);
    expect(screen.getByRole('button', { name: 'Thêm 1 món vào giỏ' })).toBeInTheDocument();
    expect(screen.getByText('Tiết kiệm 10.000đ')).toBeInTheDocument();
  });

  it('bàn phím: Enter trên dòng cũng chọn', async () => {
    renderBlock(data());
    const x = await screen.findByRole('checkbox', { name: /Sản phẩm x/ });
    fireEvent.keyDown(x, { key: 'Enter' });
    expect(x).toHaveAttribute('aria-checked', 'true');
  });

  it('bấm thêm: chỉ món đã chọn (không có món chính), thành công thì "Đã thêm vào giỏ" rồi bỏ chọn', async () => {
    const { qc } = renderBlock(data());
    const spy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('checkbox', { name: /Sản phẩm y/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 1 món vào giỏ' }));
    await waitFor(() => expect(mocks.addAll).toHaveBeenCalledWith([{ variationId: 'v-y', quantity: 1 }]));
    expect(await screen.findByRole('button', { name: 'Đã thêm vào giỏ' })).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['cart'] });
    expect(screen.getByRole('checkbox', { name: /Sản phẩm y/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('thêm lỗi: báo lỗi mua kèm, giữ nguyên lựa chọn để thử lại', async () => {
    mocks.addAll.mockRejectedValue(new Error('x'));
    renderBlock(data());
    fireEvent.click(await screen.findByRole('checkbox', { name: /Sản phẩm x/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 1 món vào giỏ' }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text: 'Chưa thêm được món mua kèm, bạn thử lại nhé' })));
    expect(screen.getByRole('checkbox', { name: /Sản phẩm x/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('món hết hàng hoặc giá kèm không thấp hơn giá bán không có dòng; hết dòng thì ẩn cả khối', async () => {
    const { container } = renderBlock({ combos: [], addons: [addon('a1', [item('x', { addonPrice: 40_000, inStock: false }), item('y', { addonPrice: 100_000 })])] });
    await waitFor(() => expect(mocks.fetchBundles).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('có cả combo và mua kèm: hai vùng riêng trong một khung', async () => {
    renderBlock({ combos: [combo('c1', [item('a'), item('b')])], addons: data().addons });
    expect(await screen.findByRole('region', { name: 'Combo ưu đãi' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mua kèm deal sốc' })).toBeInTheDocument();
    expect(screen.getAllByTestId('pdp-bundle-slots')).toHaveLength(1);
  });
});
