// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// R2-BUYERWEB-3: thẻ điểm/ví lấy số lúc đăng nhập và đứng yên sau khi đặt đơn/huỷ đơn, chỉ đúng sau F5.
// R2-BUYERWEB-8: số dư phải dẫn tới sổ cái để khách đối chiếu.

const state = vi.hoisted(() => ({
  me: null as null | { pointsBalance: number; pointsConvertedBalance: number; walletBalance: number },
  meCalls: 0,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u', fullName: 'Nguyễn An', referralCode: 'AN1', pointsBalance: 1800, pointsConvertedBalance: 0, walletBalance: 50000 },
    status: 'authenticated',
    initialized: true,
    sessionUnavailable: false,
    logout: vi.fn(),
  }),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMe: async () => {
    state.meCalls += 1;
    if (!state.me) throw new Error('offline');
    return state.me;
  },
  fetchOrdersPage: async () => ({ data: [], meta: { page: 1, limit: 20, total: 0 } }),
}));

import AccountPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<AccountPage />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const card = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll('a')).find((a) => a.textContent?.includes(label))!;

beforeEach(() => {
  state.me = null;
  state.meCalls = 0;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan — số dư điểm và ví luôn lấy lại từ máy chủ (R2-BUYERWEB-3)', () => {
  it('số trên thẻ theo hồ sơ mới nhất, không theo số lúc đăng nhập', async () => {
    state.me = { pointsBalance: 119, pointsConvertedBalance: 0, walletBalance: 0 };
    const c = await mount();
    expect(state.meCalls).toBeGreaterThan(0);
    expect(card(c, 'Điểm Xanh').textContent).toContain('119');
    expect(card(c, 'Ví Tubu').textContent).toContain('0đ');
    expect(c.textContent).not.toContain('1.800');
    expect(c.textContent).not.toContain('50.000đ');
  });

  it('lô điểm quy đổi cộng vào tổng và có ghi chú không hết hạn', async () => {
    state.me = { pointsBalance: 100, pointsConvertedBalance: 40, walletBalance: 0 };
    const c = await mount();
    expect(card(c, 'Điểm Xanh').textContent).toContain('140');
    expect(card(c, 'Điểm Xanh').textContent).toContain('trong đó 40 điểm không hết hạn');
  });

  it('chưa lấy được hồ sơ (mất mạng) thì giữ số lúc đăng nhập thay vì để trống', async () => {
    const c = await mount();
    expect(card(c, 'Điểm Xanh').textContent).toContain('1.800');
    expect(card(c, 'Ví Tubu').textContent).toContain('50.000đ');
  });
});

describe('/tai-khoan — lối vào sổ cái (R2-BUYERWEB-8)', () => {
  it('thẻ Điểm Xanh và Ví Tubu dẫn tới trang lịch sử riêng', async () => {
    const c = await mount();
    expect(card(c, 'Điểm Xanh').getAttribute('href')).toBe('/tai-khoan/diem-xanh');
    expect(card(c, 'Ví Tubu').getAttribute('href')).toBe('/tai-khoan/vi-tubu');
  });
});
