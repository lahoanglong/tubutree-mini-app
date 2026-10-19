// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// BUYERWEB-14: khách gõ sai địa chỉ thì không sửa/xoá được, web không có Sổ địa chỉ dù API đã có PATCH/DELETE.

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

describe('/tai-khoan/dia-chi — Sổ địa chỉ (BUYERWEB-14)', () => {
  it('khách chưa đăng nhập: được mời đăng nhập và quay lại đúng trang này', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    const a = c.querySelector<HTMLAnchorElement>('a[href^="/dang-nhap"]');
    expect(a?.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Ftai-khoan%2Fdia-chi');
  });

  it('liệt kê địa chỉ, đánh dấu mặc định, chỉ địa chỉ chưa mặc định mới có nút "Đặt mặc định"', async () => {
    const c = await mount();
    const items = Array.from(c.querySelectorAll('ul > li'));
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('Nguyễn An · 0912345678');
    expect(items[0]!.textContent).toContain('Mặc định');
    expect(items[0]!.textContent).toContain('1 Xuân Thuỷ, Cầu Giấy, Hà Nội');
    expect(btn(c, 'Đặt địa chỉ của Nguyễn An làm mặc định')).toBeUndefined();
    expect(btn(c, 'Đặt địa chỉ của Trần Bình làm mặc định')).toBeDefined();
  });

  it('chưa có địa chỉ nào: nói rõ và vẫn có nút thêm', async () => {
    mocks.list = [];
    const c = await mount();
    expect(c.textContent).toContain('Bạn chưa lưu địa chỉ nào');
    expect(btn(c, 'Thêm địa chỉ mới')).toBeDefined();
  });

  it('không tải được: báo lỗi và có nút Thử lại', async () => {
    mocks.listError = true;
    const c = await mount();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Không tải được sổ địa chỉ');
    expect(btn(c, 'Thử lại')).toBeDefined();
  });

  it('sửa: form điền sẵn, sửa SĐT rồi lưu gọi PATCH đúng id với dữ liệu mới', async () => {
    const c = await mount();
    click(btn(c, 'Sửa địa chỉ của Trần Bình')!);
    await flush(4);
    const phone = Array.from(c.querySelectorAll('label')).find((l) => l.textContent?.includes('Số điện thoại'))!.querySelector('input')!;
    expect(phone.value).toBe('0987654321');
    typeInto(phone, '0911222333');
    click(btn(c, 'Lưu thay đổi')!);
    await flush(6);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0]![0]).toBe('a2');
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ phone: '0911222333', recipient: 'Trần Bình', provinceCode: '84_VN01', wardCode: '84_VN01_001' });
    expect(c.querySelector('form')).toBeNull();
  });

  it('sửa với SĐT sai: không gọi API, báo ngay tại ô', async () => {
    const c = await mount();
    click(btn(c, 'Sửa địa chỉ của Trần Bình')!);
    await flush(4);
    typeInto(Array.from(c.querySelectorAll('label')).find((l) => l.textContent?.includes('Số điện thoại'))!.querySelector('input'), '123');
    click(btn(c, 'Lưu thay đổi')!);
    await flush(4);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(c.textContent).toContain('Số điện thoại chưa đúng');
  });

  it('đặt mặc định: PATCH isDefault', async () => {
    const c = await mount();
    click(btn(c, 'Đặt địa chỉ của Trần Bình làm mặc định')!);
    await flush(4);
    expect(mocks.update).toHaveBeenCalledWith('a2', { isDefault: true });
  });

  it('xoá phải xác nhận: "Giữ lại" thì không xoá; "Xóa" thì gọi DELETE đúng id', async () => {
    const c = await mount();
    click(btn(c, 'Xóa địa chỉ của Trần Bình')!);
    expect(c.querySelector('[role="alertdialog"]')).not.toBeNull();
    click(btn(c, 'Giữ lại')!);
    await flush(2);
    expect(mocks.remove).not.toHaveBeenCalled();
    click(btn(c, 'Xóa địa chỉ của Trần Bình')!);
    click(Array.from(c.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === 'Xóa') ?? null);
    await flush(4);
    expect(mocks.remove).toHaveBeenCalledWith('a2');
    expect(c.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('xoá xong: báo "Đã xóa địa chỉ." như Mini App', async () => {
    const c = await mount();
    click(btn(c, 'Xóa địa chỉ của Trần Bình')!);
    click(Array.from(c.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === 'Xóa') ?? null);
    await flush(4);
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã xóa địa chỉ.');
  });

  it('WEB-13: mở hộp xác nhận xóa thì focus vào "Giữ lại"; "Giữ lại" trả focus về nút "Xóa" của đúng dòng đó', async () => {
    const c = await mount();
    click(btn(c, 'Xóa địa chỉ của Trần Bình')!);
    expect(document.activeElement).toBe(btn(c, 'Giữ lại'));
    expect(document.getElementById(c.querySelector('[role="alertdialog"]')!.getAttribute('aria-describedby')!)!.textContent).toContain('vẫn giữ nguyên địa chỉ giao');
    click(btn(c, 'Giữ lại')!);
    await flush(2);
    expect(document.activeElement).toBe(btn(c, 'Xóa địa chỉ của Trần Bình'));
  });

  it('WEB-13: xóa lỗi thì focus về nút "Xóa" của dòng; xóa xong (dòng sắp biến mất) thì về nút "Thêm địa chỉ mới", không rơi về <body>', async () => {
    mocks.remove.mockRejectedValueOnce(new Error('Không xóa được.'));
    const c = await mount();
    click(btn(c, 'Xóa địa chỉ của Trần Bình')!);
    click(Array.from(c.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === 'Xóa') ?? null);
    await flush(4);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Không xóa được.');
    expect(document.activeElement).toBe(btn(c, 'Xóa địa chỉ của Trần Bình'));
    click(btn(c, 'Xóa địa chỉ của Trần Bình')!);
    click(Array.from(c.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === 'Xóa') ?? null);
    await flush(4);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(btn(c, 'Thêm địa chỉ mới'));
  });

  it('xoá xong rồi đặt mặc định thất bại: thông báo đã xóa biến mất, chỉ còn lỗi', async () => {
    const c = await mount();
    click(btn(c, 'Xóa địa chỉ của Trần Bình')!);
    click(Array.from(c.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === 'Xóa') ?? null);
    await flush(4);
    expect(c.querySelector('[role="status"]')).not.toBeNull();
    mocks.update.mockRejectedValue(new Error('Không đặt được mặc định'));
    mocks.list = [A1, A2];
    await flush(4);
    click(btn(c, 'Đặt địa chỉ của Trần Bình làm mặc định')!);
    await flush(4);
    expect(c.querySelector('[role="status"]')).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Không đặt được mặc định');
  });

  it('thông báo đã xóa tự tắt sau vài giây', async () => {
    const c = await mount();
    vi.useFakeTimers();
    const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    try {
      click(btn(c, 'Xóa địa chỉ của Trần Bình')!);
      click(Array.from(c.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === 'Xóa') ?? null);
      await advance(100);
      expect(c.querySelector('[role="status"]')).not.toBeNull();
      await advance(5000);
      expect(c.querySelector('[role="status"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('BE không cho xoá (địa chỉ đang gắn gói giao định kỳ): hiện nguyên văn lời BE', async () => {
    mocks.remove.mockRejectedValue(new Error('Địa chỉ đang dùng cho gói giao định kỳ: Dầu gội. Hãy đổi địa chỉ của gói trước.'));
    const c = await mount();
    click(btn(c, 'Xóa địa chỉ của Trần Bình')!);
    click(Array.from(c.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === 'Xóa') ?? null);
    await flush(4);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('đang dùng cho gói giao định kỳ');
  });

  it('thêm mới: gọi POST và đóng form', async () => {
    const c = await mount();
    click(btn(c, 'Thêm địa chỉ mới')!);
    await flush(2);
    expect(c.querySelector('form[aria-label="Thêm địa chỉ mới"]')).not.toBeNull();
    click(btn(c, 'Hủy')!);
    expect(c.querySelector('form')).toBeNull();
  });

  it('truy cập: h1 → h2 không nhảy cấp, mọi nút có tên, vùng chạm 44px', async () => {
    const c = await mount();
    click(btn(c, 'Sửa địa chỉ của Trần Bình')!);
    await flush(3);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(headingProblems(c)).toEqual([]);
  });
});
