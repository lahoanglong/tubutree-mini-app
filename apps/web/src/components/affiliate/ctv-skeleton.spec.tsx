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

  it('báo trạng thái đang tải cho trình đọc màn hình', () => {
    mounted = render(<CtvDashboardSkeleton />);
    const root = mounted.container.querySelector('[data-testid="ctv-skeleton"]')!;
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(root.textContent).toBe('Đang tải…');
  });
});
