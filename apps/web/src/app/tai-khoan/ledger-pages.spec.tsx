// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// R2-BUYERWEB-8: web không có lịch sử Điểm Xanh/Ví Tubu dù thẻ tài khoản hiện số dư; Mini App thì có.

const state = vi.hoisted(() => ({
  points: [] as Record<string, unknown>[],
  walletPages: [] as { data: Record<string, unknown>[]; total: number }[],
  walletCalls: [] as number[],
  failPoints: false,
  phase: 'authenticated' as string,
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMe: async () => ({ pointsBalance: 1681, pointsConvertedBalance: 119, walletBalance: 50000 }),
  getWallet: async () => ({ walletBalance: 50000, cashbackPending: 0, commissionApproved: 0, commissionPending: 0, withdrawMin: 100000, withdrawFee: 3000 }),
  getPointsTransactions: async () => {
    if (state.failPoints) throw new Error('boom');
    return state.points;
  },
  getWalletTransactions: async (page: number) => {
    state.walletCalls.push(page);
    const p = state.walletPages[page - 1] ?? { data: [], total: 0 };
    return { data: p.data, meta: { page, limit: 20, total: p.total } };
  },
}));

import PointsPage from './diem-xanh/page';
import WalletPage from './vi-tubu/page';

let mounted: Rendered[] = [];
const mount = async (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  await flush(6);
  return r.container;
};

beforeEach(() => {
  state.phase = 'authenticated';
  state.failPoints = false;
  state.walletCalls = [];
  state.points = [
    { id: 'p1', delta: -1681, reason: 'ORDER_REDEEM:TB1', expiresAt: null, createdAt: '2026-10-14T05:00:00Z' },
    { id: 'p2', delta: 250, reason: 'ORDER_DELIVERED:TB0', expiresAt: '2027-10-14T00:00:00Z', createdAt: '2026-10-10T05:00:00Z' },
    { id: 'p3', delta: 119, reason: 'XU_TO_POINTS:1', expiresAt: null, lot: 'CONVERTED', createdAt: '2026-09-01T05:00:00Z' },
    { id: 'p4', delta: 5, reason: 'WEIRD_INTERNAL_CODE:xyz', expiresAt: null, createdAt: '2026-08-01T05:00:00Z' },
  ];
  state.walletPages = [
    {
      total: 21,
      data: [
        { id: 'w1', delta: 120000, balanceAfter: 170000, type: 'ORDER_REFUND', reason: null, orderId: 'o1', createdAt: '2026-10-14T05:00:00Z' },
        { id: 'w2', delta: -70000, balanceAfter: 50000, type: 'ORDER_PAY', reason: 'Đơn TB1', orderId: 'o2', createdAt: '2026-10-12T05:00:00Z' },
      ],
    },
    { total: 21, data: [{ id: 'w3', delta: 50000, balanceAfter: 120000, type: 'ADJUST', reason: null, orderId: null, createdAt: '2026-09-01T05:00:00Z' }] },
  ];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/diem-xanh — lịch sử Điểm Xanh', () => {
  it('tổng điểm (cả lô quy đổi) và từng dòng bằng tiếng Việt, có dấu cộng/trừ và ngày', async () => {
    const c = await mount(<PointsPage />);
    expect(c.textContent).toContain('1.800');
    expect(c.textContent).toContain('trong đó 119 điểm không hết hạn');
    const rows = Array.from(c.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('Dùng điểm khi thanh toán · TB1');
    expect(rows[0]).toContain('−1.681');
    expect(rows[0]).toContain('14/10/2026');
    expect(rows[1]).toContain('Tích điểm từ đơn hàng · TB0');
    expect(rows[1]).toContain('+250');
    expect(rows[1]).toContain('Hết hạn 14/10/2027');
    expect(rows[2]).toContain('Điểm không hết hạn');
  });

  it('mã lý do lạ không lộ ra màn hình', async () => {
    const c = await mount(<PointsPage />);
    expect(c.textContent).toContain('Điều chỉnh Điểm Xanh');
    expect(c.textContent).not.toContain('WEIRD_INTERNAL_CODE');
    expect(c.textContent).not.toContain('ORDER_REDEEM');
  });

  it('chưa có giao dịch: câu báo trống, không để trang trắng', async () => {
    state.points = [];
    const c = await mount(<PointsPage />);
    expect(c.textContent).toContain('Chưa có giao dịch điểm nào');
  });

  it('tải lỗi: báo lỗi và có nút Thử lại', async () => {
    state.failPoints = true;
    const c = await mount(<PointsPage />);
    expect(c.textContent).toContain('Không tải được lịch sử Điểm Xanh');
    expect(byText(c, 'button', 'Thử lại')).not.toBeNull();
  });

  it('khách chưa đăng nhập thấy lời mời đăng nhập mang theo returnTo', async () => {
    state.phase = 'guest';
    const c = await mount(<PointsPage />);
    expect(c.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe(
      `/dang-nhap?returnTo=${encodeURIComponent('/tai-khoan/diem-xanh')}`,
    );
  });

  it('đạt kiểm tra truy cập tối thiểu: một h1, nút có tên, vùng chạm đủ lớn', async () => {
    const c = await mount(<PointsPage />);
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});

describe('/tai-khoan/vi-tubu — sao kê Ví Tubu', () => {
  it('số dư thật và từng dòng: nhãn loại, tiền có dấu, số dư sau biến động', async () => {
    const c = await mount(<WalletPage />);
    expect(c.textContent).toContain('50.000đ');
    const rows = Array.from(c.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Hoàn tiền đơn hàng');
    expect(rows[0]).toContain('+120.000đ');
    expect(rows[0]).toContain('Số dư 170.000đ');
    expect(rows[1]).toContain('Thanh toán đơn hàng');
    expect(rows[1]).toContain('−70.000đ');
    expect(rows[1]).toContain('Đơn TB1');
  });

  it('Xem thêm tải trang kế tiếp và nối vào danh sách', async () => {
    const c = await mount(<WalletPage />);
    click(byText(c, 'button', 'Xem thêm'));
    await flush(6);
    expect(state.walletCalls).toEqual([1, 2]);
    expect(c.querySelectorAll('li')).toHaveLength(3);
    expect(byText(c, 'button', 'Xem thêm')).toBeNull();
  });

  it('chưa có biến động nào: câu báo trống', async () => {
    state.walletPages = [{ total: 0, data: [] }];
    const c = await mount(<WalletPage />);
    expect(c.textContent).toContain('Chưa có biến động nào trong Ví');
  });

  it('đạt kiểm tra truy cập tối thiểu', async () => {
    const c = await mount(<WalletPage />);
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});
