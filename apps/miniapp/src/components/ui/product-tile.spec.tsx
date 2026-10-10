import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ProductTile } from './product-tile';

const PRODUCT = {
  id: 'p1', slug: 'serum-x', name: 'Serum Bã Trầu', brand: 'Tubu', thumbnail: null,
  basePrice: 52000, salePrice: null, inStock: true, reviewCount: 12, ratingAvg: 4.5, sold: 340,
};

// ProductTile hiện WishlistHeart mặc định (showWishlist=true ở mọi variant trừ line/list) —
// WishlistHeart dùng useQueryClient() (@tanstack/react-query), không có fallback no-op nếu thiếu
// Provider ("No QueryClient set" throw ngay khi render). Bọc QueryClientProvider thật, giống
// pattern address-form.spec.tsx đã dùng cho vấn đề tương tự.
function renderTile(ui: ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ProductTile', () => {
  it('grid variant shows price, name, out-of-stock overlay when inStock=false (fixes A4-06)', () => {
    renderTile(<ProductTile product={{ ...PRODUCT, inStock: false }} variant="grid" onPress={() => {}} />);
    expect(screen.getByText(/tạm hết|hết hàng/i)).toBeInTheDocument();
  });
  it('missing inStock (old API without the field) does NOT show the out-of-stock overlay', () => {
    const { inStock: _omit, ...noStock } = PRODUCT;
    renderTile(<ProductTile product={noStock as unknown as typeof PRODUCT} variant="grid" onPress={() => {}} />);
    expect(screen.queryByText(/tạm hết|hết hàng/i)).not.toBeInTheDocument();
  });
  it('flash priceOverride wins over salePrice/basePrice and shows a flash badge', () => {
    renderTile(<ProductTile product={{ ...PRODUCT, salePrice: 45000 }} priceOverride={{ price: 39000 }} variant="grid" onPress={() => {}} />);
    expect(screen.getByText('39.000đ')).toBeInTheDocument();
  });
  it('action="rebuy" shows a Mua lại button instead of the default add-to-cart affordance', () => {
    const onAction = vi.fn();
    renderTile(<ProductTile product={PRODUCT} variant="line" action="rebuy" onPress={() => {}} onAction={onAction} />);
    screen.getByText('Mua lại').click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  it('onPress fires when the tile itself (not a nested button) is clicked', () => {
    const onPress = vi.fn();
    renderTile(<ProductTile product={PRODUCT} variant="grid" onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Serum Bã Trầu' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('clicking "Mua lại" does NOT also fire the tile\'s onPress (click isolation, no accidental navigation)', () => {
    const onPress = vi.fn();
    const onAction = vi.fn();
    renderTile(<ProductTile product={PRODUCT} variant="line" action="rebuy" onPress={onPress} onAction={onAction} />);
    screen.getByText('Mua lại').click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });
  it('out-of-stock product with action="rebuy" still shows the overlay (A4-06 applies regardless of action)', () => {
    renderTile(<ProductTile product={{ ...PRODUCT, inStock: false }} variant="line" action="rebuy" onPress={() => {}} onAction={() => {}} />);
    expect(screen.getByText(/tạm hết|hết hàng/i)).toBeInTheDocument();
    expect(screen.getByText('Mua lại')).toBeInTheDocument();
  });
  it('rail + rebuy: nút "Mua lại" nằm hàng riêng, full width, không bị min-width 120px của ZaUI làm tràn thẻ 148px', () => {
    renderTile(<ProductTile product={PRODUCT} variant="rail" action="rebuy" showWishlist={false} onPress={() => {}} onAction={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Mua lại' });
    expect(btn.className).toContain('zaui-btn-full-width');
    expect(btn).toHaveStyle({ minWidth: '0px' });
  });
  it('bàn phím: nút tên nằm trong thứ tự Tab, Enter / Space gọi onPress; phím trên tim yêu thích KHÔNG kích hoạt thẻ', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    renderTile(<ProductTile product={PRODUCT} variant="grid" onPress={onPress} />);
    const link = screen.getByRole('button', { name: 'Serum Bã Trầu' });
    expect(link.tagName).toBe('BUTTON');
    expect(link.tabIndex).toBe(0);
    link.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onPress).toHaveBeenCalledTimes(2);
    screen.getByRole('button', { name: /yêu thích/i }).focus();
    await user.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledTimes(2);
  });
  it('tên truy cập = tên sản phẩm; giá đang hiển thị nằm trong mô tả truy cập', () => {
    renderTile(<ProductTile product={{ ...PRODUCT, salePrice: 45000 }} priceOverride={{ price: 39000 }} variant="grid" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Serum Bã Trầu' })).toHaveAccessibleDescription(/39.000/);
  });
  it('bọc giá cho aria-describedby phải là display:flex: span thường tạo line box 24px làm thẻ cao hơn 4px so với skeleton 133px (pin chiều cao thật: e2e Task 26)', () => {
    renderTile(<ProductTile product={PRODUCT} variant="grid" onPress={() => {}} />);
    const tile = screen.getByRole('button', { name: 'Serum Bã Trầu' });
    const wrapper = document.getElementById(tile.getAttribute('aria-describedby')!)!;
    expect(wrapper).toHaveStyle({ display: 'flex' });
  });

  describe('không lồng phần tử tương tác (C-072, axe nested-interactive)', () => {
    const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';

    function expectNoNestedInteractive(container: HTMLElement) {
      const nested = Array.from(container.querySelectorAll(INTERACTIVE)).filter((el) => el.querySelector(INTERACTIVE));
      expect(nested.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
    }

    it('thẻ lưới có tim: không phần tử bấm được nào chứa phần tử bấm được khác', () => {
      const { container } = renderTile(<ProductTile product={PRODUCT} variant="grid" onPress={() => {}} />);
      expect(screen.getByRole('button', { name: /yêu thích/i })).toBeInTheDocument();
      expectNoNestedInteractive(container);
    });

    it('thẻ kệ "Mua lại": nút Mua lại cũng không nằm trong phần tử bấm được', () => {
      const { container } = renderTile(
        <ProductTile product={PRODUCT} variant="rail" action="rebuy" showWishlist={false} onPress={() => {}} onAction={() => {}} />,
      );
      expect(screen.getByRole('button', { name: 'Mua lại' })).toBeInTheDocument();
      expectNoNestedInteractive(container);
    });

    it('nút tên không có định vị riêng (để ::after phủ đúng cả thẻ) còn vỏ thẻ là position:relative', () => {
      const { container } = renderTile(<ProductTile product={PRODUCT} variant="grid" onPress={() => {}} />);
      const link = screen.getByRole('button', { name: 'Serum Bã Trầu' });
      expect(link.className).toContain('tubu-tile-link');
      expect(link.style.position).toBe('');
      expect((container.firstElementChild as HTMLElement).style.position).toBe('relative');
    });

    it('vỏ thẻ tạo stacking context riêng (isolation) để z-index 1 của tim/Mua lại không nổi lên trên thanh dính của trang', () => {
      const { container } = renderTile(<ProductTile product={PRODUCT} variant="grid" onPress={() => {}} />);
      expect((container.firstElementChild as HTMLElement).style.isolation).toBe('isolate');
    });

    it('tim và Mua lại nổi trên lớp phủ bằng z-index; ảnh chỉ để trang trí (tên đã có ở nút tên)', () => {
      const { container } = renderTile(
        <ProductTile product={{ ...PRODUCT, thumbnail: 'https://x/a.jpg' }} variant="grid" action="rebuy" onAction={() => {}} onPress={() => {}} />,
      );
      for (const name of [/yêu thích/i, 'Mua lại']) {
        let el: HTMLElement | null = screen.getByRole('button', { name });
        let lifted = false;
        while (el && el !== container) {
          if (el.style.zIndex === '1') lifted = true;
          el = el.parentElement;
        }
        expect(lifted).toBe(true);
      }
      expect(container.querySelector('img')).toHaveAttribute('alt', '');
    });

    it('tokens.css có lớp phủ .tubu-tile-link::after kín thẻ và vòng focus vẽ trên lớp phủ', () => {
      const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
      const after = /\.tubu-tile-link::after\s*\{([^}]*)\}/.exec(css);
      expect(after).not.toBeNull();
      for (const decl of ['position: absolute', 'top: 0', 'right: 0', 'bottom: 0', 'left: 0']) expect(after![1]).toContain(decl);
      expect(css).toMatch(/\.tubu-tile-link:focus-visible::after\s*\{[^}]*outline:/);
    });
  });
});
