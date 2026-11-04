// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('zmp-sdk/apis', () => ({
  setStorage: vi.fn(),
  getStorage: vi.fn(),
  removeStorage: vi.fn(),
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { post: vi.fn() },
  setAccessToken: vi.fn(),
  setAuthReady: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  loginGuest: vi.fn(),
  loginZaloMiniApp: vi.fn(),
  refreshTokens: vi.fn(),
  ensurePhoneApi: vi.fn(),
}));
vi.mock('../services/zmp-bridge', () => ({
  getZaloAccessToken: vi.fn(),
  requestZaloPhoneToken: vi.fn(),
  getLaunchReferral: vi.fn(() => undefined),
}));
vi.mock('../services/first-touch', () => ({ loadFirstTouch: vi.fn(async () => undefined) }));

import { getStorage, setStorage, removeStorage } from 'zmp-sdk/apis';
import { getDeviceId, useAuthStore, resetDeviceIdCacheForTests } from './auth';
import { saveRecentCustomer, loadRecentCustomers } from '../components/affiliate/recent-customers';

const mockedGet = vi.mocked(getStorage);
const mockedSet = vi.mocked(setStorage);
const mockedRemove = vi.mocked(removeStorage);

const deviceReads = () => mockedGet.mock.calls.filter(([a]) => (a as { keys: string[] }).keys.includes('tubu_device_id')).length;

beforeEach(() => {
  vi.clearAllMocks();
  resetDeviceIdCacheForTests();
  localStorage.clear();
  mockedSet.mockResolvedValue(undefined as never);
  mockedRemove.mockResolvedValue(undefined as never);
  mockedGet.mockResolvedValue({ tubu_device_id: 'd_abc' });
});

describe('getDeviceId — cache theo module', () => {
  it('10 lần gọi liên tiếp chỉ đọc ZMP storage 1 lần', async () => {
    for (let i = 0; i < 10; i++) expect(await getDeviceId()).toBe('d_abc');
    expect(deviceReads()).toBe(1);
  });

  it('gọi đồng thời dùng chung một lần đọc', async () => {
    await Promise.all(Array.from({ length: 10 }, () => getDeviceId()));
    expect(deviceReads()).toBe(1);
  });

  it('đọc lỗi thì không cache lỗi: lần sau đọc lại', async () => {
    mockedGet.mockRejectedValueOnce(new Error('bridge'));
    await expect(getDeviceId()).rejects.toThrow();
    expect(await getDeviceId()).toBe('d_abc');
    expect(deviceReads()).toBe(2);
  });
});

describe('getDeviceId — nguồn ngẫu nhiên (SEC-F4)', () => {
  it('thiếu cả randomUUID lẫn getRandomValues thì ném, không rơi về Math.random', async () => {
    mockedGet.mockResolvedValue({});
    vi.stubGlobal('crypto', {});
    const rnd = vi.spyOn(Math, 'random');
    try {
      await expect(getDeviceId()).rejects.toThrow();
      expect(rnd).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      rnd.mockRestore();
    }
  });

  it('thiếu randomUUID thì dựng UUID v4 từ getRandomValues', async () => {
    mockedGet.mockResolvedValue({});
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    try {
      expect(await getDeviceId()).toMatch(/^d_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('logout xoá khách gần đây của CTV (SEC-F3)', () => {
  it('xoá mọi khoá tubu_ctv_recent_customers:<userId>, giữ khoá khác', async () => {
    const c = { recipient: 'A', phone: '0900000001', street: 's', province: 'p', provinceCode: '1', ward: 'w', wardCode: '2', usedAt: 1 };
    saveRecentCustomer('u1', c);
    saveRecentCustomer('u2', c);
    localStorage.setItem('other_key', 'x');
    expect(loadRecentCustomers('u1')).toHaveLength(1);
    await useAuthStore.getState().logout();
    expect(loadRecentCustomers('u1')).toEqual([]);
    expect(loadRecentCustomers('u2')).toEqual([]);
    expect(localStorage.getItem('other_key')).toBe('x');
  });
});
