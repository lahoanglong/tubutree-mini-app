// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { ProgressBar } from './progress-bar';

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
const fill = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="progress-fill"]')!;

describe('ProgressBar', () => {
  it('ariaLabel đặt tên cho thanh mà không in thêm chữ nhìn thấy', () => {
    const { container } = mount(<ProgressBar value={1} max={4} ariaLabel="Đã bán 25%" />);
    expect(container.querySelector('[role="progressbar"]')!.getAttribute('aria-label')).toBe('Đã bán 25%');
    expect(container.textContent).toBe('');
  });

  it('độ rộng theo phần trăm, kẹp 0..100', () => {
    expect(fill(mount(<ProgressBar value={30} max={120} />).container).style.width).toBe('25%');
    expect(fill(mount(<ProgressBar value={500} max={100} />).container).style.width).toBe('100%');
    expect(fill(mount(<ProgressBar value={-5} max={100} />).container).style.width).toBe('0%');
  });

  it('max bằng 0 không ra NaN', () => {
    expect(fill(mount(<ProgressBar value={3} max={0} />).container).style.width).toBe('0%');
  });

  it('role progressbar có giá trị và nhãn; tông flash đổi màu', () => {
    const { container } = mount(<ProgressBar value={4} max={10} label="Đã bán" tone="flash" />);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('4');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    expect(bar.getAttribute('aria-label')).toBe('Đã bán');
    expect(fill(container).className).toContain('bg-promo-solid');
  });
});
