import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlashSlotItem as FlashSlotItemData } from '@tubutree/app-core/api/flash-sale';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNavigate: () => navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { FlashSlotItem } from './flash-slot-item';

const ITEM: FlashSlotItemData = {
  itemId: 'fi1',
  variationId: 'v1',
  variationName: null,
  productId: 'p1',
  productSlug: 'serum-x',
  productName: 'Serum Bã Trầu',
  thumbnail: null,
  categoryIds: ['c1'],
  flashPrice: 79_000,
  retailPrice: 129_000,
  salePrice: null,
  soldCount: 6,
  quota: 10,
  soldOut: false,
  perUserLimit: 5,
};

const base = { slotStatus: 'LIVE' as const, reminded: false, remindPending: false, onBuy: () => {}, onToggleRemind: () => {} };

beforeEach(() => navigate.mockClear());

describe('FlashSlotItem: khung đang diễn ra', () => {
  it('thẻ line: giá Giờ vàng, giá gạch, giới hạn mỗi khách và thanh đã bán có chữ', () => {
    const { container } = render(<FlashSlotItem item={ITEM} {...base} />);
    expect(container.querySelector('[data-ds-variant="line"]')).not.toBeNull();
    expect(container.textContent).toContain('79.000đ');
    expect(container.textContent).toContain('129.000đ');
    expect(screen.getByText('Mỗi khách tối đa 5')).toBeInTheDocument();
    expect(screen.getByText('Đã bán 60%')).toBeInTheDocument();
  });

  it('nút Mua ngay mang tên sản phẩm, bấm gọi onBuy và không mở trang sản phẩm', () => {
    const onBuy = vi.fn();
    render(<FlashSlotItem item={ITEM} {...base} onBuy={onBuy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mua ngay Serum Bã Trầu' }));
    expect(onBuy).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('bấm tên mở trang sản phẩm đúng phân loại có suất', () => {
    render(<FlashSlotItem item={{ ...ITEM, variationId: 'v-flash' }} {...base} />);
    fireEvent.click(screen.getByRole('button', { name: 'Serum Bã Trầu' }));
    expect(navigate).toHaveBeenCalledWith('/product/serum-x', { state: { variationId: 'v-flash' } });
  });

  it('tên phân loại hiện cùng dòng giới hạn khi sản phẩm nhiều phân loại', () => {
    render(<FlashSlotItem item={{ ...ITEM, variationName: '500g' }} {...base} />);
    expect(screen.getByText('500g · Mỗi khách tối đa 5')).toBeInTheDocument();
  });
});

describe('FlashSlotItem: món hết suất', () => {
  const SOLD = { ...ITEM, soldOut: true, soldCount: 10 };

  it('hàng mờ, thanh ghi "Đã bán hết", nút Mua ngay khoá bằng aria-disabled và không gọi onBuy', () => {
    const onBuy = vi.fn();
    const { container } = render(<FlashSlotItem item={SOLD} {...base} onBuy={onBuy} />);
    expect((container.firstElementChild as HTMLElement).style.opacity).toBe('0.55');
    expect(screen.getByText('Đã bán hết')).toBeInTheDocument();
    const buy = screen.getByRole('button', { name: 'Mua ngay Serum Bã Trầu' });
    expect(buy).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(buy);
    expect(onBuy).not.toHaveBeenCalled();
  });

  it('hàng còn suất không mờ', () => {
    const { container } = render(<FlashSlotItem item={ITEM} {...base} />);
    expect((container.firstElementChild as HTMLElement).style.opacity).toBe('');
  });
});

describe('FlashSlotItem: khung sắp diễn ra', () => {
  it('không có Mua ngay; có nút Nhắc tôi aria-pressed=false mang tên sản phẩm', () => {
    const onToggleRemind = vi.fn();
    render(<FlashSlotItem item={ITEM} {...base} slotStatus="UPCOMING" onToggleRemind={onToggleRemind} />);
    expect(screen.queryByRole('button', { name: /Mua ngay/ })).not.toBeInTheDocument();
    const remind = screen.getByRole('button', { name: 'Nhắc tôi Serum Bã Trầu' });
    expect(remind).toHaveAttribute('aria-pressed', 'false');
    expect(remind).toHaveTextContent('Nhắc tôi');
    fireEvent.click(remind);
    expect(onToggleRemind).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('đã nhắc: aria-pressed=true, chữ "Đã đặt nhắc", tên đọc nói việc bấm sẽ bỏ nhắc', () => {
    render(<FlashSlotItem item={ITEM} {...base} slotStatus="UPCOMING" reminded />);
    const remind = screen.getByRole('button', { name: 'Đã đặt nhắc Serum Bã Trầu, bỏ nhắc' });
    expect(remind).toHaveAttribute('aria-pressed', 'true');
    expect(remind).toHaveTextContent('Đã đặt nhắc');
  });

  it('đang gửi yêu cầu nhắc: nút báo bận và không nhận thêm lần bấm', () => {
    const onToggleRemind = vi.fn();
    render(<FlashSlotItem item={ITEM} {...base} slotStatus="UPCOMING" remindPending onToggleRemind={onToggleRemind} />);
    const remind = screen.getByRole('button', { name: 'Nhắc tôi Serum Bã Trầu' });
    expect(remind).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(remind);
    expect(onToggleRemind).not.toHaveBeenCalled();
  });

  it('món sắp mở vẫn hiện thanh đã bán (Vừa mở bán), không in 0%', () => {
    render(<FlashSlotItem item={{ ...ITEM, soldCount: 0 }} {...base} slotStatus="UPCOMING" />);
    expect(screen.getByText('Vừa mở bán')).toBeInTheDocument();
  });
});

describe('FlashSlotItem: dữ liệu xấu không làm vỡ dòng', () => {
  it('tên dài 80 ký tự và không có ảnh: tên cắt hai dòng, nút vẫn đủ tên truy cập', () => {
    const name = 'Nước giặt sinh học hương sả chanh dung tích lớn tiết kiệm cho cả gia đình bạn nhé'.slice(0, 80);
    render(<FlashSlotItem item={{ ...ITEM, productName: name, thumbnail: null }} {...base} />);
    expect(screen.getByRole('button', { name: `Mua ngay ${name}` })).toBeInTheDocument();
  });

  it('quota 0 không in NaN hay Infinity', () => {
    const { container } = render(<FlashSlotItem item={{ ...ITEM, quota: 0, soldCount: 0 }} {...base} />);
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
    expect(screen.getByText('Vừa mở bán')).toBeInTheDocument();
  });
});
