// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_WINDOW_MS, isChunkLoadError, reloadOnceForChunkError } from './chunk-reload';

const reload = vi.fn();
beforeEach(() => {
  sessionStorage.clear();
  reload.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
});

describe('isChunkLoadError', () => {
  it('nhận ChunkLoadError và các câu báo của webpack/trình duyệt', () => {
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 6710 failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading CSS chunk 12 failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true);
  });
  it('lỗi khác, null, chuỗi lạ thì không', () => {
    expect(isChunkLoadError(new Error('Network down'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('boom')).toBe(false);
  });
});

describe('reloadOnceForChunkError', () => {
  it('lần đầu tải lại; lần hai trong cửa sổ thì không; hết cửa sổ thì cho lại', () => {
    expect(reloadOnceForChunkError(1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnceForChunkError(1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnceForChunkError(1_000_000 + CHUNK_RELOAD_WINDOW_MS + 1)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it('sessionStorage ném lỗi: không tải lại (không bảo vệ được khỏi vòng lặp)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(reloadOnceForChunkError()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
