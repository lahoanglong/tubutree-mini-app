import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchSupportContact: vi.fn(), callPhone: vi.fn(), haptic: vi.fn() }));
vi.mock('../pages/about-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSupportContact: mocks.fetchSupportContact,
}));
vi.mock('../services/zmp-bridge', () => ({ callPhone: mocks.callPhone }));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));

import { SupportHotline } from './support-hotline';

const renderLine = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SupportHotline />
    </QueryClientProvider>,
  );

describe('SupportHotline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchSupportContact.mockResolvedValue({ hotline: '0984606774', email: null, zaloOaName: null, hours: null });
  });

  it('"Gọi <số>" là một khối không ngắt dòng, để số không tách khỏi chữ "Gọi" ở màn 375px', async () => {
    renderLine();
    const call = await screen.findByRole('button', { name: /Gọi 0984 606 774/ });
    expect(call).toHaveStyle({ whiteSpace: 'nowrap' });
    expect(screen.getByText('Cần hỗ trợ?')).toBeInTheDocument();
  });

  it('không có QueryClientProvider thì ẩn dòng này, không vỡ màn lỗi', () => {
    const { container } = render(<SupportHotline />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lỗi đọc cấu hình vẫn còn số mặc định', async () => {
    mocks.fetchSupportContact.mockRejectedValue(new Error('mạng'));
    renderLine();
    await waitFor(() => expect(screen.getByRole('button', { name: /Gọi 0984 606 774/ })).toBeInTheDocument());
  });

  it('số hotline dùng số đều (tabular-nums) và vẫn không ngắt dòng', async () => {
    renderLine();
    const call = await screen.findByRole('button', { name: /Gọi 0984 606 774/ });
    expect(call.style.fontVariantNumeric).toBe('tabular-nums');
    expect(call.style.whiteSpace).toBe('nowrap');
  });

  it('admin để trống hotline: ẩn cả dòng, không có chữ "Cần hỗ trợ?" lẻ loi', async () => {
    mocks.fetchSupportContact.mockResolvedValue({ hotline: null, email: null, zaloOaName: null, hours: null });
    const { container } = renderLine();
    await waitFor(() => expect(mocks.fetchSupportContact).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('chạm "Gọi": rung nhẹ rồi gọi đúng số gốc', async () => {
    renderLine();
    fireEvent.click(await screen.findByRole('button', { name: /Gọi 0984 606 774/ }));
    expect(mocks.haptic).toHaveBeenCalledWith('light');
    expect(mocks.callPhone).toHaveBeenCalledWith('0984606774');
  });

  it('hai cú chạm cùng nhịp khi cuộc gọi còn treo: chỉ gọi và rung một lần; xong thì chạm lại được', async () => {
    let finish!: () => void;
    mocks.callPhone.mockReturnValueOnce(new Promise<void>((r) => (finish = r)));
    renderLine();
    const call = await screen.findByRole('button', { name: /Gọi 0984 606 774/ });
    await act(async () => {
      fireEvent.click(call);
      fireEvent.click(call);
    });
    expect(mocks.callPhone).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    fireEvent.click(call);
    expect(mocks.callPhone).toHaveBeenCalledTimes(2);
  });
});
