// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { mount } from './harness';
import { ShopTopBar } from './shop-top-bar';

const bar = () => document.querySelector<HTMLElement>('[data-testid="shop-top-bar"]')!;
function scrollWindowTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

describe('ShopTopBar (web)', () => {
  it('chưa cuộn qua bìa: tên shop ẩn khỏi trình đọc và mờ', () => {
    scrollWindowTo(0);
    mount(<ShopTopBar title="Gian hàng Lan" threshold={100} />);
    expect(bar().getAttribute('aria-hidden')).toBe('true');
    expect(bar().style.opacity).toBe('0');
  });

  it('cuộn quá ngưỡng thì hiện tên shop, cuộn về thì ẩn', () => {
    scrollWindowTo(0);
    mount(<ShopTopBar title="Gian hàng Lan" threshold={100} />);
    scrollWindowTo(140);
    expect(bar().getAttribute('aria-hidden')).toBe('false');
    expect(bar().style.opacity).toBe('1');
    expect(bar().textContent).toBe('Gian hàng Lan');
    scrollWindowTo(10);
    expect(bar().getAttribute('aria-hidden')).toBe('true');
  });

  it('không chặn chạm vào nút lùi nằm dưới; chỉ hiện ở khổ điện thoại', () => {
    scrollWindowTo(0);
    mount(<ShopTopBar title="Shop" threshold={100} />);
    expect(bar().style.pointerEvents).toBe('none');
    expect(bar().className).toContain('md:hidden');
  });

  it('đặt đúng vị trí ban đầu khi trang đã cuộn sẵn (quay lại từ trang khác)', () => {
    scrollWindowTo(300);
    mount(<ShopTopBar title="Shop" threshold={100} />);
    expect(bar().getAttribute('aria-hidden')).toBe('false');
  });
});
