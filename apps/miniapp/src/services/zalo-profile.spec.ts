import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getZaloUserInfo: vi.fn(),
  ensurePhone: vi.fn(),
  user: { current: null as { fullName?: string | null; phone?: string | null } | null },
}));
vi.mock('./zmp-bridge', () => ({ getZaloUserInfo: mocks.getZaloUserInfo }));
vi.mock('../store/auth', () => ({
  useAuthStore: { getState: () => ({ user: mocks.user.current, ensurePhone: mocks.ensurePhone }) },
}));

import { requestZaloProfile, usableProfileName } from './zalo-profile';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.current = { fullName: 'Khách', phone: null };
});

describe('usableProfileName', () => {
  it("bỏ tên giữ chỗ 'Khách' của tài khoản khách và tên rỗng", () => {
    expect(usableProfileName('Khách')).toBe('');
    expect(usableProfileName('  khách ')).toBe('');
    expect(usableProfileName(null)).toBe('');
    expect(usableProfileName(undefined)).toBe('');
    expect(usableProfileName('  Lã Hoàng Long ')).toBe('Lã Hoàng Long');
  });
});

describe('requestZaloProfile — xin quyền tên + SĐT Zalo để điền sẵn form địa chỉ (Q-27)', () => {
  it('khách đồng ý cả hai → trả tên + SĐT, hỏi tên trước rồi mới tới SĐT (2 sheet native không chồng nhau)', async () => {
    const order: string[] = [];
    mocks.getZaloUserInfo.mockImplementation(async () => { order.push('name'); return { name: 'Lã Hoàng Long' }; });
    mocks.ensurePhone.mockImplementation(async () => { order.push('phone'); return '0901234567'; });
    await expect(requestZaloProfile()).resolves.toEqual({ name: 'Lã Hoàng Long', phone: '0901234567' });
    expect(order).toEqual(['name', 'phone']);
  });

  it('từ chối quyền tên (SDK reject) nhưng cho SĐT → vẫn lấy được SĐT, tên để trống', async () => {
    mocks.getZaloUserInfo.mockRejectedValue({ code: -201 });
    mocks.ensurePhone.mockResolvedValue('0901234567');
    await expect(requestZaloProfile()).resolves.toEqual({ name: '', phone: '0901234567' });
  });

  it('từ chối SĐT (ensurePhone trả null) → chỉ có tên, không throw', async () => {
    mocks.getZaloUserInfo.mockResolvedValue({ name: 'Ánh' });
    mocks.ensurePhone.mockResolvedValue(null);
    await expect(requestZaloProfile()).resolves.toEqual({ name: 'Ánh', phone: '' });
  });

  it('từ chối cả hai / chạy ngoài Zalo (ensurePhone cũng ném) → cả hai rỗng, nhập tay', async () => {
    mocks.getZaloUserInfo.mockRejectedValue(new Error('no bridge'));
    mocks.ensurePhone.mockRejectedValue(new Error('no bridge'));
    await expect(requestZaloProfile()).resolves.toEqual({ name: '', phone: '' });
  });

  it('tài khoản đã có SĐT → KHÔNG hỏi lại SĐT (không bật sheet thừa), trả luôn SĐT đó', async () => {
    mocks.user.current = { fullName: 'Khách', phone: '0988888888' };
    mocks.getZaloUserInfo.mockResolvedValue({ name: 'Bình' });
    await expect(requestZaloProfile()).resolves.toEqual({ name: 'Bình', phone: '0988888888' });
    expect(mocks.ensurePhone).not.toHaveBeenCalled();
  });

  it('tài khoản đã có tên thật → KHÔNG hỏi lại quyền tên', async () => {
    mocks.user.current = { fullName: 'Cường', phone: null };
    mocks.ensurePhone.mockResolvedValue('0977777777');
    await expect(requestZaloProfile()).resolves.toEqual({ name: 'Cường', phone: '0977777777' });
    expect(mocks.getZaloUserInfo).not.toHaveBeenCalled();
  });

  it("Zalo trả tên rỗng hoặc đúng chữ 'Khách' → coi như chưa có tên", async () => {
    mocks.getZaloUserInfo.mockResolvedValue({ name: 'Khách' });
    mocks.ensurePhone.mockResolvedValue(null);
    await expect(requestZaloProfile()).resolves.toEqual({ name: '', phone: '' });
  });
});
