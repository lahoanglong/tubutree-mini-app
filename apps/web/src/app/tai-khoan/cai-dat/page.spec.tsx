// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Chép ý settings.spec.tsx (Mini App): công tắc đọc từ server, lưu lỗi thì hoàn lại và báo, khoá khi đang lưu, một lần tải,
// "Cập nhật đơn hàng" không phải công tắc, cỡ chữ là nhóm radio, link hồ sơ/địa chỉ, theo dõi OA chỉ khi có OA, đăng xuất.
// Không chép phần đồng bộ cờ cũ trên máy (settings-legacy-sync): chỉ Mini App có thiết bị cũ.

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: 'u1', fullName: 'Lan' } as Record<string, unknown> | null,
    status: 'authenticated' as string,
    initialized: true,
    sessionUnavailable: false,
    retrySession: vi.fn(),
    logout: vi.fn(),
  },
  get: vi.fn(),
  patch: vi.fn(),
  oaAvailable: false,
  follow: vi.fn(),
  storageSet: vi.fn(),
  storageGet: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, patch: mocks.patch } }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    oa: {
      get available() {
        return mocks.oaAvailable;
      },
      follow: mocks.follow,
    },
    storage: { get: mocks.storageGet, set: mocks.storageSet },
  },
}));

import SettingsPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<SettingsPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const promo = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="switch"][aria-label="Khuyến mãi & mã giảm giá"]')!;
const garden = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="switch"][aria-label="Nhắc nhở Vườn Xanh & tương tác bài viết"]')!;
const radios = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="radiogroup"][aria-label="Cỡ chữ"] [role="radio"]'));

beforeEach(() => {
  mocks.auth.user = { id: 'u1', fullName: 'Lan' };
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.auth.sessionUnavailable = false;
  mocks.auth.logout.mockReset().mockResolvedValue(undefined);
  mocks.get.mockReset().mockResolvedValue({ notifyPromo: true, notifyGarden: true });
  mocks.patch.mockReset().mockImplementation(async (_p: string, body: object) => ({ notifyPromo: true, notifyGarden: true, ...body }));
  mocks.oaAvailable = false;
  mocks.follow.mockReset().mockResolvedValue(false);
  mocks.storageGet.mockReset().mockResolvedValue(null);
  mocks.storageSet.mockReset().mockResolvedValue(undefined);
  document.documentElement.removeAttribute('style');
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/cai-dat: khung trang', () => {
  it('đang khôi phục phiên: một h1 "Cài đặt", chưa gọi API', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.initialized = false;
    const { container } = await mount();
    expect(Array.from(container.querySelectorAll('h1')).map((h) => h.textContent)).toEqual(['Cài đặt']);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('khách chưa đăng nhập: lời mời đăng nhập quay lại đúng trang, không gọi API', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    const { container } = await mount();
    expect(container.querySelector('a[href*="/dang-nhap"]')?.getAttribute('href')).toContain(encodeURIComponent('/tai-khoan/cai-dat'));
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('mất kết nối lúc khôi phục phiên: nói đúng chuyện đó, không mời đăng nhập', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.sessionUnavailable = true;
    const { container } = await mount();
    expect(container.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(container.querySelector('a[href*="/dang-nhap"]')).toBeNull();
  });

  it('một h1 "Cài đặt" và ba nhóm h2: Thông báo, Hiển thị · Cỡ chữ, Tài khoản; không lỗi a11y', async () => {
    const { container } = await mount();
    expect(Array.from(container.querySelectorAll('h1')).map((h) => h.textContent)).toEqual(['Cài đặt']);
    expect(Array.from(container.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(['Thông báo', 'Hiển thị · Cỡ chữ', 'Tài khoản']);
    expect(headingProblems(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});

describe('/tai-khoan/cai-dat: thông báo lưu trên server', () => {
  it('hiển thị trạng thái từ server; tắt khuyến mãi thì PATCH đúng body', async () => {
    const { container } = await mount();
    expect(mocks.get).toHaveBeenCalledWith('/me/notifications/prefs');
    expect(promo(container).getAttribute('aria-checked')).toBe('true');
    click(promo(container));
    await flush(4);
    expect(mocks.patch).toHaveBeenCalledWith('/me/notifications/prefs', { notifyPromo: false });
    expect(promo(container).getAttribute('aria-checked')).toBe('false');
    expect(garden(container).getAttribute('aria-checked')).toBe('true');
  });

  it('chỉ tải tuỳ chọn một lần, không lặp khi render lại', async () => {
    const { container } = await mount();
    click(radios(container)[2]!);
    await flush(4);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('lưu lỗi: trả công tắc về như cũ và báo lỗi', async () => {
    mocks.patch.mockRejectedValue(new Error('net'));
    const { container } = await mount();
    click(promo(container));
    await flush(4);
    expect(promo(container).getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Chưa lưu được cài đặt. Kiểm tra mạng rồi thử lại.');
  });

  it('bấm hai lần liên tiếp khi đang lưu: chỉ gửi một yêu cầu, công tắc khoá cho tới khi xong', async () => {
    let resolveSave: (v: object) => void = () => undefined;
    mocks.patch.mockReturnValue(new Promise((r) => (resolveSave = r)));
    const { container } = await mount();
    click(promo(container));
    click(promo(container));
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(promo(container).getAttribute('aria-disabled')).toBe('true');
    expect(garden(container).getAttribute('aria-disabled')).toBe('true');
    await act(async () => resolveSave({ notifyPromo: false, notifyGarden: true }));
    await flush(2);
    expect(promo(container).hasAttribute('aria-disabled')).toBe(false);
    expect(promo(container).getAttribute('aria-checked')).toBe('false');
  });

  it('"Cập nhật đơn hàng" luôn bật nên không phải công tắc; công tắc khoá cho tới khi tải xong', async () => {
    mocks.get.mockReturnValue(new Promise(() => undefined));
    const { container } = await mount();
    expect(container.querySelector('[role="switch"][aria-label*="đơn hàng"]')).toBeNull();
    expect(container.textContent).toContain('Cập nhật đơn hàng');
    expect(promo(container).getAttribute('aria-disabled')).toBe('true');
    click(promo(container));
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('tải tuỳ chọn lỗi: báo lỗi, công tắc vẫn khoá, "Thử lại" tải lại', async () => {
    mocks.get.mockRejectedValueOnce(new Error('x'));
    const { container } = await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Chưa tải được cài đặt thông báo. Thử lại sau nhé.');
    expect(promo(container).getAttribute('aria-disabled')).toBe('true');
    click(byText(container, 'button', 'Thử lại'));
    await flush(6);
    expect(promo(container).getAttribute('aria-checked')).toBe('true');
    expect(promo(container).hasAttribute('aria-disabled')).toBe(false);
  });

  it('công tắc bật/tắt được bằng bàn phím (công tắc là nút bấm được)', async () => {
    const { container } = await mount();
    expect(promo(container).tagName).toBe('BUTTON');
    click(garden(container));
    await flush(4);
    expect(mocks.patch).toHaveBeenCalledWith('/me/notifications/prefs', { notifyGarden: false });
  });
});

describe('/tai-khoan/cai-dat: cỡ chữ', () => {
  it('nhóm radio Nhỏ/Vừa/Lớn, mặc định Vừa; chọn Lớn thì áp dụng cho cả web và lưu tubu_prefs', async () => {
    const { container } = await mount();
    expect(radios(container).map((r) => r.textContent)).toEqual(['ANhỏ', 'AVừa', 'ALớn']);
    expect(radios(container).map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    click(radios(container)[2]!);
    await flush(2);
    expect(document.documentElement.style.fontSize).toBe('18px');
    expect(mocks.storageSet).toHaveBeenCalledWith('tubu_prefs', JSON.stringify({ fontScale: 'large' }));
    expect(radios(container).map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
  });

  it('mở trang với cỡ đã lưu thì chọn sẵn cỡ đó', async () => {
    mocks.storageGet.mockResolvedValue(JSON.stringify({ fontScale: 'small' }));
    const { container } = await mount();
    expect(radios(container).map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(document.documentElement.style.fontSize).toBe('15px');
  });
});

describe('/tai-khoan/cai-dat: liên kết, theo dõi OA, đăng xuất', () => {
  it('nhóm Tài khoản: Chỉnh sửa hồ sơ và Sổ địa chỉ là link tới route web', async () => {
    const { container } = await mount();
    expect(byText(container, 'a', 'Chỉnh sửa hồ sơ')?.getAttribute('href')).toBe('/tai-khoan/ho-so');
    expect(byText(container, 'a', 'Sổ địa chỉ')?.getAttribute('href')).toBe('/tai-khoan/dia-chi');
    expect(container.textContent).not.toMatch(/Beta/i);
  });

  it('không có OA: không có hàng Theo dõi Zalo OA', async () => {
    const { container } = await mount();
    expect(container.textContent).not.toContain('Theo dõi Zalo OA');
  });

  it('có OA: hàng Theo dõi Zalo OA, bấm "Theo dõi" mở trang OA qua bridge', async () => {
    mocks.oaAvailable = true;
    const { container } = await mount();
    expect(container.textContent).toContain('Theo dõi Zalo OA');
    click(byText(container, 'button', 'Theo dõi'));
    await flush(2);
    expect(mocks.follow).toHaveBeenCalledTimes(1);
  });

  it('Đăng xuất gọi logout', async () => {
    const { container } = await mount();
    click(byText(container, 'button', 'Đăng xuất'));
    await flush(2);
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
  });
});
