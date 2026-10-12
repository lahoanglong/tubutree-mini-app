import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchNotifyPrefs: vi.fn(),
  saveNotifyPrefs: vi.fn(),
  stored: undefined as string | undefined,
  setStorage: vi.fn(),
}));
vi.mock('zmp-sdk/apis', () => ({
  getStorage: async () => (mocks.stored === undefined ? {} : { tubu_prefs: mocks.stored }),
  setStorage: mocks.setStorage,
}));
vi.mock('./settings-notify-prefs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchNotifyPrefs: mocks.fetchNotifyPrefs,
  saveNotifyPrefs: mocks.saveNotifyPrefs,
}));

import { syncLegacyNotifyPrefs, useLegacyNotifyPrefsSync } from './settings-legacy-sync';

describe('Chuyển lựa chọn tắt thông báo cũ trên máy lên server lúc mở app (C-022)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stored = undefined;
    mocks.fetchNotifyPrefs.mockResolvedValue({ notifyPromo: true, notifyGarden: true });
    mocks.saveNotifyPrefs.mockImplementation(async (patch: object) => ({ notifyPromo: true, notifyGarden: true, ...patch }));
  });

  it('máy không còn khoá cũ → không gọi mạng', async () => {
    mocks.stored = JSON.stringify({ fontScale: 'large' });
    await expect(syncLegacyNotifyPrefs()).resolves.toBeNull();
    expect(mocks.fetchNotifyPrefs).not.toHaveBeenCalled();
    expect(mocks.setStorage).not.toHaveBeenCalled();
  });

  it('khách đã tắt khuyến mãi ở bản cũ → đẩy lên server rồi chỉ giữ cỡ chữ trên máy', async () => {
    mocks.stored = JSON.stringify({ notifyPromo: false, notifyGarden: true, fontScale: 'large' });
    await expect(syncLegacyNotifyPrefs()).resolves.toEqual({ notifyPromo: false, notifyGarden: true });
    expect(mocks.saveNotifyPrefs).toHaveBeenCalledWith({ notifyPromo: false });
    expect(mocks.setStorage).toHaveBeenCalledWith({ data: { tubu_prefs: JSON.stringify({ fontScale: 'large' }) } });
  });

  it('lưu server lỗi → giữ nguyên khoá cũ trên máy để lần mở sau thử lại', async () => {
    mocks.stored = JSON.stringify({ notifyPromo: false });
    mocks.saveNotifyPrefs.mockRejectedValue(new Error('net'));
    await expect(syncLegacyNotifyPrefs()).rejects.toThrow('net');
    expect(mocks.setStorage).not.toHaveBeenCalled();
  });

  it('hook chỉ chạy khi đã đăng nhập', async () => {
    mocks.stored = JSON.stringify({ notifyPromo: false });
    const { rerender } = renderHook(({ authed }) => useLegacyNotifyPrefsSync(authed), {
      initialProps: { authed: false },
    });
    await Promise.resolve();
    expect(mocks.fetchNotifyPrefs).not.toHaveBeenCalled();
    rerender({ authed: true });
    await waitFor(() => expect(mocks.saveNotifyPrefs).toHaveBeenCalledWith({ notifyPromo: false }));
  });
});
