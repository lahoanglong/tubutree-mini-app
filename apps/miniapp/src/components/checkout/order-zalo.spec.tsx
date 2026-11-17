import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openWebview: vi.fn(),
  copyText: vi.fn(),
  notify: vi.fn(),
  trackEvent: vi.fn(),
  cfg: { orderZaloEnabled: true as boolean, tubuZaloPhone: '0899149229' as string | undefined },
}));

vi.mock('zmp-sdk/apis', () => ({ openWebview: mocks.openWebview }));
vi.mock('../../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../../services/analytics', () => ({ trackEvent: mocks.trackEvent }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));

import { OrderZaloFriend } from './order-zalo';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cfg.orderZaloEnabled = true;
  mocks.cfg.tubuZaloPhone = '0899149229';
});

describe('OrderZaloFriend', () => {
  it('câu mời có mã đơn; chạm "Mở Zalo Tubu Tree" mở zalo.me/<số> và đo nguồn bấm', async () => {
    mocks.openWebview.mockResolvedValue(undefined);
    wrap(<OrderZaloFriend code="TUBU2026111557909" from="success" />);
    expect(screen.getByText('Kết bạn Zalo với Tubu Tree để nhận hành trình đơn TUBU2026111557909.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mở Zalo Tubu Tree' }));
    await waitFor(() => expect(mocks.openWebview).toHaveBeenCalledWith({ url: 'https://zalo.me/0899149229' }));
    expect(mocks.trackEvent).toHaveBeenCalledWith('order_zalo_friend_click', 'miniapp', { from: 'success' });
    expect(screen.queryByRole('button', { name: 'Chép số' })).toBeNull();
  });

  it('Zalo chặn mở liên kết: hiện số để khách tự tìm, nút "Chép số" chép đúng số', async () => {
    mocks.openWebview.mockRejectedValue(new Error('blocked'));
    mocks.copyText.mockResolvedValue(true);
    wrap(<OrderZaloFriend code="TT001" from="order_detail" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở Zalo Tubu Tree' }));
    const copy = await screen.findByRole('button', { name: 'Chép số' });
    expect(screen.getByText(/0899149229/)).toBeInTheDocument();
    fireEvent.click(copy);
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ text: 'Đã chép số', type: 'success' }));
    expect(mocks.copyText).toHaveBeenCalledWith('0899149229');
  });

  it('số cấu hình hỏng: dùng số mặc định thay vì mở liên kết lạ', async () => {
    mocks.cfg.tubuZaloPhone = 'https://evil.example';
    mocks.openWebview.mockResolvedValue(undefined);
    wrap(<OrderZaloFriend code="TT001" from="success" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở Zalo Tubu Tree' }));
    await waitFor(() => expect(mocks.openWebview).toHaveBeenCalledWith({ url: 'https://zalo.me/0899149229' }));
  });
});
