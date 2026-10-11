import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  getPublicConfig: vi.fn(),
  requestAccountDeletion: vi.fn(),
  logout: vi.fn(),
  openSnackbar: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div>{children}</div> : null),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/about', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/api', () => ({ api: { get: mocks.apiGet }, getErrorMessage: () => 'lỗi' }));
vi.mock('../services/shop-api', () => ({ getPublicConfig: mocks.getPublicConfig }));
vi.mock('../services/account-api', () => ({ requestAccountDeletion: mocks.requestAccountDeletion }));
vi.mock('../services/zmp-bridge', () => ({ hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ logout: mocks.logout }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import AboutPage from './about';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AboutPage /></QueryClientProvider>);
}

const SUPPORT = { hotline: '0899 149 229', email: 'tubutree@gmail.com', zaloOaName: null };

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
    expect(await screen.findByText('0899 149 229')).toBeInTheDocument();
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
    const row = await screen.findByRole('button', { name: /Chính sách đổi trả/ });
    fireEvent.click(row);
    expect(await screen.findByRole('heading', { level: 2, name: 'Chính sách đổi trả' })).toBeInTheDocument();
    expect(screen.getByText(/Đổi\/trả áp dụng trong 7 ngày/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    await waitFor(() => expect(screen.queryByText(/Đổi\/trả áp dụng trong 7 ngày/)).toBeNull());
  });

  it('Xóa tài khoản: bấm → hỏi lại → "Gửi yêu cầu xóa" gọi API đúng một lần, "Hủy" quay về', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa tài khoản' }));
    expect(screen.getByText('Xóa tài khoản vĩnh viễn?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByText('Xóa tài khoản vĩnh viễn?')).toBeNull();
    expect(mocks.requestAccountDeletion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Xóa tài khoản' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu xóa' }));
    await waitFor(() => expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã ghi nhận yêu cầu', type: 'info' }));
    await waitFor(() => expect(screen.queryByText('Xóa tài khoản vĩnh viễn?')).toBeNull());
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
