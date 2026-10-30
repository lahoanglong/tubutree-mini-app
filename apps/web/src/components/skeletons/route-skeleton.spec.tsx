// @vitest-environment jsdom
import { render } from '@/test-utils/dom';
import { describe, expect, it, vi } from 'vitest';
import { RouteSkeleton, skeletonKindFor } from './route-skeleton';

vi.mock('next/navigation', () => ({ usePathname: () => '/tai-khoan/diem-xanh' }));

describe('skeletonKindFor (R-76)', () => {
  it('chọn khung chờ theo trang đang mở, tiền tố dài nhất thắng', () => {
    expect(skeletonKindFor('/tai-khoan')).toBe('hub');
    expect(skeletonKindFor('/tai-khoan/diem-xanh')).toBe('loyalty');
    expect(skeletonKindFor('/vuon-xanh')).toBe('game');
    expect(skeletonKindFor('/tai-khoan/vi-tubu')).toBe('balance');
    expect(skeletonKindFor('/tai-khoan/don-hang/TUBU123')).toBe('list');
    expect(skeletonKindFor('/tai-khoan/ho-so')).toBe('form');
    expect(skeletonKindFor('/thanh-toan/chuyen-khoan/TUBU1')).toBe('form');
    expect(skeletonKindFor('/gio-hang')).toBe('list');
  });
  it('đường dẫn lạ hoặc chưa biết dùng khung danh sách', () => {
    expect(skeletonKindFor('/cong-dong')).toBe('list');
    expect(skeletonKindFor(null)).toBe('list');
    expect(skeletonKindFor('/tai-khoan-gia')).toBe('list');
  });
});

describe('RouteSkeleton: chỗ giữ tiêu đề (không nhảy bố cục)', () => {
  const heights = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('[style*="height"]')).map((n) => n.style.height);

  it('standalone loyalty/game (loading.tsx, chưa có PageHeader): dải tiêu đề cỡ PageHeader trên điện thoại, không thanh 24px, khối cách mt-4', () => {
    for (const kind of ['loyalty', 'game'] as const) {
      const { container } = render(<RouteSkeleton kind={kind} standalone />);
      const band = container.querySelector('[data-page-bleed]') as HTMLElement;
      expect(band.className).toContain('max-md:pt-[calc(12px+var(--safe-top))]');
      expect(band.className).toContain('max-md:bg-[var(--color-bg-surface)]');
      expect(container.querySelector('[role="status"]')?.className).not.toMatch(/(^|\s)py-4/);
      expect(container.querySelector('.mt-4')).not.toBeNull();
      expect((band.firstElementChild as HTMLElement).getAttribute('style')).toContain('calc(var(--type-title-lg-size) * var(--type-title-lg-lh))');
    }
  });

  it('standalone kiểu khác (hub, list): vẫn thanh tiêu đề 24 và py-4', () => {
    const { container } = render(<RouteSkeleton kind="list" standalone />);
    expect(heights(container)[0]).toBe('24px');
    expect(container.querySelector('[role="status"]')?.className).toContain('py-4');
  });

  it('mặc định (AuthLoading trong khung trang, đã có PageHeader): bỏ thanh tiêu đề và py-4', () => {
    const { container } = render(<RouteSkeleton kind="loyalty" />);
    expect(heights(container)[0]).toBe('180px');
    expect(container.querySelector('[role="status"]')?.className).not.toContain('py-4');
    const game = render(<RouteSkeleton kind="game" />);
    expect(heights(game.container)[0]).toBe('160px');
  });
});
