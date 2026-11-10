// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@/test-utils/render-hook';
import { IMAGES_UPLOADING, useUploadBusy } from './use-upload-busy';

describe('useUploadBusy', () => {
  it('bận từ lúc một ô báo true tới lúc báo false', () => {
    const h = renderHook(() => useUploadBusy());
    expect(h.result.current.busy).toBe(false);
    act(() => h.result.current.onBusyChange(true));
    expect(h.result.current.busy).toBe(true);
    act(() => h.result.current.onBusyChange(false));
    expect(h.result.current.busy).toBe(false);
    h.unmount();
  });

  it('hai ô tải cùng lúc: ô đầu xong chưa nhả khoá, chỉ nhả khi ô cuối xong', () => {
    const h = renderHook(() => useUploadBusy());
    act(() => h.result.current.onBusyChange(true));
    act(() => h.result.current.onBusyChange(true));
    act(() => h.result.current.onBusyChange(false));
    expect(h.result.current.busy).toBe(true);
    act(() => h.result.current.onBusyChange(false));
    expect(h.result.current.busy).toBe(false);
    h.unmount();
  });

  it('báo false thừa không kéo bộ đếm xuống âm: lượt tải kế vẫn khoá', () => {
    const h = renderHook(() => useUploadBusy());
    act(() => h.result.current.onBusyChange(false));
    act(() => h.result.current.onBusyChange(true));
    expect(h.result.current.busy).toBe(true);
    h.unmount();
  });

  it('onBusyChange giữ nguyên tham chiếu qua các lần vẽ (đưa vào ô ảnh không làm ô vẽ lại thừa)', () => {
    const h = renderHook(() => useUploadBusy());
    const first = h.result.current.onBusyChange;
    act(() => first(true));
    expect(h.result.current.onBusyChange).toBe(first);
    h.unmount();
  });

  it('chữ nút dùng chung cùng chữ với Mini App', () => {
    expect(IMAGES_UPLOADING).toBe('Đang tải ảnh…');
  });
});
