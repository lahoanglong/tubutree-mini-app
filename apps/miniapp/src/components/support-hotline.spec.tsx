import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchSupportContact: vi.fn(), callPhone: vi.fn() }));
vi.mock('../pages/about-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSupportContact: mocks.fetchSupportContact,
}));
vi.mock('../services/zmp-bridge', () => ({ callPhone: mocks.callPhone }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

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
});
