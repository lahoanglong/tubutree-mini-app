import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ coreGet: vi.fn() }));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { OffersHistory } from './offers-history';

const PATH = '/me/coupons/history';
const row = (code: string, status: 'USED' | 'EXPIRED') => ({
  code,
  type: 'AMOUNT',
  value: 20_000,
  minOrder: null,
  maxDiscount: null,
  endAt: '2026-10-01T00:00:00.000Z',
  status,
  usedAt: status === 'USED' ? '2026-09-20T00:00:00.000Z' : null,
});

function renderHistory(initialOpen = false, scrollReady = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (ready: boolean) => (
    <QueryClientProvider client={qc}>
      <OffersHistory initialOpen={initialOpen} scrollReady={ready} />
    </QueryClientProvider>
  );
  const view = render(tree(scrollReady));
  return { ...view, setScrollReady: (ready: boolean) => view.rerender(tree(ready)) };
}
const toggle = () => screen.getByRole('button', { name: 'Mã đã dùng, hết hạn' });
const panel = () => document.getElementById(toggle().getAttribute('aria-controls')!)!;
const calls = () => mocks.coreGet.mock.calls.filter(([p]) => p === PATH).length;

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.coreGet.mockResolvedValue([row('DA-DUNG', 'USED'), row('HET-HAN', 'EXPIRED')]);
});

describe('OffersHistory — mục "Mã đã dùng, hết hạn" mở tại chỗ ở Mã của tôi', () => {
  it('đóng: không gọi API lịch sử, panel ẩn, nút aria-expanded=false trỏ vào panel', () => {
    renderHistory();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).not.toBeVisible();
    expect(calls()).toBe(0);
  });

  it('mở: gọi /me/coupons/history một lần, vẽ phiếu đã dùng và hết hạn, không phiếu nào có nút; đóng lại không gọi thêm', async () => {
    renderHistory();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(within(panel()).getAllByRole('group')).toHaveLength(2));
    expect(within(panel()).queryByRole('button')).toBeNull();
    expect(calls()).toBe(1);
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).not.toBeVisible();
    expect(calls()).toBe(1);
  });

  it('đang tải: panel aria-busy có khung chờ; tải xong bỏ aria-busy', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.coreGet.mockImplementation(() => new Promise((r) => (release = r)));
    renderHistory(true);
    expect(panel()).toHaveAttribute('aria-busy', 'true');
    release([]);
    expect(await screen.findByText('Chưa có mã đã dùng hoặc hết hạn')).toBeInTheDocument();
    expect(panel()).not.toHaveAttribute('aria-busy');
  });

  it('chưa có lịch sử: trạng thái rỗng tại chỗ', async () => {
    mocks.coreGet.mockResolvedValue([]);
    renderHistory(true);
    expect(await screen.findByText('Chưa có mã đã dùng hoặc hết hạn')).toBeInTheDocument();
  });

  it('tải lỗi: báo tại chỗ, "Thử lại" gọi lại API', async () => {
    mocks.coreGet.mockRejectedValueOnce({ isHttpError: true, response: { status: 500, data: { message: 'x' } } });
    renderHistory(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(within(panel()).getAllByRole('group')).toHaveLength(2));
    expect(calls()).toBe(2);
  });

  it('initialOpen (?history=1): mở sẵn và cuộn tới mục đúng một lần, chỉ khi scrollReady', async () => {
    const view = renderHistory(true, false);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    view.setScrollReady(true);
    await waitFor(() => expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1));
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('không initialOpen thì không cuộn', () => {
    renderHistory(false, true);
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
