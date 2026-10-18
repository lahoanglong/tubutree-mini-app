// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unlabeledFields, unnamedControls } from '@/test-utils/a11y';

type Call = { method: string; path: string; body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string> };

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  role: 'CUSTOMER' as string,
  cashbackEnabled: false,
  wallet: null as Record<string, unknown> | null,
  referral: null as Record<string, unknown> | null,
  loyalty: null as Record<string, unknown> | null,
  pages: [] as { data: Record<string, unknown>[]; total: number; limit?: number }[],
  fail: new Set<string>(),
  calls: [] as Call[],
  withdraw: null as null | (() => Promise<unknown>),
  share: null as null | (() => Promise<string>),
  shared: [] as unknown[],
  hold: new Set<string>(),
}));

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
      return state.withdraw!();
    },
  },
}));

import WalletPage from './page';

const WALLET = { walletBalance: 1_250_000, cashbackPending: 45_000, commissionApproved: 520_000, commissionPending: 30_000, withdrawMin: 100_000, withdrawFee: 3_000 };
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
const postsOf = (path: string) => state.calls.filter((c) => c.method === 'post' && c.path === path);
const input = (c: HTMLElement, label: string) => {
  const l = Array.from(document.querySelectorAll('label')).find((x) => x.textContent === label);
  return document.getElementById(l!.getAttribute('for')!) as HTMLInputElement;
};
async function openSheet(c: HTMLElement) {
  click(byText(c, 'button', 'Rút ngân hàng'));
  await flush(3);
}
async function fillBank(c: HTMLElement, amount = '200000') {
  typeInto(input(c, 'Số tiền rút'), amount);
  typeInto(input(c, 'Tên ngân hàng'), 'Techcombank');
  typeInto(input(c, 'Số tài khoản'), '19031234567');
  typeInto(input(c, 'Chủ tài khoản'), 'LA HOANG LONG');
  await flush(2);
}
const submitBtn = () => Array.from(document.querySelectorAll('button')).find((b) => /^Rút( [\d.]+đ)?$/.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;

beforeEach(() => {
  state.phase = 'authenticated';
  state.role = 'CUSTOMER';
  state.cashbackEnabled = false;
  state.wallet = { ...WALLET };
  state.referral = { ...REFERRAL };
  state.loyalty = { ...LOYALTY };
  state.pages = [PAGE_1, PAGE_2];
  state.fail = new Set();
  state.calls = [];
  state.shared = [];
  state.withdraw = async () => ({ ok: true, payoutId: 'p1', status: 'PENDING', withdrawn: 200_000, fee: 3_000, net: 197_000 });
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
    expect(c.textContent).toContain('Hoa hồng chờ duyệt');
    expect(c.textContent).toContain('30.000đ');
    expect(c.textContent).toContain('Hoa hồng có thể rút');
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

  it('hoa hồng đã duyệt > 0: thẻ dẫn sang /ctv kèm "Nhận về Ví →"; bằng 0 thì không bấm được, không gợi ý', async () => {
    let c = await mount();
    const a = c.querySelector<HTMLAnchorElement>('a[href="/ctv"]');
    expect(a).not.toBeNull();
    expect(a!.textContent).toContain('Nhận về Ví →');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.wallet = { ...WALLET, commissionApproved: 0 };
    c = await mount();
    expect(c.querySelector('a[href="/ctv"]')).toBeNull();
    expect(c.textContent).not.toContain('Nhận về Ví →');
    expect(c.textContent).toContain('Hoa hồng có thể rút');
  });

  it('khách thường chưa có hoa hồng: ẩn hai thẻ hoa hồng, chú thích nói về thanh toán đơn', async () => {
    state.wallet = { ...WALLET, commissionApproved: 0, commissionPending: 0, cashbackPending: 0 };
    const c = await mount();
    expect(c.textContent).toContain('Số dư dùng để thanh toán đơn');
    expect(c.textContent).not.toContain('Hoa hồng chờ duyệt');
    expect(c.textContent).not.toContain('Hoa hồng có thể rút');
    expect(c.textContent).not.toContain('Tiền thật từ hoa hồng');
    expect(c.textContent).not.toContain('Hoàn tiền đã duyệt, chờ về Ví');
  });

  it('CTV và đại lý vẫn thấy khối hoa hồng dù đang 0đ, chú thích nhắc tiền thật từ hoa hồng', async () => {
    for (const role of ['AFFILIATE', 'DEALER']) {
      state.role = role;
      state.wallet = { ...WALLET, commissionApproved: 0, commissionPending: 0, cashbackPending: 0 };
      const c = await mount();
      expect(c.textContent).toContain('Hoa hồng chờ duyệt');
      expect(c.textContent).toContain('Hoa hồng có thể rút');
      expect(c.textContent).toContain('Tiền thật từ hoa hồng — rút về ngân hàng hoặc trả đơn hàng.');
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

  it('mẹo dưới ví: dùng Ví trả đơn miễn phí thay vì rút có phí (phí lấy từ API)', async () => {
    state.wallet = { ...WALLET, withdrawFee: 5_000 };
    const c = await mount();
    expect(c.textContent).toContain('Mẹo: dùng Ví Tubu để trả đơn hàng — miễn phí, thay vì rút về ngân hàng (phí chuyển khoản 5.000đ/lần).');
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

describe('/tai-khoan/vi-tubu — giới thiệu bạn bè', () => {
  it('hiện thống kê, mốc còn thiếu và mã; chia sẻ gọi bridge với đường dẫn ?ref=', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Mời bạn — nhận Điểm Xanh');
    expect(c.textContent).toContain('Mời thêm 3 bạn để nhận 50 điểm');
    expect(c.textContent).toContain('TUBU1234');
    click(byText(c, 'button', 'Chia sẻ'));
    await flush(3);
    expect(state.shared).toHaveLength(1);
    const arg = state.shared[0] as { title: string; text: string; path: string };
    expect(arg.path).toBe('/?ref=TUBU1234');
    expect(arg.text).toContain('TUBU1234');
    expect(arg.text).not.toMatch(/(?<![\p{L}_])xu(?![\p{L}_])|TubuXu/iu);
  });

  it('chia sẻ chép được liên kết thì báo đã chép; thất bại thì báo kèm mã; huỷ thì im lặng', async () => {
    const c = await mount();
    state.share = async () => 'copied';
    click(byText(c, 'button', 'Chia sẻ'));
    await flush(3);
    expect(c.textContent).toContain('Đã chép liên kết giới thiệu');
    state.share = async () => 'failed';
    click(byText(c, 'button', 'Chia sẻ'));
    await flush(3);
    expect(c.textContent).toContain('Chưa chia sẻ được. Bạn gửi mã TUBU1234 cho bạn bè nhé.');
    state.share = async () => 'cancelled';
    click(byText(c, 'button', 'Chia sẻ'));
    await flush(3);
    expect(c.querySelector('[role="status"]')?.textContent ?? '').toBe('');
  });

  it('điều kiện thưởng lấy theo số API trả; thiếu thì dùng 200.000đ và 30 ngày', async () => {
    let c = await mount();
    expect(c.textContent).toContain('có đơn thứ hai từ 200.000đ giao thành công trong 30 ngày kể từ đơn đầu');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.referral = { ...REFERRAL, windowDays: 45, minOrderAmount: 300_000 };
    c = await mount();
    expect(c.textContent).toContain('từ 300.000đ giao thành công trong 45 ngày');
  });

  it('đã đủ hoặc vượt mốc: ẩn dòng "Mời thêm", không in số âm', async () => {
    state.referral = { ...REFERRAL, successCount: 7 };
    const c = await mount();
    expect(c.textContent).toContain('Mời bạn — nhận Điểm Xanh');
    expect(c.textContent).not.toContain('Mời thêm');
  });

  it('CTV (AFFILIATE) không thấy lời hứa thưởng Điểm Xanh', async () => {
    state.role = 'AFFILIATE';
    const c = await mount();
    expect(c.textContent).not.toContain('Mời bạn — nhận Điểm Xanh');
    expect(c.textContent).not.toContain('có đơn thứ hai');
  });

  it('thống kê giới thiệu lỗi: ví vẫn hiện, chỉ ẩn khối mời bạn', async () => {
    state.fail.add('/me/referral');
    const c = await mount();
    expect(c.textContent).toContain('1.250.000đ');
    expect(c.textContent).not.toContain('Mời bạn — nhận Điểm Xanh');
  });
});

describe('/tai-khoan/vi-tubu — rút tiền về ngân hàng', () => {
  it('nút Rút khoá tới khi đủ số tiền + ngân hàng; gửi đúng POST /wallet/withdraw, body và Idempotency-Key', async () => {
    const c = await mount();
    await openSheet(c);
    expect(document.body.textContent).toContain('Khả dụng: 1.250.000đ • Tối thiểu: 100.000đ');
    expect(submitBtn().disabled).toBe(true);
    typeInto(input(c, 'Số tiền rút'), '200000');
    typeInto(input(c, 'Tên ngân hàng'), 'Techcombank');
    typeInto(input(c, 'Số tài khoản'), '19031234567');
    await flush(2);
    expect(submitBtn().disabled).toBe(true);
    typeInto(input(c, 'Chủ tài khoản'), 'LA HOANG LONG');
    await flush(2);
    expect(document.body.textContent).toContain('Phí chuyển khoản ngân hàng: 3.000đ • Thực nhận: 197.000đ');
    expect(submitBtn().textContent?.trim()).toBe('Rút 200.000đ');
    click(submitBtn());
    await flush(6);
    const posts = postsOf('/wallet/withdraw');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ amount: 200_000, bankInfo: { bankName: 'Techcombank', accountNumber: '19031234567', accountName: 'LA HOANG LONG' } });
    expect(posts[0]!.headers?.['Idempotency-Key']).toMatch(/\S{8,}/);
    expect(c.textContent).toContain('Đã gửi yêu cầu rút. Thực nhận 197.000đ trong 1-3 ngày làm việc.');
    expect(document.body.textContent).not.toContain('Phí chuyển khoản ngân hàng');
  });

  it('rút xong làm mới số dư và sao kê', async () => {
    const c = await mount();
    await openSheet(c);
    await fillBank(c);
    const walletBefore = state.calls.filter((x) => x.path === '/me/wallet').length;
    const txnBefore = state.calls.filter((x) => x.path === '/me/wallet/transactions').length;
    click(submitBtn());
    await flush(8);
    expect(state.calls.filter((x) => x.path === '/me/wallet').length).toBeGreaterThan(walletBefore);
    expect(state.calls.filter((x) => x.path === '/me/wallet/transactions').length).toBeGreaterThan(txnBefore);
  });

  it('số tiền dưới mức tối thiểu, vượt số dư, số TK dưới 6 ký tự: nút khoá (canWithdraw như Mini App)', async () => {
    const c = await mount();
    await openSheet(c);
    await fillBank(c, '99999');
    expect(submitBtn().disabled).toBe(true);
    typeInto(input(c, 'Số tiền rút'), '1250001');
    await flush(2);
    expect(submitBtn().disabled).toBe(true);
    typeInto(input(c, 'Số tiền rút'), '1250000');
    typeInto(input(c, 'Số tài khoản'), '12345');
    await flush(2);
    expect(submitBtn().disabled).toBe(true);
    typeInto(input(c, 'Số tài khoản'), '123456');
    await flush(2);
    expect(submitBtn().disabled).toBe(false);
  });

  it('mức tối thiểu và phí lấy từ API; API không trả thì mặc định 100.000đ và 3.000đ', async () => {
    state.wallet = { ...WALLET, withdrawMin: undefined, withdrawFee: undefined };
    const c = await mount();
    await openSheet(c);
    expect(document.body.textContent).toContain('Tối thiểu: 100.000đ');
    await fillBank(c);
    expect(document.body.textContent).toContain('Phí chuyển khoản ngân hàng: 3.000đ • Thực nhận: 197.000đ');
  });

  it('số dư dưới mức tối thiểu: báo chưa đủ mốc và khoá cả bốn ô nhập', async () => {
    state.wallet = { ...WALLET, walletBalance: 50_000 };
    const c = await mount();
    await openSheet(c);
    expect(document.body.textContent).toContain('chưa đủ mốc tối thiểu 100.000đ');
    for (const label of ['Số tiền rút', 'Tên ngân hàng', 'Số tài khoản', 'Chủ tài khoản']) {
      expect(input(c, label).disabled).toBe(true);
    }
  });

  it('bấm đúp không gửi hai lệnh', async () => {
    let release!: () => void;
    state.withdraw = () => new Promise((res) => {
      release = () => res({ ok: true, payoutId: 'p1', status: 'PENDING', withdrawn: 200_000, fee: 3_000, net: 197_000 });
    });
    const c = await mount();
    await openSheet(c);
    await fillBank(c);
    const btn = submitBtn();
    click(btn);
    click(btn);
    await flush(2);
    expect(postsOf('/wallet/withdraw')).toHaveLength(1);
    expect(btn.textContent).toContain('Đang gửi...');
    release();
    await flush(4);
  });

  it('mỗi lần mở sheet và sau mỗi lỗi là một lệnh mới: Idempotency-Key khác nhau', async () => {
    state.withdraw = async () => {
      throw new Error('Ngân hàng từ chối');
    };
    const c = await mount();
    await openSheet(c);
    await fillBank(c, '150000');
    click(submitBtn());
    await flush(6);
    expect(document.querySelector('[role="dialog"]')!.querySelector('[role="alert"]')?.textContent).toBe('Ngân hàng từ chối');
    expect(c.querySelector('[role="status"]')?.textContent).not.toContain('Ngân hàng từ chối');
    click(submitBtn());
    await flush(6);
    const keys = postsOf('/wallet/withdraw').map((p) => p.headers?.['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('mở lại sheet sau khi đóng cho key mới và xoá số tiền cũ', async () => {
    state.withdraw = async () => {
      throw new Error('lỗi');
    };
    const c = await mount();
    await openSheet(c);
    await fillBank(c, '150000');
    click(submitBtn());
    await flush(6);
    click(byText(document.body, 'button', 'Đóng') ?? (document.querySelector('[aria-label="Đóng"]') as HTMLElement));
    await flush(2);
    await openSheet(c);
    expect(input(c, 'Số tiền rút').value).toBe('');
    await fillBank(c, '150000');
    click(submitBtn());
    await flush(6);
    const keys = postsOf('/wallet/withdraw').map((p) => p.headers?.['Idempotency-Key']);
    expect(keys[1]).not.toBe(keys[0]);
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
  it('tiêu đề, nút, nhãn ô nhập và vùng chạm đạt kiểm tra tối thiểu (kể cả khi mở sheet rút)', async () => {
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    await openSheet(c);
    expect(unlabeledFields(document.body)).toEqual([]);
    expect(unnamedControls(document.body)).toEqual([]);
    expect(smallTouchTargets(document.body)).toEqual([]);
  });
});
