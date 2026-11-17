import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ status: 'authenticated' as string, get: vi.fn(), snack: vi.fn() }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ status: mocks.status }) }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('zmp-ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useSnackbar: () => ({ openSnackbar: mocks.snack }) }));

import { BadgeRow } from './badge-row';

const renderRow = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BadgeRow /></QueryClientProvider>);

describe('BadgeRow', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.snack.mockReset();
    mocks.status = 'authenticated';
  });

  it('cờ tắt: không vẽ gì', async () => {
    mocks.get.mockResolvedValue({ enabled: false, badges: [] });
    const { container } = renderRow();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/game/badges'));
    expect(container).toBeEmptyDOMElement();
  });

  it('API cũ (404): không vẽ gì', async () => {
    mocks.get.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    const { container } = renderRow();
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('khách chưa đăng nhập: không gọi API', () => {
    mocks.status = 'unauthenticated';
    const { container } = renderRow();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('cờ bật: 8 huy hiệu, đã đạt đứng trước, chạm huy hiệu chưa đạt thì báo điều kiện', async () => {
    mocks.get.mockResolvedValue({ enabled: true, badges: [{ id: 'STREAK_7', earned: true, earnedAt: '2026-11-17T00:00:00.000Z' }] });
    renderRow();
    expect(await screen.findByTestId('badge-row')).toBeInTheDocument();
    expect(screen.getByText('1/8')).toBeInTheDocument();
    const chips = screen.getAllByRole('button');
    expect(chips).toHaveLength(8);
    expect(chips[0]).toHaveAccessibleName('Chuỗi 7 ngày, đã đạt');
    expect(chips[1]!.getAttribute('aria-label')).toMatch(/^Đơn đầu tiên, chưa đạt\. /);
    fireEvent.click(chips[1]!);
    expect(mocks.snack).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', text: 'Nhận đơn hàng đầu tiên.' }));
    fireEvent.click(chips[0]!);
    expect(mocks.snack).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'success' }));
  });
});
