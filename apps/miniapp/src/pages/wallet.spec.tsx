import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getWallet: vi.fn(),
  getCoins: vi.fn(),
  getLoyalty: vi.fn(),
  getWalletTransactions: vi.fn(),
  withdraw: vi.fn(),
  convertToXu: vi.fn(),
  shareLink: vi.fn(),
  features: { cashback: false },
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
  getCoins: mocks.getCoins,
  getLoyalty: mocks.getLoyalty,
  getWalletTransactions: mocks.getWalletTransactions,
  withdraw: mocks.withdraw,
  convertToXu: mocks.convertToXu,
}));
vi.mock('../services/zmp-bridge', () => ({ shareLink: mocks.shareLink }));
vi.mock('../utils/features', () => ({
  get CASHBACK_ENABLED() {
    return mocks.features.cashback;
  },
}));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated' };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../utils/idempotency', () => {
  let n = 0;
  return { newIdempotencyKey: () => `key-${++n}` };
});

import WalletPage from './wallet';

const WALLET = {
  walletBalance: 1_250_000,
  coinsBalance: 80_000,
  cashbackPending: 45_000,
  commissionApproved: 520_000,
  commissionPending: 30_000,
  xuConvertMultiplier: 1.2,
  withdrawMin: 100_000,
  withdrawFee: 3_000,
};
const COINS = {
  coinsBalance: 80_000,
  referralCode: 'TUBU1234',
  referralSuccessCount: 2,
  referralEarned: 20_000,
  nextMilestone: { count: 5, bonus: 50_000 },
};
const LOYALTY = { pointsBalance: 48_000, tier: { name: 'Bạc' } };
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
  mocks.getCoins.mockResolvedValue(COINS);
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
});

describe('WalletPage — hiển thị (hành vi giữ nguyên khi chuyển DS v2)', () => {
  it('có đúng một h1 ở mọi trạng thái: đang tải, lỗi, đã tải (C-114)', async () => {
    mocks.getWallet.mockReturnValue(new Promise(() => {}));
    mocks.getCoins.mockReturnValue(new Promise(() => {}));
    mocks.getLoyalty.mockReturnValue(new Promise(() => {}));
    const loading = renderPage();
    expect(loading.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ví Tubu');
    loading.unmount();

    vi.clearAllMocks();
    mocks.getWallet.mockRejectedValue(new Error('boom'));
    mocks.getCoins.mockResolvedValue(COINS);
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

  it('hiện số dư Ví, TubuXu, Điểm Xanh, ba nguồn tiền chờ và sao kê đúng số liệu', async () => {
    stubLoaded();
    renderPage();
    expect(await screen.findByText('Ví Tubu (số dư khả dụng)')).toBeInTheDocument();
    expect(screen.getAllByText('1.250.000đ').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('TubuXu (tiêu trong app)')).toBeInTheDocument();
    expect(screen.getByText('Điểm Xanh (đổi giảm giá)')).toBeInTheDocument();
    expect(screen.getByText('Bạc')).toBeInTheDocument();
    expect(screen.getByText('Hoa hồng chờ duyệt')).toBeInTheDocument();
    expect(screen.getByText('30.000đ')).toBeInTheDocument();
    expect(screen.getByText('Hoa hồng có thể rút')).toBeInTheDocument();
    expect(screen.getByText('520.000đ')).toBeInTheDocument();
    expect(screen.getByText('Hoàn tiền đã duyệt, chờ về Ví')).toBeInTheDocument();
    expect(screen.getByText('45.000đ')).toBeInTheDocument();
    expect(screen.getByText('Mời thêm 3 bạn để nhận 50.000 xu')).toBeInTheDocument();
    expect(screen.getByText('TUBU1234')).toBeInTheDocument();
    expect(await screen.findByText('Hoàn tiền sàn ngoài')).toBeInTheDocument();
    expect(screen.getByText('+50.000đ')).toBeInTheDocument();
    expect(screen.getByText('−100.000đ')).toBeInTheDocument();
    expect(screen.getByText('Số dư 1.200.000đ')).toBeInTheDocument();
  });

  it('chú thích dưới TubuXu: chỉ nói việc còn làm được (mua hàng, góp quỹ trồng cây), không còn "mua nước"/"mua cây"', async () => {
    stubLoaded();
    renderPage();
    await screen.findByText('TubuXu (tiêu trong app)');
    expect(screen.getByText('Dùng để mua hàng và góp quỹ trồng cây 🌳 trong app. Không rút được.')).toBeInTheDocument();
  });

  it('lỗi tải ví KHÔNG hiện 0đ mà báo lỗi kèm Thử lại gọi lại getWallet', async () => {
    mocks.getWallet.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue(WALLET);
    mocks.getCoins.mockResolvedValue(COINS);
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

describe('WalletPage — đổi Ví sang TubuXu', () => {
  it('nhập số tiền → hiện số xu ước tính, gửi đúng số tiền + key rồi báo thành công', async () => {
    stubLoaded();
    mocks.convertToXu.mockResolvedValue({ spent: 100_000, received: 120_000, multiplier: 1.2 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi TubuXu' }));
    expect(await screen.findByText('Đổi Ví → TubuXu')).toBeInTheDocument();
    const go = screen.getByRole('button', { name: 'Đổi ngay' });
    expect(go).toBeDisabled();
    fireEvent.change(inputOf(/Số tiền muốn đổi/), { target: { value: '100000' } });
    expect(screen.getByText(/Nhận ≈/).textContent).toContain('120.000 xu');
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(mocks.convertToXu).toHaveBeenCalledTimes(1));
    expect(mocks.convertToXu.mock.calls[0]![0]).toBe(100_000);
    expect(mocks.convertToXu.mock.calls[0]![1]).toMatch(/^key-/);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã đổi 100.000đ → 120.000 xu 🎉', type: 'success' }),
    );
  });

  it('số tiền vượt số dư → nút Đổi ngay vẫn khoá', async () => {
    stubLoaded();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi TubuXu' }));
    await screen.findByText('Đổi Ví → TubuXu');
    fireEvent.change(inputOf(/Số tiền muốn đổi/), { target: { value: '9999999' } });
    expect(screen.getByRole('button', { name: 'Đổi ngay' })).toBeDisabled();
  });

  it('ví 0đ → báo chưa có số dư và khoá ô nhập', async () => {
    stubLoaded({ ...WALLET, walletBalance: 0 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi TubuXu' }));
    expect(await screen.findByText(/chưa có số dư khả dụng trong Ví Tubu/)).toBeInTheDocument();
    expect(inputOf(/Số tiền muốn đổi/)).toBeDisabled();
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

  it('hai nút hành động trên thẻ Ví cao tối thiểu 44px', async () => {
    stubLoaded();
    renderPage();
    for (const name of ['Đổi TubuXu', 'Rút ngân hàng', 'Chia sẻ']) {
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

  it('cảnh báo trong sheet rút/đổi không dùng emoji làm biểu tượng (⚠️ 🌱 thay bằng Icon)', async () => {
    stubLoaded({ ...WALLET, walletBalance: 0 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Rút ngân hàng' }));
    expect((await screen.findByText(/chưa đủ mốc tối thiểu/)).textContent).not.toMatch(/⚠/);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đổi TubuXu' }));
    expect((await screen.findByText(/chưa có số dư khả dụng/)).textContent).not.toMatch(/🌱/);
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

  it('sheet đổi TubuXu khi ví 0đ không gợi ý kiếm tiền từ hoàn tiền sàn ngoài', async () => {
    stubLoaded({ ...WALLET, walletBalance: 0 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi TubuXu' }));
    const hint = await screen.findByText(/chưa có số dư khả dụng trong Ví Tubu/);
    expect(hint.textContent).not.toMatch(/sàn ngoài/i);
    expect(hint.textContent).toMatch(/hoa hồng/);
  });

  describe('khi bật cờ CASHBACK_ENABLED', () => {
    beforeEach(() => {
      mocks.features.cashback = true;
    });

    it('chú thích và gợi ý nhắc lại hoàn tiền sàn ngoài; thẻ chờ về Ví hiện cả khi 0đ', async () => {
      stubLoaded({ ...WALLET, cashbackPending: 0, walletBalance: 0 });
      renderPage();
      expect((await screen.findByText(/Tiền thật từ hoa hồng/)).textContent).toMatch(/hoàn tiền sàn ngoài/);
      expect(screen.getByText('Hoàn tiền đã duyệt, chờ về Ví')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Đổi TubuXu' }));
      expect((await screen.findByText(/chưa có số dư khả dụng trong Ví Tubu/)).textContent).toMatch(/Hoàn tiền sàn ngoài/);
    });
  });
});
