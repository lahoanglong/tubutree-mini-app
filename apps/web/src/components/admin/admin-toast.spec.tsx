// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, useState } from 'react';
import { AdminToastProvider, useAdminToast, useToastedMessage, type AdminMsg } from './admin-toast';
import { click, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

const region = (root: ParentNode) => root.querySelector<HTMLElement>('[data-admin-toast-region]')!;
const toasts = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>('[data-admin-toast]'));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function Trigger({ text, tone }: { text: string; tone?: 'success' | 'info' | 'danger' }) {
  const toast = useAdminToast();
  return (
    <button type="button" onClick={() => toast.show(text, tone)}>
      bấm {text}
    </button>
  );
}
const press = (root: ParentNode, text: string) => click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === `bấm ${text}`) ?? null);

describe('AdminToastProvider', () => {
  it('vùng aria-live="polite" có mặt từ đầu (trước khi có thông báo) và đặt ở góc dưới phải từ sm, phía trên ở điện thoại', () => {
    const { container } = mount(<AdminToastProvider><p>nội dung</p></AdminToastProvider>);
    const r = region(container);
    expect(r.getAttribute('aria-live')).toBe('polite');
    expect(r.className).toContain('fixed');
    expect(r.className).toContain('sm:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]');
    expect(r.className).toContain('sm:right-4');
    expect(r.className).toContain('top-[calc(0.75rem+env(safe-area-inset-top,0px))]');
    expect(r.className).toContain('pointer-events-none');
    expect(container.textContent).toContain('nội dung');
  });

  it('show: hiện toast trong vùng aria-live; thành công tự tắt sau 5 giây', () => {
    const { container } = mount(<AdminToastProvider><Trigger text="Đã lưu." tone="success" /></AdminToastProvider>);
    press(container, 'Đã lưu.');
    expect(toasts(region(container)).map((t) => t.textContent)).toEqual(['Đã lưu.']);
    expect(toasts(container)[0]!.className).toContain('border-success-fg');
    expect(toasts(container)[0]!.className).toContain('pointer-events-auto');
    tick(4999);
    expect(toasts(container)).toHaveLength(1);
    tick(2);
    expect(toasts(container)).toHaveLength(0);
  });

  it('lỗi KHÔNG tự tắt: chỉ biến mất khi bấm Đóng thông báo', () => {
    const { container } = mount(<AdminToastProvider><Trigger text="Không lưu được." tone="danger" /></AdminToastProvider>);
    press(container, 'Không lưu được.');
    expect(toasts(container)[0]!.className).toContain('border-danger-fg');
    tick(60_000);
    expect(toasts(container)).toHaveLength(1);
    const close = toasts(container)[0]!.querySelector<HTMLButtonElement>('button[aria-label="Đóng thông báo"]')!;
    expect(close.className).toContain('min-h-[44px]');
    click(close);
    expect(toasts(container)).toHaveLength(0);
  });

  it('đưa focus vào thẻ thì dừng đếm; rời ra thì đếm lại từ đầu', () => {
    const { container } = mount(<AdminToastProvider><Trigger text="Đã xong." tone="info" /></AdminToastProvider>);
    press(container, 'Đã xong.');
    const card = toasts(container)[0]!;
    tick(4000);
    act(() => void card.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    tick(60_000);
    expect(toasts(container)).toHaveLength(1);
    act(() => void card.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    tick(4999);
    expect(toasts(container)).toHaveLength(1);
    tick(2);
    expect(toasts(container)).toHaveLength(0);
  });

  it('tối đa 4 thẻ cùng lúc: thẻ mới đẩy thẻ cũ nhất ra', () => {
    const { container } = mount(
      <AdminToastProvider>
        {['a', 'b', 'c', 'd', 'e'].map((x) => <Trigger key={x} text={`lỗi ${x}`} tone="danger" />)}
      </AdminToastProvider>,
    );
    for (const x of ['a', 'b', 'c', 'd', 'e']) press(container, `lỗi ${x}`);
    expect(toasts(container).map((t) => t.textContent)).toEqual(['lỗi b', 'lỗi c', 'lỗi d', 'lỗi e']);
  });
});

describe('useAdminToast không có provider', () => {
  it('`active` là false và show không làm gì (tab dùng riêng không vỡ)', () => {
    let seen: ReturnType<typeof useAdminToast> | undefined;
    function Probe() {
      seen = useAdminToast();
      return null;
    }
    mount(<Probe />);
    expect(seen!.active).toBe(false);
    expect(() => seen!.show('x', 'danger')).not.toThrow();
  });
});

describe('useToastedMessage', () => {
  function Tab({ successOnly = false }: { successOnly?: boolean }) {
    const [msg, setMsg] = useState<AdminMsg | null>(null);
    const inline = useToastedMessage(msg, { successOnly });
    return (
      <div>
        <button type="button" onClick={() => setMsg({ ok: true, text: 'Đã khoá An.' })}>ok</button>
        <button type="button" onClick={() => setMsg({ ok: false, text: 'Lỗi mạng.' })}>lỗi</button>
        {inline && <p data-inline>{inline.text}</p>}
      </div>
    );
  }
  const btn = (root: ParentNode, text: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) ?? null;

  it('không có provider: giữ nguyên thông báo inline như trước', () => {
    const { container } = mount(<Tab />);
    click(btn(container, 'ok'));
    expect(container.querySelector('[data-inline]')?.textContent).toBe('Đã khoá An.');
  });

  it('có provider: đẩy lên toast và KHÔNG vẽ inline nữa (không đọc hai lần)', () => {
    const { container } = mount(<AdminToastProvider><Tab /></AdminToastProvider>);
    click(btn(container, 'ok'));
    expect(container.querySelector('[data-inline]')).toBeNull();
    expect(toasts(container).map((t) => t.textContent)).toEqual(['Đã khoá An.']);
    click(btn(container, 'lỗi'));
    expect(toasts(container).map((t) => t.className.includes('border-danger-fg'))).toEqual([false, true]);
  });

  it('cùng một chữ bấm lần hai vẫn hiện toast lần hai', () => {
    const { container } = mount(<AdminToastProvider><Tab /></AdminToastProvider>);
    click(btn(container, 'ok'));
    click(btn(container, 'ok'));
    expect(toasts(container)).toHaveLength(2);
  });

  it('successOnly: thành công lên toast, lỗi vẫn inline và không có toast lỗi', () => {
    const { container } = mount(<AdminToastProvider><Tab successOnly /></AdminToastProvider>);
    click(btn(container, 'lỗi'));
    expect(container.querySelector('[data-inline]')?.textContent).toBe('Lỗi mạng.');
    expect(toasts(container)).toHaveLength(0);
    click(btn(container, 'ok'));
    expect(container.querySelector('[data-inline]')).toBeNull();
    expect(toasts(container).map((t) => t.textContent)).toEqual(['Đã khoá An.']);
  });
});
