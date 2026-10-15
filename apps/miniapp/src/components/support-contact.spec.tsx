import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasOA: false,
  openOAChat: vi.fn(),
  callPhone: vi.fn(),
  fetchSupportContact: vi.fn(),
  copyText: vi.fn(),
  openSnackbar: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
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
    mocks.fetchSupportContact.mockResolvedValue({ hotline: '0899 149 229', email: 'tubutree@gmail.com', zaloOaName: null });
    mocks.copyText.mockResolvedValue(true);
  });

  it('chưa có OA: vẫn có nút gọi hotline (gọi đúng số) và email để sao chép', async () => {
    renderBlock();
    fireEvent.click(await screen.findByRole('button', { name: /Gọi hotline 0899 149 229/ }));
    expect(mocks.callPhone).toHaveBeenCalledWith('0899 149 229');
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
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });

  it('không đọc được cấu hình → rơi về hotline/email mặc định của Tubu', async () => {
    mocks.fetchSupportContact.mockRejectedValue(new Error('mạng'));
    renderBlock();
    expect(await screen.findByRole('button', { name: /Gọi hotline 0899 149 229/ })).toBeInTheDocument();
  });
});
