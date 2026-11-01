// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { MoveButtons } from './move-buttons';

const base = { id: 'i1', name: 'Kem dưỡng', canUp: true, canDown: true, onMove: () => undefined };
const byName = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

describe('MoveButtons (web)', () => {
  it('tên nút có tên món; khối thì có chữ "khối"', () => {
    mount(<MoveButtons {...base} />);
    expect(byName('Đưa Kem dưỡng lên')).toBeTruthy();
    expect(byName('Đưa Kem dưỡng xuống')).toBeTruthy();
    mount(<MoveButtons {...base} name="Bếp xanh" scope="section" />);
    expect(byName('Đưa khối Bếp xanh lên')).toBeTruthy();
  });

  it('còn dời được: bấm gọi onMove với hướng, nút mang data-move-id/dir', () => {
    const onMove = vi.fn();
    mount(<MoveButtons {...base} onMove={onMove} />);
    const down = byName('Đưa Kem dưỡng xuống');
    expect(down.dataset.moveId).toBe('i1');
    expect(down.dataset.moveDir).toBe('down');
    click(down);
    expect(onMove).toHaveBeenCalledWith('down');
  });

  it('ở rìa: aria-disabled, không phải disabled; bấm gọi onBlocked; vẫn nhận focus', () => {
    const onMove = vi.fn();
    const onBlocked = vi.fn();
    mount(<MoveButtons {...base} canUp={false} onMove={onMove} onBlocked={onBlocked} />);
    const up = byName('Đưa Kem dưỡng lên');
    expect(up.getAttribute('aria-disabled')).toBe('true');
    expect(up.hasAttribute('disabled')).toBe(false);
    up.focus();
    expect(document.activeElement).toBe(up);
    click(up);
    expect(onMove).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith('up');
    expect(document.activeElement).toBe(up);
  });

  it('vùng chạm vuông 44', () => {
    mount(<MoveButtons {...base} />);
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
      expect(parseFloat(b.style.minWidth)).toBeGreaterThanOrEqual(44);
      expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });
});
