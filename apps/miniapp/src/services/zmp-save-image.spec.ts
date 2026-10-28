import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('zmp-sdk/apis', () => ({ saveImageToGallery: mocks.save }));

import { saveImageFromUrl } from './zmp-save-image';

afterEach(() => vi.useRealTimers());

describe('saveImageFromUrl', () => {
  it('lưu xong thì không để lại hẹn giờ 30 giây', async () => {
    vi.useFakeTimers();
    mocks.save.mockResolvedValue(undefined);
    await saveImageFromUrl('https://img.vietqr.io/x.png');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('SDK treo quá 30 giây thì reject', async () => {
    vi.useFakeTimers();
    mocks.save.mockReturnValue(new Promise(() => {}));
    const p = saveImageFromUrl('https://img.vietqr.io/x.png');
    const assertion = expect(p).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
