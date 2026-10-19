// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// mv-order: sổ địa chỉ giống Mini App (addresses.tsx). Gốc: BUYERWEB-14: khách gõ sai địa chỉ thì không sửa/xoá được, web không có Sổ địa chỉ dù API đã có PATCH/DELETE.

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading',
  list: [] as Record<string, unknown>[],
  listError: false,
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/geo-client', () => ({
  getProvinces: async () => [{ code: '84_VN01', name: 'Hà Nội' }],
  getCommunes: async () => [{ code: '84_VN01_001', name: 'Cầu Giấy' }],
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getAddresses: async () => {
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

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<AddressBookPage />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const btn = (c: HTMLElement, name: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name);

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.list = [A1, A2];
  mocks.listError = false;
  mocks.update.mockReset().mockResolvedValue(A1);
  mocks.create.mockReset().mockResolvedValue(A1);
  mocks.remove.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('sổ địa chỉ như Mini App', () => {
  it('tiêu đề trong dải TitleBand, một h1', async () => {
    const c = await mount();
    expect(c.querySelector('[data-page-bleed] h1')!.textContent).toBe('Sổ địa chỉ');
    expect(c.querySelectorAll('h1')).toHaveLength(1);
  });

  it('thẻ mặc định viền xanh 1,5px không bóng; thẻ thường giữ thẻ nổi', async () => {
    const c = await mount();
    const [def, other] = Array.from(c.querySelectorAll('ul > li'));
    expect(def!.className).toContain('max-md:border-[1.5px]');
    expect(def!.className).toContain('max-md:shadow-none');
    expect(other!.className).not.toContain('max-md:border-[1.5px]');
  });

  it('tên người nhận cỡ sm; Sửa xanh, Xóa đỏ, không gạch chân ở điện thoại', async () => {
    const c = await mount();
    const name = c.querySelector('ul > li span')!;
    expect(name.className).toContain('max-md:text-sm');
    expect(btn(c, 'Sửa địa chỉ của Nguyễn An')!.className).toContain('max-md:no-underline');
    expect(btn(c, 'Sửa địa chỉ của Nguyễn An')!.className).toContain('max-md:text-[color:var(--color-text-brand)]');
    expect(btn(c, 'Xóa địa chỉ của Nguyễn An')!.className).toContain('max-md:text-[color:var(--color-text-danger)]');
  });

  it('nút đặt mặc định ghi "Đặt mặc định"; nút thêm không có dấu "+" và có biểu tượng', async () => {
    const c = await mount();
    expect(btn(c, 'Đặt địa chỉ của Trần Bình làm mặc định')!.textContent).toBe('Đặt mặc định');
    const add = btn(c, 'Thêm địa chỉ mới')!;
    expect(add.querySelector('svg')).not.toBeNull();
    expect(add.className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
  });
});
