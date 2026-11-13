// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRef } from 'react';
import { LoadError, ScrollRegion, STICKY_FIRST_TD, STICKY_FIRST_TH, STICKY_TH } from './ui';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

describe('LoadError (một định nghĩa chung)', () => {
  it('nhận nội dung bằng children hoặc bằng message; có role="alert" và nút Thử lại cao 44px', () => {
    const a = mount(<LoadError onRetry={() => {}}>Không tải được <b>danh sách</b>.</LoadError>);
    expect(a.container.querySelector('[role="alert"]')?.textContent).toContain('Không tải được danh sách.');
    const b = mount(<LoadError message="Không tải được đơn." onRetry={() => {}} />);
    expect(b.container.querySelector('[role="alert"]')?.textContent).toContain('Không tải được đơn.');
    expect(byText(b.container, 'button', 'Thử lại')!.className).toContain('min-h-[44px]');
  });

  it('onRetry trả Promise: nút báo bận bằng aria-busy/aria-disabled (không disabled) và chạm đúp chỉ gọi một lần', async () => {
    let release!: () => void;
    const onRetry = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const { container } = mount(<LoadError message="Lỗi." onRetry={onRetry} />);
    const btn = byText(container, 'button', 'Thử lại') as HTMLButtonElement;
    click(btn);
    click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    release();
    await flush();
    expect(btn.getAttribute('aria-busy')).toBeNull();
    click(btn);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('retrying (lần tải lại đến từ nơi khác): báo bận và bỏ qua cú chạm', () => {
    const onRetry = vi.fn();
    const { container } = mount(<LoadError message="Lỗi." onRetry={onRetry} retrying />);
    const btn = byText(container, 'button', 'Thử lại') as HTMLButtonElement;
    expect(btn.getAttribute('aria-busy')).toBe('true');
    click(btn);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('onRetry trả void: không khoá, gọi mỗi lần chạm', () => {
    const onRetry = vi.fn();
    const { container } = mount(<LoadError message="Lỗi." onRetry={onRetry} />);
    const btn = byText(container, 'button', 'Thử lại')!;
    click(btn);
    click(btn);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});

describe('ScrollRegion stickyHead', () => {
  it('mặc định chỉ cuộn ngang; stickyHead cho khung tự cuộn dọc có trần chiều cao để tiêu đề dính bám theo khung', () => {
    const plain = mount(<ScrollRegion label="Bảng A"><table /></ScrollRegion>);
    const plainRegion = plain.container.querySelector('[role="region"]')!;
    expect(plainRegion.className).toContain('overflow-x-auto');
    expect(plainRegion.className).not.toContain('max-h-');
    const sticky = mount(<ScrollRegion label="Bảng B" stickyHead className="rounded-card"><table /></ScrollRegion>);
    const region = sticky.container.querySelector('[role="region"]')!;
    expect(region.className).toContain('overflow-auto');
    expect(region.className).toContain('max-h-[70vh]');
    expect(region.className).toContain('rounded-card');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-label')).toBe('Bảng B');
  });

  it('nhận ref để AdminPagination cuộn về đầu bảng', () => {
    const ref = createRef<HTMLDivElement>();
    mount(<ScrollRegion label="Bảng" ref={ref}><table /></ScrollRegion>);
    expect(ref.current?.getAttribute('aria-label')).toBe('Bảng');
  });

  it('lớp dính có nền đặc (không lộ hàng cuộn qua) và cột đầu nổi trên hàng thường', () => {
    for (const cls of [STICKY_TH, STICKY_FIRST_TH, STICKY_FIRST_TD]) {
      expect(cls).toContain('sticky');
      expect(cls).toMatch(/\bbg-stone-(0|50)\b/);
    }
    expect(STICKY_TH).toContain('top-0');
    expect(STICKY_FIRST_TH).toMatch(/left-0.*top-0|top-0.*left-0/);
    expect(STICKY_FIRST_TD).toContain('left-0');
    expect(STICKY_FIRST_TD).toContain('group-hover:bg-stone-50');
  });
});
