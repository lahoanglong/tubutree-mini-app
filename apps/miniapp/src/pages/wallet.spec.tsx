import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getWallet: vi.fn(),
  getReferral: vi.fn(),
  getLoyalty: vi.fn(),
  getWalletTransactions: vi.fn(),
  withdraw: vi.fn(),
  shareLink: vi.fn(),
  features: { cashback: false },
  role: 'CUSTOMER' as string,
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/wallet', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/account-api', () => ({
  getWallet: mocks.getWallet,
  getReferral: mocks.getReferral,
  getLoyalty: mocks.getLoyalty,
  getWalletTransactions: mocks.getWalletTransactions,
  withdraw: mocks.withdraw,
}));
vi.mock('../services/zmp-bridge', () => ({ shareLink: mocks.shareLink }));
vi.mock('../utils/features', () => ({
  get CASHBACK_ENABLED() {
    return mocks.features.cashback;
  },
}));
vi.mock('../store/auth', () => {
  return {
    useAuthStore: (sel?: (s: { status: string; user: { role: string } }) => unknown) => {
      const state = { status: 'authenticated', user: { role: mocks.role } };
      return sel ? sel(state) : state;
    },
  };
});
vi.mock('../utils/idempotency', () => {
  let n = 0;
  return { newIdempotencyKey: () => `key-${++n}` };
});

import WalletPage from './wallet';

const WALLET = {
  walletBalance: 1_250_000,
  cashbackPending: 45_000,
  commissionApproved: 520_000,
  commissionPending: 30_000,
  withdrawMin: 100_000,
  withdrawFee: 3_000,
};
const REFERRAL = {
  referralCode: 'TUBU1234',
  successCount: 2,
  earnedPoints: 20,
  milestones: [{ count: 5, bonusPoints: 50 }],
  nextMilestone: { count: 5, bonusPoints: 50 },
};
const LOYALTY = { pointsBalance: 48_000, pointsConvertedBalance: 2_000, tier: { name: 'Bạc' } };
const TXN_PAGE_1 = {
  data: [
    { id: 't1', delta: 50_000, balanceAfter: 1_250_000, type: 'CASHBACK', reason: null, orderId: null, createdAt: '2026-10-05T07:04:00' },
    { id: 't2', delta: -100_000, balanceAfter: 1_200_000, type: 'WITHDRAW', reason: 'Rút về ngân hàng', orderId: null, createdAt: '2026-10-04T10:00:00' },
  ],
  meta: { page: 1, limit: 2, total: 3 },
};
const TXN_PAGE_2 = {
  data: [{ id: 't3', delta: 10_000, balanceAfter: 1_300_000, type: 'ADJUST', reason: null, orderId: null, createdAt: '2026-10-03T10:00:00' }],
  meta: { page: 2, limit: 2, total: 3 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WalletPage />
    </QueryClientProvider>,
  );
}

function stubLoaded(wallet: object = WALLET) {
  mocks.getWallet.mockResolvedValue(wallet);
  mocks.getReferral.mockResolvedValue(REFERRAL);
  mocks.getLoyalty.mockResolvedValue(LOYALTY);
  mocks.getWalletTransactions.mockImplementation((page: number) => Promise.resolve(page === 1 ? TXN_PAGE_1 : TXN_PAGE_2));
}

/** Ô nhập theo nhãn hiển thị: ưu tiên liên kết <label for> (DS v2 `Field`), rơi về ô nhập gần nhất
 * trong cùng khối với chữ nhãn, để các ca hành vi không phụ thuộc cách gắn nhãn. Việc nhãn PHẢI gắn
 * với control được khẳng định riêng ở ca a11y bên dưới. */
function inputOf(label: string | RegExp): HTMLInputElement {
  const linked = screen.queryByLabelText(label);
  if (linked) return linked as HTMLInputElement;
  let el: HTMLElement | null = screen.getByText(label);
  while (el && !el.querySelector('input')) el = el.parentElement;
  return el!.querySelector('input')!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.features.cashback = false;
  mocks.role = 'CUSTOMER';
});

describe('WalletPage — hiển thị (hành vi giữ nguyên khi chuyển DS v2)', () => {
  it('có đúng một h1 ở mọi trạng thái: đang tải, lỗi, đã tải (C-114)', async () => {
    mocks.getWallet.mockReturnValue(new Promise(() => {}));
    mocks.getReferral.mockReturnValue(new Promise(() => {}));
    mocks.getLoyalty.mockReturnValue(new Promise(() => {}));
    const loading = renderPage();
    expect(loading.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ví Tubu');
    loading.unmount();

    vi.clearAllMocks();
    mocks.getWallet.mockRejectedValue(new Error('boom'));
    mocks.getReferral.mockResolvedValue(REFERRAL);
    mocks.getLoyalty.mockResolvedValue(LOYALTY);
    const failed = renderPage();
    await screen.findByRole('button', { name: 'Thử lại' });
    expect(failed.container.querySelectorAll('h1')).toHaveLength(1);
    failed.unmount();

    vi.clearAllMocks();
    stubLoaded();
    const loaded = renderPage();
    await screen.findByText('Ví Tubu (số dư khả dụng)');
    expect(loaded.container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('hiện số dư Ví, Điểm Xanh (tổng hai lô), ba nguồn tiền chờ và sao kê đúng số liệu', async () => {
    stubLoaded();
    renderPage();
    expect(await screen.findByText('Ví Tubu (số dư khả dụng)')).toBeInTheDocument();
    expect(screen.getAllByText('1.250.000đ').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Điểm Xanh (đổi giảm giá)')).toBeInTheDocument();
    expect(screen.getByText('50.000 điểm')).toBeInTheDocument();
    expect(screen.getByText('Bạc')).toBeInTheDocument();
    expect(screen.getByText('Hoa hồng chờ duyệt')).toBeInTheDocument();
    expect(screen.getByText('30.000đ')).toBeInTheDocument();
    expect(screen.getByText('Hoa hồng có thể rút')).toBeInTheDocument();
    expect(screen.getByText('520.000đ')).toBeInTheDocument();
    expect(screen.getByText('Hoàn tiền đã duyệt, chờ về Ví')).toBeInTheDocument();
    expect(screen.getByText('45.000đ')).toBeInTheDocument();
    expect(screen.getByText('Mời thêm 3 bạn để nhận 50 điểm')).toBeInTheDocument();
    expect(screen.getByText('20 điểm')).toBeInTheDocument();
    expect(screen.getByText('TUBU1234')).toBeInTheDocument();
    expect(await screen.findByText('Hoàn tiền sàn ngoài')).toBeInTheDocument();
    expect(screen.getByText('+50.000đ')).toBeInTheDocument();
    expect(screen.getByText('−100.000đ')).toBeInTheDocument();
    expect(screen.getByText('Số dư 1.200.000đ')).toBeInTheDocument();
  });

  it('Điểm Xanh có phần quy đổi: nói rõ phần không hết hạn dùng ở đâu, không ra tiền (PD-3)', async () => {
    stubLoaded();
    renderPage();
    expect(await screen.findByText('trong đó 2.000 điểm không hết hạn')).toBeInTheDocument();
    expect(
      screen.getByText('Điểm không hết hạn dùng trả đơn hàng tới 100% giá trị hàng và góp quỹ trồng cây. Không rút ra tiền.'),
    ).toBeInTheDocument();
  });

  it('không có điểm quy đổi: không hiện dòng "không hết hạn"', async () => {
    mocks.getWallet.mockResolvedValue(WALLET);
    mocks.getReferral.mockResolvedValue(REFERRAL);
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 48_000, tier: { name: 'Bạc' } });
    mocks.getWalletTransactions.mockResolvedValue(TXN_PAGE_1);
    renderPage();
    expect(await screen.findByText('48.000 điểm')).toBeInTheDocument();
    expect(screen.queryByText(/không hết hạn/)).toBeNull();
  });

  it('lỗi tải ví KHÔNG hiện 0đ mà báo lỗi kèm Thử lại gọi lại getWallet', async () => {
    mocks.getWallet.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue(WALLET);
    mocks.getReferral.mockResolvedValue(REFERRAL);
    mocks.getLoyalty.mockResolvedValue(LOYALTY);
    mocks.getWalletTransactions.mockResolvedValue(TXN_PAGE_1);
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(screen.queryByText('Ví Tubu (số dư khả dụng)')).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByText('Ví Tubu (số dư khả dụng)')).toBeInTheDocument();
  });

  it('sao kê phân trang: "Xem thêm" nạp trang 2', async () => {
    stubLoaded();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    await waitFor(() => expect(mocks.getWalletTransactions).toHaveBeenCalledWith(2));
    expect(await screen.findByText('Điều chỉnh')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  });

  it('sao kê phân trang theo số trang: có biến động mới chen vào giữa hai lần tải thì dòng cuối trang 1 lặp lại ở đầu trang 2 — mỗi dòng chỉ hiện một lần, không cảnh báo key trùng', async () => {
    stubLoaded();
    const t2 = TXN_PAGE_1.data[1]!;
    mocks.getWalletTransactions.mockImplementation((page: number) =>
      Promise.resolve(page === 1 ? TXN_PAGE_1 : { data: [t2, TXN_PAGE_2.data[0]], meta: { page: 2, limit: 2, total: 4 } }),
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
      expect(await screen.findByText('Điều chỉnh')).toBeInTheDocument();
      expect(screen.getAllByText('Số dư 1.200.000đ')).toHaveLength(1);
      expect(errors.mock.calls.filter((c) => /same key|unique "key"/.test(String(c[0])))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it('sao kê trống → báo chưa có biến động', async () => {
    stubLoaded();
    mocks.getWalletTransactions.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    renderPage();
    expect(await screen.findByText('Chưa có biến động nào trong Ví.')).toBeInTheDocument();
  });
});

describe('WalletPage — điều hướng', () => {
  it('thẻ Điểm Xanh mở /loyalty; "Nhận về Ví" mở /affiliate khi hoa hồng đã duyệt > 0', async () => {
    stubLoaded();
    renderPage();
    fireEvent.click(await screen.findByText('Điểm Xanh (đổi giảm giá)'));
    expect(mocks.navigate).toHaveBeenCalledWith('/loyalty');
    fireEvent.click(screen.getByText('Hoa hồng có thể rút'));
    expect(mocks.navigate).toHaveBeenCalledWith('/affiliate');
  });

  it('hoa hồng đã duyệt = 0 → thẻ không bấm được, không có gợi ý "Nhận về Ví"', async () => {
    stubLoaded({ ...WALLET, commissionApproved: 0 });
    renderPage();
    await screen.findByText('Hoa hồng có thể rút');
    expect(screen.queryByText(/Nhận về Ví/)).toBeNull();
    fireEvent.click(screen.getByText('Hoa hồng có thể rút'));
    expect(mocks.navigate).not.toHaveBeenCalledWith('/affiliate');
  });

  it('"Chia sẻ" mã giới thiệu gọi shareLink với đường dẫn ?ref=; lỗi thì báo mã qua snackbar', async () => {
    stubLoaded();
    mocks.shareLink.mockRejectedValueOnce(new Error('no share'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ' }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledWith(expect.objectContaining({ path: '/?ref=TUBU1234' })));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mã giới thiệu của bạn: TUBU1234', type: 'info' }),
    );
  });
});

describe('WalletPage — rút tiền', () => {
  it('nút Rút khoá tới khi đủ số tiền + thông tin ngân hàng; gửi đúng số tiền, bank và Idempotency-Key', async () => {
    stubLoaded();
    mocks.withdraw.mockResolvedValue({ ok: true, payoutId: 'p1', status: 'PENDING', withdrawn: 200_000, fee: 3_000, net: 197_000 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Rút ngân hàng' }));
    expect(await screen.findByText('Rút tiền về ngân hàng')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: /^Rút\s*$/ });
    expect(submit).toBeDisabled();
    fireEvent.change(inputOf('Số tiền rút'), { target: { value: '200000' } });
    fireEvent.change(inputOf('Tên ngân hàng'), { target: { value: 'Techcombank' } });
    fireEvent.change(inputOf('Số tài khoản'), { target: { value: '19031234567' } });
    expect(screen.getByRole('button', { name: /^Rút 200\.000đ$/ })).toBeDisabled();
    fireEvent.change(inputOf('Chủ tài khoản'), { target: { value: 'LA HOANG LONG' } });
    expect(screen.getByText(/Thực nhận:/).textContent).toContain('197.000đ');

    const go = screen.getByRole('button', { name: 'Rút 200.000đ' });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(mocks.withdraw).toHaveBeenCalledTimes(1));
    const [amount, bank, key] = mocks.withdraw.mock.calls[0]!;
    expect(amount).toBe(200_000);
    expect(bank).toEqual({ bankName: 'Techcombank', accountNumber: '19031234567', accountName: 'LA HOANG LONG' });
    expect(key).toMatch(/^key-/);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({
        text: 'Đã gửi yêu cầu rút. Thực nhận 197.000đ trong 1-3 ngày làm việc.',
        type: 'success',
      }),
    );
  });

  it('số dư dưới mức tối thiểu → báo chưa đủ mốc và khoá cả bốn ô nhập', async () => {
    stubLoaded({ ...WALLET, walletBalance: 50_000 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Rút ngân hàng' }));
    expect(await screen.findByText(/chưa đủ mốc tối thiểu 100\.000đ/)).toBeInTheDocument();
    for (const label of ['Số tiền rút', 'Tên ngân hàng', 'Số tài khoản', 'Chủ tài khoản']) {
      expect(inputOf(label)).toBeDisabled();
    }
  });

  it('mỗi lần mở sheet là một lệnh rút mới → Idempotency-Key khác nhau', async () => {
    stubLoaded();
    mocks.withdraw.mockRejectedValue(new Error('lỗi'));
    renderPage();
    const fill = () => {
      fireEvent.change(inputOf('Số tiền rút'), { target: { value: '150000' } });
      fireEvent.change(inputOf('Tên ngân hàng'), { target: { value: 'VCB' } });
      fireEvent.change(inputOf('Số tài khoản'), { target: { value: '123456' } });
      fireEvent.change(inputOf('Chủ tài khoản'), { target: { value: 'A' } });
    };
    fireEvent.click(await screen.findByRole('button', { name: 'Rút ngân hàng' }));
    await screen.findByText('Rút tiền về ngân hàng');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Rút 150.000đ' }));
    await waitFor(() => expect(mocks.withdraw).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    fireEvent.click(screen.getByRole('button', { name: 'Rút 150.000đ' }));
    await waitFor(() => expect(mocks.withdraw).toHaveBeenCalledTimes(2));
    expect(mocks.withdraw.mock.calls[1]![2]).not.toBe(mocks.withdraw.mock.calls[0]![2]);
  });
});

describe('WalletPage — xu đã gộp vào Điểm Xanh, không còn đường vào TubuXu (Q-26, PD-3)', () => {
  it('không còn nút/sheet đổi Ví sang xu, thẻ TubuXu hay mẹo ×1.2', async () => {
    stubLoaded();
    renderPage();
    await screen.findByText('Ví Tubu (số dư khả dụng)');
    expect(screen.queryByRole('button', { name: /Đổi/ })).toBeNull();
    expect(screen.queryByText(/TubuXu/)).toBeNull();
    expect(screen.queryByText(/×1[.,]2/)).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/(?<![\p{L}_])xu(?![\p{L}_])/iu);
  });

  it('thống kê giới thiệu đọc từ /me/referral (/me/coins đã 410, mock không còn getCoins)', async () => {
    stubLoaded();
    renderPage();
    await screen.findByText('Ví Tubu (số dư khả dụng)');
    expect(mocks.getReferral).toHaveBeenCalledTimes(1);
  });

  it('mẹo dưới ví nói đúng việc Ví làm được: trả cả đơn hàng, miễn phí, thay vì rút có phí', async () => {
    stubLoaded();
    renderPage();
    const tip = await screen.findByText(/Mẹo:/);
    expect(tip.textContent).toMatch(/trả đơn hàng/);
    expect(tip.textContent).toMatch(/3\.000đ/);
  });

  it('lời mời bạn: thưởng là Điểm Xanh, chia sẻ không hứa "cả hai nhận xu"', async () => {
    stubLoaded();
    mocks.shareLink.mockResolvedValue(undefined);
    renderPage();
    expect(await screen.findByText('Mời bạn — nhận Điểm Xanh')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ' }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    const arg = mocks.shareLink.mock.calls[0]![0] as { description: string };
    expect(arg.description).toContain('TUBU1234');
    expect(arg.description).not.toMatch(/(?<![\p{L}_])xu(?![\p{L}_])|TubuXu/iu);
  });

  it('khách thường thấy đủ điều kiện thưởng: đơn thứ hai từ minOrderAmount trong windowDays', async () => {
    stubLoaded();
    mocks.getReferral.mockResolvedValue({ ...REFERRAL, windowDays: 30, minOrderAmount: 200_000 });
    renderPage();
    const promise = await screen.findByText(/có đơn thứ hai từ 200\.000đ giao thành công trong 30 ngày kể từ đơn đầu/);
    expect(promise.textContent).toMatch(/Điểm Xanh/);
  });

  it('điều kiện lấy theo số API trả, không ghi cứng', async () => {
    stubLoaded();
    mocks.getReferral.mockResolvedValue({ ...REFERRAL, windowDays: 45, minOrderAmount: 300_000 });
    renderPage();
    expect(await screen.findByText(/từ 300\.000đ giao thành công trong 45 ngày/)).toBeInTheDocument();
  });

  it('CTV (AFFILIATE) không thấy lời hứa thưởng Điểm Xanh vì không bao giờ được thưởng', async () => {
    mocks.role = 'AFFILIATE';
    stubLoaded();
    mocks.getReferral.mockResolvedValue({ ...REFERRAL, windowDays: 30, minOrderAmount: 200_000 });
    renderPage();
    await screen.findByText('Ví Tubu (số dư khả dụng)');
    expect(screen.queryByText('Mời bạn — nhận Điểm Xanh')).toBeNull();
    expect(screen.queryByText(/có đơn thứ hai/)).toBeNull();
  });

  it('chưa tải được thống kê giới thiệu: ví vẫn hiện, chỉ ẩn khối mời bạn', async () => {
    stubLoaded();
    mocks.getReferral.mockRejectedValue(new Error('lỗi'));
    renderPage();
    expect(await screen.findByText('Ví Tubu (số dư khả dụng)')).toBeInTheDocument();
    expect(screen.queryByText('Mời bạn — nhận Điểm Xanh')).toBeNull();
  });
});

describe('WalletPage — vùng chạm >= 44px, nhãn form và biểu tượng (C-076, C-113)', () => {
  it('nhãn của các ô nhập gắn với control (trình đọc màn hình đọc được)', async () => {
    stubLoaded();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Rút ngân hàng' }));
    await screen.findByText('Rút tiền về ngân hàng');
    for (const label of ['Số tiền rút', 'Tên ngân hàng', 'Số tài khoản', 'Chủ tài khoản']) {
      expect(screen.getByLabelText(label)).toBeInstanceOf(HTMLInputElement);
    }
  });

  it('nút Rút và nút Chia sẻ cao tối thiểu 44px', async () => {
    stubLoaded();
    renderPage();
    for (const name of ['Rút ngân hàng', 'Chia sẻ']) {
      const btn = await screen.findByRole('button', { name });
      expect(Number.parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });

  it('thẻ Điểm Xanh bấm được bằng bàn phím (role=button, Enter mở /loyalty)', async () => {
    stubLoaded();
    renderPage();
    const row = (await screen.findByText('Điểm Xanh (đổi giảm giá)')).closest('[role="button"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    fireEvent.keyDown(row!, { key: 'Enter' });
    expect(mocks.navigate).toHaveBeenCalledWith('/loyalty');
    expect(within(row!).getByText('Bạc')).toBeInTheDocument();
  });

  it('cảnh báo trong sheet rút không dùng emoji làm biểu tượng (⚠️ thay bằng Icon)', async () => {
    stubLoaded({ ...WALLET, walletBalance: 0 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Rút ngân hàng' }));
    expect((await screen.findByText(/chưa đủ mốc tối thiểu/)).textContent).not.toMatch(/⚠/);
  });
});

describe('WalletPage — ẩn lối vào Hoàn tiền sàn ngoài (C-086, Q-15)', () => {
  it('chú thích dưới số dư không mời khách kiếm tiền từ hoàn tiền sàn ngoài', async () => {
    stubLoaded();
    renderPage();
    const caption = await screen.findByText(/Tiền thật từ hoa hồng/);
    expect(caption.textContent).not.toMatch(/sàn ngoài/i);
  });

  it('hết khoản đã duyệt chờ về Ví: không còn thẻ "Hoàn tiền đã duyệt, chờ về Ví"', async () => {
    stubLoaded({ ...WALLET, cashbackPending: 0 });
    renderPage();
    await screen.findByText('Hoa hồng chờ duyệt');
    expect(screen.queryByText('Hoàn tiền đã duyệt, chờ về Ví')).toBeNull();
  });

  it('còn khoản đã duyệt chờ về Ví: vẫn hiện số tiền của khách', async () => {
    stubLoaded();
    renderPage();
    expect(await screen.findByText('Hoàn tiền đã duyệt, chờ về Ví')).toBeInTheDocument();
    expect(screen.getByText('45.000đ')).toBeInTheDocument();
  });

  it('sao kê cũ vẫn gọi đúng tên loại giao dịch CASHBACK', async () => {
    stubLoaded();
    renderPage();
    expect(await screen.findByText('Hoàn tiền sàn ngoài')).toBeInTheDocument();
  });

  describe('khi bật cờ CASHBACK_ENABLED', () => {
    beforeEach(() => {
      mocks.features.cashback = true;
    });

    it('chú thích nhắc lại hoàn tiền sàn ngoài; thẻ chờ về Ví hiện cả khi 0đ', async () => {
      stubLoaded({ ...WALLET, cashbackPending: 0, walletBalance: 0 });
      renderPage();
      expect((await screen.findByText(/Tiền thật từ hoa hồng/)).textContent).toMatch(/hoàn tiền sàn ngoài/);
      expect(screen.getByText('Hoàn tiền đã duyệt, chờ về Ví')).toBeInTheDocument();
    });
  });
});
