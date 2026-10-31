import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShopTopBar } from './shop-top-bar';

function scrollPageTo(top: number) {
  const page = document.querySelector('.zaui-page') as HTMLElement;
  Object.defineProperty(page, 'scrollTop', { value: top, configurable: true });
  act(() => {
    fireEvent.scroll(page);
  });
}

function renderWithPage(threshold?: number) {
  return render(
    <div className="zaui-page">
      <ShopTopBar title="Gian hàng Lan" threshold={threshold} />
    </div>,
  );
}

describe('ShopTopBar', () => {
  it('chưa cuộn qua bìa: tên shop ẩn khỏi trình đọc và mờ', () => {
    renderWithPage(100);
    const bar = screen.getByTestId('shop-top-bar');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar.style.opacity).toBe('0');
  });

  it('cuộn quá ngưỡng thì hiện tên shop, cuộn về thì ẩn', () => {
    renderWithPage(100);
    scrollPageTo(140);
    const bar = screen.getByTestId('shop-top-bar');
    expect(bar).toHaveAttribute('aria-hidden', 'false');
    expect(bar.style.opacity).toBe('1');
    expect(bar).toHaveTextContent('Gian hàng Lan');
    scrollPageTo(10);
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it('nằm trên nền đặc của BackButton (zIndex 199) để chữ không bị che', () => {
    renderWithPage(100);
    expect(Number(screen.getByTestId('shop-top-bar').style.zIndex)).toBeGreaterThan(199);
  });

  it('không chặn chạm vào nút lùi nằm dưới', () => {
    renderWithPage(100);
    expect(screen.getByTestId('shop-top-bar').style.pointerEvents).toBe('none');
  });

  it('cuộn ở vùng con (hàng ngang) không làm đổi trạng thái', () => {
    render(
      <div className="zaui-page">
        <ShopTopBar title="Shop" threshold={50} />
        <div data-testid="row" className="scroll-x" />
      </div>,
    );
    const row = screen.getByTestId('row');
    Object.defineProperty(row, 'scrollTop', { value: 500, configurable: true });
    act(() => {
      fireEvent.scroll(row);
    });
    expect(screen.getByTestId('shop-top-bar')).toHaveAttribute('aria-hidden', 'true');
  });
});
