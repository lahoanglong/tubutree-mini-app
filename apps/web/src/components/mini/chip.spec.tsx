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
  return r.container;
};

describe('Chip (web, mini)', () => {
  it('mặc định mở: bấm gọi onPress, có hiệu ứng nhấn, con trỏ tay, không mờ', () => {
    const onPress = vi.fn();
    const chip = mount(<Chip onPress={onPress}>6 tuần</Chip>).querySelector('button')!;
    expect(chip.disabled).toBe(false);
    expect(chip.className).toMatch(/(^|\s)tubu-press(\s|$)/);
    expect(chip.style.cursor).toBe('pointer');
    expect(chip.style.opacity).toBe('');
    click(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled: nút DOM disabled thật, bấm không gọi onPress, bỏ hiệu ứng nhấn, con trỏ không-cho-phép và mờ đi; vẫn giữ vùng chạm 44px và aria-pressed', () => {
    const onPress = vi.fn();
    const chip = mount(
      <Chip selected disabled onPress={onPress}>
        6 tuần
      </Chip>,
    ).querySelector('button')!;
    expect(chip.disabled).toBe(true);
    click(chip);
    expect(onPress).not.toHaveBeenCalled();
    expect(chip.className).not.toMatch(/(^|\s)tubu-press(\s|$)/);
    expect(chip.className).toContain('tubu-hit-44');
    expect(chip.style.cursor).toBe('not-allowed');
    expect(chip.style.opacity).toBe('0.6');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('có href thì vẽ liên kết và bỏ qua disabled: không mờ, vẫn có hiệu ứng nhấn', () => {
    const link = mount(
      <Chip href="/san-pham" disabled>
        Tất cả
      </Chip>,
    ).querySelector('a')!;
    expect(link).not.toBeNull();
    expect(link.className).toMatch(/(^|\s)tubu-press(\s|$)/);
    expect(link.style.cursor).toBe('pointer');
    expect(link.style.opacity).toBe('');
  });
});
