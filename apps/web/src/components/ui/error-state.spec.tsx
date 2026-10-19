// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { ErrorState } from './error-state';

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('ErrorState', () => {
  it('chữ mặc định, role alert, nút Thử lại gọi onRetry', () => {
    const onRetry = vi.fn();
    const { container } = mount(<ErrorState onRetry={onRetry} />);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Đã có lỗi xảy ra — Vui lòng thử lại');
    click(container.querySelector('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button')!.textContent).toBe('Thử lại');
  });

  it('không có onRetry thì không có nút; message tuỳ biến', () => {
    const { container } = mount(<ErrorState message="Không tải được đơn" />);
    expect(container.textContent).toBe('Không tải được đơn');
    expect(container.querySelector('button')).toBeNull();
  });
});
