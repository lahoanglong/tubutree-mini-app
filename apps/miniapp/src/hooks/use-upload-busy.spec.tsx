import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUploadBusy } from './use-upload-busy';

describe('useUploadBusy', () => {
  it('bận từ lượt tải đầu tiên tới lượt cuối cùng xong: hai ô tải chồng nhau không nhả khoá khi ô đầu xong', () => {
    const { result } = renderHook(() => useUploadBusy());
    expect(result.current.busy).toBe(false);
    act(() => result.current.onBusyChange(true));
    act(() => result.current.onBusyChange(true));
    expect(result.current.busy).toBe(true);
    act(() => result.current.onBusyChange(false));
    expect(result.current.busy).toBe(true);
    act(() => result.current.onBusyChange(false));
    expect(result.current.busy).toBe(false);
  });

  it('báo xong thừa không kéo bộ đếm xuống âm: lượt tải kế tiếp vẫn khoá được', () => {
    const { result } = renderHook(() => useUploadBusy());
    act(() => result.current.onBusyChange(false));
    act(() => result.current.onBusyChange(true));
    expect(result.current.busy).toBe(true);
  });

  it('onBusyChange giữ nguyên qua các lần vẽ: ô ảnh gọi bản cũ sau khi form vẽ lại vẫn tính đúng', () => {
    const { result, rerender } = renderHook(() => useUploadBusy());
    const first = result.current.onBusyChange;
    act(() => first(true));
    rerender();
    expect(result.current.onBusyChange).toBe(first);
    act(() => first(false));
    expect(result.current.busy).toBe(false);
  });
});
