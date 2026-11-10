// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// Wave 76B: Đặt mặc định và Xoá địa chỉ khoá đồng bộ theo id địa chỉ (Mini 76A: addresses.tsx).

const mocks = vi.hoisted(() => ({
  list: [] as Record<string, unknown>[],
  gate: null as Promise<void> | null,
  listCalls: 0,
  listError: false,
  script: [] as Promise<Record<string, unknown>[]>[],
  update: vi.fn(),
  create: vi.fn(),
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
    const scripted = mocks.script.shift();
    if (scripted) return scripted;
    if (mocks.gate) await mocks.gate;
    if (mocks.listError) throw new Error('boom');
    return mocks.list;
  },
  updateAddress: mocks.update,
  createAddress: mocks.create,
  deleteAddress: mocks.remove,
}));

import AddressBookPage from './page';

const A1 = {
  id: 'a1', recipient: 'Nguyễn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_001', isDefault: true,
};
const A2 = { ...A1, id: 'a2', recipient: 'Trần Bình', phone: '0987654321', street: '9 Hoàng Quốc Việt', isDefault: false };
const A3 = { ...A1, id: 'a3', recipient: 'Lê Chi', phone: '0900000003', street: '3 Cầu Giấy', isDefault: false };

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
const twice = (el: HTMLElement | undefined) =>
  act(() => {
    el!.click();
    el!.click();
  });
const confirmBtn = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find((b) => b.textContent === label);

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
const SET_A2 = 'Đặt mặc định cho địa chỉ của Trần Bình';
const SET_A3 = 'Đặt mặc định cho địa chỉ của Lê Chi';
const DEL_A2 = 'Xoá địa chỉ của Trần Bình';
const DEL_A3 = 'Xoá địa chỉ của Lê Chi';

beforeEach(() => {
  localStorage.clear();
  mocks.list = [A1, A2, A3];
  mocks.gate = null;
  mocks.listCalls = 0;
  mocks.listError = false;
  mocks.script = [];
  mocks.update.mockReset().mockResolvedValue(A1);
  mocks.create.mockReset().mockResolvedValue(A1);
  mocks.remove.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('Sổ địa chỉ — Đặt mặc định khoá theo địa chỉ', () => {
  it('hai cú bấm cùng khung hình chỉ gọi PATCH một lần; nút aria-busy + aria-disabled, KHÔNG disabled thật', async () => {
    const c = await mount();
    holdList();
    twice(btn(c, SET_A2));
    await flush(3);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith('a2', { isDefault: true });
    const b = btn(c, SET_A2)!;
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await releaseList();
  });

  it('khoá giữ tới khi sổ địa chỉ mới về: bấm lúc sổ còn cũ không gọi thêm, sổ về rồi bấm lại được', async () => {
    const c = await mount();
    holdList();
    click(btn(c, SET_A2)!);
    await flush(4);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    click(btn(c, SET_A2)!);
    await flush(2);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await releaseList();
    expect(btn(c, SET_A2)!.hasAttribute('aria-busy')).toBe(false);
    click(btn(c, SET_A2)!);
    await flush(4);
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it('lỗi: role=alert ngay dưới địa chỉ đó, khoá nhả để bấm lại, không có unhandled rejection', async () => {
    mocks.update.mockRejectedValueOnce(new Error('Không đặt được mặc định'));
    const c = await mount();
    const seen = await captureUnhandledRejections(async () => {
      click(btn(c, SET_A2)!);
      await flush(6);
    });
    expect(seen).toEqual([]);
    const row = btn(c, SET_A2)!.closest('li')!;
    expect(row.querySelector('[role="alert"]')?.textContent).toContain('Không đặt được mặc định');
    expect(c.querySelectorAll('[role="alert"]')).toHaveLength(1);
    click(btn(c, SET_A2)!);
    await flush(6);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('khoá theo đích: địa chỉ khác vẫn đặt được trong lúc địa chỉ A còn bay; cùng địa chỉ A không chồng; cả hai nút đều báo bận', async () => {
    const c = await mount();
    holdList();
    click(btn(c, SET_A2)!);
    await flush(3);
    click(btn(c, SET_A3)!);
    await flush(3);
    expect(mocks.update.mock.calls.map((x) => x[0])).toEqual(['a2', 'a3']);
    expect(btn(c, SET_A2)!.getAttribute('aria-busy')).toBe('true');
    expect(btn(c, SET_A3)!.getAttribute('aria-busy')).toBe('true');
    click(btn(c, SET_A2)!);
    await flush(2);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    await releaseList();
  });

  it('lỗi nhớ riêng theo địa chỉ: A lỗi rồi B chạy xong thì lời báo của A vẫn còn; bấm lại A xoá lời báo cũ', async () => {
    mocks.update.mockImplementation(async (id: string) => {
      if (id === 'a2') throw new Error('A2 lỗi');
      return A1;
    });
    const c = await mount();
    click(btn(c, SET_A2)!);
    await flush(6);
    click(btn(c, SET_A3)!);
    await flush(6);
    expect(btn(c, SET_A2)!.closest('li')!.querySelector('[role="alert"]')?.textContent).toContain('A2 lỗi');
    expect(btn(c, SET_A3)!.closest('li')!.querySelector('[role="alert"]')).toBeNull();
    mocks.update.mockResolvedValue(A1);
    click(btn(c, SET_A2)!);
    await flush(6);
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('Sổ địa chỉ — Xoá khoá theo địa chỉ, loại trừ với Đặt mặc định', () => {
  const openConfirm = (c: HTMLElement, name: string) => click(btn(c, name)!);

  it('hai cú bấm cùng khung hình trên nút Xoá của hộp xác nhận chỉ gọi DELETE một lần; nút aria-busy + aria-disabled, KHÔNG disabled; "Giữ lại" không đóng được khi đang xoá', async () => {
    let finish!: () => void;
    mocks.remove.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ ok: true }); }));
    const c = await mount();
    openConfirm(c, DEL_A2);
    twice(confirmBtn(c, 'Xoá'));
    await flush(3);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith('a2');
    const del = confirmBtn(c, 'Đang xoá…')!;
    expect(del.getAttribute('aria-busy')).toBe('true');
    expect(del.getAttribute('aria-disabled')).toBe('true');
    expect(del.disabled).toBe(false);
    const keep = confirmBtn(c, 'Giữ lại')!;
    expect(keep.disabled).toBe(false);
    expect(keep.getAttribute('aria-disabled')).toBe('true');
    click(keep);
    expect(c.querySelector('[role="alertdialog"]')).not.toBeNull();
    click(del);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await flush(6);
    expect(c.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('xoá lỗi: hộp đóng, role=alert ở dòng đó, khoá nhả nên xoá lại được, không có unhandled rejection', async () => {
    mocks.remove.mockRejectedValueOnce(new Error('Không xoá được.'));
    const c = await mount();
    openConfirm(c, DEL_A2);
    const seen = await captureUnhandledRejections(async () => {
      click(confirmBtn(c, 'Xoá')!);
      await flush(6);
    });
    expect(seen).toEqual([]);
    expect(btn(c, DEL_A2)!.closest('li')!.querySelector('[role="alert"]')?.textContent).toContain('Không xoá được.');
    openConfirm(c, DEL_A2);
    expect(c.querySelector('[role="alert"]')).toBeNull();
    click(confirmBtn(c, 'Xoá')!);
    await flush(6);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });

  it('khoá giữ tới khi sổ mới về: focus chỉ về "Thêm địa chỉ mới" sau khi sổ đã làm mới', async () => {
    const c = await mount();
    openConfirm(c, DEL_A2);
    holdList();
    click(confirmBtn(c, 'Xoá')!);
    await flush(4);
    expect(c.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).not.toBe(btn(c, 'Thêm địa chỉ mới'));
    expect(btn(c, DEL_A2)).toBeUndefined();
    await releaseList();
    expect(document.activeElement).toBe(btn(c, 'Thêm địa chỉ mới'));
  });

  it('cùng một địa chỉ: đang đặt mặc định thì nút Xoá của dòng không mở hộp xác nhận và không gọi DELETE (loại trừ nhau)', async () => {
    const c = await mount();
    holdList();
    click(btn(c, SET_A2)!);
    await flush(3);
    expect(btn(c, DEL_A2)!.getAttribute('aria-disabled')).toBe('true');
    click(btn(c, DEL_A2)!);
    expect(c.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
    await releaseList();
  });

  it('loại trừ ở tầng khoá: bấm "Đặt mặc định" rồi "Xoá" của dòng trong cùng khung hình (state chưa kịp báo bận) thì DELETE trong hộp xác nhận vẫn bị chặn tới khi đặt mặc định xong', async () => {
    const c = await mount();
    holdList();
    act(() => {
      btn(c, SET_A2)!.click();
      btn(c, DEL_A2)!.click();
    });
    await flush(3);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(c.querySelector('[role="alertdialog"]')).not.toBeNull();
    click(confirmBtn(c, 'Xoá')!);
    await flush(3);
    expect(mocks.remove).not.toHaveBeenCalled();
    await releaseList();
  });

  it('khác địa chỉ: xoá A song song với đặt mặc định B; B không bị chặn', async () => {
    const c = await mount();
    openConfirm(c, DEL_A2);
    holdList();
    click(confirmBtn(c, 'Xoá')!);
    await flush(3);
    click(btn(c, SET_A3)!);
    await flush(3);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith('a3', { isDefault: true });
    await releaseList();
  });
});

describe('Sổ địa chỉ — sổ mới chưa về thì dòng đã xoá vẫn không quay lại (Mini 88A)', () => {
  type Rows = Record<string, unknown>[];
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const cardOf = (c: HTMLElement, name: string) => Array.from(c.querySelectorAll('li')).find((li) => li.textContent?.includes(name));
  const deleteA2 = async (c: HTMLElement) => {
    click(btn(c, DEL_A2)!);
    click(confirmBtn(c, 'Xoá')!);
    await flush(4);
  };

  it('xoá xong mà sổ mới chưa về: dòng đã xoá và cả ba nút của nó biến mất ngay, dòng kia còn nguyên; sổ về rồi vẫn vậy', async () => {
    const c = await mount();
    const refetch = deferred<Rows>();
    mocks.script.push(refetch.promise);
    await deleteA2(c);
    expect(mocks.listCalls).toBe(2);
    expect(mocks.remove).toHaveBeenCalledWith('a2');
    expect(cardOf(c, 'Trần Bình')).toBeUndefined();
    expect(btn(c, DEL_A2)).toBeUndefined();
    expect(btn(c, SET_A2)).toBeUndefined();
    expect(btn(c, 'Sửa địa chỉ của Trần Bình')).toBeUndefined();
    expect(cardOf(c, 'Lê Chi')).toBeDefined();
    expect(btn(c, DEL_A3)).toBeDefined();
    await act(async () => refetch.resolve([A1, A3]));
    await flush(4);
    expect(cardOf(c, 'Trần Bình')).toBeUndefined();
    expect(cardOf(c, 'Lê Chi')).toBeDefined();
  });

  it('xoá xong mà tải lại sổ lỗi: dòng đã xoá không quay lại, dòng kia còn nguyên, không có unhandled rejection', async () => {
    const c = await mount();
    const refetch = deferred<Rows>();
    mocks.script.push(refetch.promise);
    const seen = await captureUnhandledRejections(async () => {
      await deleteA2(c);
      await act(async () => refetch.reject(new Error('offline')));
      await flush(4);
    });
    expect(seen).toEqual([]);
    expect(mocks.listCalls).toBe(2);
    expect(cardOf(c, 'Trần Bình')).toBeUndefined();
    expect(cardOf(c, 'Lê Chi')).toBeDefined();
  });

  it('xoá một địa chỉ rồi đặt mặc định địa chỉ khác trước khi lần tải lại đầu về (lần sau huỷ lần trước): địa chỉ đã xoá vắng mặt ở mọi bước, kể cả khi sổ cũ của lần bị huỷ về muộn', async () => {
    const c = await mount();
    const afterDelete = deferred<Rows>();
    const afterDefault = deferred<Rows>();
    mocks.script.push(afterDelete.promise, afterDefault.promise);
    await deleteA2(c);
    expect(cardOf(c, 'Trần Bình')).toBeUndefined();
    click(btn(c, SET_A3)!);
    await flush(4);
    expect(mocks.update).toHaveBeenCalledWith('a3', { isDefault: true });
    expect(mocks.listCalls).toBe(3);
    expect(cardOf(c, 'Trần Bình')).toBeUndefined();
    await act(async () => afterDelete.resolve([A1, A2, A3]));
    await flush(4);
    expect(cardOf(c, 'Trần Bình')).toBeUndefined();
    await act(async () => afterDefault.resolve([{ ...A1, isDefault: false }, { ...A3, isDefault: true }]));
    await flush(4);
    expect(cardOf(c, 'Trần Bình')).toBeUndefined();
    expect(cardOf(c, 'Lê Chi')!.textContent).toContain('Mặc định');
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it('kiểm hồi quy (đã đúng từ trước, không chứng minh sửa của wave): đặt mặc định xong mà tải lại sổ lỗi thì khoá vẫn nhả, nút hết bận, bấm lại gửi được', async () => {
    const c = await mount();
    const refetch = deferred<Rows>();
    mocks.script.push(refetch.promise);
    click(btn(c, SET_A2)!);
    await flush(4);
    expect(btn(c, SET_A2)!.getAttribute('aria-busy')).toBe('true');
    const seen = await captureUnhandledRejections(async () => {
      await act(async () => refetch.reject(new Error('offline')));
      await flush(4);
    });
    expect(seen).toEqual([]);
    expect(btn(c, SET_A2)!.hasAttribute('aria-busy')).toBe(false);
    click(btn(c, SET_A2)!);
    await flush(4);
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
});

describe('Sổ địa chỉ — Thử lại tải sổ', () => {
  it('hai cú bấm cùng khung hình chỉ tải lại một lần', async () => {
    mocks.listError = true;
    const c = await mount();
    const before = mocks.listCalls;
    mocks.listError = false;
    holdList();
    twice(btn(c, 'Thử lại'));
    await flush(3);
    expect(mocks.listCalls).toBe(before + 1);
    await releaseList();
    expect(c.textContent).toContain('Nguyễn An');
  });
});
