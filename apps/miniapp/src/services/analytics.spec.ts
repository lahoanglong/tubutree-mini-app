import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./api', () => ({ api: { post: vi.fn().mockResolvedValue({ data: { accepted: 1 } }) } }));

import { trackEvent, flushEventQueue, flushEventQueueOnHide, __resetQueueForTest } from './analytics';
import { api } from './api';

describe('trackEvent / flushEventQueue', () => {
  beforeEach(() => __resetQueueForTest());
  afterEach(() => vi.clearAllMocks());

  it('gom sự kiện vào hàng đợi, chưa gửi ngay', () => {
    trackEvent('app_opened', 'miniapp', {});
    expect(api.post).not.toHaveBeenCalled();
  });

  it('flush gửi đúng payload, mỗi sự kiện có eventId dạng uuid', async () => {
    trackEvent('screen_viewed', 'miniapp', { route: '/home' });
    await flushEventQueue();
    expect(api.post).toHaveBeenCalledTimes(1);
    const body = (api.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(body.events).toHaveLength(1);
    expect(body.events[0].eventName).toBe('screen_viewed');
    expect(body.events[0].eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('flush khi hàng đợi rỗng → không gọi API', async () => {
    await flushEventQueue();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('đủ 50 sự kiện → tự flush ngay không cần gọi thủ công', () => {
    for (let i = 0; i < 50; i++) trackEvent('screen_viewed', 'miniapp', { i });
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('flush lỗi mạng → không throw ra ngoài (best-effort, CHẤP NHẬN mất lô này, không giữ lại)', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    trackEvent('client_error', 'miniapp', {});
    await expect(flushEventQueue()).resolves.toBeUndefined();
  });
});

describe('flushEventQueueOnHide', () => {
  beforeEach(() => __resetQueueForTest());
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('sendBeacon thành công → KHÔNG gọi api.post (đã gửi bằng beacon)', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon });
    trackEvent('client_error', 'miniapp', {});

    flushEventQueueOnHide();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sendBeacon thất bại (trả false) → PHẢI gửi lại batch đã lấy ra qua api.post, không rơi mất', () => {
    const sendBeacon = vi.fn().mockReturnValue(false);
    vi.stubGlobal('navigator', { sendBeacon });
    trackEvent('client_error', 'miniapp', { foo: 'bar' });

    flushEventQueueOnHide();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledTimes(1);
    const body = (api.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(body.events).toHaveLength(1);
    expect(body.events[0].props).toEqual({ foo: 'bar' });
  });

  it('không có navigator.sendBeacon (môi trường không hỗ trợ) → gửi thẳng qua api.post', () => {
    vi.stubGlobal('navigator', {});
    trackEvent('client_error', 'miniapp', {});

    flushEventQueueOnHide();

    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
