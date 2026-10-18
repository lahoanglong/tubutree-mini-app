// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unlabeledFields, unnamedControls } from '@/test-utils/a11y';
import { ApiError, NetworkError } from '@/lib/client-api';

// D5-14: khách chỉ xem được tên, không sửa được hồ sơ trên web. PATCH /me đã có (fullName); số điện thoại không nằm trong
// UpdateMeDto nên chỉ hiển thị, không cho sửa.

const mocks = vi.hoisted(() => ({
  updateMyName: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  updateMyName: mocks.updateMyName,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ updateProfile: mocks.updateProfile }),
}));

import { ProfileSection } from './profile-section';

function CacheProbe() {
  const qc = useQueryClient();
  // Trang thật đã có /me trong bộ nhớ đệm (getMe); gieo sẵn ở đây rồi nghe thay đổi.
  useState(() => qc.setQueryData(['me'], { fullName: 'Nguyễn An', walletBalance: 5 }));
  const { data } = useQuery({ queryKey: ['me'], queryFn: () => Promise.resolve(null), enabled: false });
  return <output data-testid="cache">{JSON.stringify(data ?? null)}</output>;
}

let mounted: Rendered[] = [];
const mount = (name: string | null = 'Nguyễn An', phone: string | null | undefined = '0912345678') => {
  const r = render(
    <>
      <ProfileSection name={name} phone={phone} />
      <CacheProbe />
    </>,
  );
  mounted.push(r);
  return r.container;
};
const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input')!;
const save = (c: HTMLElement) => byText(c, 'button', 'Lưu')!;

beforeEach(() => {
  mocks.updateMyName.mockReset().mockResolvedValue(undefined);
  mocks.updateProfile.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('ProfileSection — xem hồ sơ', () => {
  it('hiện họ tên và số điện thoại (định dạng dễ đọc), chưa mở ô nhập', () => {
    const c = mount();
    expect(c.textContent).toContain('Nguyễn An');
    expect(c.textContent).toContain('0912 345 678');
    expect(c.querySelector('input')).toBeNull();
    expect(byText(c, 'button', 'Sửa tên')).not.toBeNull();
  });

  it('chưa có tên hoặc chưa có số: câu báo rõ, không để trống trơn', () => {
    const c = mount(null, null);
    expect(c.textContent).toContain('Chưa đặt tên');
    expect(c.textContent).toContain('Chưa có số điện thoại');
  });

  it('số điện thoại chỉ đọc: không có nút sửa số', () => {
    const c = mount();
    expect(byText(c, 'button', 'Sửa số')).toBeNull();
    expect(c.querySelectorAll('button')).toHaveLength(1);
  });
});

describe('ProfileSection — sửa tên', () => {
  it('"Sửa tên" mở ô nhập có nhãn "Họ tên", điền sẵn tên hiện tại và đưa con trỏ vào', () => {
    const c = mount();
    click(byText(c, 'button', 'Sửa tên'));
    expect(input(c).value).toBe('Nguyễn An');
    expect(input(c).maxLength).toBe(120);
    expect(c.querySelector(`label[for="${input(c).id}"]`)?.textContent).toBe('Họ tên');
    expect(document.activeElement).toBe(input(c));
  });

  it('lưu: gửi tên đã cắt khoảng trắng, đóng ô nhập, hiện "Đã lưu tên." và cập nhật phiên + bộ nhớ đệm /me', async () => {
    const c = mount();
    click(byText(c, 'button', 'Sửa tên'));
    typeInto(input(c), '  Trần Bình  ');
    click(save(c));
    await flush();
    expect(mocks.updateMyName).toHaveBeenCalledTimes(1);
    expect(mocks.updateMyName).toHaveBeenCalledWith('Trần Bình');
    expect(c.querySelector('input')).toBeNull();
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã lưu tên.');
    expect(c.textContent).toContain('Trần Bình');
    expect(mocks.updateProfile).toHaveBeenCalledWith({ fullName: 'Trần Bình' });
    expect(JSON.parse(c.querySelector('[data-testid="cache"]')!.textContent!)).toEqual({ fullName: 'Trần Bình', walletBalance: 5 });
  });

  it('Enter trong ô nhập cũng lưu', async () => {
    const c = mount();
    click(byText(c, 'button', 'Sửa tên'));
    typeInto(input(c), 'Lê Chi');
    const form = c.querySelector('form')!;
    const { act } = await import('react');
    act(() => {
      form.requestSubmit();
    });
    await flush();
    expect(mocks.updateMyName).toHaveBeenCalledWith('Lê Chi');
  });

  it('tên trống hoặc toàn khoảng trắng: báo ngay, không gọi API, ô nhập còn mở', () => {
    const c = mount();
    click(byText(c, 'button', 'Sửa tên'));
    typeInto(input(c), '   ');
    click(save(c));
    expect(mocks.updateMyName).not.toHaveBeenCalled();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Bạn nhập họ tên nhé.');
    expect(input(c).getAttribute('aria-invalid')).toBe('true');
  });

  it('tên không đổi: đóng ô nhập, không gọi API', () => {
    const c = mount();
    click(byText(c, 'button', 'Sửa tên'));
    click(save(c));
    expect(mocks.updateMyName).not.toHaveBeenCalled();
    expect(c.querySelector('input')).toBeNull();
  });

  it('"Huỷ" bỏ thay đổi và lần mở sau điền lại tên cũ', () => {
    const c = mount();
    click(byText(c, 'button', 'Sửa tên'));
    typeInto(input(c), 'Tên khác');
    click(byText(c, 'button', 'Huỷ'));
    expect(c.querySelector('input')).toBeNull();
    expect(c.textContent).toContain('Nguyễn An');
    expect(mocks.updateMyName).not.toHaveBeenCalled();
    click(byText(c, 'button', 'Sửa tên'));
    expect(input(c).value).toBe('Nguyễn An');
  });

  it('đang lưu: nút khoá và đổi chữ, bấm thêm không gửi lần hai', async () => {
    let release: () => void = () => {};
    mocks.updateMyName.mockReturnValue(new Promise<void>((r) => (release = r)));
    const c = mount();
    click(byText(c, 'button', 'Sửa tên'));
    typeInto(input(c), 'Trần Bình');
    click(save(c));
    await flush(1);
    const busy = byText(c, 'button', 'Đang lưu…') as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    click(busy);
    expect(mocks.updateMyName).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(c.querySelector('input')).toBeNull();
  });

  it('máy chủ từ chối (400): câu tiếng Việt, giữ ô nhập và chữ đã gõ, cho bấm lại, không cập nhật phiên', async () => {
    mocks.updateMyName.mockRejectedValueOnce(new ApiError('fullName must be shorter than or equal to 120 characters', 400));
    const c = mount();
    click(byText(c, 'button', 'Sửa tên'));
    typeInto(input(c), 'Trần Bình');
    click(save(c));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Họ tên chưa hợp lệ. Bạn kiểm tra lại nhé.');
    expect(c.querySelector('[role="alert"]')?.textContent).not.toMatch(/must be/);
    expect(input(c).value).toBe('Trần Bình');
    expect((save(c) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    click(save(c));
    await flush();
    expect(c.querySelector('input')).toBeNull();
  });

  it('mất mạng: báo mất kết nối; lỗi khác (500): báo thử lại sau', async () => {
    mocks.updateMyName.mockRejectedValueOnce(new NetworkError(false));
    const c = mount();
    click(byText(c, 'button', 'Sửa tên'));
    typeInto(input(c), 'Trần Bình');
    click(save(c));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Không kết nối được tới Tubu Tree. Bạn kiểm tra mạng rồi thử lại nhé.');
    mocks.updateMyName.mockRejectedValueOnce(new ApiError('Internal', 500));
    click(save(c));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Chưa lưu được. Bạn thử lại sau ít phút nhé.');
  });

  it('a11y: ô nhập có nhãn, mọi nút có tên và vùng chạm 44px (cả lúc xem và lúc sửa)', () => {
    const c = mount();
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    click(byText(c, 'button', 'Sửa tên'));
    expect(unlabeledFields(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});
