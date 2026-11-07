import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { featuredAffiliateProducts, type FeaturedSource } from '@tubutree/app-core/commerce/affiliate-share';
import { vnd } from '@tubutree/app-core/commerce/money';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('../../utils/clipboard', () => ({ copyText: (t: string) => mocks.copyText(t) }));

import { AffiliateFeaturedProducts } from './featured-products';

const source = (over: Partial<FeaturedSource> & Pick<FeaturedSource, 'id' | 'name' | 'slug'>): FeaturedSource => ({
  thumbnail: null,
  basePrice: 100000,
  salePrice: null,
  maxAffiliateRate: 10,
  ...over,
});

const PRODUCTS = featuredAffiliateProducts(
  [
    source({ id: 'a', name: 'Ly tre', slug: 'ly-tre', basePrice: 100000, maxAffiliateRate: 10 }),
    source({ id: 'b', name: 'Bàn chải tre', slug: 'ban-chai-tre', basePrice: 200000, salePrice: 150000, maxAffiliateRate: 20 }),
  ],
  { baseUrl: 'https://zalo.me/s/123', affiliateCode: 'TUBU01', productPath: '/product' },
);

const rows = () => screen.getAllByTestId('ctv-featured-row');
const row = (i: number): HTMLElement => rows()[i]!;
const liveRegion = (): HTMLElement => document.querySelector<HTMLElement>('[aria-live="polite"]')!;

beforeEach(() => {
  mocks.copyText.mockReset();
  mocks.copyText.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe('AffiliateFeaturedProducts', () => {
  it('tiêu đề, dòng xếp hoa hồng nhiều nhất lên đầu, mỗi dòng ghi mức % và số tiền dự kiến mỗi đơn', () => {
    render(<AffiliateFeaturedProducts products={PRODUCTS} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Sản phẩm hoa hồng nổi bật' })).toBeInTheDocument();
    expect(screen.getByText('Chia sẻ nhanh')).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    expect(row(0)).toHaveTextContent('Bàn chải tre');
    expect(row(0)).toHaveTextContent('Hoa hồng tới 20%');
    expect(row(0)).toHaveTextContent(`Dự kiến tới ${vnd(30000)} mỗi đơn`);
    expect(row(1)).toHaveTextContent('Ly tre');
    expect(row(1)).toHaveTextContent('Hoa hồng tới 10%');
    expect(row(1)).toHaveTextContent(`Dự kiến tới ${vnd(10000)} mỗi đơn`);
  });

  it('số tiền dự kiến dùng số đều (tabular-nums)', () => {
    render(<AffiliateFeaturedProducts products={PRODUCTS} />);
    expect(screen.getByText(`Dự kiến tới ${vnd(30000)} mỗi đơn`)).toHaveStyle({ fontVariantNumeric: 'tabular-nums' });
  });

  it('chạm "Chép link giới thiệu": chép lời giới thiệu kèm link có ?ref=, chỉ dòng đó đổi nhãn "Đã chép link", 2 giây sau trả nhãn cũ', async () => {
    vi.useFakeTimers();
    render(<AffiliateFeaturedProducts products={PRODUCTS} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Chép link giới thiệu Bàn chải tre' }));
    });
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    const copied = mocks.copyText.mock.calls[0]?.[0] as string;
    expect(copied).toContain('https://zalo.me/s/123/product/ban-chai-tre?ref=TUBU01');
    expect(copied).not.toContain('!');
    expect(within(row(0)).getByRole('button', { name: 'Đã chép link giới thiệu Bàn chải tre' })).toBeInTheDocument();
    expect(within(row(1)).getByRole('button', { name: 'Chép link giới thiệu Ly tre' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(within(row(0)).getByRole('button', { name: 'Đã chép link giới thiệu Bàn chải tre' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(within(row(0)).getByRole('button', { name: 'Chép link giới thiệu Bàn chải tre' })).toBeInTheDocument();
  });

  it('chép không được: giữ nhãn cũ và nói cách chép tay ở đúng dòng đó', async () => {
    mocks.copyText.mockResolvedValue(false);
    render(<AffiliateFeaturedProducts products={PRODUCTS} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Chép link giới thiệu Ly tre' }));
    });
    expect(within(row(1)).getByText('Không chép được, hãy chép link thủ công.')).toBeInTheDocument();
    expect(within(row(0)).queryByText('Không chép được, hãy chép link thủ công.')).toBeNull();
    expect(liveRegion()).toHaveTextContent('Không chép được, hãy chép link thủ công.');
    expect(screen.queryByRole('button', { name: /^Đã chép link/ })).toBeNull();
  });

  it('vùng aria-live có sẵn từ lúc dựng (không chèn cùng chữ) và đọc "Đã chép link giới thiệu <tên>" sau khi chép', async () => {
    render(<AffiliateFeaturedProducts products={PRODUCTS} />);
    expect(liveRegion()).toBeInTheDocument();
    expect(liveRegion()).toBeEmptyDOMElement();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Chép link giới thiệu Ly tre' }));
    });
    expect(liveRegion()).toHaveTextContent('Đã chép link giới thiệu Ly tre');
  });

  it('ghi chú nói số tiền là ước tính theo giá hiển thị; không hiện ở trạng thái chờ, rỗng, lỗi', () => {
    const { rerender } = render(<AffiliateFeaturedProducts products={PRODUCTS} />);
    expect(screen.getByText('Ước tính theo giá đang hiển thị, hoa hồng thật tính trên số tiền khách đã trả.')).toBeInTheDocument();
    for (const ui of [<AffiliateFeaturedProducts key="a" products={null} />, <AffiliateFeaturedProducts key="b" products={[]} />, <AffiliateFeaturedProducts key="c" products={null} error />]) {
      rerender(ui);
      expect(screen.queryByText(/Ước tính theo giá/)).toBeNull();
    }
  });

  it('đang tải: ba khung chờ, chưa có dòng nào', () => {
    render(<AffiliateFeaturedProducts products={null} />);
    expect(screen.getByRole('status', { name: 'Sản phẩm hoa hồng nổi bật' })).toBeInTheDocument();
    expect(screen.queryAllByTestId('ctv-featured-row')).toHaveLength(0);
  });

  it('danh sách rỗng: nói rõ chưa có sản phẩm, không có nút', () => {
    render(<AffiliateFeaturedProducts products={[]} />);
    expect(screen.getByText('Chưa có sản phẩm nào có hoa hồng để chia sẻ.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('tải lỗi: lời báo role=alert, nút "Thử lại" gọi onRetry; thiếu onRetry thì không có nút', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<AffiliateFeaturedProducts products={null} error onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa tải được danh sách sản phẩm.');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<AffiliateFeaturedProducts products={null} error />);
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });
});
