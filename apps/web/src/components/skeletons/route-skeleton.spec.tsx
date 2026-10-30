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

  it('standalone (loading.tsx, chưa có PageHeader): giữ thanh tiêu đề 24 và py-4', () => {
    const { container } = render(<RouteSkeleton kind="loyalty" standalone />);
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
