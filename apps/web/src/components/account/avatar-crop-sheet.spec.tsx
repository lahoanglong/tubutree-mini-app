// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';
import { AvatarCropSheet } from './avatar-crop-sheet';

// Chép ý avatar-crop-modal.tsx (Mini App): khung tròn 240px, kéo + thu phóng 1–3, xuất JPEG 200x200, Hủy chọn / Xác nhận dùng.

const drawImage = vi.fn();
const ctx = { beginPath: vi.fn(), arc: vi.fn(), clip: vi.fn(), drawImage };
let mounted: Rendered | null = null;
let imageMode: 'load' | 'error' = 'load';

beforeEach(() => {
  drawImage.mockClear();
  imageMode = 'load';
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

  it('"Hủy chọn" đóng, không xác nhận', () => {
    const { onClose, onConfirm } = mount();
    click(byText(document.body, 'button', 'Hủy chọn'));
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
