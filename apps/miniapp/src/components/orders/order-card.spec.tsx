import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { OrderView } from '../../services/shop-api';
import { describeNested, findNestedInteractive } from '../ui/nested-interactive';
import { OrderCard } from './order-card';

const ORDER = {
  id: 'o1', code: 'TUBU-777', status: 'DELIVERED', total: 149000, createdAt: '2026-09-20T08:00:00.000Z',
  items: [
    { id: 'i1', variationId: 'v1', productName: 'Nước rửa chén', productSlug: 'nrc', variationName: 'Chanh', unitPrice: 65000, quantity: 2, total: 130000, backorderedQty: 0, thumbnail: 'https://img.test/a.jpg' },
    { id: 'i2', variationId: 'v2', productName: 'Xà phòng', productSlug: null, variationName: '', unitPrice: 19000, quantity: 1, total: 19000, backorderedQty: 0 },
  ],
} as unknown as OrderView;

const openButton = () => screen.getByRole('button', { name: 'Đơn TUBU-777' });
const shell = () => screen.getByTestId('order-card');

describe('OrderCard', () => {
  it('ảnh SP đầu, tên + "+1", "3 món", tổng tiền, trạng thái', () => {
    render(<OrderCard order={ORDER} onOpen={() => {}} onReorder={() => {}} />);
    const card = shell();
    expect(card.querySelector('img')).toHaveAttribute('src', 'https://img.test/a.jpg');
    expect(card).toHaveTextContent('Nước rửa chén +1');
    expect(card).toHaveTextContent(/3 món/);
    expect(card).toHaveTextContent('149.000đ');
    expect(card).toHaveTextContent('Giao thành công');
  });

  it('ngày tạo đơn hiện dd/MM/yyyy có đệm số 0 (qua formatDate, không phụ thuộc ICU của webview)', () => {
    render(<OrderCard order={ORDER} onOpen={() => {}} onReorder={() => {}} />);
    expect(shell()).toHaveTextContent('3 món · 20/09/2026');
  });

  it('nút mở đơn có tên "Đơn <mã>" và mô tả là tóm tắt (món, ngày, tổng) để trình đọc màn hình đọc được', () => {
    render(<OrderCard order={ORDER} onOpen={() => {}} onReorder={() => {}} />);
    expect(openButton()).toHaveAccessibleDescription(/Nước rửa chén \+1.*3 món.*149\.000đ/);
  });

  it('"Mua lại" gọi onReorder, KHÔNG mở chi tiết', () => {
    const onOpen = vi.fn();
    const onReorder = vi.fn();
    render(<OrderCard order={ORDER} onOpen={onOpen} onReorder={onReorder} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mua lại' }));
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(openButton());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('đơn đang giao → không có "Mua lại"; không ảnh → icon thay thế', () => {
    render(<OrderCard order={{ ...ORDER, status: 'SHIPPING', items: [{ ...ORDER.items[1]! }] } as OrderView} onOpen={() => {}} onReorder={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Mua lại' })).toBeNull();
    expect(shell().querySelector('img')).toBeNull();
  });

  it('không truyền onReorder → không có "Mua lại" dù đơn đã giao', () => {
    render(<OrderCard order={ORDER} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Mua lại' })).toBeNull();
  });

  it('bàn phím: Tab tới nút mở đơn rồi Enter/Space mở chi tiết; Tab tiếp tới "Mua lại", Enter ở đó không mở chi tiết', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onReorder = vi.fn();
    render(<OrderCard order={ORDER} onOpen={onOpen} onReorder={onReorder} />);
    await user.tab();
    expect(openButton()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(2);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Mua lại' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  describe('không lồng phần tử tương tác (axe nested-interactive)', () => {
    it('thẻ có "Mua lại": không phần tử bấm được nào chứa phần tử focus được khác', () => {
      const { container } = render(<OrderCard order={ORDER} onOpen={() => {}} onReorder={() => {}} />);
      expect(screen.getByRole('button', { name: 'Mua lại' })).toBeInTheDocument();
      expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
    });

    it('vỏ thẻ không phải phần tử tương tác (không role, không tabindex): nút mở đơn là nút thật và "Mua lại" là anh em của nó', () => {
      render(<OrderCard order={ORDER} onOpen={() => {}} onReorder={() => {}} />);
      expect(shell()).not.toHaveAttribute('role');
      expect(shell()).not.toHaveAttribute('tabindex');
      expect(openButton().tagName).toBe('BUTTON');
      expect(openButton()).not.toContainElement(screen.getByRole('button', { name: 'Mua lại' }));
    });

    it('nút mở đơn không có định vị riêng (để ::after phủ đúng cả thẻ) còn vỏ thẻ là relative + isolation; "Mua lại" nổi trên lớp phủ bằng z-index', () => {
      render(<OrderCard order={ORDER} onOpen={() => {}} onReorder={() => {}} />);
      expect(openButton().className).toContain('tubu-tile-link');
      expect(openButton().style.position).toBe('');
      expect(shell().style.position).toBe('relative');
      expect(shell().style.isolation).toBe('isolate');
      let el: HTMLElement | null = screen.getByRole('button', { name: 'Mua lại' });
      let lifted = false;
      while (el && el !== shell()) {
        if (el.style.zIndex === '1') lifted = true;
        el = el.parentElement;
      }
      expect(lifted).toBe(true);
    });

    it('nút mở đơn cao ít nhất 44px (vùng chạm), không làm thẻ cao thêm', () => {
      render(<OrderCard order={ORDER} onOpen={() => {}} onReorder={() => {}} />);
      expect(parseInt(openButton().style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    });

    it('tokens.css có lớp phủ .tubu-tile-link::after kín thẻ (dùng chung với thẻ sản phẩm)', () => {
      const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
      const after = /\.tubu-tile-link::after\s*\{([^}]*)\}/.exec(css);
      expect(after).not.toBeNull();
      for (const decl of ['position: absolute', 'top: 0', 'right: 0', 'bottom: 0', 'left: 0']) expect(after![1]).toContain(decl);
    });
  });
});
