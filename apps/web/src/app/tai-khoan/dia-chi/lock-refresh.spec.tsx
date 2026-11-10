// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';
import { ApiError, NetworkError } from '@/lib/client-api';

// W91B (Mini W88A): Đặt mặc định và Xoá giữ khoá tới khi sổ địa chỉ làm mới về nhưng chỉ tối đa 4 giây, và lệnh bị máy chủ
// từ chối vì trạng thái đã đổi (400/404/409) thì tải lại sổ rồi mới nhả khoá; 401/5xx/mất mạng không tải lại.

const mocks = vi.hoisted(() => ({
  list: [] as Record<string, unknown>[],
  gate: null as Promise<void> | null,
  listCalls: 0,
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth-context')>()),
  useOptionalAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('@/lib/geo-client', () => ({
  getProvinces: async () => [{ code: '84_VN01', name: 'Hà Nội' }],
  getCommunes: async () => [{ code: '84_VN01_001', name: 'Cầu Giấy' }],
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getAddresses: async () => {
    mocks.listCalls += 1;
    if (mocks.gate) await mocks.gate;
    return mocks.list;
  },
  updateAddress: mocks.update,
  deleteAddress: mocks.remove,
}));

import AddressBookPage from './page';

const A1 = {
  id: 'a1', recipient: 'Nguyễn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_001', isDefault: true,
};
const A2 = { ...A1, id: 'a2', recipient: 'Trần Bình', phone: '0987654321', street: '9 Hoàng Quốc Việt', isDefault: false };

beforeAll(async () => {
  await import('@/components/mini/empty-state');
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<AddressBookPage />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const btn = (c: HTMLElement, name: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name) as HTMLButtonElement | undefined;
const confirmBtn = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find((b) => b.textContent === label);
const SET_A2 = 'Đặt mặc định cho địa chỉ của Trần Bình';
const DEL_A2 = 'Xoá địa chỉ của Trần Bình';

let release: () => void = () => {};
const holdList = () => {
  mocks.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
};
const releaseList = async () => {
  mocks.gate = null;
  await act(async () => release());
  await flush(6);
};

beforeEach(() => {
  localStorage.clear();
  mocks.list = [A1, A2];
  mocks.gate = null;
  mocks.listCalls = 0;
  mocks.update.mockReset().mockResolvedValue(A1);
  mocks.remove.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('Sổ địa chỉ — làm mới không bao giờ về: nhả khoá sau 4 giây', () => {
  beforeEach(() => {
    // shouldAdvanceTime để `flush` (setTimeout 0) và bộ đếm giờ của react-query vẫn chạy; chỉ cần giả setTimeout để tua tới hạn.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it('Đặt mặc định: còn khoá ở 3 giây (chạm thêm không gửi PATCH), nhả sau 4 giây dù sổ chưa về', async () => {
    const c = await mount();
    holdList();
    click(btn(c, SET_A2)!);
    await flush(4);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await advance(3_000);
    expect(btn(c, SET_A2)!.getAttribute('aria-busy')).toBe('true');
    click(btn(c, SET_A2)!);
    await flush(2);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await advance(1_500);
    await flush(4);
    expect(btn(c, SET_A2)!.hasAttribute('aria-busy')).toBe(false);
    click(btn(c, SET_A2)!);
    await flush(4);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    await releaseList();
  });

  it('Xoá: dòng biến mất ngay, focus chỉ về "Thêm địa chỉ mới" sau 4 giây dù sổ chưa về', async () => {
    const c = await mount();
    click(btn(c, DEL_A2)!);
    holdList();
    click(confirmBtn(c, 'Xoá')!);
    await flush(4);
    expect(mocks.remove).toHaveBeenCalledWith('a2');
    expect(btn(c, DEL_A2)).toBeUndefined();
    await advance(3_000);
    expect(document.activeElement).not.toBe(btn(c, 'Thêm địa chỉ mới'));
    await advance(1_500);
    await flush(4);
    expect(document.activeElement).toBe(btn(c, 'Thêm địa chỉ mới'));
    await releaseList();
  });
});

describe('Sổ địa chỉ — lệnh bị từ chối mà làm mới không bao giờ về: nhả khoá sau 4 giây', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it('Đặt mặc định bị từ chối 404: lời báo hiện ngay, còn khoá ở 3 giây, nhả sau 4 giây dù sổ chưa về', async () => {
    mocks.update.mockRejectedValueOnce(new ApiError('Địa chỉ không còn', 404));
    const c = await mount();
    holdList();
    click(btn(c, SET_A2)!);
    await flush(4);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Địa chỉ không còn');
    await advance(3_000);
    expect(btn(c, SET_A2)!.getAttribute('aria-busy')).toBe('true');
    await advance(1_500);
    await flush(4);
    expect(btn(c, SET_A2)!.hasAttribute('aria-busy')).toBe(false);
    await releaseList();
  });
});

describe('Sổ địa chỉ — lệnh bị từ chối', () => {
  it.each([400, 404, 409])('Đặt mặc định bị từ chối %i: lời báo hiện ngay, sổ được tải lại, khoá nhả sau khi sổ về', async (status) => {
    mocks.update.mockRejectedValueOnce(new ApiError('Địa chỉ không còn', status));
    const c = await mount();
    const before = mocks.listCalls;
    holdList();
    const seen = await captureUnhandledRejections(async () => {
      click(btn(c, SET_A2)!);
      await flush(4);
    });
    expect(seen).toEqual([]);
    expect(mocks.listCalls).toBe(before + 1);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Địa chỉ không còn');
    expect(btn(c, SET_A2)!.getAttribute('aria-busy')).toBe('true');
    click(btn(c, SET_A2)!);
    await flush(2);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await releaseList();
    expect(btn(c, SET_A2)!.hasAttribute('aria-busy')).toBe(false);
  });

  it('Xoá bị từ chối 404 (địa chỉ đã bị xoá ở nơi khác): sổ được tải lại rồi mới nhả khoá', async () => {
    mocks.remove.mockRejectedValueOnce(new ApiError('Không tìm thấy địa chỉ', 404));
    const c = await mount();
    const before = mocks.listCalls;
    click(btn(c, DEL_A2)!);
    holdList();
    click(confirmBtn(c, 'Xoá')!);
    await flush(4);
    expect(mocks.listCalls).toBe(before + 1);
    expect(btn(c, SET_A2)!.getAttribute('aria-disabled')).toBe('true');
    await releaseList();
    expect(btn(c, SET_A2)!.hasAttribute('aria-disabled')).toBe(false);
  });

  it.each([
    ['401', () => new ApiError('Hết phiên', 401)],
    ['403', () => new ApiError('Không có quyền', 403)],
    ['500', () => new ApiError('Lỗi máy chủ', 500)],
    ['mất mạng', () => new NetworkError(false)],
  ])('Đặt mặc định bị từ chối bởi %s: không tải lại sổ, khoá nhả ngay để bấm lại', async (_name, makeError) => {
    mocks.update.mockRejectedValueOnce(makeError());
    const c = await mount();
    const before = mocks.listCalls;
    click(btn(c, SET_A2)!);
    await flush(6);
    expect(mocks.listCalls).toBe(before);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(btn(c, SET_A2)!.hasAttribute('aria-busy')).toBe(false);
    click(btn(c, SET_A2)!);
    await flush(4);
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it('Xoá bị từ chối 404 rồi sổ tải lại không còn dòng đó: lời báo lên đầu trang, làm việc khác thì tắt', async () => {
    const A3 = { ...A2, id: 'a3', recipient: 'Lê Chi', phone: '0911111111', street: '5 Trần Duy Hưng' };
    mocks.list = [A1, A2, A3];
    mocks.remove.mockRejectedValueOnce(new ApiError('Không tìm thấy địa chỉ', 404));
    const c = await mount();
    click(btn(c, DEL_A2)!);
    mocks.list = [A1, A3];
    click(confirmBtn(c, 'Xoá')!);
    await flush(8);
    expect(btn(c, DEL_A2)).toBeUndefined();
    const alerts = Array.from(c.querySelectorAll('[role="alert"]'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain('Không tìm thấy địa chỉ');
    expect(alerts[0]!.closest('li')).toBeNull();
    click(btn(c, 'Đặt mặc định cho địa chỉ của Lê Chi')!);
    await flush(8);
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('lỗi của địa chỉ còn trong sổ vẫn nằm trong dòng của nó, không lặp lên đầu trang', async () => {
    mocks.update.mockRejectedValueOnce(new ApiError('Lỗi máy chủ', 500));
    const c = await mount();
    click(btn(c, SET_A2)!);
    await flush(6);
    const alerts = Array.from(c.querySelectorAll('[role="alert"]'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.closest('li')).not.toBeNull();
  });
});
