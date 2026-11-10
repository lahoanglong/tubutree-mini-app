// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// Sửa hồ sơ web ↔ Mini (Wave 92B ↔ 78A): lệnh lưu giữ khoá tới khi /me mới về (để ngày sinh đã đặt chuyển sang chỉ đọc) nhưng có hạn 4 giây,
// dù /me tải lại hay treo: mạng chậm không được giữ nút "Lưu thay đổi" lâu hơn lệnh đã xong.

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: 'u1', fullName: 'Lan', avatarUrl: null as string | null } as Record<string, unknown> | null,
    status: 'authenticated' as string,
    initialized: true,
    sessionUnavailable: false,
    retrySession: vi.fn(),
    updateProfile: vi.fn(),
  },
  get: vi.fn(),
  patch: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, patch: mocks.patch } }));
vi.mock('@/components/account/cloudinary-upload', () => ({ isCloudinaryConfigured: () => false, uploadToCloudinary: vi.fn() }));

import EditProfilePage from './page';
import { NetworkError } from '@/lib/client-api';

const ME = { id: 'u1', fullName: 'Lan', email: 'lan@tubu.vn', avatarUrl: null, dob: '1990-05-01', phone: '0912345678', onboarded: true, segments: [] };
const never = () => new Promise<never>(() => undefined);

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<EditProfilePage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const saveBtn = (c: HTMLElement) => byText(c, 'button', 'Lưu thay đổi') as HTMLButtonElement;
const nameField = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLInputElement>('input')).find((i) => c.querySelector(`label[for="${i.id}"]`)?.textContent === 'Họ và tên')!;
const alertText = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? '';
const meCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/me').length;

beforeEach(() => {
  mocks.auth.user = { id: 'u1', fullName: 'Lan', avatarUrl: null };
  mocks.auth.updateProfile.mockReset();
  mocks.get.mockReset().mockResolvedValue(ME);
  mocks.patch.mockReset().mockResolvedValue({ ...ME });
  // shouldAdvanceTime để `flush` (setTimeout 0) và bộ đếm giờ của react-query vẫn chạy; chỉ giả setTimeout để tua tới hạn.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('/tai-khoan/ho-so — khoá lưu có hạn 4 giây khi /me không về (W92B)', () => {
  it('lưu thành công mà /me tải lại treo: còn khoá ở 3 giây (bấm thêm không gửi lệnh), nhả sau 4 giây, rồi lưu lại được', async () => {
    const { container } = await mount();
    mocks.get.mockImplementation(() => never());
    const btn = saveBtn(container);
    click(btn);
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(meCalls()).toBe(2);
    await advance(3_000);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    click(btn);
    await flush(4);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    await advance(1_500);
    await flush(4);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    click(btn);
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(2);
  });

  it('lưu lỗi mà /me tải lại treo: lời lỗi và chữ đã nhập giữ nguyên, khoá nhả sau 4 giây để thử lại', async () => {
    mocks.patch.mockRejectedValueOnce(new NetworkError(false)).mockResolvedValueOnce({ ...ME });
    const { container } = await mount();
    typeInto(nameField(container), 'Lan C');
    mocks.get.mockImplementation(() => never());
    const btn = saveBtn(container);
    click(btn);
    await flush(6);
    expect(alertText(container)).toBeTruthy();
    expect(meCalls()).toBe(2);
    await advance(3_000);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    click(btn);
    await flush(4);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    await advance(1_500);
    await flush(4);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    expect(nameField(container).value).toBe('Lan C');
    click(btn);
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(2);
  });
});
