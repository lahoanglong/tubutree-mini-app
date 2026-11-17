// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Công tắc riêng "Hành trình đơn hàng qua Zalo" ở Cài đặt web, cùng hành vi settings.tsx của Mini App (wave tubu-mss-consent-ui).

const mocks = vi.hoisted(() => ({
  config: { orderZaloEnabled: false } as Record<string, unknown>,
  status: null as unknown,
  patch: vi.fn(),
  zaloCalls: 0,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', fullName: 'Lan' }, status: 'authenticated', initialized: true, sessionUnavailable: false, retrySession: vi.fn(), logout: vi.fn() }),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (path === '/config/public') return mocks.config;
      if (path === '/config/order-zalo') {
        mocks.zaloCalls += 1;
        return mocks.status;
      }
      return { notifyPromo: true, notifyGarden: true };
    },
    patch: mocks.patch,
  },
}));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: { oa: { available: false, follow: vi.fn() }, storage: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) } },
}));

import SettingsPage from './page';

const STATUS = { enabled: true, prechecked: false, choice: null, phoneMasked: '090•••4567', tubuZaloPhone: '0899149229' };
let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<SettingsPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const zaloSwitch = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="switch"][aria-label="Hành trình đơn hàng qua Zalo"]');

beforeEach(() => {
  mocks.config = { orderZaloEnabled: false };
  mocks.status = STATUS;
  mocks.zaloCalls = 0;
  mocks.patch.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('Cài đặt web — "Hành trình đơn hàng qua Zalo"', () => {
  it('cờ tắt: không hỏi máy chủ, không có công tắc mới', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Khuyến mãi & mã giảm giá');
    expect(zaloSwitch(c)).toBeNull();
    expect(mocks.zaloCalls).toBe(0);
  });

  it('cờ bật: bật công tắc → PATCH /me/order-zalo-updates {enabled:true}, không đụng tuỳ chọn khuyến mãi', async () => {
    mocks.config = { orderZaloEnabled: true };
    mocks.patch.mockResolvedValue({ enabled: true, updatedAt: '2026-11-17T01:00:00.000Z', source: 'account_settings' });
    const c = await mount();
    const sw = zaloSwitch(c)!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    click(sw);
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledWith('/me/order-zalo-updates', { enabled: true });
    expect(zaloSwitch(c)!.getAttribute('aria-checked')).toBe('true');
  });

  it('lưu lỗi: giữ trạng thái cũ, báo chưa lưu được', async () => {
    mocks.config = { orderZaloEnabled: true };
    mocks.status = { ...STATUS, choice: true };
    mocks.patch.mockRejectedValue(new Error('mạng'));
    const c = await mount();
    click(zaloSwitch(c)!);
    await flush(6);
    expect(zaloSwitch(c)!.getAttribute('aria-checked')).toBe('true');
    expect(c.textContent).toContain('Chưa lưu được cài đặt. Kiểm tra mạng rồi thử lại.');
  });

  it('khách đã đồng ý nhưng ra khỏi nhóm triển khai (enabled false, không số): vẫn có công tắc để rút đồng ý', async () => {
    mocks.config = { orderZaloEnabled: true };
    mocks.status = { ...STATUS, enabled: false, phoneMasked: null, choice: true };
    mocks.patch.mockResolvedValue({ enabled: false, updatedAt: '2026-11-17T01:00:00.000Z', source: 'account_settings' });
    const c = await mount();
    const sw = zaloSwitch(c)!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    click(sw);
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledWith('/me/order-zalo-updates', { enabled: false });
  });
});
