// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkError, REQUEST_TIMEOUT_MS, setAccessToken } from './client-api';
import { generateStoryDraft, STORY_DRAFT_TIMEOUT_MS } from './product-categories';

describe('generateStoryDraft', () => {
  beforeEach(() => {
    setAccessToken(null);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('dài hơn ngân sách 55 giây của API và hạn đọc 60 giây của Apache chút ít, để nhận được lời báo lỗi của API thay vì tự ngắt', () => {
    expect(STORY_DRAFT_TIMEOUT_MS).toBeGreaterThan(55_000);
    expect(STORY_DRAFT_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });

  it('chờ quá hạn mặc định 20 giây vẫn chưa ngắt, ngắt ở STORY_DRAFT_TIMEOUT_MS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_res, rej) => {
            init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    let settled = false;
    const pending = generateStoryDraft('p1', '').catch((e: unknown) => ((settled = true), e));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(STORY_DRAFT_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    const err = await pending;
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).timedOut).toBe(true);
  });
});
