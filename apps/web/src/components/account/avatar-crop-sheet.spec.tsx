// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';
import { AvatarCropSheet } from './avatar-crop-sheet';

// Chép ý avatar-crop-modal.tsx (Mini App): khung tròn 240px, kéo + thu phóng 1–3, xuất JPEG 200x200, Hủy chọn / Xác nhận dùng.

const drawImage = vi.fn();
const ctx = { beginPath: vi.fn(), arc: vi.fn(), clip: vi.fn(), drawImage };
let mounted: Rendered | null = null;
let imageMode: 'load' | 'error' | 'hold' = 'load';
// Ảnh chưa nạp xong (chế độ 'hold'): ca kiểm gọi hàm để cho nó nạp xong hoặc lỗi.
let held: { load: () => void; fail: () => void }[] = [];

beforeEach(() => {
  drawImage.mockClear();
  imageMode = 'load';
  held = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,Q1JPUA==');
  vi.stubGlobal(
    'Image',
    class {
      width = 400;
      height = 200;
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        if (imageMode === 'hold') {
          held.push({ load: () => this.onload?.(), fail: () => this.onerror?.() });
          return;
        }
        queueMicrotask(() => (imageMode === 'load' ? this.onload?.() : this.onerror?.()));
      }
    },
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = (props: Partial<Parameters<typeof AvatarCropSheet>[0]> = {}) => {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  mounted = render(<AvatarCropSheet open imageSrc="data:image/jpeg;base64,UkFX" onClose={onClose} onConfirm={onConfirm} {...props} />);
  return { onClose, onConfirm };
};

describe('AvatarCropSheet', () => {
  it('đóng hoặc chưa có ảnh thì không dựng gì', () => {
    mount({ open: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    mounted?.unmount();
    mount({ imageSrc: null });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('có hộp thoại "Cắt ảnh đại diện", hướng dẫn kéo/thu phóng, thanh thu phóng 1–3 có tên, mọi nút có tên', () => {
    mount();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Cắt ảnh đại diện');
    expect(dialog.textContent).toContain('Kéo di chuyển hoặc thu phóng để chọn góc mặt đẹp nhất');
    const range = dialog.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect([range.min, range.max, range.step, range.value]).toEqual(['1', '3', '0.05', '1']);
    expect(range.getAttribute('aria-label')).toBe('Thu phóng');
    expect(unnamedControls(dialog as HTMLElement)).toEqual([]);
  });

  it('"Huỷ chọn" đóng, không xác nhận', () => {
    const { onClose, onConfirm } = mount();
    click(byText(document.body, 'button', 'Huỷ chọn'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"Xác nhận dùng" vẽ ảnh vào khung tròn 200x200 theo cách phủ kín (cover) rồi trả data URL JPEG', async () => {
    const { onConfirm } = mount();
    click(byText(document.body, 'button', 'Xác nhận dùng'));
    await flush();
    expect(ctx.arc).toHaveBeenCalledWith(100, 100, 100, 0, Math.PI * 2);
    // Ảnh 400x200 (ngang): chiều cao phủ khung 240 → rộng 480; căn giữa: x = (120 - 240) * 200/240 = -100.
    const [, x, y, w, h] = drawImage.mock.calls[0]!;
    expect([x, y, w, h].map((n) => Math.round(n as number))).toEqual([-100, 0, 400, 200]);
    expect(onConfirm).toHaveBeenCalledWith('data:image/jpeg;base64,Q1JPUA==');
  });

  it('thu phóng đổi vùng cắt', async () => {
    mount();
    const range = document.querySelector<HTMLInputElement>('input[type="range"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(range, '2');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(byText(document.body, 'button', 'Xác nhận dùng'));
    await flush();
    const [, , , w, h] = drawImage.mock.calls[0]!;
    expect([w, h].map((n) => Math.round(n as number))).toEqual([800, 400]);
  });

  it('không đọc được ảnh hoặc không có canvas: trả nguyên ảnh gốc như Mini App', async () => {
    imageMode = 'error';
    const a = mount();
    click(byText(document.body, 'button', 'Xác nhận dùng'));
    await flush();
    expect(a.onConfirm).toHaveBeenCalledWith('data:image/jpeg;base64,UkFX');
    mounted?.unmount();
    imageMode = 'load';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const b = mount();
    click(byText(document.body, 'button', 'Xác nhận dùng'));
    await flush();
    expect(b.onConfirm).toHaveBeenCalledWith('data:image/jpeg;base64,UkFX');
  });
});

describe('AvatarCropSheet: khoá đồng bộ xác nhận (W78B)', () => {
  const twice = (el: HTMLElement) =>
    act(() => {
      el.click();
      el.click();
    });
  const confirmBtn = () => byText(document.body, 'button', /Xác nhận dùng|Đang xử lý/) as HTMLButtonElement;

  it('chạm đúp "Xác nhận dùng" cùng khung hình: dựng một ảnh, onConfirm một lần', async () => {
    const { onConfirm } = mount();
    twice(confirmBtn());
    await flush();
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('đang xử lý: nút giữ focus (aria-busy + aria-disabled, không `disabled`), chạm thêm không dựng ảnh thứ hai; xong thì nhả', async () => {
    imageMode = 'hold';
    const { onConfirm } = mount();
    confirmBtn().focus();
    click(confirmBtn());
    await flush(2);
    expect(confirmBtn().textContent).toBe('Đang xử lý…');
    expect(confirmBtn().getAttribute('aria-busy')).toBe('true');
    expect(confirmBtn().getAttribute('aria-disabled')).toBe('true');
    expect(confirmBtn().disabled).toBe(false);
    expect(document.activeElement).toBe(confirmBtn());
    click(confirmBtn());
    await flush(2);
    expect(held).toHaveLength(1);

    await act(async () => held[0]!.load());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirmBtn().textContent).toBe('Xác nhận dùng');
    expect(confirmBtn().hasAttribute('aria-busy')).toBe(false);
    click(confirmBtn());
    await flush(2);
    expect(held).toHaveLength(2);
  });

  it('đang xử lý: "Huỷ chọn" bị chặn (aria-disabled), không có nút Đóng, Esc và bấm nền không đóng; xong thì đóng được lại', async () => {
    imageMode = 'hold';
    const { onClose, onConfirm } = mount();
    click(confirmBtn());
    await flush(2);
    const cancel = byText(document.body, 'button', 'Huỷ chọn') as HTMLButtonElement;
    expect(cancel.getAttribute('aria-disabled')).toBe('true');
    expect(cancel.disabled).toBe(false);
    click(cancel);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('button[aria-label="Đóng"]')).toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    click(document.querySelector('[data-sheet-backdrop]'));
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => held[0]!.load());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(cancel.hasAttribute('aria-disabled')).toBe(false);
    expect(document.querySelector('button[aria-label="Đóng"]')).not.toBeNull();
    click(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ảnh lỗi hoặc không có canvas: nhả khoá, trả ảnh gốc một lần, bấm lại được', async () => {
    imageMode = 'hold';
    const { onConfirm } = mount();
    click(confirmBtn());
    await flush(2);
    await act(async () => held[0]!.fail());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenLastCalledWith('data:image/jpeg;base64,UkFX');
    expect(confirmBtn().hasAttribute('aria-busy')).toBe(false);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    click(confirmBtn());
    await flush(2);
    await act(async () => held[1]!.load());
    expect(onConfirm).toHaveBeenCalledTimes(2);
    click(confirmBtn());
    await flush(2);
    expect(held).toHaveLength(3);
  });

  it('mở lại sheet khi lần dựng trước chưa về: khoá và trạng thái bận được đặt lại', async () => {
    imageMode = 'hold';
    const onConfirm = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" data-toggle onClick={() => setOpen((o) => !o)}>
            đổi
          </button>
          <AvatarCropSheet open={open} imageSrc="data:image/jpeg;base64,UkFX" onClose={() => setOpen(false)} onConfirm={onConfirm} />
        </>
      );
    }
    mounted = render(<Harness />);
    click(confirmBtn());
    await flush(2);
    expect(held).toHaveLength(1);
    click(document.querySelector('[data-toggle]'));
    await flush(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click(document.querySelector('[data-toggle]'));
    await flush(2);
    expect(confirmBtn().textContent).toBe('Xác nhận dùng');
    click(confirmBtn());
    await flush(2);
    expect(held).toHaveLength(2);
  });
});
