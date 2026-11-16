import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./api', () => ({ api: { post: vi.fn().mockResolvedValue({ data: { accepted: 1 } }) } }));

import {
  trackEvent,
  trackAppOpened,
  flushEventQueue,
  flushEventQueueOnHide,
  getSessionId,
  setCheckoutEntry,
  takeCheckoutEntry,
  SESSION_IDLE_MS,
  __resetQueueForTest,
} from './analytics';
import { __resetEntrySourceForTest } from '../utils/entry-source';
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

describe('nguồn khách của phiên trên phong bì sự kiện', () => {
  const sent = async () => {
    await flushEventQueue();
    return (api.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].events as Array<Record<string, unknown>>;
  };
  const launchWith = (search: string) => vi.stubGlobal('window', { location: { search, hash: '' } });

  beforeEach(() => {
    __resetQueueForTest();
    __resetEntrySourceForTest();
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    __resetEntrySourceForTest();
  });

  it('mọi sự kiện trong phiên mang entrySource và campaign của link mở app', async () => {
    launchWith('?src=shopee&utm_campaign=card-2610');
    trackEvent('screen_viewed', 'miniapp', { route: '/' });
    trackEvent('product_viewed', 'miniapp', { slug: 'x' });
    const events = await sent();
    expect(events.map((e) => [e.entrySource, e.campaign])).toEqual([
      ['shopee', 'card-2610'],
      ['shopee', 'card-2610'],
    ]);
  });

  it('mở app không có nguồn → organic, không có campaign', async () => {
    launchWith('');
    trackEvent('screen_viewed', 'miniapp', {});
    const [e] = await sent();
    expect(e).toMatchObject({ entrySource: 'organic' });
    expect(e).not.toHaveProperty('campaign', expect.anything());
  });

  it('nơi gọi tự truyền entrySource (extra) thì giữ giá trị đó', async () => {
    launchWith('?src=shopee');
    trackEvent('notification_opened', 'miniapp', {}, { entrySource: 'push' });
    const [e] = await sent();
    expect(e!.entrySource).toBe('push');
  });

  it('app_opened mang mã giới thiệu và medium của link', async () => {
    launchWith('?src=fb&utm_medium=social&ref=ABCD1234');
    trackAppOpened();
    const [e] = await sent();
    expect(e).toMatchObject({
      eventName: 'app_opened',
      entrySource: 'fb',
      refCode: 'ABCD1234',
      props: { medium: 'social' },
    });
  });

  it('app_opened không nguồn → props rỗng, không refCode', async () => {
    launchWith('');
    trackAppOpened();
    const [e] = await sent();
    expect(e).toMatchObject({ eventName: 'app_opened', entrySource: 'organic', props: {} });
    expect(e).not.toHaveProperty('refCode', expect.anything());
  });
});

describe('flushEventQueueOnHide', () => {
  beforeEach(() => __resetQueueForTest());
  afterEach(() => vi.clearAllMocks());

  it('hàng đợi rỗng → không gọi api.post', () => {
    flushEventQueueOnHide();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('có sự kiện trong hàng đợi → gửi qua api.post (không dùng sendBeacon)', () => {
    trackEvent('client_error', 'miniapp', { foo: 'bar' });

    flushEventQueueOnHide();

    expect(api.post).toHaveBeenCalledTimes(1);
    const body = (api.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(body.events).toHaveLength(1);
    expect(body.events[0].props).toEqual({ foo: 'bar' });
  });

  it('hơn 50 sự kiện (2 lô) → xả hết qua nhiều lần gọi flushEventQueue, không rơi mất', () => {
    for (let i = 0; i < 75; i++) trackEvent('screen_viewed', 'miniapp', { i });

    flushEventQueueOnHide();

    const calls = (api.post as ReturnType<typeof vi.fn>).mock.calls;
    const totalSent = calls.reduce((sum, call) => sum + call[1].events.length, 0);
    expect(totalSent).toBe(75);
  });
});

describe('sessionId trên phong bì sự kiện', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const sessionIds = async () => {
    await flushEventQueue();
    return (api.post as ReturnType<typeof vi.fn>).mock.calls.flatMap((c) => c[1].events.map((e: { sessionId: string }) => e.sessionId));
  };

  beforeEach(() => {
    __resetQueueForTest();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T08:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('mọi sự kiện trong phiên mang cùng một sessionId dạng UUID v4', async () => {
    trackEvent('screen_viewed', 'miniapp', { route: '/' });
    vi.setSystemTime(new Date('2026-11-16T08:20:00Z'));
    trackEvent('cart_viewed', 'miniapp', { itemCount: 1, subtotalBucket: '0-99k' });
    vi.setSystemTime(new Date('2026-11-16T08:45:00Z'));
    trackEvent('screen_viewed', 'miniapp', { route: '/cart' });
    const ids = await sessionIds();
    expect(ids).toHaveLength(3);
    expect(ids[0]).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(1);
  });

  it('30 phút không có sự kiện nào → sang mã phiên mới', async () => {
    trackEvent('screen_viewed', 'miniapp', { route: '/' });
    vi.setSystemTime(Date.now() + SESSION_IDLE_MS - 1);
    trackEvent('screen_viewed', 'miniapp', { route: '/cart' });
    vi.setSystemTime(Date.now() + SESSION_IDLE_MS);
    trackEvent('screen_viewed', 'miniapp', { route: '/' });
    const [a, b, c] = await sessionIds();
    expect(a).toBe(b);
    expect(c).not.toBe(b);
    expect(c).toMatch(UUID_V4);
  });

  it('đọc mã phiên (getSessionId) không gia hạn phiên, chỉ sự kiện mới gia hạn', async () => {
    trackEvent('screen_viewed', 'miniapp', { route: '/' });
    const first = getSessionId();
    vi.setSystemTime(Date.now() + SESSION_IDLE_MS - 1000);
    expect(getSessionId()).toBe(first);
    vi.setSystemTime(Date.now() + 1000);
    expect(getSessionId()).not.toBe(first);
  });

  it('máy không có crypto.randomUUID vẫn sinh eventId và sessionId dạng UUID v4', async () => {
    vi.stubGlobal('crypto', {});
    trackEvent('screen_viewed', 'miniapp', { route: '/' });
    await flushEventQueue();
    const e = (api.post as ReturnType<typeof vi.fn>).mock.calls[0]![1].events[0];
    expect(e.eventId).toMatch(UUID_V4);
    expect(e.sessionId).toMatch(UUID_V4);
  });
});

describe('dấu nơi vào thanh toán', () => {
  beforeEach(() => __resetQueueForTest());

  it('lấy ra đúng một lần rồi về unknown', () => {
    setCheckoutEntry('buy_now');
    expect(takeCheckoutEntry()).toBe('buy_now');
    expect(takeCheckoutEntry()).toBe('unknown');
  });

  it('chưa ghi dấu → unknown', () => {
    expect(takeCheckoutEntry()).toBe('unknown');
  });
});
