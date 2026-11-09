// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { Chip } from './chip';

// Cùng ý nghĩa chip.spec.tsx của Mini App: disabled là nút DOM thật, bấm không gọi onPress, bỏ hiệu ứng nhấn.

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r.container.querySelector('button')!;
};

describe('Chip (web)', () => {
  it('mặc định mở: bấm gọi onPress, có hiệu ứng nhấn, không mờ', () => {
    const onPress = vi.fn();
    const chip = mount(<Chip selected={false} onPress={onPress}>6 tuần</Chip>);
    expect(chip.disabled).toBe(false);
    expect(chip.className).toContain('tubu-press');
    expect(chip.className).not.toContain('opacity-60');
    expect(chip.className).not.toContain('cursor-not-allowed');
    click(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled: nút DOM disabled thật, bấm không gọi onPress, bỏ hiệu ứng nhấn, con trỏ không-cho-phép và mờ đi; vẫn giữ vùng chạm 44px và aria-pressed', () => {
    const onPress = vi.fn();
    const chip = mount(<Chip selected disabled onPress={onPress}>6 tuần</Chip>);
    expect(chip.disabled).toBe(true);
    click(chip);
    expect(onPress).not.toHaveBeenCalled();
    expect(chip.className).not.toMatch(/(^|\s)tubu-press(\s|$)/);
    expect(chip.className).toContain('tubu-hit-44');
    expect(chip.className).toContain('cursor-not-allowed');
    expect(chip.className).toContain('opacity-60');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });
});
