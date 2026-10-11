import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchActive: vi.fn(),
  fetchUpcoming: vi.fn(),
  setReminder: vi.fn(),
  cancelReminder: vi.fn(),
  navigate: vi.fn(),
  status: 'guest',
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../services/shop-api', () => ({
  fetchActiveFlashSales: mocks.fetchActive,
  fetchUpcomingFlashSales: mocks.fetchUpcoming,
  setFlashReminder: mocks.setReminder,
  cancelFlashReminder: mocks.cancelReminder,
}));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { FlashSale, UpcomingFlashSales } from './flash-sale';

function renderFlash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FlashSale />
    </QueryClientProvider>,
  );
}

const ITEM = {
  itemId: 'i1', productId: 'p1', productSlug: 'p1', productName: 'Nước rửa chén', thumbnail: null, variationId: 'v1',
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 2, endAt: new Date(Date.now() + 3_600_000).toISOString(),
};

describe('FlashSale (C-084)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'guest';
    mocks.fetchUpcoming.mockResolvedValue([]);
  });

  it('không có đợt giờ vàng nào → không vẽ gì', async () => {
    mocks.fetchActive.mockResolvedValue([]);
    const { container } = renderFlash();
    await waitFor(() => expect(mocks.fetchActive).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('tải lỗi → khối có tiêu đề, thông báo và "Thử lại" thay vì biến mất; thử lại thành công hiện đợt giờ vàng', async () => {
    mocks.fetchActive.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([ITEM]);
    renderFlash();
    const region = await screen.findByRole('region', { name: 'Ưu đãi giờ vàng' });
    expect(within(region).getByText('Có chút trục trặc, thử lại nhé')).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Thử lại Ưu đãi giờ vàng' }));
    expect(await screen.findByText('Nước rửa chén')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Thử lại/ })).toBeNull();
  });
});

describe('FlashSale — thẻ giờ vàng (C-076 di cư DS v2: giữ nguyên hành vi)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'guest';
    mocks.fetchUpcoming.mockResolvedValue([]);
  });

  it('tiêu đề h2, đồng hồ đếm ngược có tên truy cập, thẻ hiện -% / giá giờ vàng / giá gạch / đã bán', async () => {
    mocks.fetchActive.mockResolvedValue([ITEM]);
    renderFlash();
    expect(await screen.findByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: /^.*Còn \d+h \d{2}m$/ })).toBeInTheDocument();
    expect(screen.getByText('-20%')).toBeInTheDocument();
    expect(screen.getByText('80.000đ')).toBeInTheDocument();
    expect(screen.getByText('100.000đ')).toHaveStyle({ textDecoration: 'line-through' });
    expect(screen.getByText('Đã bán 20%')).toBeInTheDocument();
  });

  it('chạm thẻ → sang SP kèm đúng phân loại đang giờ vàng', async () => {
    mocks.fetchActive.mockResolvedValue([ITEM]);
    renderFlash();
    fireEvent.click(await screen.findByText('Nước rửa chén'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/p1', { state: { variationId: 'v1' } });
  });

  it('thanh "đã bán" không vượt 100% khi bán quá suất', async () => {
    mocks.fetchActive.mockResolvedValue([{ ...ITEM, quota: 10, soldCount: 15 }]);
    renderFlash();
    expect(await screen.findByText('Đã bán 150%')).toBeInTheDocument();
    expect(screen.getByTestId('progress-fill')).toHaveStyle({ width: '100%' });
  });
});

describe('UpcomingFlashSales (C-076 di cư DS v2: giữ nguyên hành vi)', () => {
  const UP = {
    itemId: 'u1', productSlug: 'nrc', productName: 'Nước rửa chén', thumbnail: null, retailPrice: 100000, flashPrice: 80000,
    startAt: new Date(Date.now() + 3_600_000).toISOString(), reminded: false,
  };

  function renderUpcoming() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <UpcomingFlashSales />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
    mocks.fetchUpcoming.mockResolvedValue([UP]);
    mocks.setReminder.mockResolvedValue({});
    mocks.cancelReminder.mockResolvedValue({});
  });

  it('khách chưa đăng nhập → không vẽ gì', async () => {
    mocks.status = 'guest';
    const { container } = renderUpcoming();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it('"Nhắc tôi" đặt nhắc mà KHÔNG mở sản phẩm; bấm khi đã nhắc thì huỷ nhắc', async () => {
    renderUpcoming();
    fireEvent.click(await screen.findByRole('button', { name: /Nhắc tôi/ }));
    await waitFor(() => expect(mocks.setReminder).toHaveBeenCalledWith('u1'));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('đã đặt nhắc → nhãn "Đã đặt nhắc", bấm huỷ nhắc', async () => {
    mocks.fetchUpcoming.mockResolvedValue([{ ...UP, reminded: true }]);
    renderUpcoming();
    fireEvent.click(await screen.findByRole('button', { name: /Đã đặt nhắc/ }));
    await waitFor(() => expect(mocks.cancelReminder).toHaveBeenCalledWith('u1'));
  });

  it('chạm thẻ → mở sản phẩm (không kèm state)', async () => {
    renderUpcoming();
    fireEvent.click(await screen.findByText('Nước rửa chén'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/nrc');
  });

  it('nút nhắc cao tối thiểu 44px', async () => {
    renderUpcoming();
    const btn = await screen.findByRole('button', { name: /Nhắc tôi/ });
    expect(Number.parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
  });
});
