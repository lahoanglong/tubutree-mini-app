// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { CtvDashboardSkeleton } from './ctv-skeleton';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('CtvDashboardSkeleton', () => {
  it('vẽ đúng hình trang CTV: một thẻ hoa hồng, bốn lối tắt, hai ô số liệu', () => {
    mounted = render(<CtvDashboardSkeleton />);
    const blocks = Array.from(mounted.container.querySelectorAll<HTMLElement>('[data-skeleton]'));
    expect(blocks).toHaveLength(7);
    expect(blocks[0]!.style.height).toBe('160px');
    expect(blocks.slice(1, 5).map((b) => b.style.height)).toEqual(['98px', '98px', '98px', '98px']);
    expect(blocks.slice(5).map((b) => b.style.height)).toEqual(['98px', '98px']);
    const grids = Array.from(mounted.container.querySelectorAll('.grid'));
    expect(grids.map((g) => (g.className.match(/grid-cols-(\d)/) ?? [])[1])).toEqual(['4', '2']);
  });

  it('cùng khuôn với bảng điều khiển thật: bám mép trái (không mx-auto), từ lg hai cột 24rem + phần còn lại, thẻ hoa hồng và lối tắt ở cột trái', () => {
    mounted = render(<CtvDashboardSkeleton />);
    const root = mounted.container.querySelector<HTMLElement>('[data-testid="ctv-skeleton"]')!;
    const cls = root.className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(['md:max-w-2xl', 'lg:max-w-none', 'lg:grid', 'lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]']));
    expect(cls).not.toContain('mx-auto');
    const [left, right] = Array.from(root.children).filter((c) => !c.classList.contains('sr-only'));
    expect(left!.className).toContain('lg:col-start-1');
    expect(left!.querySelector('.grid-cols-4')).not.toBeNull();
    expect(right!.className).toContain('lg:col-start-2');
  });

  it('báo trạng thái đang tải cho trình đọc màn hình', () => {
    mounted = render(<CtvDashboardSkeleton />);
    const root = mounted.container.querySelector('[data-testid="ctv-skeleton"]')!;
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(root.textContent).toBe('Đang tải…');
  });
});
