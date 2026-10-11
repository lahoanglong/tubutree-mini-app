import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AxiosError } from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(),
  getOwnedBrand: vi.fn(), getOwnedBrandSales: vi.fn(),
  updateOwnedBrand: vi.fn(), createOwnedPromotion: vi.fn(), updateOwnedPromotion: vi.fn(), deleteOwnedPromotion: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/brand-owner', search: '', hash: '', state: null, key: 'k' }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/brand-owner-api', () => ({
  getOwnedBrand: mocks.getOwnedBrand,
  getOwnedBrandSales: mocks.getOwnedBrandSales,
  updateOwnedBrand: mocks.updateOwnedBrand,
  createOwnedPromotion: mocks.createOwnedPromotion,
  updateOwnedPromotion: mocks.updateOwnedPromotion,
  deleteOwnedPromotion: mocks.deleteOwnedPromotion,
}));
vi.mock('../components/image-upload', () => ({ ImageUpload: ({ label }: { label: string }) => <div>{label}</div> }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import BrandOwnerPage from './brand-owner';

const BRAND = {
  id: 'b1', slug: 'sachi', name: 'Sachi', logoUrl: null, coverUrl: null, tagline: null, story: null, origin: null,
  isVerified: true, isPublished: true, followerCount: 12,
  promotions: [
    { id: 'p1', title: 'MUA 2 TẶNG 1', subtitle: null, couponCode: 'TUBU20', startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z', isActive: true },
  ],
};

const SALES = {
  period: '30d', from: '2026-09-10T00:00:00.000Z', to: '2026-10-10T00:00:00.000Z',
  orderCount: 12, unitsSold: 31, revenue: 4_560_000,
  delivered: { orderCount: 9, revenue: 3_200_000 },
  topProducts: [
    { productId: 'p1', name: 'Nước rửa chén Sachi', slug: 'nrc', quantity: 20, revenue: 3_000_000 },
    { productId: 'p2', name: 'Xà bông Sachi', slug: 'xb', quantity: 11, revenue: 1_560_000 },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><BrandOwnerPage /></QueryClientProvider>);
}

describe('BrandOwnerPage tab Doanh thu (C-034, Q-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwnedBrand.mockResolvedValue(BRAND);
    mocks.getOwnedBrandSales.mockResolvedValue(SALES);
  });

  it('có 2 tab; mặc định mở "Hồ sơ & khuyến mãi" và chưa gọi API doanh thu', async () => {
    renderPage();
    await screen.findByText('Sachi');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Hồ sơ & khuyến mãi', 'Doanh thu']);
    expect(screen.getByRole('tab', { name: 'Hồ sơ & khuyến mãi' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Thông tin nhãn')).toBeInTheDocument();
    expect(mocks.getOwnedBrandSales).not.toHaveBeenCalled();
  });

  it('mở tab "Doanh thu": gọi kỳ 30 ngày, hiện số đơn, doanh thu, số sản phẩm đã bán và SP bán chạy', async () => {
    renderPage();
    await screen.findByText('Sachi');
    fireEvent.click(screen.getByRole('tab', { name: 'Doanh thu' }));
    await waitFor(() => expect(mocks.getOwnedBrandSales).toHaveBeenCalledWith('30d'));
    expect(await screen.findByText('4.560.000đ')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('31')).toBeInTheDocument();
    expect(screen.getByText(/9 đơn đã giao/)).toBeInTheDocument();
    expect(screen.getByText(/3\.200\.000đ/)).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Nước rửa chén Sachi')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('3.000.000đ')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/20/)).toBeInTheDocument();
    expect(screen.getByText(/không hiện thông tin khách/i)).toBeInTheDocument();
    expect(screen.queryByText('Thông tin nhãn')).toBeNull();
  });

  it('đổi kỳ báo cáo -> gọi lại API với kỳ đó', async () => {
    renderPage();
    await screen.findByText('Sachi');
    fireEvent.click(screen.getByRole('tab', { name: 'Doanh thu' }));
    await screen.findByText('4.560.000đ');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Hồ sơ & khuyến mãi', 'Doanh thu', '7 ngày', '30 ngày', '90 ngày', 'Tháng này', 'Tháng trước',
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'Tháng trước' }));
    await waitFor(() => expect(mocks.getOwnedBrandSales).toHaveBeenCalledWith('prev_month'));
    fireEvent.click(screen.getByRole('tab', { name: '7 ngày' }));
    await waitFor(() => expect(mocks.getOwnedBrandSales).toHaveBeenCalledWith('7d'));
  });

  it('kỳ chưa có đơn -> trạng thái rỗng, không vẽ danh sách', async () => {
    mocks.getOwnedBrandSales.mockResolvedValue({ ...SALES, orderCount: 0, unitsSold: 0, revenue: 0, delivered: { orderCount: 0, revenue: 0 }, topProducts: [] });
    renderPage();
    await screen.findByText('Sachi');
    fireEvent.click(screen.getByRole('tab', { name: 'Doanh thu' }));
    expect(await screen.findByText('Chưa có đơn nào trong kỳ này')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('lỗi tải -> hiện thông báo + nút thử lại', async () => {
    mocks.getOwnedBrandSales.mockRejectedValueOnce(new Error('mạng lỗi')).mockResolvedValue(SALES);
    renderPage();
    await screen.findByText('Sachi');
    fireEvent.click(screen.getByRole('tab', { name: 'Doanh thu' }));
    const retry = await screen.findByRole('button', { name: /thử lại/i });
    fireEvent.click(retry);
    expect(await screen.findByText('4.560.000đ')).toBeInTheDocument();
  });
});

describe('BrandOwnerPage khuyến mãi gắn mã giảm giá (C-006)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwnedBrand.mockResolvedValue(BRAND);
    mocks.updateOwnedPromotion.mockResolvedValue({});
    mocks.createOwnedPromotion.mockResolvedValue({});
  });

  it('sửa khuyến mãi rồi xoá ô mã -> gửi couponCode rỗng để gỡ mã', async () => {
    renderPage();
    await screen.findByText('MUA 2 TẶNG 1');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    fireEvent.change(screen.getByPlaceholderText(/Mã giảm giá/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateOwnedPromotion).toHaveBeenCalledTimes(1));
    expect(mocks.updateOwnedPromotion.mock.calls[0]![0]).toBe('p1');
    expect(mocks.updateOwnedPromotion.mock.calls[0]![1]).toMatchObject({ couponCode: '' });
  });

  it('thêm khuyến mãi không nhập mã -> không gửi couponCode', async () => {
    renderPage();
    await screen.findByText('MUA 2 TẶNG 1');
    fireEvent.change(screen.getByPlaceholderText(/Tiêu đề/), { target: { value: 'Giảm sốc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm khuyến mãi' }));
    await waitFor(() => expect(mocks.createOwnedPromotion).toHaveBeenCalledTimes(1));
    expect(mocks.createOwnedPromotion.mock.calls[0]![0].couponCode).toBeUndefined();
  });

  it('mã bị từ chối ở máy chủ (400) -> hiện đúng thông báo, không báo "Đã thêm"', async () => {
    mocks.createOwnedPromotion.mockRejectedValue(
      new AxiosError('Bad Request', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 400, statusText: 'Bad Request', headers: {}, config: {} as never,
        data: { message: 'Mã giảm giá "MASAI" chưa có trong hệ thống.' },
      }),
    );
    renderPage();
    await screen.findByText('MUA 2 TẶNG 1');
    fireEvent.change(screen.getByPlaceholderText(/Tiêu đề/), { target: { value: 'Giảm sốc' } });
    fireEvent.change(screen.getByPlaceholderText(/Mã giảm giá/), { target: { value: 'masai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm khuyến mãi' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text: expect.stringContaining('chưa có trong hệ thống') })));
    expect(mocks.createOwnedPromotion.mock.calls[0]![0].couponCode).toBe('MASAI');
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã thêm khuyến mãi' }));
  });
});

describe('BrandOwnerPage cấu trúc trang (C-076, C-114)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwnedBrand.mockResolvedValue(BRAND);
    mocks.deleteOwnedPromotion.mockResolvedValue({});
    mocks.updateOwnedBrand.mockResolvedValue({});
  });

  const oneH1 = () => {
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]!.textContent).toBe('Quản lý nhãn hàng');
  };

  it('đúng một h1 khi đang tải', () => {
    mocks.getOwnedBrand.mockReturnValue(new Promise(() => {}));
    renderPage();
    oneH1();
  });

  it('đúng một h1 khi chưa được cấp nhãn (404)', async () => {
    mocks.getOwnedBrand.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    await screen.findByText(/chưa được cấp quyền quản lý nhãn/);
    oneH1();
  });

  it('đúng một h1 khi lỗi tải, có nút Thử lại', async () => {
    mocks.getOwnedBrand.mockRejectedValueOnce(new Error('mạng lỗi')).mockResolvedValue(BRAND);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /thử lại/i }));
    await screen.findByRole('heading', { level: 2, name: 'Sachi' });
    oneH1();
  });

  it('đúng một h1 ở trang chỉnh sửa; tên nhãn là h2', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Sachi' })).toBeInTheDocument();
    oneH1();
  });

  it('trạng thái nhãn: chính hãng, đang hiển thị, số theo dõi; không dùng ký tự ✓', async () => {
    renderPage();
    await screen.findByText('Sachi');
    expect(screen.getByText('Chính hãng')).toBeInTheDocument();
    expect(screen.getByText('Đang hiển thị')).toBeInTheDocument();
    expect(screen.getByText(/12 theo dõi/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('✓');
  });

  it('nhãn chưa xác minh và còn nháp', async () => {
    mocks.getOwnedBrand.mockResolvedValue({ ...BRAND, isVerified: false, isPublished: false });
    renderPage();
    await screen.findByText('Sachi');
    expect(screen.getByText('Chưa xác minh')).toBeInTheDocument();
    expect(screen.getByText('Nháp (admin duyệt)')).toBeInTheDocument();
  });

  it('"Xem trang nhãn": đã đăng thì sang /brand/:slug, nháp thì chỉ báo cảnh báo', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem trang nhãn' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/brand/sachi');
  });

  it('"Xem trang nhãn" khi nhãn còn nháp: không chuyển trang, báo cảnh báo', async () => {
    mocks.getOwnedBrand.mockResolvedValue({ ...BRAND, isPublished: false });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem trang nhãn' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
  });

  it('Lưu thông tin gửi các trường đang nhập', async () => {
    renderPage();
    await screen.findByText('Sachi');
    fireEvent.change(screen.getByLabelText('Tagline'), { target: { value: 'Sống xanh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thông tin' }));
    await waitFor(() => expect(mocks.updateOwnedBrand).toHaveBeenCalledTimes(1));
    expect(mocks.updateOwnedBrand.mock.calls[0]![0]).toMatchObject({ tagline: 'Sống xanh', logoUrl: '', coverUrl: '', origin: '', story: '' });
  });

  it('xoá khuyến mãi phải xác nhận trong sheet có tiêu đề h2; Huỷ không gọi API', async () => {
    renderPage();
    await screen.findByText('MUA 2 TẶNG 1');
    fireEvent.click(screen.getByRole('button', { name: 'Xoá' }));
    const sheet = within(screen.getByTestId('sheet'));
    expect(sheet.getByRole('heading', { level: 2, name: 'Xoá khuyến mãi này?' })).toBeInTheDocument();
    fireEvent.click(sheet.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByTestId('sheet')).toBeNull();
    expect(mocks.deleteOwnedPromotion).not.toHaveBeenCalled();
  });

  it('xác nhận xoá gọi deleteOwnedPromotion đúng id', async () => {
    renderPage();
    await screen.findByText('MUA 2 TẶNG 1');
    fireEvent.click(screen.getByRole('button', { name: 'Xoá' }));
    fireEvent.click(within(screen.getByTestId('sheet')).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(mocks.deleteOwnedPromotion).toHaveBeenCalledWith('p1'));
  });

  it('ngày kết thúc trước ngày bắt đầu: báo lỗi và khoá nút thêm', async () => {
    renderPage();
    await screen.findByText('MUA 2 TẶNG 1');
    fireEvent.change(screen.getByPlaceholderText(/Tiêu đề/), { target: { value: 'Giảm sốc' } });
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '2026-11-01' } });
    expect(screen.getByText('Ngày kết thúc phải sau ngày bắt đầu.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm khuyến mãi' })).toBeDisabled();
  });
});
