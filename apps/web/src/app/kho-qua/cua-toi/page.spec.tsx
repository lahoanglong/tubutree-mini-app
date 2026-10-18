// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { makeGiftRedemption } from '@/components/loyalty/reward-fixtures';

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  mine: [] as object[],
  failOnce: false,
  calls: [] as string[],
}));

vi.mock('@/components/ui/qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push(path);
      if (state.failOnce) {
        state.failOnce = false;
        throw new Error('mất mạng');
      }
      if (path === '/me/loyalty/rewards/mine') return state.mine;
      throw new Error(`chưa mock ${path}`);
    },
  },
}));

import RewardsMinePage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RewardsMinePage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const entry = (c: HTMLElement, name: string) => {
  const el = Array.from(c.querySelectorAll<HTMLElement>('[data-redemption]')).find((x) => x.textContent?.includes(name));
  if (!el) throw new Error(`không thấy ${name}`);
  return el;
};

beforeEach(() => {
  state.phase = 'authenticated';
  state.mine = [];
  state.failOnce = false;
  state.calls = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/kho-qua/cua-toi — Quà của tôi', () => {
  it('READY: mã QG- cỡ lớn + QR, nơi nhận kèm địa chỉ và giờ, hạn nhận theo giờ VN', async () => {
    state.mine = [makeGiftRedemption()];
    const c = await mount();
    const row = entry(c, 'Gói hạt giống Tubu');
    expect(row.querySelector('p')?.textContent).toBe('QG-8K2M9P4T');
    expect(row.querySelector('[data-testid="qr"]')?.textContent).toBe('QG-8K2M9P4T');
    expect(row.textContent).toContain('Nhận tại Kho Tubu TP.HCM');
    expect(row.textContent).toContain('99 Nguyễn Văn Linh, Phường Tân Phong, TP.HCM');
    expect(row.textContent).toContain('T2 08:00–17:00');
    expect(row.textContent).toContain('Hạn nhận 17/12/2026');
  });

  it('CANCELLED: lý do và số điểm đã hoàn (kể cả 0), không lộ mã', async () => {
    state.mine = [
      makeGiftRedemption({ id: 'a', status: 'CANCELLED', code: 'QG-AAAAAAAA', claimPoint: null, cancelReason: 'Quá hạn nhận', refundedPoints: 25_000 }),
      makeGiftRedemption({ id: 'b', giftName: 'Túi vải Tubu', status: 'CANCELLED', code: 'QG-BBBBBBBB', claimPoint: null, cancelReason: 'Gian lận', refundedPoints: 0 }),
    ];
    const c = await mount();
    expect(c.textContent).toContain('Đã huỷ: Quá hạn nhận');
    expect(c.textContent).toContain('Đã hoàn 25.000 điểm');
    expect(c.textContent).toContain('Đã hoàn 0 điểm');
    expect(c.textContent).not.toContain('QG-AAAAAAAA');
  });

  it('CANCELLED không có lý do → "không rõ lý do"', async () => {
    state.mine = [makeGiftRedemption({ status: 'CANCELLED', claimPoint: null, cancelReason: null, refundedPoints: null })];
    const c = await mount();
    expect(c.textContent).toContain('Đã huỷ: không rõ lý do');
    expect(c.textContent).toContain('Đã hoàn 0 điểm');
  });

  it('FULFILLED: ngày nhận theo giờ VN', async () => {
    state.mine = [makeGiftRedemption({ status: 'FULFILLED', claimPoint: null, fulfilledAt: '2026-10-25T17:30:00.000Z' })];
    const c = await mount();
    expect(c.textContent).toContain('Đã nhận ngày 26/10/2026');
  });

  it('sắp xếp: quà sẵn sàng nhận lên trước, rồi mới nhất trước', async () => {
    state.mine = [
      makeGiftRedemption({ id: 'old', giftName: 'Quà cũ', status: 'FULFILLED', claimPoint: null, fulfilledAt: '2026-10-18T03:00:00.000Z', createdAt: '2026-10-10T03:00:00.000Z' }),
      makeGiftRedemption({ id: 'new', giftName: 'Quà mới', status: 'FULFILLED', claimPoint: null, fulfilledAt: '2026-10-19T03:00:00.000Z', createdAt: '2026-10-18T03:00:00.000Z' }),
      makeGiftRedemption({ id: 'ready', giftName: 'Quà sẵn sàng', createdAt: '2026-10-01T03:00:00.000Z' }),
    ];
    const c = await mount();
    const names = Array.from(c.querySelectorAll('[data-redemption]')).map((e) => ['Quà sẵn sàng', 'Quà mới', 'Quà cũ'].find((n) => e.textContent?.includes(n)));
    expect(names).toEqual(['Quà sẵn sàng', 'Quà mới', 'Quà cũ']);
  });

  it('lượt mã giảm giá dẫn tới ví mã (Điểm Xanh)', async () => {
    state.mine = [
      makeGiftRedemption({ giftKind: 'VOUCHER', giftName: 'Miễn phí vận chuyển', status: 'FULFILLED', code: null, couponCode: 'FREESHIP-ABC', claimPoint: null }),
    ];
    const c = await mount();
    const a = entry(c, 'Miễn phí vận chuyển').querySelector<HTMLAnchorElement>('a');
    expect(a?.getAttribute('href')).toBe('/tai-khoan/diem-xanh');
    expect(a?.textContent).toContain('Mã FREESHIP-ABC');
  });

  it('rỗng → thông báo và lối về Kho quà', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Bạn chưa đổi quà nào');
    expect(byText(c, 'a', 'Đến Kho quà')?.getAttribute('href')).toBe('/kho-qua');
  });

  it('lỗi tải → ErrorState + Thử lại gọi lại API', async () => {
    state.failOnce = true;
    state.mine = [makeGiftRedemption()];
    const c = await mount();
    expect(c.textContent).toContain('mất mạng');
    click(byText(c, 'button', 'Thử lại'));
    await flush(5);
    expect(c.textContent).toContain('QG-8K2M9P4T');
    expect(state.calls).toHaveLength(2);
  });

  it('đang khôi phục phiên → không gọi API; khách → đăng nhập quay lại /kho-qua/cua-toi', async () => {
    state.phase = 'loading';
    await mount();
    expect(state.calls).toHaveLength(0);
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href*="/dang-nhap"]')?.getAttribute('href')).toContain(encodeURIComponent('/kho-qua/cua-toi'));
    expect(state.calls).toHaveLength(0);
  });

  it('một h1, điều khiển đủ tên, vùng chạm đủ lớn', async () => {
    state.mine = [makeGiftRedemption()];
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(c.querySelector('h1')?.textContent).toBe('Quà của tôi');
  });
});
