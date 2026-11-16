// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
const hasSessionMarker = vi.fn();
vi.mock('./client-api', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  hasSessionMarker: () => hasSessionMarker(),
}));

import { __resetWebEventsForTest, flushWebEvents, trackWebEvent } from './analytics';

describe('trackWebEvent / flushWebEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetWebEventsForTest();
    apiFetch.mockReset().mockResolvedValue({ accepted: 1 });
    hasSessionMarker.mockReset().mockReturnValue(true);
    document.cookie = 'tubu_ft=; Max-Age=0; Path=/';
  });
  afterEach(() => vi.useRealTimers());

  it('gom vào hàng đợi, chưa gửi ngay; hết 5 giây thì gửi một lô với platform web và eventId', async () => {
    trackWebEvent('recycle_funnel_step', { step: 'enter', surface: 'web' });
    expect(apiFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, opts] = apiFetch.mock.calls[0] as [string, { method: string; body: { events: Array<Record<string, unknown>> } }];
    expect(path).toBe('/events');
    expect(opts.method).toBe('POST');
    expect(opts.body.events).toHaveLength(1);
    expect(opts.body.events[0]).toMatchObject({ eventName: 'recycle_funnel_step', platform: 'web', props: { step: 'enter', surface: 'web' } });
    expect(opts.body.events[0]!.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('khách chưa có phiên: không gọi API, sự kiện nằm chờ rồi gửi khi đã có phiên', async () => {
    hasSessionMarker.mockReturnValue(false);
    trackWebEvent('recycle_funnel_step', { step: 'enter', surface: 'web' });
    await flushWebEvents();
    expect(apiFetch).not.toHaveBeenCalled();
    hasSessionMarker.mockReturnValue(true);
    await flushWebEvents();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('lỗi mạng: không ném, không gửi lại lô cũ', async () => {
    apiFetch.mockRejectedValueOnce(new Error('network'));
    trackWebEvent('recycle_funnel_step', { step: 'submitted', surface: 'web', lane: 'DROP_OFF' });
    await expect(flushWebEvents()).resolves.toBeUndefined();
    await flushWebEvents();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('hasSessionMarker ném lỗi (mock thiếu export): flush vẫn không ném', async () => {
    hasSessionMarker.mockImplementation(() => {
      throw new Error('boom');
    });
    trackWebEvent('recycle_funnel_step', { step: 'enter', surface: 'web' });
    await expect(flushWebEvents()).resolves.toBeUndefined();
  });

  it('đủ 50 sự kiện: tự gửi ngay, và hàng đợi chờ không vượt 100 (bỏ cái cũ nhất)', async () => {
    for (let i = 0; i < 50; i++) trackWebEvent('recycle_funnel_step', { step: 'enter', surface: 'web', i });
    await vi.advanceTimersByTimeAsync(0);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect((apiFetch.mock.calls[0]![1] as { body: { events: unknown[] } }).body.events).toHaveLength(50);

    apiFetch.mockClear();
    hasSessionMarker.mockReturnValue(false);
    for (let i = 0; i < 130; i++) trackWebEvent('recycle_funnel_step', { step: 'enter', surface: 'web', i });
    hasSessionMarker.mockReturnValue(true);
    await flushWebEvents();
    await flushWebEvents();
    const sent = apiFetch.mock.calls.flatMap((c) => (c[1] as { body: { events: Array<{ props: { i: number } }> } }).body.events);
    expect(sent).toHaveLength(100);
    expect(sent[0]!.props.i).toBe(30);
  });

  it('gắn entrySource/campaign từ cookie chạm đầu', async () => {
    document.cookie = `tubu_ft=${encodeURIComponent(JSON.stringify({ source: 'oa', campaign: 'thang11' }))}; Path=/`;
    trackWebEvent('recycle_funnel_step', { step: 'enter', surface: 'web' });
    await flushWebEvents();
    const ev = (apiFetch.mock.calls[0]![1] as { body: { events: Array<Record<string, unknown>> } }).body.events[0]!;
    expect(ev).toMatchObject({ entrySource: 'oa', campaign: 'thang11' });
  });
});
