// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { ConfirmSheet } from './confirm-sheet';

const base = { title: 'Bỏ món khỏi combo?', message: 'Combo X sẽ mất giảm 5.000đ.', confirmLabel: 'Vẫn bỏ', onConfirm: () => {}, onCancel: () => {} };

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')];
const byName = (name: string) => buttons().find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!;

afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.style.overflow = '';
});

describe('ConfirmSheet (web)', () => {
  it('hiện tiêu đề, lời nhắc và hai nút; đóng thì không có gì trong DOM', () => {
    mount(<ConfirmSheet open {...base} />);
    const dlg = document.querySelector('[role="alertdialog"]')!;
    expect(dlg.textContent).toContain('Bỏ món khỏi combo?');
    expect(dlg.textContent).toContain('Combo X sẽ mất giảm 5.000đ.');
    expect(byName('Vẫn bỏ')).toBeDefined();
    expect(byName('Huỷ')).toBeDefined();
    mounted.pop()!.unmount();
    mount(<ConfirmSheet open={false} {...base} />);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('nút xác nhận gọi onConfirm; Huỷ và nút Đóng gọi onCancel; nhãn Huỷ đổi được', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    mount(<ConfirmSheet open {...base} cancelLabel="Giữ lại" onConfirm={onConfirm} onCancel={onCancel} />);
    click(byName('Vẫn bỏ'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    click(byName('Giữ lại'));
    click(byName('Đóng'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
