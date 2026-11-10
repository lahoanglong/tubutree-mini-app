import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { AvatarCropModal } from './avatar-crop-modal';

describe('AvatarCropModal — xuất ảnh cắt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('phủ nền trắng trước khi vẽ: PNG trong suốt không thành nền đen khi xuất JPEG', async () => {
    class FakeImage {
      width = 400;
      height = 400;
      crossOrigin = '';
      onload: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const calls: string[] = [];
    const ctx = {
      set fillStyle(v: string) {
        calls.push(`fillStyle:${v}`);
      },
      fillRect: () => void calls.push('fillRect'),
      beginPath: () => {},
      arc: () => {},
      clip: () => {},
      drawImage: () => void calls.push('drawImage'),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
    const onConfirm = vi.fn();

    render(<AvatarCropModal visible imageSrc="data:image/png;base64,AAAA" onClose={() => {}} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Xác nhận dùng'));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA'));
    expect(calls.indexOf('fillRect')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('fillRect')).toBeLessThan(calls.indexOf('drawImage'));
    expect(calls).toContain('fillStyle:white');
  });

  describe('chạm đúp cùng nhịp vào "Xác nhận dùng" (W78A)', () => {
    const SRC = 'data:image/png;base64,AAAA';
    const CROPPED = 'data:image/jpeg;base64,AAAA';

    // Mỗi `new Image()` là một lần tải ảnh thật: đếm số lần dựng để thấy khoá chặn trước khi tải, không chỉ chặn onConfirm.
    function stubImage(outcome: 'load' | 'error') {
      const created: unknown[] = [];
      class FakeImage {
        width = 400;
        height = 400;
        crossOrigin = '';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor() {
          created.push(this);
        }
        set src(_v: string) {
          queueMicrotask(() => (outcome === 'load' ? this.onload?.() : this.onerror?.()));
        }
      }
      vi.stubGlobal('Image', FakeImage);
      const ctx = { fillStyle: '', fillRect: () => {}, beginPath: () => {}, arc: () => {}, clip: () => {}, drawImage: () => {} };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(CROPPED);
      return created;
    }

    it('ảnh tải được: hai cú chạm cùng nhịp chỉ tải ảnh một lần và gọi onConfirm một lần', async () => {
      const created = stubImage('load');
      const onConfirm = vi.fn();
      render(<AvatarCropModal visible imageSrc={SRC} onClose={() => {}} onConfirm={onConfirm} />);
      const btn = screen.getByRole('button', { name: 'Xác nhận dùng' });
      await act(async () => {
        fireEvent.click(btn);
        fireEvent.click(btn);
      });
      expect(created).toHaveLength(1);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith(CROPPED);
    });

    it('xong một lần cắt thì nhả khoá: bấm lại cắt được lần nữa', async () => {
      const created = stubImage('load');
      const onConfirm = vi.fn();
      render(<AvatarCropModal visible imageSrc={SRC} onClose={() => {}} onConfirm={onConfirm} />);
      const btn = screen.getByRole('button', { name: 'Xác nhận dùng' });
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(created).toHaveLength(2);
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });

    it('ảnh tải lỗi: hai cú chạm cùng nhịp vẫn chỉ gọi onConfirm một lần (ảnh gốc), rồi bấm lại được', async () => {
      const created = stubImage('error');
      const onConfirm = vi.fn();
      render(<AvatarCropModal visible imageSrc={SRC} onClose={() => {}} onConfirm={onConfirm} />);
      const btn = screen.getByRole('button', { name: 'Xác nhận dùng' });
      await act(async () => {
        fireEvent.click(btn);
        fireEvent.click(btn);
      });
      expect(created).toHaveLength(1);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith(SRC);
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(created).toHaveLength(2);
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });
  });
});
