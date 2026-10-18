// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

type Call = { method: string; path: string; body?: unknown; headers?: Record<string, string> };

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  merchants: [] as object[],
  txns: [] as object[],
  wallet: { cashbackPending: 123_000 } as object,
  holdDays: 45,
  fail: new Set<string>(),
  click: null as null | (() => Promise<unknown>),
  calls: [] as Call[],
  opened: [] as string[],
  win: null as null | { opener: unknown; location: { replace: (u: string) => void }; close: () => void },
  openCalls: [] as unknown[][],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'get', path });
      if (state.fail.has(path)) {
        state.fail.delete(path);
        throw new Error('mất mạng');
      }
      if (path === '/cashback/merchants') return state.merchants;
      if (path === '/cashback/transactions') return state.txns;
      if (path === '/me/wallet') return state.wallet;
      if (path === '/config/public') return { cashbackHoldDays: state.holdDays };
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => {
      state.calls.push({ method: 'post', path, body, headers: opts?.headers });
      return state.click!();
    },
  },
}));

import CashbackPage from './page';

const MERCHANTS = [
  { id: 'm1', slug: 'shopee', name: 'Shopee', logoUrl: '', category: 'mall', baseRate: '0.05', terms: 'Không áp dụng đơn hoàn huỷ.' },
  { id: 'm2', slug: 'lazada', name: 'Lazada', logoUrl: 'https://img.example/lazada.png', category: 'mall', baseRate: '0.035', terms: null },
];
const TXNS = [
  { id: 'c1', merchantOrderId: 'ABCDEFGHIJKLMN', orderAmount: 500_000, commission: 0, userReward: 25_000, status: 'PENDING', confirmedAt: null, paidAt: null },
  { id: 'c2', merchantOrderId: '', orderAmount: 200_000, commission: 0, userReward: 7_000, status: 'CONFIRMED', confirmedAt: null, paidAt: null },
  { id: 'c3', merchantOrderId: 'X1', orderAmount: 100_000, commission: 0, userReward: 5_000, status: 'PAID', confirmedAt: null, paidAt: null },
  { id: 'c4', merchantOrderId: 'X2', orderAmount: 100_000, commission: 0, userReward: 0, status: 'REJECTED', confirmedAt: null, paidAt: null },
];

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CashbackPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const postsOf = (path: string) => state.calls.filter((c) => c.method === 'post' && c.path === path);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const tile = (c: HTMLElement, name: string) => byText(c, 'button[data-merchant]', name);
const buyBtn = () => byText(dialog()!, 'button', 'Mua sắm & nhận hoàn tiền') as HTMLButtonElement;

beforeEach(() => {
  state.phase = 'authenticated';
  state.merchants = MERCHANTS;
  state.txns = TXNS;
  state.wallet = { cashbackPending: 123_000 };
  state.holdDays = 45;
  state.fail = new Set();
  state.click = async () => ({ deeplink: 'https://aff.example/abc' });
  state.calls = [];
  state.opened = [];
  state.openCalls = [];
  state.win = { opener: 'x', location: { replace: (u: string) => void state.opened.push(u) }, close: vi.fn() };
  vi.spyOn(window, 'open').mockImplementation(((...a: unknown[]) => {
    state.openCalls.push(a);
    return state.win;
  }) as typeof window.open);
});
afterEach(() => {
  vi.restoreAllMocks();
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/hoan-tien — hiển thị', () => {
  it('khoản đã duyệt chờ về Ví, lưới sàn kèm tỉ lệ và danh sách giao dịch đúng số liệu', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Đã duyệt, chờ về Ví');
    expect(c.textContent).toContain('123.000đ');
    expect(c.textContent).toContain('Sàn đã xác nhận đơn — khoản này sẽ vào Ví Tubu. Đơn sàn chưa duyệt xem ở danh sách bên dưới.');
    expect(tile(c, 'Shopee')?.textContent).toContain('5%');
    expect(tile(c, 'Lazada')?.textContent).toContain('3,5%');
    expect(c.textContent).toContain('+25.000đ');
    expect(c.textContent).toContain('Đơn 500.000đ · #ABCDEFGHIJ');
    expect(c.textContent).toContain('Đơn 200.000đ');
    for (const label of ['Chờ duyệt', 'Đã duyệt', 'Đã hoàn vào Ví', 'Từ chối']) expect(c.textContent).toContain(label);
  });

  it('lỗi tải ví KHÔNG hiện 0đ mà báo lỗi kèm Thử lại', async () => {
    state.fail.add('/me/wallet');
    const c = await mount();
    expect(c.textContent).not.toContain('Đã duyệt, chờ về Ví');
    click(byText(c, 'button', 'Thử lại'));
    await flush(5);
    expect(c.textContent).toContain('123.000đ');
  });

  it('chưa có sàn / chưa có giao dịch → đúng câu chữ', async () => {
    state.merchants = [];
    state.txns = [];
    state.wallet = { cashbackPending: 0 };
    const c = await mount();
    expect(c.textContent).toContain('Chưa có sàn đối tác nào.');
    expect(c.textContent).toContain('Chưa có giao dịch hoàn tiền. Bắt đầu mua sắm qua các sàn ở trên.');
  });

  it('lỗi tải sàn → ErrorState + Thử lại, không hiện "Chưa có sàn"', async () => {
    state.fail.add('/cashback/merchants');
    const c = await mount();
    expect(c.textContent).toContain('mất mạng');
    expect(c.textContent).not.toContain('Chưa có sàn đối tác nào.');
    click(byText(c, 'button', 'Thử lại'));
    await flush(5);
    expect(tile(c, 'Shopee')).not.toBeNull();
  });

  it('lỗi tải giao dịch → báo lỗi, không nói "chưa có giao dịch"', async () => {
    state.fail.add('/cashback/transactions');
    const c = await mount();
    expect(c.textContent).not.toContain('Chưa có giao dịch hoàn tiền');
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('mất mạng');
  });
});

describe('/hoan-tien — khách và phiên', () => {
  it('khách: vẫn thấy lưới sàn, không số dư 0đ giả, không giao dịch, không gọi API cần đăng nhập', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(tile(c, 'Shopee')).not.toBeNull();
    expect(c.textContent).not.toContain('Đã duyệt, chờ về Ví');
    expect(c.querySelector('a[href*="/dang-nhap"]')?.getAttribute('href')).toContain(encodeURIComponent('/hoan-tien'));
    expect(state.calls.map((x) => x.path)).not.toContain('/me/wallet');
    expect(state.calls.map((x) => x.path)).not.toContain('/cashback/transactions');
  });

  it('khách mở chi tiết sàn: thay nút mua bằng lối đăng nhập, không gọi POST /cashback/click', async () => {
    state.phase = 'guest';
    const c = await mount();
    click(tile(c, 'Shopee'));
    await flush(3);
    expect(byText(dialog()!, 'button', 'Mua sắm & nhận hoàn tiền')).toBeNull();
    expect(dialog()!.querySelector('a[href*="/dang-nhap"]')).not.toBeNull();
    expect(postsOf('/cashback/click')).toHaveLength(0);
  });

  it('đang khôi phục phiên → không gọi API cần đăng nhập, lưới sàn vẫn hiện', async () => {
    state.phase = 'loading';
    const c = await mount();
    expect(tile(c, 'Shopee')).not.toBeNull();
    expect(state.calls.map((x) => x.path)).not.toContain('/me/wallet');
  });

  it('mất kết nối phiên → báo đúng chuyện đó thay vì mời đăng nhập', async () => {
    state.phase = 'unavailable';
    const c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(c.querySelector('a[href*="/dang-nhap"]')).toBeNull();
  });
});

describe('/hoan-tien — chọn sàn và nhận hoàn tiền', () => {
  it('bấm sàn → chi tiết (số ngày giữ từ cấu hình, điều khoản, lưu ý) rồi POST /cashback/click và mở link ở tab mới', async () => {
    const c = await mount();
    click(tile(c, 'Shopee'));
    await flush(3);
    const d = dialog()!;
    expect(d.textContent).toContain('Hoàn đến 5% giá trị đơn');
    expect(d.textContent).toContain('Cách nhận hoàn tiền');
    expect(d.textContent).toContain('Sàn xác nhận đơn → hoàn tiền vào Ví Tubu (sau 45 ngày)');
    expect(d.textContent).toContain('Không áp dụng đơn hoàn huỷ.');
    expect(d.textContent).toContain('Lưu ý: phải bấm từ đây mỗi lần mua để được ghi nhận hoàn tiền.');
    click(buyBtn());
    await flush(5);
    expect(postsOf('/cashback/click')).toHaveLength(1);
    expect(postsOf('/cashback/click')[0]!.body).toEqual({ merchantId: 'm1', productUrl: undefined });
    expect(state.opened).toEqual(['https://aff.example/abc']);
    expect(state.win!.opener).toBeNull();
    expect(dialog()).toBeNull();
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Đã ghi nhận hoàn tiền! Đang chuyển hướng sang sàn...');
  });

  it('bấm đúp chỉ tạo một lượt click', async () => {
    let resolve!: (v: unknown) => void;
    state.click = () => new Promise((r) => (resolve = r));
    const c = await mount();
    click(tile(c, 'Shopee'));
    await flush(3);
    click(buyBtn());
    click(buyBtn());
    await flush(2);
    resolve({ deeplink: 'https://aff.example/abc' });
    await flush(5);
    expect(postsOf('/cashback/click')).toHaveLength(1);
    expect(state.opened).toHaveLength(1);
  });

  it('link đối tác không phải http(s) thì không mở', async () => {
    state.click = async () => ({ deeplink: 'javascript:alert(1)' });
    const c = await mount();
    click(tile(c, 'Shopee'));
    await flush(3);
    click(buyBtn());
    await flush(5);
    expect(state.opened).toEqual([]);
    expect(state.win!.close).toHaveBeenCalled();
  });

  it('tab được mở ngay trong cú bấm, trước khi có phản hồi của máy chủ, và không dùng noopener', async () => {
    let resolve!: (v: unknown) => void;
    state.click = () => new Promise((r) => (resolve = r));
    const c = await mount();
    click(tile(c, 'Shopee'));
    await flush(3);
    click(buyBtn());
    expect(state.openCalls).toHaveLength(1);
    expect(state.openCalls[0]![2]).toBeUndefined();
    await flush(2);
    expect(state.opened).toEqual([]);
    resolve({ deeplink: 'https://aff.example/abc' });
    await flush(5);
    expect(state.opened).toEqual(['https://aff.example/abc']);
  });

  it('trình duyệt chặn cửa sổ mới (window.open trả null) → giữ khung và hiện liên kết để khách tự bấm', async () => {
    state.win = null;
    const c = await mount();
    click(tile(c, 'Shopee'));
    await flush(3);
    click(buyBtn());
    await flush(5);
    const a = dialog()!.querySelector('a[href="https://aff.example/abc"]');
    expect(a?.textContent).toContain('Mở sàn');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('tạo click lỗi → báo lỗi trong khung, KHÔNG mở link', async () => {
    state.click = async () => {
      throw new Error('Sàn đang bảo trì');
    };
    const c = await mount();
    click(tile(c, 'Lazada'));
    await flush(3);
    click(buyBtn());
    await flush(5);
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Sàn đang bảo trì');
    expect(state.opened).toEqual([]);
    expect(state.win!.close).toHaveBeenCalled();
  });
});

describe('/hoan-tien — truy cập', () => {
  it('thẻ sàn là nút, một h1, điều khoản đủ tên, vùng chạm đủ lớn, không emoji làm biểu tượng', async () => {
    const c = await mount();
    expect(tile(c, 'Shopee')?.tagName).toBe('BUTTON');
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(c.querySelector('h1')?.textContent).toBe('Hoàn tiền');
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(c.textContent).not.toMatch(/⚠|↩/);
  });
});
