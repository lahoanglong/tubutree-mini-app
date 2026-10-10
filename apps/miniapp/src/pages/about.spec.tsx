import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), getPublicConfig: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div>{children}</div> : null),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/api', () => ({ api: { get: mocks.apiGet }, getErrorMessage: () => 'lỗi' }));
vi.mock('../services/shop-api', () => ({ getPublicConfig: mocks.getPublicConfig }));
vi.mock('../services/account-api', () => ({ requestAccountDeletion: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({ hasOA: false, openOAChat: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ logout: vi.fn() }) }));
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
