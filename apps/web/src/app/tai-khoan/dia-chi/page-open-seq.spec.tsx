// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { chooseGeo, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// Wave 101B: form Sửa/Thêm địa chỉ nằm tại chỗ trong sổ. Nút Huỷ khoá lúc đang lưu nhưng "Sửa" của dòng khác hay "Thêm địa chỉ mới" thay form đi được:
// lệnh lưu cũ xong muộn không được đóng form vừa mở lại và xoá chữ khách đang gõ.

const mocks = vi.hoisted(() => ({
  list: [] as Record<string, unknown>[],
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
  getAddresses: async () => mocks.list,
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

beforeAll(async () => {
  await import('@/components/mini/empty-state');
});

let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<AddressBookPage />);
  await flush(6);
  return mounted.container;
};
const btn = (c: HTMLElement, name: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name) as HTMLButtonElement | undefined;
const phoneInput = (c: HTMLElement) => Array.from(c.querySelectorAll('label')).find((l) => l.textContent?.includes('Số điện thoại'))!.querySelector('input')!;
const gate = (fn: typeof mocks.update) => {
  let release!: (v: unknown) => void;
  let fail!: (e: unknown) => void;
  const p = new Promise((res, rej) => {
    release = res;
    fail = rej;
  });
  fn.mockImplementationOnce(() => p);
  return { release, fail };
};

beforeEach(() => {
  localStorage.clear();
  mocks.list = [A1, A2];
  mocks.update.mockReset().mockResolvedValue(A1);
  mocks.create.mockReset().mockResolvedValue(A1);
  mocks.remove.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('Sổ địa chỉ: form Sửa', () => {
  it('lưu địa chỉ A, chuyển sang sửa địa chỉ B và gõ: lệnh của A xong muộn không đóng form của B, chữ đang gõ còn', async () => {
    const c = await mount();
    const g = gate(mocks.update);
    click(btn(c, 'Sửa địa chỉ của Trần Bình')!);
    await flush(4);
    click(btn(c, 'Lưu')!);
    await flush(2);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    click(btn(c, 'Sửa địa chỉ của Nguyễn An')!);
    await flush(4);
    typeInto(phoneInput(c), '0911222333');
    await act(async () => g.release(A2));
    await flush(6);
    expect(c.querySelector('form')).not.toBeNull();
    expect(phoneInput(c).value).toBe('0911222333');
  });

  it('quay lại sửa đúng địa chỉ A (form mới) và gõ: lệnh cũ xong muộn không đóng form mới', async () => {
    const c = await mount();
    const g = gate(mocks.update);
    click(btn(c, 'Sửa địa chỉ của Trần Bình')!);
    await flush(4);
    click(btn(c, 'Lưu')!);
    await flush(2);
    click(btn(c, 'Sửa địa chỉ của Nguyễn An')!);
    await flush(4);
    click(btn(c, 'Sửa địa chỉ của Trần Bình')!);
    await flush(4);
    typeInto(phoneInput(c), '0911222333');
    await act(async () => g.release(A2));
    await flush(6);
    expect(c.querySelector('form')).not.toBeNull();
    expect(phoneInput(c).value).toBe('0911222333');
  });

  it('không đổi form giữa chừng: lưu xong thì form đóng như trước', async () => {
    const c = await mount();
    const g = gate(mocks.update);
    click(btn(c, 'Sửa địa chỉ của Trần Bình')!);
    await flush(4);
    click(btn(c, 'Lưu')!);
    await flush(2);
    await act(async () => g.release(A2));
    await flush(6);
    expect(c.querySelector('form')).toBeNull();
  });
});

describe('Sổ địa chỉ: form Thêm', () => {
  const fillAndSave = async (c: HTMLElement) => {
    const input = (label: string) => Array.from(c.querySelectorAll('label')).find((l) => l.textContent?.includes(label))!.querySelector('input')!;
    typeInto(input('Người nhận'), 'Lê Cường');
    typeInto(input('Số điện thoại'), '0912345678');
    typeInto(input('Số nhà, tên đường'), '5 Láng Hạ');
    chooseGeo(c, 'Tỉnh/Thành phố', '84_VN01');
    await flush();
    chooseGeo(c, 'Phường/Xã', '84_VN01_001');
    click(btn(c, 'Lưu')!);
    await flush(2);
  };

  it('lưu địa chỉ mới, chuyển sang sửa dòng khác rồi mở lại form Thêm và gõ: lệnh cũ xong muộn không đóng form Thêm mới', async () => {
    const c = await mount();
    const g = gate(mocks.create);
    click(btn(c, 'Thêm địa chỉ mới')!);
    await flush(4);
    await fillAndSave(c);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    click(btn(c, 'Sửa địa chỉ của Nguyễn An')!);
    await flush(4);
    click(btn(c, 'Huỷ')!);
    await flush(2);
    click(btn(c, 'Thêm địa chỉ mới')!);
    await flush(4);
    const name = Array.from(c.querySelectorAll('label')).find((l) => l.textContent?.includes('Người nhận'))!.querySelector('input')!;
    typeInto(name, 'Chữ đang gõ');
    await act(async () => g.release(A1));
    await flush(6);
    expect(c.querySelector('form')).not.toBeNull();
    expect(name.isConnected).toBe(true);
    expect(Array.from(c.querySelectorAll('label')).find((l) => l.textContent?.includes('Người nhận'))!.querySelector('input')!.value).toBe('Chữ đang gõ');
  });

  it('không đổi form giữa chừng: thêm xong thì form đóng như trước', async () => {
    const c = await mount();
    const g = gate(mocks.create);
    click(btn(c, 'Thêm địa chỉ mới')!);
    await flush(4);
    await fillAndSave(c);
    await act(async () => g.release(A1));
    await flush(6);
    expect(c.querySelector('form')).toBeNull();
  });
});
