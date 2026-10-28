// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unlabeledFields, unnamedControls } from '@/test-utils/a11y';
import { ApiError, NetworkError } from '@/lib/client-api';

type Call = { method: string; path: string; body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string> };

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  role: 'CUSTOMER' as string,
  cashbackEnabled: false,
  ctvReady: true,
  wallet: null as Record<string, unknown> | null,
  referral: null as Record<string, unknown> | null,
  loyalty: null as Record<string, unknown> | null,
  pages: [] as { data: Record<string, unknown>[]; total: number; limit?: number }[],
  fail: new Set<string>(),
  calls: [] as Call[],
  share: null as null | (() => Promise<string>),
  shared: [] as unknown[],
  hold: new Set<string>(),
}));

vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => (p === '/ctv' ? state.ctvReady : true) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { role: state.role } }) }));
vi.mock('@tubutree/app-core/features', () => ({
  get CASHBACK_ENABLED() {
    return state.cashbackEnabled;
  },
}));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    share: async (input: unknown) => {
      state.shared.push(input);
      return state.share!();
    },
  },
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string, opts?: { query?: Record<string, unknown> }) => {
      state.calls.push({ method: 'get', path, query: opts?.query });
      if (state.fail.has(path)) throw new Error('Máy chủ đang bận');
      if (path === '/me/wallet') return state.wallet;
      if (path === '/me/referral') return state.referral;
      if (path === '/me/loyalty') return state.loyalty;
      if (path === '/me/wallet/transactions') {
        const page = Number(opts?.query?.page ?? 1);
        const p = state.pages[page - 1] ?? { data: [], total: 0 };
        return { data: p.data, meta: { page, limit: p.limit ?? 20, total: p.total } };
      }
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => {
      state.calls.push({ method: 'post', path, body, headers: opts?.headers });
      throw new Error(`POST không được gọi ở trang Ví: ${path}`);
    },
  },
}));

import WalletPage from './page';

const WALLET = { walletBalance: 1_250_000, cashbackPending: 45_000, commissionApproved: 520_000, commissionPending: 30_000 };
const REFERRAL = { referralCode: 'TUBU1234', successCount: 2, earnedPoints: 20, milestones: [{ count: 5, bonusPoints: 50 }], nextMilestone: { count: 5, bonusPoints: 50 } };
const LOYALTY = { pointsBalance: 48_000, pointsConvertedBalance: 2_000, tier: { name: 'Bạc' } };
const PAGE_1 = {
  total: 3,
  limit: 2,
  data: [
    { id: 't1', delta: 50_000, balanceAfter: 1_250_000, type: 'CASHBACK', reason: null, orderId: null, createdAt: '2026-10-05T07:04:00Z' },
    { id: 't2', delta: -100_000, balanceAfter: 1_200_000, type: 'WITHDRAW', reason: 'Rút về ngân hàng', orderId: null, createdAt: '2026-10-04T10:00:00Z' },
  ],
};
const PAGE_2 = { total: 3, limit: 2, data: [{ id: 't3', delta: 10_000, balanceAfter: 1_300_000, type: 'ADJUST', reason: null, orderId: null, createdAt: '2026-10-03T10:00:00Z' }] };

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<WalletPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
beforeEach(() => {
  state.phase = 'authenticated';
  state.role = 'CUSTOMER';
  state.cashbackEnabled = false;
  state.ctvReady = true;
  state.wallet = { ...WALLET };
  state.referral = { ...REFERRAL };
  state.loyalty = { ...LOYALTY };
  state.pages = [PAGE_1, PAGE_2];
  state.fail = new Set();
  state.calls = [];
  state.shared = [];
  state.share = async () => 'shared';
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/tai-khoan/vi-tubu — thẻ số dư và nguồn tiền', () => {
  it('hiện số dư Ví, Điểm Xanh (tổng hai lô, hạng), hoa hồng chờ/có thể rút và hoàn tiền đã duyệt chờ về Ví', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Ví Tubu (số dư khả dụng)');
    expect(c.textContent).toContain('1.250.000đ');
    expect(c.textContent).toContain('Điểm Xanh (đổi giảm giá)');
    expect(c.textContent).toContain('50.000');
    expect(c.textContent).toContain('trong đó 2.000 điểm không hết hạn');
    expect(c.textContent).toContain('Bạc');
    expect(c.textContent).toContain('Hoa hồng đang chờ');
    expect(c.textContent).toContain('30.000đ');
    expect(c.textContent).toContain('Hoa hồng có thể chuyển vào Ví');
    expect(c.textContent).toContain('520.000đ');
    expect(c.textContent).toContain('Hoàn tiền đã duyệt, chờ về Ví');
    expect(c.textContent).toContain('45.000đ');
  });

  it('thẻ Điểm Xanh dẫn sang /tai-khoan/diem-xanh', async () => {
    const c = await mount();
    const a = c.querySelector<HTMLAnchorElement>('a[href="/tai-khoan/diem-xanh"]');
    expect(a).not.toBeNull();
    expect(a!.textContent).toContain('Điểm Xanh (đổi giảm giá)');
  });

  it('có điểm quy đổi: nói rõ phần không hết hạn dùng ở đâu, không ra tiền; không có thì ẩn dòng', async () => {
    let c = await mount();
    expect(c.textContent).toContain('Điểm không hết hạn dùng trả đơn hàng tới 100% giá trị hàng và góp quỹ trồng cây. Không rút ra tiền.');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.loyalty = { pointsBalance: 100, tier: { name: 'Bạc' } };
    c = await mount();
    expect(c.textContent).not.toContain('không hết hạn');
  });

  it('/ctv chưa có trên web: thẻ hoa hồng không thành link 404 và không gợi ý "Chuyển vào Ví →"', async () => {
    state.ctvReady = false;
    const c = await mount();
    expect(c.querySelector('a[href="/ctv"]')).toBeNull();
    expect(c.textContent).not.toContain('Chuyển vào Ví →');
    expect(c.textContent).toContain('Hoa hồng có thể chuyển vào Ví');
  });

  it('"Hoa hồng đang chờ" cùng câu với trang CTV; có tiền chờ thì thẻ dẫn sang tab Hoa hồng; bằng 0 hoặc /ctv chưa có thì không là link (R-60)', async () => {
    let c = await mount();
    expect(c.textContent).toContain('Hoa hồng đang chờ');
    expect(c.textContent).toContain('đơn chưa giao hoặc trong thời gian đổi/trả');
    expect(c.textContent).not.toContain('Hoa hồng chờ duyệt');
    const a = c.querySelector<HTMLAnchorElement>('a[href="/ctv?tab=commission"]');
    expect(a).not.toBeNull();
    expect(a!.textContent).toContain('Xem chi tiết →');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.wallet = { ...WALLET, commissionPending: 0 };
    c = await mount();
    expect(c.querySelector('a[href="/ctv?tab=commission"]')).toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.wallet = WALLET;
    state.ctvReady = false;
    c = await mount();
    expect(c.querySelector('a[href="/ctv?tab=commission"]')).toBeNull();
  });

  it('hạng dài: nhãn hạng được cắt (truncate, max-w-full) để không đẩy vỡ thẻ Điểm Xanh (R-139)', async () => {
    const longTier = 'Đại Thụ Xanh Thượng Hạng Vĩnh Cửu Của Rừng Già';
    state.loyalty = { pointsBalance: 100, tier: { name: longTier } };
    const c = await mount();
    const badge = Array.from(c.querySelectorAll('span')).filter((s) => s.textContent === longTier).pop()!;
    expect(badge.className).toContain('truncate');
    expect(badge.className).toContain('max-w-full');
  });

  it('hoa hồng đã duyệt > 0: thẻ dẫn sang /ctv kèm "Chuyển vào Ví →"; bằng 0 thì không bấm được, không gợi ý', async () => {
    let c = await mount();
    const a = c.querySelector<HTMLAnchorElement>('a[href="/ctv"]');
    expect(a).not.toBeNull();
    expect(a!.textContent).toContain('Chuyển vào Ví →');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.wallet = { ...WALLET, commissionApproved: 0 };
    c = await mount();
    expect(c.querySelector('a[href="/ctv"]')).toBeNull();
    expect(c.textContent).not.toContain('Chuyển vào Ví →');
    expect(c.textContent).toContain('Hoa hồng có thể chuyển vào Ví');
  });

  it('khách thường chưa có hoa hồng: ẩn hai thẻ hoa hồng, chú thích nói về thanh toán đơn', async () => {
    state.wallet = { ...WALLET, commissionApproved: 0, commissionPending: 0, cashbackPending: 0 };
    const c = await mount();
    expect(c.textContent).toContain('Dùng để trả tiền hàng ở bước thanh toán');
    expect(c.textContent).not.toContain('Hoa hồng đang chờ');
    expect(c.textContent).not.toContain('Hoa hồng có thể chuyển vào Ví');
    expect(c.textContent).not.toContain('Tiền thật từ hoa hồng');
    expect(c.textContent).not.toContain('Hoàn tiền đã duyệt, chờ về Ví');
  });

  it('CTV và đại lý vẫn thấy khối hoa hồng dù đang 0đ, chú thích nhắc tiền thật từ hoa hồng', async () => {
    for (const role of ['AFFILIATE', 'DEALER']) {
      state.role = role;
      state.wallet = { ...WALLET, commissionApproved: 0, commissionPending: 0, cashbackPending: 0 };
      const c = await mount();
      expect(c.textContent).toContain('Hoa hồng đang chờ');
      expect(c.textContent).toContain('Hoa hồng có thể chuyển vào Ví');
      expect(c.textContent).toContain('Tiền thật từ hoa hồng — dùng để trả tiền hàng.');
      expect(c.textContent).not.toContain('hoàn tiền sàn ngoài');
      mounted.forEach((m) => m.unmount());
      mounted = [];
    }
  });

  it('cờ CASHBACK_ENABLED bật: chú thích nhắc hoàn tiền sàn ngoài và thẻ chờ về Ví hiện cả khi 0đ', async () => {
    state.cashbackEnabled = true;
    state.role = 'AFFILIATE';
    state.wallet = { ...WALLET, cashbackPending: 0 };
    const c = await mount();
    expect(c.textContent).toContain('Tiền thật từ hoa hồng & hoàn tiền sàn ngoài');
    expect(c.textContent).toContain('Hoàn tiền đã duyệt, chờ về Ví');
  });

  it('mẹo dưới ví nói tiền hoàn đơn và hoa hồng vào Ví để trả đơn sau, không nhắc rút ngân hàng', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Mẹo: tiền hoàn đơn và hoa hồng CTV vào Ví Tubu, dùng trả đơn sau ở bước thanh toán.');
  });

  it('không còn nút hay sheet rút về ngân hàng, không gọi POST nào (chính sách Zalo 4.5)', async () => {
    const c = await mount();
    expect(byText(c, 'button', 'Rút ngân hàng')).toBeNull();
    expect(c.textContent).not.toMatch(/Rút ngân hàng|Tên ngân hàng|Số tài khoản/);
    expect(state.calls.filter((x) => x.method === 'post')).toEqual([]);
  });
});

describe('/tai-khoan/vi-tubu — trạng thái tải, lỗi, khách', () => {
  it('lỗi tải ví KHÔNG hiện 0đ mà báo lỗi kèm Thử lại gọi lại /me/wallet', async () => {
    state.fail.add('/me/wallet');
    const c = await mount();
    expect(c.textContent).toContain('Máy chủ đang bận');
    expect(c.textContent).not.toContain('Ví Tubu (số dư khả dụng)');
    const before = state.calls.filter((x) => x.path === '/me/wallet').length;
    state.fail.delete('/me/wallet');
    click(byText(c, 'button', 'Thử lại'));
    await flush(6);
    expect(state.calls.filter((x) => x.path === '/me/wallet').length).toBe(before + 1);
    expect(c.textContent).toContain('1.250.000đ');
  });

  it('khách chưa đăng nhập: mời đăng nhập, quay lại /tai-khoan/vi-tubu, không gọi API ví', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href^="/dang-nhap"]')).not.toBeNull();
    expect(state.calls.filter((x) => x.path.startsWith('/me/'))).toEqual([]);
  });

  it('đang khôi phục phiên: chỉ "Đang tải…"', async () => {
    state.phase = 'loading';
    const c = await mount();
    expect(c.textContent).toContain('Đang tải…');
    expect(state.calls).toEqual([]);
  });

  it('có đúng một h1 ở mọi trạng thái', async () => {
    const c = await mount();
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(c.querySelector('h1')!.textContent).toBe('Ví Tubu');
  });
});

describe('/tai-khoan/vi-tubu — Mời bạn đã chuyển sang trang Cá nhân', () => {
  it('Ví không còn khối mời bạn, nút chia sẻ và không gọi /me/referral', async () => {
    const c = await mount();
    expect(c.textContent).not.toContain('Mời bạn');
    expect(byText(c, 'button', 'Chia sẻ')).toBeNull();
    expect(state.calls.some((x) => x.path === '/me/referral')).toBe(false);
  });
});

describe('/tai-khoan/vi-tubu — Ví 0đ và chưa có biến động', () => {
  const EMPTY_NOTE = 'Tiền hoàn đơn và hoa hồng CTV sẽ vào Ví Tubu. Ví dùng để trả đơn hàng.';

  it('nói tiền vào Ví từ đâu, không nhắc rút tiền, không lặp thêm khối Mẹo', async () => {
    state.wallet = { ...WALLET, walletBalance: 0 };
    state.pages = [{ total: 0, data: [] }];
    const c = await mount();
    expect(c.textContent).toContain(EMPTY_NOTE);
    expect(c.textContent).not.toContain('Mẹo:');
    expect(EMPTY_NOTE).not.toMatch(/rút|ngân hàng/i);
  });

  it('Ví 0đ nhưng đã có biến động: giữ chú thích cũ và khối Mẹo', async () => {
    state.wallet = { ...WALLET, walletBalance: 0 };
    const c = await mount();
    expect(c.textContent).not.toContain(EMPTY_NOTE);
    expect(c.textContent).toContain('Mẹo:');
  });
});

describe('/tai-khoan/vi-tubu — lịch sử Ví', () => {
  it('từng dòng: nhãn loại, giờ, lý do, tiền có dấu, số dư sau biến động', async () => {
    const c = await mount();
    const rows = Array.from(c.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Hoàn tiền sàn ngoài');
    expect(rows[0]).toContain('+50.000đ');
    expect(rows[0]).toContain('Số dư 1.250.000đ');
    expect(rows[1]).toContain('Rút về ngân hàng');
    expect(rows[1]).toContain('−100.000đ');
    expect(rows[1]).toContain('Số dư 1.200.000đ');
  });

  it('Xem thêm tải trang kế (20/trang) và nối vào danh sách; hết trang thì ẩn nút', async () => {
    const c = await mount();
    expect(state.calls.find((x) => x.path === '/me/wallet/transactions')!.query).toEqual({ page: 1, limit: 20 });
    click(byText(c, 'button', 'Xem thêm'));
    await flush(6);
    expect(c.querySelectorAll('li')).toHaveLength(3);
    expect(byText(c, 'button', 'Xem thêm')).toBeNull();
  });

  it('có biến động chen vào giữa hai lần tải: dòng lặp chỉ hiện một lần', async () => {
    state.pages = [PAGE_1, { total: 3, limit: 2, data: [PAGE_1.data[1]!, PAGE_2.data[0]!] }];
    const c = await mount();
    click(byText(c, 'button', 'Xem thêm'));
    await flush(6);
    expect(c.querySelectorAll('li')).toHaveLength(3);
  });

  it('sao kê trống: báo chưa có biến động', async () => {
    state.pages = [{ total: 0, data: [] }];
    const c = await mount();
    expect(c.textContent).toContain('Chưa có biến động nào trong Ví');
  });

  it('lỗi tải sao kê: báo lỗi kèm Thử lại, số dư vẫn hiện', async () => {
    state.fail.add('/me/wallet/transactions');
    const c = await mount();
    expect(c.textContent).toContain('1.250.000đ');
    expect(c.textContent).toContain('Máy chủ đang bận');
    expect(byText(c, 'button', 'Thử lại')).not.toBeNull();
  });

  it('tiêu đề theo nguồn chắc chắn: trả hàng một phần, thanh toán đơn; hoàn còn lại giữ "Hoàn tiền đơn hàng"', async () => {
    state.pages = [{
      total: 3,
      data: [
        { id: 'r1', delta: 40_000, balanceAfter: 90_000, type: 'ORDER_REFUND', reason: 'Hoàn tiền trả hàng đơn TT001', orderId: null, createdAt: '2026-10-05T07:04:00Z' },
        { id: 'r2', delta: 50_000, balanceAfter: 50_000, type: 'ORDER_REFUND', reason: 'Hoàn tiền đơn TT002', orderId: 'o2', createdAt: '2026-10-04T07:04:00Z' },
        { id: 'r3', delta: -20_000, balanceAfter: 0, type: 'ORDER_PAY', reason: 'Thanh toán đơn TT003', orderId: 'o3', createdAt: '2026-10-03T07:04:00Z' },
      ],
    }];
    const c = await mount();
    const titles = Array.from(c.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(titles[0]).toContain('Hoàn tiền trả hàng');
    expect(titles[1]).toContain('Hoàn tiền đơn hàng');
    expect(titles[2]).toContain('Thanh toán đơn');
  });
});

describe('/tai-khoan/vi-tubu — truy cập', () => {
  it('tiêu đề, nút và vùng chạm đạt kiểm tra tối thiểu', async () => {
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(unlabeledFields(document.body)).toEqual([]);
  });
});

describe('/tai-khoan/vi-tubu — giao diện điện thoại như Mini App', () => {
  const orderOf = (el: Element) => Number(/max-md:order-(\d+)/.exec(el.className)![1]);

  it('thứ tự một cột ở điện thoại: thẻ Điểm Xanh rồi nguồn tiền, hoàn tiền, mẹo, lịch sử', async () => {
    const c = await mount();
    const items = Array.from(c.querySelectorAll('main *')).filter((el) => /max-md:order-\d+/.test(el.className.toString()));
    const labels = items.sort((a, b) => orderOf(a) - orderOf(b)).map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '');
    const at = (needle: string) => labels.findIndex((l) => l.includes(needle));
    expect(at('Số dư Ví Tubu')).toBeGreaterThan(-1);
    expect(at('Số dư Ví Tubu')).toBeLessThan(at('Điểm Xanh (đổi giảm giá)'));
    expect(at('Điểm Xanh (đổi giảm giá)')).toBeLessThan(at('Hoa hồng đang chờ'));
    expect(at('Hoa hồng đang chờ')).toBeLessThan(at('Hoàn tiền đã duyệt'));
    expect(at('Hoàn tiền đã duyệt')).toBeLessThan(at('Mẹo: tiền hoàn đơn'));
    expect(at('Mẹo: tiền hoàn đơn')).toBeLessThan(at('Lịch sử Ví'));
  });

  it('hai cột giữ nguyên ở máy tính: DOM vẫn là cột trái rồi cột phải', async () => {
    const c = await mount();
    const heads = Array.from(c.querySelectorAll('section')).map((s) => s.getAttribute('aria-label'));
    expect(heads.indexOf('Số dư Ví Tubu')).toBeLessThan(heads.indexOf('Lịch sử Ví'));
  });

  it('các thẻ không viền ở điện thoại', async () => {
    const c = await mount();
    expect(Array.from(c.querySelectorAll('section')).filter((s) => s.classList.contains('border'))).toEqual([]);
  });

  it('trang bỏ đệm 48px của body và có thanh tiêu đề trắng như Mini App', async () => {
    const c = await mount();
    expect(c.querySelector('h1')!.closest('header')!.hasAttribute('data-page-bleed')).toBe(true);
    expect(c.querySelector('h1')!.closest('header')!.className).toContain('max-md:bg-[var(--color-bg-surface)]');
  });
});


describe('/tai-khoan/vi-tubu — số Điểm Xanh không gãy dòng (9968242c)', () => {
  it('số điểm không xuống dòng và hạng thành viên nằm dưới số, không chen vào hàng làm cột số hẹp lại', async () => {
    const c = await mount();
    const points = Array.from(c.querySelectorAll<HTMLElement>('span')).find((x) => x.textContent === '50.000 điểm')!;
    expect(points.className).toContain('whitespace-nowrap');
    const column = points.parentElement as HTMLElement;
    expect(column.contains(byText(c, 'span', 'Bạc'))).toBe(true);
    expect(column.className).toContain('min-w-0');
  });
});
