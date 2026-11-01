import { render, screen, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/storefront', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));

import { StorefrontPreview } from './storefront-preview';
import type { StorefrontEdit } from '../services/storefront-api';

const wrap = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>
);
const product = (id: string, name: string) => ({
  id, name, slug: id, thumbnail: null, brand: 'Tubu', basePrice: 100_000, salePrice: null, ratingAvg: 5, reviewCount: 1, inStock: true,
});
const item = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id: `i-${id}`, productId: id, note: null, variationId: null, isPinned: false, isHidden: false, sortOrder: 0, product: product(id, name), ...over,
});
const section = (id: string, title: string, items: unknown[], over: Record<string, unknown> = {}) => ({
  id, title, kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0, items, ...over,
});
const sf = (collections: unknown[]) => ({
  id: 'sf1', slug: 'shop-1', type: 'CTV', title: 'Cửa hàng Xanh', headerNote: null, avatarUrl: null, coverUrl: null, theme: 'default',
  isPublished: false, collections,
}) as unknown as StorefrontEdit;

afterEach(cleanup);

describe('StorefrontPreview', () => {
  it('dựng từng khối bằng ShopSection theo kiểu của khối và giữ data-testid cũ', () => {
    render(wrap(<StorefrontPreview sf={sf([
      section('c1', 'Lưới', [item('a', 'Món A'), item('b', 'Món B')]),
      section('c2', 'Kệ', [item('c', 'Món C'), item('d', 'Món D')], { layout: 'CAROUSEL' }),
      section('c3', 'Dòng', [item('e', 'Món E')], { layout: 'STACK' }),
    ])} />));
    const frame = screen.getByTestId('storefront-preview');
    expect(within(frame).getByTestId('shop-grid')).toBeInTheDocument();
    expect(within(frame).getByTestId('shop-rail')).toBeInTheDocument();
    expect(within(frame).getByTestId('shop-line')).toBeInTheDocument();
    expect(within(frame).getByText('Cửa hàng Xanh')).toBeInTheDocument();
  });

  it('bỏ món ẩn hoặc khách không thấy; bộ chỉ có món ẩn không thành khối', () => {
    render(wrap(<StorefrontPreview sf={sf([
      section('c1', 'Có hiện', [item('a', 'Món hiện'), item('b', 'Món ẩn', { isHidden: true }), item('c', 'Món chờ duyệt', { hiddenReason: 'Chưa duyệt' })]),
      section('c2', 'Chỉ ẩn', [item('d', 'Món giấu', { isHidden: true })]),
    ])} />));
    expect(screen.getByText('Món hiện')).toBeInTheDocument();
    expect(screen.queryByText('Món ẩn')).not.toBeInTheDocument();
    expect(screen.queryByText('Món chờ duyệt')).not.toBeInTheDocument();
    expect(screen.queryByText('Chỉ ẩn')).not.toBeInTheDocument();
  });

  it('chỉ vẽ sáu khối đầu như tab Shop; khung xem trước là inert', () => {
    const many = Array.from({ length: 8 }, (_, k) => section(`s${k}`, `Khối ${k + 1}`, [item(`p${k}a`, `A${k}`), item(`p${k}b`, `B${k}`)]));
    render(wrap(<StorefrontPreview sf={sf(many)} />));
    expect(screen.getAllByTestId('shop-grid')).toHaveLength(6);
    expect(screen.getAllByTestId('shop-grid')[0]!.closest('[inert]')).not.toBeNull();
  });

  it('chưa có sản phẩm nào: câu trả lời cũ, không khối nào', () => {
    render(wrap(<StorefrontPreview sf={sf([section('c1', 'Trống', [])])} />));
    expect(screen.getByText('Chưa có sản phẩm nào.')).toBeInTheDocument();
    expect(screen.queryByTestId('shop-grid')).not.toBeInTheDocument();
  });
});
