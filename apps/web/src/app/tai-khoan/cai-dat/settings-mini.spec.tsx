// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// mv-order: cài đặt (kiểu điện thoại giống Mini App).

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

describe('cài đặt như Mini App (điện thoại)', () => {
  it('tiêu đề khối chữ không chân đậm; nhãn dòng semibold; Đăng xuất nền xanh nhạt; có dòng phiên bản', async () => {
    const { container } = await mount();
    const h2 = container.querySelector('h2')!;
    expect(h2.className).toContain('max-md:font-ui');
    expect(h2.className).toContain('max-md:font-bold');
    expect(promo(container).querySelector('span')!.className).toContain('max-md:font-semibold');
    const logout = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Đăng xuất')!;
    expect(logout.className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
    expect(container.textContent).toContain('Tubu Tree · phiên bản 1.0.0');
    expect(container.querySelector('[data-page-bleed] h1')!.textContent).toBe('Cài đặt');
  });
});
