import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
