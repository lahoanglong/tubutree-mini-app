import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { OrderView } from '../../services/shop-api';
import { OrderCard } from './order-card';

const ORDER = {
  id: 'o1', code: 'TUBU-777', status: 'DELIVERED', total: 149000, createdAt: '2026-09-20T08:00:00.000Z',
  items: [
    { id: 'i1', variationId: 'v1', productName: 'Nước rửa chén', productSlug: 'nrc', variationName: 'Chanh', unitPrice: 65000, quantity: 2, total: 130000, backorderedQty: 0, thumbnail: 'https://img.test/a.jpg' },
    { id: 'i2', variationId: 'v2', productName: 'Xà phòng', productSlug: null, variationName: '', unitPrice: 19000, quantity: 1, total: 19000, backorderedQty: 0 },
  ],
} as unknown as OrderView;

describe('OrderCard', () => {
  it('ảnh SP đầu, tên + "+1", "3 món", tổng tiền, trạng thái', () => {
    render(<OrderCard order={ORDER} onOpen={() => {}} onReorder={() => {}} />);
    const card = screen.getByRole('button', { name: 'Đơn TUBU-777' });
    expect(card.querySelector('img')).toHaveAttribute('src', 'https://img.test/a.jpg');
    expect(card).toHaveTextContent('Nước rửa chén +1');
    expect(card).toHaveTextContent(/3 món/);
    expect(card).toHaveTextContent('149.000đ');
    expect(card).toHaveTextContent('Giao thành công');
  });

  it('"Mua lại" gọi onReorder, KHÔNG mở chi tiết', () => {
    const onOpen = vi.fn();
    const onReorder = vi.fn();
    render(<OrderCard order={ORDER} onOpen={onOpen} onReorder={onReorder} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mua lại' }));
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Đơn TUBU-777' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('bấm vào vùng trống cạnh "Mua lại" mở chi tiết đơn (không có vùng chết), chỉ nút mới bị chặn nổi bọt', () => {
    const onOpen = vi.fn();
    const onReorder = vi.fn();
    render(<OrderCard order={ORDER} onOpen={onOpen} onReorder={onReorder} />);
    const row = screen.getByTestId('order-card-actions');
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onReorder).not.toHaveBeenCalled();
    // Vùng chặn nổi bọt chỉ bọc đúng nút: cha trực tiếp của nút không phải là hàng full-width.
    const button = screen.getByRole('button', { name: 'Mua lại' });
    expect(button.parentElement).not.toBe(row);
    expect(row.children).toHaveLength(1);
    fireEvent.click(button);
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('đơn đang giao → không có "Mua lại"; không ảnh → icon thay thế', () => {
    render(<OrderCard order={{ ...ORDER, status: 'SHIPPING', items: [{ ...ORDER.items[1]! }] } as OrderView} onOpen={() => {}} onReorder={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Mua lại' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Đơn TUBU-777' }).querySelector('img')).toBeNull();
  });

  it('không truyền onReorder → không có "Mua lại" dù đơn đã giao', () => {
    render(<OrderCard order={ORDER} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Mua lại' })).toBeNull();
  });

  it('Enter trên thẻ mở chi tiết; Enter trên "Mua lại" không mở chi tiết', () => {
    const onOpen = vi.fn();
    render(<OrderCard order={ORDER} onOpen={onOpen} onReorder={() => {}} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mua lại' }), { key: 'Enter' });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Đơn TUBU-777' }), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
