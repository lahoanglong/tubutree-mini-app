import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasOA: false,
  openOAChat: vi.fn(),
  callPhone: vi.fn(),
  fetchSupportContact: vi.fn(),
  copyText: vi.fn(),
  openSnackbar: vi.fn(),
  navigate: vi.fn(),
  login: vi.fn(),
  authStatus: 'authenticated' as string,
  chatEnabled: false,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({ chat: { enabled: mocks.chatEnabled, hours: { start: '08:00', end: '21:00' } }, isLoaded: true }),
}));
vi.mock('../store/auth', () => {
  const state = () => ({ status: mocks.authStatus, login: mocks.login, restore: vi.fn() });
  return { useAuthStore: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: state }) };
});
vi.mock('../services/zmp-bridge', () => ({
  get hasOA() {
    return mocks.hasOA;
  },
  openOAChat: mocks.openOAChat,
  callPhone: mocks.callPhone,
}));
vi.mock('../pages/about-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSupportContact: mocks.fetchSupportContact,
}));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { SupportContact } from './support-contact';

function renderBlock() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupportContact orderCode="TT001" />
    </QueryClientProvider>,
  );
}

// BUYERMINI-19: khi chưa gắn OA, màn đơn hàng chỉ có một dòng chữ xám "Nhắn Tubu qua Zalo OA" không bấm được.
describe('SupportContact — kênh hỗ trợ trên chi tiết đơn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasOA = false;
    mocks.chatEnabled = false;
    mocks.authStatus = 'authenticated';
    mocks.fetchSupportContact.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null });
    mocks.copyText.mockResolvedValue(true);
  });

  it('chưa có OA: vẫn có nút gọi hotline (gọi đúng số) và email để sao chép', async () => {
    renderBlock();
    fireEvent.click(await screen.findByRole('button', { name: /Gọi hotline 0984 606 774/ }));
    expect(mocks.callPhone).toHaveBeenCalledWith('0984 606 774');
    expect(screen.queryByRole('button', { name: /Zalo OA/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /tubutree@gmail.com/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('tubutree@gmail.com'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
  });

  it('tổng đài số liền 18001234: nút hiện "1800 1234" cho dễ đọc nhưng vẫn gọi đúng số gốc (R5-BUYER-5)', async () => {
    mocks.fetchSupportContact.mockResolvedValue({ hotline: '18001234', email: null, zaloOaName: null });
    renderBlock();
    fireEvent.click(await screen.findByRole('button', { name: 'Gọi hotline 1800 1234' }));
    expect(mocks.callPhone).toHaveBeenCalledWith('18001234');
  });

  it('có OA: nút nhắn Zalo OA kèm mã đơn, hotline vẫn hiện', async () => {
    mocks.hasOA = true;
    renderBlock();
    fireEvent.click(await screen.findByRole('button', { name: /Nhắn Zalo OA/ }));
    expect(mocks.openOAChat).toHaveBeenCalledWith('Hỗ trợ đơn TT001');
    expect(await screen.findByRole('button', { name: /Gọi hotline/ })).toBeInTheDocument();
  });

  it('sao chép không được → báo lỗi thay vì báo thành công', async () => {
    mocks.copyText.mockResolvedValue(false);
    renderBlock();
    fireEvent.click(await screen.findByRole('button', { name: /tubutree@gmail.com/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
  });

  it('admin để trống hết và không có OA → ẩn cả khối, không hiện dòng chữ cụt', async () => {
    mocks.fetchSupportContact.mockResolvedValue({ hotline: null, email: null, zaloOaName: null });
    const { container } = renderBlock();
    await waitFor(() => expect(mocks.fetchSupportContact).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toBe('');
  });

  it('không đọc được cấu hình → rơi về hotline/email mặc định của Tubu', async () => {
    mocks.fetchSupportContact.mockRejectedValue(new Error('mạng'));
    renderBlock();
    expect(await screen.findByRole('button', { name: /Gọi hotline 0984 606 774/ })).toBeInTheDocument();
  });

  describe('chat với Tubu Tree', () => {
    it('chat bật và đã đăng nhập: nút "Chat với Tubu Tree" mở /chat?order=<mã đơn>, không còn nút OA', async () => {
      mocks.chatEnabled = true;
      mocks.hasOA = true;
      renderBlock();
      fireEvent.click(await screen.findByRole('button', { name: /Chat với Tubu Tree/ }));
      expect(mocks.navigate).toHaveBeenCalledWith('/chat?order=TT001');
      expect(screen.queryByRole('button', { name: /Zalo OA/ })).toBeNull();
      expect(await screen.findByRole('button', { name: /Gọi hotline/ })).toBeInTheDocument();
    });

    it('chat tắt: giữ nút OA và hotline như cũ, không có nút chat', async () => {
      mocks.hasOA = true;
      renderBlock();
      expect(await screen.findByRole('button', { name: /Nhắn Zalo OA/ })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Gọi hotline/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Chat với Tubu Tree/ })).toBeNull();
    });

    it('chat bật nhưng chưa đăng nhập: giữ OA và hotline, thêm lời mời đăng nhập', async () => {
      mocks.chatEnabled = true;
      mocks.hasOA = true;
      mocks.authStatus = 'idle';
      renderBlock();
      expect(await screen.findByRole('button', { name: /Nhắn Zalo OA/ })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Gọi hotline/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập để chat với Tubu Tree' }));
      expect(mocks.login).toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /^Chat với Tubu Tree/ })).toBeNull();
    });

    it('đang khôi phục phiên: không hiện lời mời đăng nhập hay nút chat, chỉ OA và hotline', async () => {
      mocks.chatEnabled = true;
      mocks.hasOA = true;
      mocks.authStatus = 'loading';
      renderBlock();
      expect(await screen.findByRole('button', { name: /Nhắn Zalo OA/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /chat với Tubu Tree/i })).toBeNull();
    });
  });
});
