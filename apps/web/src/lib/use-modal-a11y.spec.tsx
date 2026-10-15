// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { focusableIn, useModalA11y } from './use-modal-a11y';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

function Modal({ onClose, label = 'Hop', children }: { onClose: () => void; label?: string; children?: ReactNode }) {
  const ref = useModalA11y<HTMLDivElement>(onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
      {children === undefined ? (
        <>
          <button id={`${label}-a`}>A</button>
          <button id={`${label}-b`}>B</button>
          <button id={`${label}-c`}>C</button>
        </>
      ) : (
        children
      )}
    </div>
  );
}

const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
const key = (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(e);
  });
  return e;
};
const byId = (id: string) => document.getElementById(id) as HTMLElement;
const dialogEl = () => document.querySelector('[role="dialog"]') as HTMLElement;

describe('useModalA11y', () => {
  it('mở: focus vào khung, khóa cuộn nền; đóng: trả focus về chỗ đã mở và mở lại cuộn nền', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    document.body.style.overflow = 'scroll';
    const r = mount(<Modal onClose={() => undefined} />);
    expect(document.activeElement).toBe(dialogEl());
    expect(document.body.style.overflow).toBe('hidden');
    r.unmount();
    mounted = [];
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('Esc gọi onClose đúng một lần và chặn hành vi mặc định', () => {
    const onClose = vi.fn();
    mount(<Modal onClose={onClose} />);
    const e = key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('Esc bị bỏ qua khi phím đã bị xử lý, khi đang gõ IME, hoặc khi hộp xác nhận (alertdialog) đang mở phía trên', () => {
    const onClose = vi.fn();
    mount(<Modal onClose={onClose} />);
    document.addEventListener('keydown', (e) => e.preventDefault(), { once: true, capture: true });
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
    key('Escape', { isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    const alert = document.createElement('div');
    alert.setAttribute('role', 'alertdialog');
    document.body.appendChild(alert);
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
    alert.remove();
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('alertdialog nằm TRƯỚC khung trong DOM (trang nền) không chặn Esc của hộp đang mở', () => {
    const background = document.createElement('div');
    background.setAttribute('role', 'alertdialog');
    document.body.appendChild(background);
    const onClose = vi.fn();
    mount(<Modal onClose={onClose} />);
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab ở nút cuối quay về nút đầu; Shift+Tab ở nút đầu hoặc ở khung quay xuống nút cuối', () => {
    mount(<Modal onClose={() => undefined} />);
    byId('Hop-c').focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('Hop-a'));
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('Hop-c'));
    dialogEl().focus();
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('Hop-c'));
  });

  it('Tab giữa khung để trình duyệt tự đi tiếp; Tab từ ngoài khung kéo focus về nút đầu', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    mount(<Modal onClose={() => undefined} />);
    byId('Hop-a').focus();
    expect(key('Tab').defaultPrevented).toBe(false);
    outside.focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('Hop-a'));
  });

  it('khung không có phần tử focus được thì Tab giữ focus ở khung', () => {
    mount(
      <Modal onClose={() => undefined}>
        <p>Chỉ có chữ</p>
      </Modal>,
    );
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialogEl());
  });

  it('bỏ qua phần tử bị ẩn/disabled khi tính nút đầu/cuối', () => {
    mount(
      <Modal onClose={() => undefined}>
        <button id="x1" disabled>
          x1
        </button>
        <button id="x2">x2</button>
        <div hidden>
          <button id="x3">x3</button>
        </div>
      </Modal>,
    );
    expect(focusableIn(dialogEl()).map((i) => i.id)).toEqual(['x2']);
  });

  it('hai hộp chồng nhau: chỉ hộp trên cùng nhận Esc; nền chỉ mở cuộn lại khi hộp cuối đóng', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    mount(<Modal onClose={closeA} label="A" />);
    const second = mount(<Modal onClose={closeB} label="B" />);
    key('Escape');
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
    second.unmount();
    mounted = mounted.slice(0, 1);
    expect(document.body.style.overflow).toBe('hidden');
    key('Escape');
    expect(closeA).toHaveBeenCalledTimes(1);
    mounted.pop()!.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
