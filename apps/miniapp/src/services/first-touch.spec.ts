import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('zmp-sdk/apis', () => ({ getStorage: vi.fn(), setStorage: vi.fn() }));

import { getStorage, setStorage } from 'zmp-sdk/apis';
import { __resetEntrySourceForTest } from '../utils/entry-source';
import { FIRST_TOUCH_KEY, __resetFirstTouchForTest, loadFirstTouch } from './first-touch';

const mockedGet = vi.mocked(getStorage);
const mockedSet = vi.mocked(setStorage);

const launchWith = (search: string) => vi.stubGlobal('window', { location: { search, hash: '' } });
const stored = (v: unknown) => mockedGet.mockResolvedValue({ [FIRST_TOUCH_KEY]: v } as never);

beforeEach(() => {
  vi.clearAllMocks();
  __resetEntrySourceForTest();
  __resetFirstTouchForTest();
  mockedGet.mockResolvedValue({} as never);
  mockedSet.mockResolvedValue(undefined as never);
});
afterEach(() => vi.unstubAllGlobals());

describe('loadFirstTouch — nguồn chạm đầu bền trên máy', () => {
  it('lần đầu có nguồn trên link → lưu lại kèm giờ và trả về', async () => {
    launchWith('?src=shopee&utm_campaign=card-2610');
    const ft = await loadFirstTouch();
    expect(ft).toMatchObject({ source: 'shopee', campaign: 'card-2610' });
    expect(Date.parse(ft!.at!)).not.toBeNaN();
    expect(mockedSet).toHaveBeenCalledTimes(1);
    const saved = JSON.parse((mockedSet.mock.calls[0]![0] as { data: Record<string, string> }).data[FIRST_TOUCH_KEY]!);
    expect(saved).toEqual(ft);
  });

  it('đã có nguồn đã lưu → trả nguồn cũ, KHÔNG ghi đè dù lần mở này mang nguồn khác', async () => {
    stored(JSON.stringify({ source: 'oa', at: '2026-10-01T00:00:00.000Z' }));
    launchWith('?src=tiktok');
    expect(await loadFirstTouch()).toEqual({ source: 'oa', at: '2026-10-01T00:00:00.000Z' });
    expect(mockedSet).not.toHaveBeenCalled();
  });

  it('mở app không có nguồn và máy chưa lưu gì → không có chạm đầu, không ghi gì', async () => {
    launchWith('');
    expect(await loadFirstTouch()).toBeUndefined();
    expect(mockedSet).not.toHaveBeenCalled();
  });

  it('mở organic lần đầu rồi lần sau mới quét thẻ → nguồn đầu tiên có thật là thẻ', async () => {
    launchWith('');
    expect(await loadFirstTouch()).toBeUndefined();
    __resetEntrySourceForTest();
    __resetFirstTouchForTest();
    launchWith('?card=2610');
    expect(await loadFirstTouch()).toMatchObject({ source: 'card-2610' });
  });

  it.each([
    ['JSON hỏng', '{not json'],
    ['không phải chuỗi', 42],
    ['nguồn sai khuôn', JSON.stringify({ source: 'a b' })],
    ['thiếu nguồn', JSON.stringify({ at: '2026-10-01T00:00:00.000Z' })],
  ])('giá trị đã lưu bẩn (%s) → bỏ, dùng nguồn của lần mở này', async (_label, raw) => {
    stored(raw);
    launchWith('?src=lazada');
    expect(await loadFirstTouch()).toMatchObject({ source: 'lazada' });
  });

  it('đọc storage lỗi → không ném, không có chạm đầu (đăng nhập không được vướng vì số liệu)', async () => {
    mockedGet.mockRejectedValue(new Error('no bridge'));
    launchWith('?src=shopee');
    await expect(loadFirstTouch()).resolves.toBeUndefined();
  });

  it('ghi storage lỗi → vẫn trả nguồn trong bộ nhớ', async () => {
    mockedSet.mockRejectedValue(new Error('quota'));
    launchWith('?src=shopee');
    await expect(loadFirstTouch()).resolves.toMatchObject({ source: 'shopee' });
  });

  it('storage treo → bỏ cuộc sau hạn chờ, không chặn đăng nhập', async () => {
    vi.useFakeTimers();
    try {
      mockedGet.mockReturnValue(new Promise(() => {}) as never);
      launchWith('?src=shopee');
      const p = loadFirstTouch();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gọi nhiều lần cùng một lần mở → chỉ đọc/ghi storage một lần', async () => {
    launchWith('?src=shopee');
    const [a, b] = await Promise.all([loadFirstTouch(), loadFirstTouch()]);
    expect(a).toBe(b);
    await loadFirstTouch();
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedSet).toHaveBeenCalledTimes(1);
  });
});
