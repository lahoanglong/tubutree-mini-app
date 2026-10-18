import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./api', () => ({ api: { post: vi.fn().mockResolvedValue({ data: { accepted: 1 } }) } }));

import { trackEvent, trackAppOpened, flushEventQueue, flushEventQueueOnHide, __resetQueueForTest } from './analytics';
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
