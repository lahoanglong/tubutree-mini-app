import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  getPublicConfig: vi.fn(),
  requestAccountDeletion: vi.fn(),
  getWallet: vi.fn(),
  logout: vi.fn(),
  openSnackbar: vi.fn(),
  callPhone: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div>{children}</div> : null),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/about', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/api', () => ({ api: { get: mocks.apiGet }, getErrorMessage: () => 'lỗi', getLoadErrorMessage: () => 'lỗi' }));
vi.mock('../services/shop-api', () => ({ getPublicConfig: mocks.getPublicConfig }));
vi.mock('../services/account-api', () => ({ requestAccountDeletion: mocks.requestAccountDeletion, getWallet: mocks.getWallet }));
vi.mock('../services/zmp-bridge', () => ({ hasOA: false, openOAChat: vi.fn(), callPhone: mocks.callPhone, openExternal: mocks.openExternal }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ logout: mocks.logout }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import AboutPage from './about';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AboutPage /></QueryClientProvider>);
}

const SUPPORT = { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null };

describe('Trang Về Tubu Tree (C-019)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicConfig.mockResolvedValue({ freeshipThreshold: 200000, support: SUPPORT });
    mocks.apiGet.mockImplementation(async (url: string) => {
      if (url === '/faqs') {
        return { data: [{ id: 'f1', category: 'Vận chuyển', question: 'Bao lâu thì nhận hàng?', answer: '2-4 ngày.' }] };
      }
      throw new Error(`unexpected ${url}`);
    });
  });

  it('hotline/email lấy từ cấu hình, không còn số mẫu 1900 1234; chưa có Zalo OA thì ẩn dòng', async () => {
    renderPage();
    expect(await screen.findByText('0984 606 774')).toBeInTheDocument();
    expect(screen.getByText('tubutree@gmail.com')).toBeInTheDocument();
    expect(screen.queryByText('Zalo OA')).toBeNull();
    expect(document.body.textContent).not.toMatch(/1900 1234|hotro@tubutree\.com/);
  });

  it('FAQ hiển thị từ FAQ admin (GET /faqs), nhóm lọc theo danh mục admin', async () => {
    renderPage();
    expect(await screen.findByText('Bao lâu thì nhận hàng?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vận chuyển' })).toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledWith('/faqs');
    expect(screen.queryByText('Tubu Tree bán những gì?')).toBeNull();
  });

  it('admin chưa nhập FAQ → dùng bản dự phòng, câu thanh toán không còn ZaloPay', async () => {
    mocks.apiGet.mockResolvedValue({ data: [] });
    renderPage();
    expect(await screen.findByText('Tubu Tree bán những gì?')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ZaloPay');
  });

  // D5-10: bản dự phòng đọc số từ cấu hình công khai, không còn "10.000đ", "20%", "12 tháng", "7 ngày" viết cứng.
  it('FAQ dự phòng: câu Điểm Xanh và đổi/trả nói đúng số trong cấu hình admin đặt', async () => {
    mocks.apiGet.mockResolvedValue({ data: [] });
    mocks.getPublicConfig.mockResolvedValue({
      support: SUPPORT,
      loyalty: { earnPct: 3, vndPerPoint: 33, vndPerPointRedeem: 1_000, maxRedeemPct: 0.3, pointExpireMonths: 6 },
      returnWindowDays: 14,
    });
    renderPage();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /Điểm Xanh là gì/ }));
    expect(await screen.findByText(/Mỗi đơn đã giao tích 3% tiền hàng thành Điểm Xanh\. 1 Điểm Xanh đổi 1\.000đ khi thanh toán, tối đa 30% giá trị đơn\. Điểm có hạn 6 tháng\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Chính sách đổi\/trả/ }));
    expect(await screen.findByText(/trong vòng 14 ngày từ khi nhận/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/10\.000đ|tối đa 20%|12 tháng|7 ngày/);
  });

  it('FAQ dự phòng khi cấu hình không có số: không hiện con số mặc định thay cho số thật', async () => {
    mocks.apiGet.mockResolvedValue({ data: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Điểm Xanh là gì/ }));
    expect(await screen.findByText(/Mỗi đơn đã giao được tích Điểm Xanh\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/10\.000đ|tối đa 20%|12 tháng/);
  });

  it('admin để trống hết liên hệ → ẩn cả khối Hỗ trợ', async () => {
    mocks.getPublicConfig.mockResolvedValue({ support: { hotline: null, email: null, zaloOaName: null } });
    renderPage();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    await screen.findByText('Câu hỏi thường gặp');
    expect(screen.queryByText('Hỗ trợ khách hàng')).toBeNull();
  });
});

describe('Liên hệ hỗ trợ (Q-17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockResolvedValue({ data: [] });
  });

  it('có tên Zalo OA thì hiện dòng Zalo OA giữa Hotline và Email', async () => {
    mocks.getPublicConfig.mockResolvedValue({ support: { ...SUPPORT, zaloOaName: 'Tubu Tree OA' } });
    renderPage();
    expect(await screen.findByText('Tubu Tree OA')).toBeInTheDocument();
    expect(screen.getAllByText(/^(Hotline|Zalo OA|Email)$/).map((n) => n.textContent)).toEqual(['Hotline', 'Zalo OA', 'Email']);
  });

  it('chỉ có email thì chỉ hiện dòng Email (dòng chưa có giá trị thì ẩn)', async () => {
    mocks.getPublicConfig.mockResolvedValue({ support: { hotline: null, email: 'tubutree@gmail.com', zaloOaName: null } });
    renderPage();
    expect(await screen.findByText('tubutree@gmail.com')).toBeInTheDocument();
    expect(screen.queryByText('Hotline')).toBeNull();
    expect(screen.queryByText('Zalo OA')).toBeNull();
  });

  it('hotline toàn khoảng trắng từ cấu hình không để lại dòng Hotline trống', async () => {
    mocks.getPublicConfig.mockResolvedValue({ support: { hotline: '   ', email: 'tubutree@gmail.com', zaloOaName: null } });
    renderPage();
    await screen.findByText('tubutree@gmail.com');
    expect(screen.queryByText('Hotline')).toBeNull();
  });
});

describe('Liên hệ hỗ trợ khi /config/public lỗi và gọi hotline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockResolvedValue({ data: [] });
  });

  it('/config/public lỗi → vẫn hiện hotline và email mặc định Q-17', async () => {
    mocks.getPublicConfig.mockRejectedValue(new Error('429'));
    renderPage();
    expect(await screen.findByText('Hỗ trợ khách hàng')).toBeInTheDocument();
    expect(screen.getByText('0984 606 774')).toBeInTheDocument();
    expect(screen.getByText('tubutree@gmail.com')).toBeInTheDocument();
    expect(screen.queryByText('Zalo OA')).toBeNull();
  });

  it('chạm dòng Hotline mở cuộc gọi, vùng chạm >= 44px', async () => {
    mocks.getPublicConfig.mockResolvedValue({ support: SUPPORT });
    renderPage();
    const btn = await screen.findByRole('button', { name: /Hotline/ });
    expect(btn.style.minHeight).toBe('44px');
    fireEvent.click(btn);
    expect(mocks.callPhone).toHaveBeenCalledWith('0984 606 774');
  });
});

describe('Trang Về Tubu Tree — DS v2 (C-076, C-114)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicConfig.mockResolvedValue({ support: SUPPORT });
    mocks.apiGet.mockResolvedValue({
      data: [
        { id: 'f1', category: 'Vận chuyển', question: 'Bao lâu thì nhận hàng?', answer: '2-4 ngày.' },
        { id: 'f2', category: 'Vận chuyển', question: 'Phí ship bao nhiêu?', answer: 'Miễn phí từ 200k.' },
        { id: 'f3', category: 'Đổi trả', question: 'Đổi hàng thế nào?', answer: 'Trong 7 ngày.' },
      ],
    });
    mocks.requestAccountDeletion.mockResolvedValue({ message: 'Đã ghi nhận yêu cầu' });
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
  });

  it('đúng một h1 "Về Tubu Tree"; các khối nội dung là h2', async () => {
    renderPage();
    await screen.findByText('Bao lâu thì nhận hàng?');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Về Tubu Tree']);
    const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(expect.arrayContaining(['Sống Xanh An Lành', 'Câu hỏi thường gặp', 'Hỗ trợ khách hàng', 'Điều khoản & Chính sách']));
  });

  it('câu hỏi là nút có aria-expanded: câu đầu mở sẵn, mở câu khác thì câu cũ gập', async () => {
    renderPage();
    const q1 = await screen.findByRole('button', { name: /Bao lâu thì nhận hàng\?/ });
    const q2 = screen.getByRole('button', { name: /Phí ship bao nhiêu\?/ });
    expect(q1).toHaveAttribute('aria-expanded', 'true');
    expect(q2).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('2-4 ngày.')).toBeInTheDocument();
    expect(screen.queryByText('Miễn phí từ 200k.')).toBeNull();
    fireEvent.click(q2);
    expect(q2).toHaveAttribute('aria-expanded', 'true');
    expect(q1).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Miễn phí từ 200k.')).toBeInTheDocument();
    fireEvent.click(q2);
    expect(q2).toHaveAttribute('aria-expanded', 'false');
  });

  it('chọn nhóm lọc → chỉ còn câu hỏi của nhóm và gập hết câu đang mở', async () => {
    renderPage();
    await screen.findByText('Bao lâu thì nhận hàng?');
    const chip = screen.getByRole('button', { name: 'Đổi trả' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Bao lâu thì nhận hàng?')).toBeNull();
    expect(screen.getByRole('button', { name: /Đổi hàng thế nào\?/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('dòng chính sách mở nội dung ngay trong app, "Đã hiểu" đóng lại', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Chính sách đổi trả/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Chính sách đổi trả' })).toBeInTheDocument();
    await screen.findByText(/Thời hạn đổi trả/);
    fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    await waitFor(() => expect(screen.queryByText(/Thời hạn đổi trả/)).toBeNull());
  });

  it('chưa duyệt: bản nháp đọc số ngày từ vars của endpoint, có biển BẢN NHÁP (D8-4)', async () => {
    mocks.apiGet.mockImplementation(async (url: string) =>
      url === '/config/legal/doi-tra' ? { data: { content: null, vars: { returnWindowDays: 14, legalName: 'Công ty Tubu' } } } : { data: [] },
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Chính sách đổi trả/ }));
    expect(await screen.findByTestId('legal-draft-banner')).toHaveTextContent('BẢN NHÁP — chờ Tubu Tree duyệt');
    const body = screen.getByTestId('legal-markdown');
    expect(body.textContent).toContain('trong vòng 14 ngày');
    expect(body.textContent).toContain('Đơn vị vận hành: Công ty Tubu');
    expect(body.textContent).toContain('hư hỏng, đổ vỡ');
    expect(body.textContent).toContain('Tubu Tree chịu phí vận chuyển đổi trả');
  });

  it('bản nháp đổi trả nói đúng kênh hoàn: Ví Tubu hoặc tài khoản ngân hàng khách chọn (D8-4)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Chính sách đổi trả/ }));
    expect((await screen.findByTestId('legal-markdown')).textContent).toMatch(/Ví Tubu hoặc tài khoản ngân hàng/);
  });

  it('Xoá tài khoản: bấm → hỏi lại → "Gửi yêu cầu xoá" gọi API đúng một lần, "Huỷ" quay về', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá tài khoản' }));
    expect(screen.getByText('Xoá tài khoản vĩnh viễn?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByText('Xoá tài khoản vĩnh viễn?')).toBeNull();
    expect(mocks.requestAccountDeletion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Xoá tài khoản' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' }));
    await waitFor(() => expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã ghi nhận yêu cầu', type: 'info' }));
    await waitFor(() => expect(screen.queryByText('Xoá tài khoản vĩnh viễn?')).toBeNull());
    expect(mocks.requestAccountDeletion).toHaveBeenCalledWith(undefined, undefined);
  });

  it('Ví còn tiền: hiện số dư mất, nút gửi bị khoá tới khi tick đồng ý, rồi gửi kèm đúng số dư đã thấy', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: 20000 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá tài khoản' }));
    expect(await screen.findByText('Ví Tubu còn 20.000đ. Xoá tài khoản thì số dư này mất và không hoàn lại.')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Gửi yêu cầu xoá' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Tôi đồng ý bỏ số dư Ví Tubu/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' }));
    await waitFor(() => expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1));
    expect(mocks.requestAccountDeletion).toHaveBeenCalledWith(undefined, { acknowledgedWalletBalance: 20000, acceptWalletForfeit: true });
  });

  it('máy chủ từ chối vì số dư đã đổi: bỏ tick, tải lại số dư, khách phải đồng ý lại với số mới', async () => {
    mocks.getWallet.mockResolvedValueOnce({ walletBalance: 20000 }).mockResolvedValue({ walletBalance: 30000 });
    mocks.requestAccountDeletion.mockRejectedValueOnce(new Error('đổi'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá tài khoản' }));
    await screen.findByText(/Ví Tubu còn 20\.000đ/);
    fireEvent.click(screen.getByRole('checkbox', { name: /Tôi đồng ý bỏ số dư Ví Tubu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gửi yêu cầu xoá' }));
    expect(await screen.findByText(/Ví Tubu còn 30\.000đ/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' })).toBeDisabled());
    expect(screen.getByRole('checkbox', { name: /Tôi đồng ý bỏ số dư Ví Tubu/ })).not.toBeChecked();
  });

  it('chưa biết số dư (tải lỗi): không cho gửi', async () => {
    mocks.getWallet.mockRejectedValue(new Error('mạng'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá tài khoản' }));
    expect(await screen.findByText('Chưa tải được số dư Ví Tubu. Bạn thử lại sau khi tải xong.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' })).toBeDisabled();
  });

  it('nút Đăng xuất gọi logout', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('đang tải FAQ: chưa hiện bản dự phòng (tránh nháy sang nội dung khác)', async () => {
    mocks.apiGet.mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith('/faqs'));
    expect(screen.queryByText('Tubu Tree bán những gì?')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Câu hỏi thường gặp' })).toBeInTheDocument();
  });
});

describe('Điều khoản & Chính sách hiện trong app, không mở web (Zalo 4.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicConfig.mockResolvedValue({ support: SUPPORT });
    mocks.apiGet.mockResolvedValue({ data: [] });
  });

  it.each([
    ['Điều khoản sử dụng', 'dieu-khoan'],
    ['Chính sách bảo mật', 'bao-mat'],
    ['Chính sách đổi trả', 'doi-tra'],
    ['Chính sách vận chuyển', 'van-chuyen'],
  ])('"%s": sheet gọi /config/legal/%s, hiện nội dung đã duyệt, không có nút mở web', async (label, slug) => {
    mocks.apiGet.mockImplementation(async (url: string) => {
      if (url === `/config/legal/${slug}`) return { data: { content: `## Mục 1\nNội dung đã duyệt của ${slug}` } };
      return { data: [] };
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(label) }));
    expect(await screen.findByText(`Nội dung đã duyệt của ${slug}`)).toBeInTheDocument();
    expect(screen.getByText('Mục 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trên web/ })).toBeNull();
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('admin chưa nhập nội dung: hiện bản nháp đầy đủ kèm biển BẢN NHÁP', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Chính sách vận chuyển/ }));
    expect(await screen.findByTestId('legal-draft-banner')).toBeInTheDocument();
    expect(screen.getByText('1. Phạm vi giao hàng')).toBeInTheDocument();
  });

  it('liên kết nội bộ /chinh-sach/<loại> trong bản nháp mở popup chính sách đó, không mở web', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Điều khoản sử dụng/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chính sách vận chuyển' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Chính sách vận chuyển' })).toBeInTheDocument();
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('đang tải hiện khung chờ', async () => {
    mocks.apiGet.mockImplementation((url: string) =>
      url.startsWith('/config/legal/') ? new Promise(() => {}) : Promise.resolve({ data: [] }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Điều khoản sử dụng/ }));
    expect(await screen.findByTestId('policy-loading')).toBeInTheDocument();
  });

  it('lỗi mạng: báo lỗi và có nút Thử lại', async () => {
    mocks.apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/config/legal/')) throw new Error('x');
      return { data: [] };
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Điều khoản sử dụng/ }));
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('nút "Đã hiểu" đóng sheet và không mở web', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Điều khoản sử dụng/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Đã hiểu' }));
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });
});

describe('Đơn vị vận hành trên trang Về Tubu Tree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockResolvedValue({ data: [] });
  });

  it('chưa nhập thì không có dòng vận hành và không có link Bộ Công Thương', async () => {
    mocks.getPublicConfig.mockResolvedValue({ support: SUPPORT, company: { legalName: null, taxCode: null, address: null, bctNoticeUrl: null } });
    renderPage();
    await screen.findByText('Điều khoản & Chính sách');
    expect(document.body.textContent).not.toContain('Đơn vị vận hành');
    expect(screen.queryByText('Đã thông báo Bộ Công Thương')).toBeNull();
  });

  it('có thông tin thì hiện đúng một dòng "Đơn vị vận hành: tên · MST mã · địa chỉ"', async () => {
    mocks.getPublicConfig.mockResolvedValue({ support: SUPPORT, company: { legalName: 'Công ty TNHH Tubu', taxCode: '0312345678', address: '1 Đường A, Quận B', bctNoticeUrl: null } });
    renderPage();
    expect(await screen.findByText('Đơn vị vận hành: Công ty TNHH Tubu · MST 0312345678 · 1 Đường A, Quận B')).toBeInTheDocument();
  });

  it('ẩn phần còn trống; Bộ Công Thương chỉ là chữ, không bấm được và không mở link', async () => {
    mocks.getPublicConfig.mockResolvedValue({ support: SUPPORT, company: { legalName: null, taxCode: '0312345678', address: null, bctNoticeUrl: 'https://online.gov.vn/x' } });
    renderPage();
    expect(await screen.findByText('Đơn vị vận hành: MST 0312345678')).toBeInTheDocument();
    const bct = screen.getByText('Đã thông báo Bộ Công Thương');
    expect(bct.closest('a, button, [role="button"]')).toBeNull();
    fireEvent.click(bct);
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });
});

