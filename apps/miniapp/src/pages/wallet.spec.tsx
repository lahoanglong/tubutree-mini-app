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
  shareLink: vi.fn(),
  copyText: vi.fn(),
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
}));
vi.mock('../services/zmp-bridge', () => ({ shareLink: mocks.shareLink }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
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

function stubLoaded(wallet: object = WALLET, firstPage: object = TXN_PAGE_1) {
  mocks.getWallet.mockResolvedValue(wallet);
  mocks.getReferral.mockResolvedValue(REFERRAL);
  mocks.getLoyalty.mockResolvedValue(LOYALTY);
  mocks.getWalletTransactions.mockImplementation((page: number) => Promise.resolve(page === 1 ? firstPage : TXN_PAGE_2));
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
    mocks.getWalletTransactions.mockResolvedValue(TXN_PAGE_1);
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
    expect(screen.getByText('Hoa hồng có thể chuyển vào Ví')).toBeInTheDocument();
    expect(screen.getByText('520.000đ')).toBeInTheDocument();
    expect(screen.getByText('Hoàn tiền đã duyệt, chờ về Ví')).toBeInTheDocument();
    expect(screen.getByText('45.000đ')).toBeInTheDocument();
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
  it('thẻ Điểm Xanh mở /loyalty; "Chuyển vào Ví" mở /affiliate khi hoa hồng đã duyệt > 0', async () => {
    stubLoaded();
    renderPage();
    fireEvent.click(await screen.findByText('Điểm Xanh (đổi giảm giá)'));
    expect(mocks.navigate).toHaveBeenCalledWith('/loyalty');
    fireEvent.click(screen.getByText('Hoa hồng có thể chuyển vào Ví'));
    expect(mocks.navigate).toHaveBeenCalledWith('/affiliate');
  });

  it('hoa hồng đã duyệt = 0 → thẻ không bấm được, không có gợi ý "Chuyển vào Ví"', async () => {
    stubLoaded({ ...WALLET, commissionApproved: 0 });
    renderPage();
    await screen.findByText('Hoa hồng có thể chuyển vào Ví');
    expect(screen.queryByText(/Chuyển vào Ví/)).toBeNull();
    fireEvent.click(screen.getByText('Hoa hồng có thể chuyển vào Ví'));
    expect(mocks.navigate).not.toHaveBeenCalledWith('/affiliate');
  });

});

describe('WalletPage — số Điểm Xanh không gãy dòng (D6-11)', () => {
  it('số điểm không xuống dòng và hạng thành viên nằm dưới số, không chen vào hàng làm cột số hẹp lại', async () => {
    stubLoaded();
    renderPage();
    const points = await screen.findByText('50.000 điểm');
    expect(points.style.whiteSpace).toBe('nowrap');
    const column = points.parentElement as HTMLElement;
    expect(column.contains(screen.getByText('Bạc'))).toBe(true);
    expect(column.style.minWidth).toBe('0px');
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

  it('Mời bạn nằm ở trang Cá nhân, không còn trong Ví: Ví không hiện khối mời bạn và không gọi /me/referral', async () => {
    stubLoaded();
    renderPage();
    await screen.findByText('Ví Tubu (số dư khả dụng)');
    expect(mocks.getReferral).not.toHaveBeenCalled();
    expect(screen.queryByText('Mời bạn — nhận Điểm Xanh')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chia sẻ' })).toBeNull();
  });

  it('Ví 0đ và chưa có biến động: nói tiền vào Ví từ đâu, không lặp thêm khối Mẹo', async () => {
    stubLoaded({ ...WALLET, walletBalance: 0 }, { data: [], meta: { page: 1, limit: 20, total: 0 } });
    renderPage();
    const note = await screen.findByText('Tiền hoàn đơn và hoa hồng CTV sẽ vào Ví Tubu. Ví dùng để trả đơn hàng.');
    expect(note.textContent).not.toMatch(/rút|ngân hàng/i);
    expect(screen.queryByText(/Mẹo:/)).toBeNull();
  });

  it('Ví 0đ nhưng đã có biến động: giữ chú thích cũ và khối Mẹo', async () => {
    stubLoaded({ ...WALLET, walletBalance: 0 });
    renderPage();
    expect(await screen.findByText(/Mẹo:/)).toBeInTheDocument();
    expect(screen.queryByText(/sẽ vào Ví Tubu\. Ví dùng để trả đơn hàng/)).toBeNull();
  });

  it('mẹo dưới ví nói đúng việc Ví làm được: trả đơn, không nhắc rút ra ngân hàng', async () => {
    stubLoaded();
    renderPage();
    const tip = await screen.findByText(/Mẹo:/);
    expect(tip.textContent).toMatch(/trả đơn sau/);
    expect(tip.textContent).not.toMatch(/rút|ngân hàng|3\.000đ/i);
  });

  it('không còn nút hay sheet rút về ngân hàng (chính sách Zalo 4.5)', async () => {
    stubLoaded();
    renderPage();
    await screen.findByText('Ví Tubu (số dư khả dụng)');
    expect(screen.queryByRole('button', { name: /Rút/ })).toBeNull();
    expect(screen.queryByText(/ngân hàng/i, { selector: 'button, a, label' })).toBeNull();
  });

});

describe('WalletPage — vùng chạm >= 44px, nhãn form và biểu tượng (C-076, C-113)', () => {
  it('thẻ Điểm Xanh bấm được bằng bàn phím (role=button, Enter mở /loyalty)', async () => {
    stubLoaded();
    renderPage();
    const row = (await screen.findByText('Điểm Xanh (đổi giảm giá)')).closest('[role="button"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    fireEvent.keyDown(row!, { key: 'Enter' });
    expect(mocks.navigate).toHaveBeenCalledWith('/loyalty');
    expect(within(row!).getByText('Bạc')).toBeInTheDocument();
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

describe('WalletPage — khách thường (R6-BUYER-13)', () => {
  const PLAIN_WALLET = { ...WALLET, commissionApproved: 0, commissionPending: 0, cashbackPending: 0 };
  const REFUND_TXNS = {
    data: [
      { id: 'r1', delta: 40_000, balanceAfter: 90_000, type: 'ORDER_REFUND', reason: 'Hoàn tiền trả hàng đơn TT001', orderId: null, createdAt: '2026-10-05T07:04:00' },
      { id: 'r2', delta: 50_000, balanceAfter: 50_000, type: 'ORDER_REFUND', reason: 'Hoàn tiền đơn TT002', orderId: 'o2', createdAt: '2026-10-04T07:04:00' },
      { id: 'r3', delta: -20_000, balanceAfter: 0, type: 'ORDER_PAY', reason: 'Thanh toán đơn TT003', orderId: 'o3', createdAt: '2026-10-03T07:04:00' },
    ],
    meta: { page: 1, limit: 20, total: 3 },
  };

  it('không phải CTV và chưa có hoa hồng: ẩn hai thẻ hoa hồng, mô tả nói về thanh toán đơn', async () => {
    stubLoaded(PLAIN_WALLET, REFUND_TXNS);
    renderPage();
    expect(await screen.findByText('Dùng để trả tiền hàng ở bước thanh toán')).toBeInTheDocument();
    expect(screen.queryByText('Hoa hồng chờ duyệt')).toBeNull();
    expect(screen.queryByText('Hoa hồng có thể chuyển vào Ví')).toBeNull();
    expect(screen.queryByText(/Tiền thật từ hoa hồng/)).toBeNull();
  });

  it('CTV hoặc đại lý vẫn thấy khối hoa hồng dù đang 0đ', async () => {
    for (const role of ['AFFILIATE', 'DEALER']) {
      mocks.role = role;
      stubLoaded(PLAIN_WALLET, REFUND_TXNS);
      const view = renderPage();
      expect(await screen.findByText('Hoa hồng chờ duyệt')).toBeInTheDocument();
      expect(screen.getByText('Hoa hồng có thể chuyển vào Ví')).toBeInTheDocument();
      view.unmount();
    }
  });

  it('lịch sử đặt tiêu đề theo nguồn chắc chắn: trả hàng một phần, thanh toán đơn; hoàn còn lại giữ "Hoàn tiền đơn hàng"', async () => {
    stubLoaded(PLAIN_WALLET, REFUND_TXNS);
    renderPage();
    expect(await screen.findByText('Hoàn tiền trả hàng')).toBeInTheDocument();
    expect(screen.queryByText('Hoàn tiền huỷ đơn')).toBeNull();
    expect(screen.getByText('Hoàn tiền đơn hàng')).toBeInTheDocument();
    expect(screen.getByText('Thanh toán đơn')).toBeInTheDocument();
  });
});
