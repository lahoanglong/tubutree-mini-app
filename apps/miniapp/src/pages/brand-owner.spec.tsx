import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { HttpError } from '../services/http';
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { vi as t } from '../i18n/vi';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), chatOn: false, openOAChat: vi.fn(),
  getOwnedBrand: vi.fn(), getOwnedBrandSales: vi.fn(),
  updateOwnedBrand: vi.fn(), createOwnedPromotion: vi.fn(), updateOwnedPromotion: vi.fn(), deleteOwnedPromotion: vi.fn(),
  // Ô ảnh giả ghi lại props lần vẽ gần nhất theo nhãn: test tự báo "đang tải"/"tải xong" như ô thật.
  pickers: {} as Record<string, { onChange: (url: string) => void; onBusyChange: (busy: boolean) => void; disabled: boolean }>,
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
vi.mock('../components/image-upload', () => ({
  ImageUpload: ({ label, onChange, onBusyChange, disabled }: { label: string; onChange: (url: string) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) => {
    mocks.pickers[label] = { onChange, onBusyChange: onBusyChange ?? (() => undefined), disabled: Boolean(disabled) };
    return <div data-disabled={disabled ? 'true' : undefined}>{label}</div>;
  },
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, chat: { enabled: mocks.chatOn } }) }));
vi.mock('../services/zmp-bridge', () => ({ hasOA: true, openOAChat: mocks.openOAChat }));
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
    expect(screen.getByText('Thông tin thương hiệu')).toBeInTheDocument();
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
    expect(screen.queryByText('Thông tin thương hiệu')).toBeNull();
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

describe('BrandOwnerPage danh sách khuyến mãi không vỡ cột (D7 việc 10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwnedBrand.mockResolvedValue({
      ...BRAND,
      promotions: [{ ...BRAND.promotions[0]!, subtitle: 'Áp dụng cho mọi sản phẩm nước rửa chén Sachi trong tháng 10' }],
    });
  });

  it('Sửa và Xoá là nút icon 44px không co lại, tên đọc nêu rõ khuyến mãi nào; chữ chiếm phần còn lại của dòng', async () => {
    renderPage();
    const title = await screen.findByText('MUA 2 TẶNG 1');
    for (const name of ['Sửa khuyến mãi MUA 2 TẶNG 1', 'Xoá khuyến mãi MUA 2 TẶNG 1']) {
      const btn = screen.getByRole('button', { name });
      // Nút ZaUI có min-width 120px nên hai nút chữ ép cột tiêu đề còn vài chục px (D7).
      expect(btn.className).not.toMatch(/zaui-btn/);
      expect(btn.style.minWidth).toBe('44px');
      expect(btn.style.minHeight).toBe('44px');
      expect(btn.style.flexShrink).toBe('0');
    }
    const textColumn = title.parentElement as HTMLElement;
    expect(textColumn.style.flex).toBe('1 1 0%');
    expect(textColumn.style.minWidth).toBe('0px');
    expect(screen.getByText(/Áp dụng cho mọi sản phẩm/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
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
      new HttpError('Bad Request', 'ERR_BAD_REQUEST', {
        status: 400,
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
    expect(h1[0]!.textContent).toBe('Quản lý thương hiệu');
  };

  it('đúng một h1 khi đang tải', () => {
    mocks.getOwnedBrand.mockReturnValue(new Promise(() => {}));
    renderPage();
    oneH1();
  });

  it('đúng một h1 khi chưa được cấp nhãn (404)', async () => {
    mocks.getOwnedBrand.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    await screen.findByText(/chưa được cấp quyền quản lý thương hiệu/);
    oneH1();
  });

  it('chưa được cấp nhãn: nút Nhắn Tubu mở chat khi chat bật; chat tắt thì nút đổi thành Liên hệ Tubu và mở OA', async () => {
    mocks.getOwnedBrand.mockRejectedValue({ response: { status: 404 } });
    mocks.chatOn = true;
    const first = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Nhắn Tubu' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/chat');
    first.unmount();
    mocks.chatOn = false;
    renderPage();
    expect(screen.queryByRole('button', { name: 'Nhắn Tubu' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Liên hệ Tubu' }));
    expect(mocks.openOAChat).toHaveBeenCalled();
  });

  it('đúng một h1 khi lỗi tải, có nút Thử lại', async () => {
    mocks.getOwnedBrand.mockRejectedValueOnce(new Error('mạng lỗi')).mockResolvedValue(BRAND);
    renderPage();
    const retry = await screen.findByRole('button', { name: /thử lại/i });
    oneH1();
    fireEvent.click(retry);
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
    expect(screen.getByText('Bản nháp, chờ Tubu duyệt')).toBeInTheDocument();
  });

  it('"Xem trang thương hiệu": đã đăng thì sang /brand/:slug, nháp thì chỉ báo cảnh báo', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem trang thương hiệu' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/brand/sachi');
  });

  it('"Xem trang thương hiệu" khi nhãn còn nháp: không chuyển trang, báo cảnh báo', async () => {
    mocks.getOwnedBrand.mockResolvedValue({ ...BRAND, isPublished: false });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem trang thương hiệu' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
  });

  it('Lưu thông tin gửi các trường đang nhập', async () => {
    renderPage();
    await screen.findByText('Sachi');
    fireEvent.change(screen.getByLabelText('Câu giới thiệu ngắn'), { target: { value: 'Sống xanh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thông tin' }));
    await waitFor(() => expect(mocks.updateOwnedBrand).toHaveBeenCalledTimes(1));
    expect(mocks.updateOwnedBrand.mock.calls[0]![0]).toMatchObject({ tagline: 'Sống xanh', logoUrl: '', coverUrl: '', origin: '', story: '' });
  });

  it('xoá khuyến mãi phải xác nhận trong sheet có tiêu đề h2; Huỷ không gọi API', async () => {
    renderPage();
    await screen.findByText('MUA 2 TẶNG 1');
    fireEvent.click(screen.getByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
    const sheet = within(screen.getByTestId('sheet'));
    expect(sheet.getByRole('heading', { level: 2, name: 'Xoá khuyến mãi này?' })).toBeInTheDocument();
    fireEvent.click(sheet.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByTestId('sheet')).toBeNull();
    expect(mocks.deleteOwnedPromotion).not.toHaveBeenCalled();
  });

  it('xác nhận xoá gọi deleteOwnedPromotion đúng id', async () => {
    renderPage();
    await screen.findByText('MUA 2 TẶNG 1');
    fireEvent.click(screen.getByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
    fireEvent.click(within(screen.getByTestId('sheet')).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(mocks.deleteOwnedPromotion).toHaveBeenCalledWith('p1'));
  });

  it('hai ô ngày khuyến mãi có nhãn nhìn thấy (chữ "Từ ngày", "Đến ngày"), không chỉ aria-label', async () => {
    renderPage();
    await screen.findByText('MUA 2 TẶNG 1');
    const from = screen.getByLabelText('Từ ngày');
    const to = screen.getByLabelText('Đến ngày');
    expect(from.closest('label')?.textContent).toBe('Từ ngày');
    expect(to.closest('label')?.textContent).toBe('Đến ngày');
    expect(from.getAttribute('aria-label')).toBeNull();
  });

  it('ngày kết thúc trước ngày bắt đầu: báo lỗi và khoá nút thêm', async () => {
    renderPage();
    await screen.findByText('MUA 2 TẶNG 1');
    fireEvent.change(screen.getByPlaceholderText(/Tiêu đề/), { target: { value: 'Giảm sốc' } });
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '2026-11-01' } });
    expect(screen.getByText('Ngày kết thúc không được trước ngày bắt đầu.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm khuyến mãi' })).toBeDisabled();
  });
});

describe('BrandOwnerPage: Lưu thông tin, thêm/sửa/xoá khuyến mãi khoá chạm đúp (W76A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const toasts = (type: string) => mocks.openSnackbar.mock.calls.filter(([a]) => (a as { type: string }).type === type);
  const startAdd = async () => {
    await screen.findByText('MUA 2 TẶNG 1');
    fireEvent.change(screen.getByPlaceholderText(/Tiêu đề/), { target: { value: 'Giảm sốc' } });
    return screen.getByRole('button', { name: 'Thêm khuyến mãi' });
  };
  const startEdit = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
    return screen.getByRole('button', { name: 'Lưu thay đổi' });
  };
  const openDelete = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
    return within(screen.getByTestId('sheet')).getByRole('button', { name: 'Xoá' });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwnedBrand.mockResolvedValue(BRAND);
    mocks.updateOwnedBrand.mockResolvedValue({});
    mocks.createOwnedPromotion.mockResolvedValue({});
    mocks.updateOwnedPromotion.mockResolvedValue({});
    mocks.deleteOwnedPromotion.mockResolvedValue({});
  });

  it('chạm đúp "Lưu thông tin" trong cùng một khung hình chỉ lưu một lần', async () => {
    const d = deferred();
    mocks.updateOwnedBrand.mockReturnValueOnce(d.promise);
    renderPage();
    const save = await screen.findByRole('button', { name: 'Lưu thông tin' });
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(mocks.updateOwnedBrand).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
    expect(save).not.toBeDisabled();
    await act(async () => d.resolve({}));
    await waitFor(() => expect(toasts('success')).toHaveLength(1));
    expect(mocks.updateOwnedBrand).toHaveBeenCalledTimes(1);
  });

  it('lưu thông tin lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
    mocks.updateOwnedBrand.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu thông tin' }));
    await waitFor(() => expect(toasts('error')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thông tin' }));
    await waitFor(() => expect(mocks.updateOwnedBrand).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toasts('success')).toHaveLength(1));
  });

  it('chạm đúp "Thêm khuyến mãi" trong cùng một khung hình chỉ tạo một khuyến mãi', async () => {
    const d = deferred();
    mocks.createOwnedPromotion.mockReturnValueOnce(d.promise);
    renderPage();
    const add = await startAdd();
    await act(async () => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(mocks.createOwnedPromotion).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(add).toHaveAttribute('aria-busy', 'true'));
    expect(add).not.toBeDisabled();
    await act(async () => d.resolve({}));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã thêm khuyến mãi', type: 'success' }));
    expect(mocks.createOwnedPromotion).toHaveBeenCalledTimes(1);
    expect(toasts('success')).toHaveLength(1);
  });

  it('thêm khuyến mãi lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
    mocks.createOwnedPromotion.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});
    renderPage();
    fireEvent.click(await startAdd());
    await waitFor(() => expect(toasts('error')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm khuyến mãi' }));
    await waitFor(() => expect(mocks.createOwnedPromotion).toHaveBeenCalledTimes(2));
  });

  it('chạm đúp "Lưu thay đổi" trong cùng một khung hình chỉ cập nhật một lần', async () => {
    const d = deferred();
    mocks.updateOwnedPromotion.mockReturnValueOnce(d.promise);
    renderPage();
    const save = await startEdit();
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(mocks.updateOwnedPromotion).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
    expect(save).not.toBeDisabled();
    await act(async () => d.resolve({}));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cập nhật khuyến mãi', type: 'success' }));
    expect(mocks.updateOwnedPromotion).toHaveBeenCalledTimes(1);
    expect(toasts('success')).toHaveLength(1);
  });

  it('cập nhật khuyến mãi lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
    mocks.updateOwnedPromotion.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});
    renderPage();
    fireEvent.click(await startEdit());
    await waitFor(() => expect(toasts('error')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateOwnedPromotion).toHaveBeenCalledTimes(2));
  });

  it('chạm đúp "Xoá" trong khung xác nhận trong cùng một khung hình chỉ xoá một lần', async () => {
    const d = deferred();
    mocks.deleteOwnedPromotion.mockReturnValueOnce(d.promise);
    renderPage();
    const del = await openDelete();
    await act(async () => {
      fireEvent.click(del);
      fireEvent.click(del);
    });
    expect(mocks.deleteOwnedPromotion).toHaveBeenCalledTimes(1);
    expect(mocks.deleteOwnedPromotion).toHaveBeenCalledWith('p1');
    await waitFor(() => expect(del).toHaveAttribute('aria-busy', 'true'));
    expect(del).not.toBeDisabled();
    await act(async () => d.resolve({}));
    await waitFor(() => expect(screen.queryByTestId('sheet')).toBeNull());
    expect(mocks.deleteOwnedPromotion).toHaveBeenCalledTimes(1);
  });

  it('xoá khuyến mãi lỗi thì giữ khung, nhả khoá, bấm lại xoá lần hai', async () => {
    mocks.deleteOwnedPromotion.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});
    renderPage();
    fireEvent.click(await openDelete());
    await waitFor(() => expect(toasts('error')).toHaveLength(1));
    expect(screen.getByTestId('sheet')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('sheet')).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(mocks.deleteOwnedPromotion).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('sheet')).toBeNull());
  });
});

describe('BrandOwnerPage: "Liên hệ Tubu" và "Thử lại" khoá chạm đúp (W80A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatOn = false;
    mocks.getOwnedBrand.mockResolvedValue(BRAND);
    mocks.getOwnedBrandSales.mockResolvedValue(SALES);
  });

  it('hai cú chạm cùng nhịp vào "Liên hệ Tubu" khi cầu nối OA còn treo: chỉ mở một lần; xong thì chạm lại được', async () => {
    mocks.getOwnedBrand.mockRejectedValue({ response: { status: 404 } });
    const d = deferred();
    mocks.openOAChat.mockReturnValueOnce(d.promise);
    renderPage();
    const contact = await screen.findByRole('button', { name: 'Liên hệ Tubu' });
    await act(async () => {
      fireEvent.click(contact);
      fireEvent.click(contact);
    });
    expect(mocks.openOAChat).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(undefined));
    fireEvent.click(contact);
    expect(mocks.openOAChat).toHaveBeenCalledTimes(2);
  });

  it('tab Doanh thu: "Thử lại" tải lại rồi hiện số liệu', async () => {
    const d = deferred();
    mocks.getOwnedBrandSales.mockRejectedValueOnce(new Error('mạng lỗi')).mockReturnValueOnce(d.promise);
    renderPage();
    await screen.findByText('Sachi');
    fireEvent.click(screen.getByRole('tab', { name: 'Doanh thu' }));
    const retry = await screen.findByRole('button', { name: /thử lại/i });
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.getOwnedBrandSales).toHaveBeenCalledTimes(2);
    await act(async () => d.resolve(SALES));
    expect(await screen.findByText('4.560.000đ')).toBeInTheDocument();
    expect(mocks.getOwnedBrandSales).toHaveBeenCalledTimes(2);
  });
});

describe('BrandOwnerPage: ảnh logo/bìa còn đang lên thì "Lưu thông tin" chờ (W90A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwnedBrand.mockResolvedValue(BRAND);
    mocks.updateOwnedBrand.mockResolvedValue({});
  });

  it('logo và ảnh bìa tải chồng nhau: còn một ô chưa xong là nút vẫn khoá, bấm không lưu; cả hai xong mới lưu, kèm ảnh MỚI', async () => {
    renderPage();
    await screen.findByText('Thông tin thương hiệu');
    act(() => mocks.pickers['Logo']!.onBusyChange(true));
    act(() => mocks.pickers['Ảnh bìa']!.onBusyChange(true));
    const waiting = screen.getByRole('button', { name: t.common.imagesUploading });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.updateOwnedBrand).not.toHaveBeenCalled();

    act(() => {
      mocks.pickers['Logo']!.onChange('https://img.test/logo.png');
      mocks.pickers['Logo']!.onBusyChange(false);
    });
    expect(screen.getByRole('button', { name: t.common.imagesUploading })).toBeDisabled();

    act(() => {
      mocks.pickers['Ảnh bìa']!.onChange('https://img.test/bia.png');
      mocks.pickers['Ảnh bìa']!.onBusyChange(false);
    });
    const save = await screen.findByRole('button', { name: 'Lưu thông tin' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(mocks.updateOwnedBrand).toHaveBeenCalledTimes(1));
    expect(mocks.updateOwnedBrand.mock.calls[0]![0]).toMatchObject({ logoUrl: 'https://img.test/logo.png', coverUrl: 'https://img.test/bia.png' });
  });

  it('sang tab Doanh thu giữa lúc ảnh còn lên rồi quay lại: cờ nằm ở trang nên Lưu vẫn chờ tới khi lượt cũ xong', async () => {
    mocks.getOwnedBrandSales.mockResolvedValue({ period: '30d', from: '', to: '', orderCount: 0, unitsSold: 0, revenue: 0, delivered: { orderCount: 0, revenue: 0 }, topProducts: [] });
    renderPage();
    await screen.findByText('Thông tin thương hiệu');
    act(() => mocks.pickers['Logo']!.onBusyChange(true));
    fireEvent.click(screen.getByRole('tab', { name: 'Doanh thu' }));
    await waitFor(() => expect(screen.queryByText('Thông tin thương hiệu')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: 'Hồ sơ & khuyến mãi' }));
    expect(await screen.findByRole('button', { name: t.common.imagesUploading })).toBeDisabled();
    act(() => mocks.pickers['Logo']!.onBusyChange(false));
    expect(await screen.findByRole('button', { name: 'Lưu thông tin' })).toBeEnabled();
  });

  it('đang lưu thì cả hai ô ảnh khoá', async () => {
    const hold = { release: (_v: unknown): void => undefined };
    mocks.updateOwnedBrand.mockReturnValueOnce(new Promise((r) => (hold.release = r)));
    renderPage();
    await screen.findByText('Thông tin thương hiệu');
    expect(screen.getByText('Logo')).not.toHaveAttribute('data-disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thông tin' }));
    await waitFor(() => expect(mocks.updateOwnedBrand).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Logo')).toHaveAttribute('data-disabled', 'true'));
    expect(screen.getByText('Ảnh bìa')).toHaveAttribute('data-disabled', 'true');
    await act(async () => hold.release({}));
    await waitFor(() => expect(screen.getByText('Logo')).not.toHaveAttribute('data-disabled'));
  });

  it('ảnh về muộn bằng onChange của lần vẽ đầu: không ghi đè ảnh kia, bìa, hay chữ vừa gõ trong lúc ảnh lên', async () => {
    renderPage();
    await screen.findByText('Thông tin thương hiệu');
    // Ô ảnh thật giữ onChange của lần vẽ lúc chọn tệp rồi gọi sau khi tải xong; ở đây chụp lại đúng bản đó.
    const logoFirstRender = mocks.pickers['Logo']!.onChange;
    const coverFirstRender = mocks.pickers['Ảnh bìa']!.onChange;

    fireEvent.change(screen.getByLabelText('Câu giới thiệu ngắn'), { target: { value: 'Sống xanh' } });
    fireEvent.change(screen.getByLabelText('Nguồn gốc'), { target: { value: 'Đà Lạt' } });
    act(() => coverFirstRender('https://img.test/bia.png'));
    act(() => logoFirstRender('https://img.test/logo.png'));

    fireEvent.click(screen.getByRole('button', { name: 'Lưu thông tin' }));
    await waitFor(() => expect(mocks.updateOwnedBrand).toHaveBeenCalledTimes(1));
    expect(mocks.updateOwnedBrand.mock.calls[0]![0]).toEqual({
      logoUrl: 'https://img.test/logo.png',
      coverUrl: 'https://img.test/bia.png',
      tagline: 'Sống xanh',
      origin: 'Đà Lạt',
      story: '',
    });
  });
});

// W112A: lệnh ghi bị máy chủ từ chối vì hồ sơ/khuyến mãi đã đổi (400/404/409) thì nút giữ khoá tới khi hồ sơ làm mới về (tối đa LOCK_REFRESH_WAIT_MS), kẻo bấm lại trên bản cũ nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về hồ sơ: không tải lại, nhả ngay.
describe('BrandOwnerPage: máy chủ từ chối thì giữ khoá tới khi hồ sơ làm mới về (W112A)', () => {
  type Refresh = () => Promise<unknown>;
  type Opened = { invalidate: MockInstance<QueryClient['invalidateQueries']>; button: () => HTMLElement };
  type Case = {
    name: string;
    /** Lệnh ghi bị giả lập. */
    write: ReturnType<typeof vi.fn>;
    /** Khoá tải lại kỳ vọng khi máy chủ từ chối, đúng thứ tự gọi. */
    keys: string[][];
    open: (refresh: Refresh) => Promise<Opened>;
  };

  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  // TanStack báo cache qua setTimeout(0): đợi một nhịp để `isPending` kịp về false sau khi lệnh xong.
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  /** Dựng trang và thay `invalidateQueries` để soi khoá tải lại và giữ lời hứa tải lại trong tay. */
  const renderLive = (refresh: Refresh) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(<QueryClientProvider client={qc}><BrandOwnerPage /></QueryClientProvider>);
    return invalidate;
  };

  // W113A/W115A: form sửa/hộp xoá đóng khi hồ sơ về (cùng lúc khoá nhả); đã đóng thì phải mở lại (đồng bộ, dùng được cả khi đồng hồ giả) rồi mới lấy nút xác nhận.
  const reopeningEdit = () => {
    if (!screen.queryByRole('button', { name: 'Lưu thay đổi' })) {
      fireEvent.click(screen.getByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
    }
    return screen.getByRole('button', { name: 'Lưu thay đổi' });
  };
  const reopeningDelete = () => {
    if (!screen.queryByTestId('sheet')) {
      fireEvent.click(screen.getByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
    }
    return within(screen.getByTestId('sheet')).getByRole('button', { name: 'Xoá' });
  };

  const CASES: Case[] = [
    {
      name: 'lưu thông tin (saveMut)',
      write: mocks.updateOwnedBrand,
      keys: [['owned-brand']],
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        await screen.findByRole('button', { name: 'Lưu thông tin' });
        return { invalidate, button: () => screen.getByRole('button', { name: 'Lưu thông tin' }) };
      },
    },
    {
      name: 'thêm khuyến mãi (addPromo)',
      write: mocks.createOwnedPromotion,
      keys: [['owned-brand']],
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        await screen.findByText('MUA 2 TẶNG 1');
        fireEvent.change(screen.getByPlaceholderText(/Tiêu đề/), { target: { value: 'Giảm sốc' } });
        return { invalidate, button: () => screen.getByRole('button', { name: 'Thêm khuyến mãi' }) };
      },
    },
    {
      name: 'sửa khuyến mãi (updPromo)',
      write: mocks.updateOwnedPromotion,
      keys: [['owned-brand']],
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        fireEvent.click(await screen.findByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
        return { invalidate, button: reopeningEdit };
      },
    },
    {
      name: 'xoá khuyến mãi (delPromo)',
      write: mocks.deleteOwnedPromotion,
      keys: [['owned-brand']],
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        fireEvent.click(await screen.findByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
        return { invalidate, button: reopeningDelete };
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [mocks.updateOwnedBrand, mocks.createOwnedPromotion, mocks.updateOwnedPromotion, mocks.deleteOwnedPromotion]) {
      fn.mockReset();
      fn.mockResolvedValue({});
    }
    mocks.getOwnedBrand.mockResolvedValue(BRAND);
  });

  describe.each(CASES)('$name', (c) => {
    it.each([
      [400, 'Khuyến mãi này không còn hợp lệ'],
      [404, 'Không tìm thấy nữa'],
      [409, 'Vừa có thay đổi, bạn thử lại nhé'],
    ])('bị từ chối %i: báo lỗi một lần, tải lại đúng khoá, nút giữ khoá tới khi dữ liệu về rồi mới nhả', async (status, message) => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({});
      const refresh = deferred();
      const { invalidate, button } = await c.open(() => refresh.promise);
      fireEvent.click(button());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
      expect(errorSnackbars()).toBe(1);
      expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual(c.keys.map((queryKey) => ({ queryKey })));
      // Đã có lời báo lỗi mà dữ liệu chưa về: nút vẫn bận, chạm thêm không gửi lần hai.
      expect(button()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        fireEvent.click(button());
        fireEvent.click(button());
      });
      expect(c.write).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      expect(errorSnackbars()).toBe(1);
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('%s: không giữ khoá chờ tải lại, khoá nhả ngay', async (_label, error) => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(error).mockResolvedValue({});
      const { invalidate, button } = await c.open(() => new Promise(() => undefined));
      fireEvent.click(button());
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      expect(invalidate).not.toHaveBeenCalled();
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it('tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue({});
      const { button } = await c.open(() => new Promise(() => undefined));
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        fireEvent.click(button());
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
        });
        expect(button()).toHaveAttribute('aria-busy', 'true');
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
      } finally {
        vi.useRealTimers();
      }
      fireEvent.click(button());
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });
  });
});

// W113A: hộp xác nhận xoá (chỉ có nút Xoá) đóng khi máy chủ từ chối hẳn (400/404/409/422); form sửa khuyến mãi (có ô nhập) chỉ đóng khi khuyến mãi không còn hoặc vừa đổi (404/409), 400/422 giữ mở để sửa. Khoá chạm giữ như W112A: 400/404/409 chờ hồ sơ về, 422 và lỗi tạm nhả ngay.
describe('BrandOwnerPage: hộp xoá và form sửa khuyến mãi đóng khi máy chủ từ chối (W113A)', () => {
  type Refresh = () => Promise<unknown>;
  type Case = {
    name: string;
    write: ReturnType<typeof vi.fn>;
    /** Mã làm bề mặt đóng lại. */
    closesOn: number[];
    open: (refresh: Refresh) => Promise<MockInstance<QueryClient['invalidateQueries']>>;
    /** Mở lại sau khi đã đóng. */
    reopen: () => void;
    /** Bấm nút gửi nếu bề mặt đang mở. */
    tap: () => void;
    isOpen: () => boolean;
  };
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const renderLive = (refresh: Refresh) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(<QueryClientProvider client={qc}><BrandOwnerPage /></QueryClientProvider>);
    return invalidate;
  };
  const sheetButton = (name: string) => (screen.queryByTestId('sheet') ? within(screen.getByTestId('sheet')).queryByRole('button', { name }) : null);
  const TEMPORARY: [string, unknown][] = [
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ];
  const STALE: [number, string][] = [
    [400, 'Khuyến mãi này không còn hợp lệ'],
    [404, 'Không tìm thấy nữa'],
    [409, 'Vừa có thay đổi, bạn thử lại nhé'],
  ];

  const CASES: Case[] = [
    {
      name: 'form sửa khuyến mãi (updPromo)',
      write: mocks.updateOwnedPromotion,
      closesOn: [404, 409],
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        fireEvent.click(await screen.findByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
        return invalidate;
      },
      reopen: () => fireEvent.click(screen.getByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' })),
      tap: () => {
        const send = screen.queryByRole('button', { name: 'Lưu thay đổi' });
        if (send) fireEvent.click(send);
      },
      isOpen: () => screen.queryByRole('button', { name: 'Lưu thay đổi' }) !== null,
    },
    {
      name: 'hộp xoá khuyến mãi (delPromo)',
      write: mocks.deleteOwnedPromotion,
      closesOn: [400, 404, 409, 422],
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        fireEvent.click(await screen.findByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
        return invalidate;
      },
      reopen: () => fireEvent.click(screen.getByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' })),
      tap: () => {
        const send = sheetButton('Xoá');
        if (send) fireEvent.click(send);
      },
      isOpen: () => sheetButton('Xoá') !== null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [mocks.updateOwnedBrand, mocks.createOwnedPromotion, mocks.updateOwnedPromotion, mocks.deleteOwnedPromotion]) {
      fn.mockReset();
      fn.mockResolvedValue({});
    }
    mocks.getOwnedBrand.mockResolvedValue(BRAND);
  });

  describe.each(CASES)('$name', (c) => {
    it.each(STALE.filter(([status]) => c.closesOn.includes(status)))('bị từ chối %i: báo lỗi một lần, bề mặt và khoá giữ tới khi hồ sơ về rồi mới đóng và nhả', async (status, message) => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({});
      const refresh = deferred();
      const invalidate = await c.open(() => refresh.promise);
      c.tap();
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
      expect(errorSnackbars()).toBe(1);
      expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual([{ queryKey: ['owned-brand'] }]);
      // W115A: hồ sơ chưa về thì còn mở, bấm tiếp không gửi lần hai; chỉ đóng sau khi hồ sơ về.
      await settle();
      expect(c.isOpen()).toBe(true);
      c.tap();
      await settle();
      expect(c.write).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      await waitFor(() => expect(c.isOpen()).toBe(false));
      expect(errorSnackbars()).toBe(1);
      c.reopen();
      c.tap();
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it.each(STALE.filter(([status]) => !c.closesOn.includes(status)))('bị từ chối %i: giữ mở để sửa ô nhập, khoá vẫn giữ tới khi hồ sơ về rồi mới nhả', async (status, message) => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({});
      const refresh = deferred();
      const invalidate = await c.open(() => refresh.promise);
      c.tap();
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      expect(invalidate).toHaveBeenCalled();
      await settle();
      expect(c.isOpen()).toBe(true);
      c.tap();
      await settle();
      expect(c.write).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      expect(c.isOpen()).toBe(true);
      c.tap();
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      expect(errorSnackbars()).toBe(1);
    });

    it(`bị từ chối 422: ${c.closesOn.includes(422) ? 'đóng' : 'giữ mở'}, không tải lại nên khoá nhả ngay`, async () => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue({});
      const invalidate = await c.open(() => new Promise(() => undefined));
      c.tap();
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await settle();
      expect(invalidate).not.toHaveBeenCalled();
      expect(c.isOpen()).toBe(!c.closesOn.includes(422));
      if (!c.isOpen()) c.reopen();
      c.tap();
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      expect(errorSnackbars()).toBe(1);
    });

    it.each(TEMPORARY)('%s: giữ mở, không tải lại, khoá nhả ngay để thử lại', async (_label, error) => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(error).mockResolvedValue({});
      const invalidate = await c.open(() => new Promise(() => undefined));
      c.tap();
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await settle();
      expect(c.isOpen()).toBe(true);
      expect(invalidate).not.toHaveBeenCalled();
      c.tap();
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      expect(errorSnackbars()).toBe(1);
    });
  });

  it('form đã chuyển sang sửa khuyến mãi khác khi lỗi 409 của khuyến mãi trước về thì giữ nguyên form mới', async () => {
    const slow = deferred();
    mocks.getOwnedBrand.mockResolvedValue({
      ...BRAND,
      promotions: [...BRAND.promotions, { id: 'p2', title: 'Giảm 10%', subtitle: null, couponCode: null, startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z', isActive: true }],
    });
    mocks.updateOwnedPromotion.mockImplementation(() => slow.promise.then(() => Promise.reject(serverError('Vừa có thay đổi, bạn thử lại nhé', 409))));
    renderLive(() => new Promise(() => undefined));
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateOwnedPromotion).toHaveBeenCalledTimes(1));
    // Huỷ bản đang sửa rồi chuyển sang sửa khuyến mãi p2 trong lúc lệnh của p1 còn chạy.
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sửa khuyến mãi Giảm 10%' }));
    expect(screen.getByPlaceholderText(/Tiêu đề/)).toHaveValue('Giảm 10%');
    await act(async () => slow.resolve());
    await waitFor(() => expect(errorSnackbars()).toBe(1));
    await settle();
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Tiêu đề/)).toHaveValue('Giảm 10%');
  });
});

// W115A: thứ tự thống nhất khi máy chủ từ chối: lời báo → hồ sơ về (hoặc quá LOCK_REFRESH_WAIT_MS) → đóng form/hộp → nhả khoá. Bề mặt không đóng trước lúc hồ sơ về; lúc đóng phải còn là đúng khuyến mãi đã gửi lệnh. Không có gì để chờ (422) thì đóng ngay; 400/422 ở form sửa và lỗi tạm vẫn không đóng.
describe('BrandOwnerPage: hộp xoá và form sửa khuyến mãi đóng sau khi hồ sơ về (W115A)', () => {
  type Refresh = () => Promise<unknown>;
  type Case = {
    name: string;
    write: ReturnType<typeof vi.fn>;
    /** Mã làm bề mặt đóng lại. */
    closesOn: number[];
    open: (refresh: Refresh) => Promise<MockInstance<QueryClient['invalidateQueries']>>;
    /** Mở lại khuyến mãi p1 sau khi đã đóng. */
    reopen: () => void;
    /** Nút gửi của bề mặt (null khi đã đóng). */
    submit: () => HTMLElement | null;
    /** Trong lúc lệnh của p1 còn chờ: bỏ p1, mở bề mặt cho khuyến mãi p2. */
    switchToSecond: () => void;
    /** Bề mặt đang mở đúng cho p2. */
    isOnSecond: () => boolean;
  };
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const renderLive = (refresh: Refresh) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(<QueryClientProvider client={qc}><BrandOwnerPage /></QueryClientProvider>);
    return invalidate;
  };
  const sheetButton = (name: string) => (screen.queryByTestId('sheet') ? within(screen.getByTestId('sheet')).queryByRole('button', { name }) : null);
  const SECOND = { id: 'p2', title: 'Giảm 10%', subtitle: null, couponCode: null, startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z', isActive: true };
  const TEMPORARY: [string, unknown][] = [
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ];
  const STALE: [number, string][] = [
    [400, 'Khuyến mãi này không còn hợp lệ'],
    [404, 'Không tìm thấy nữa'],
    [409, 'Vừa có thay đổi, bạn thử lại nhé'],
  ];

  const CASES: Case[] = [
    {
      name: 'form sửa khuyến mãi (updPromo)',
      write: mocks.updateOwnedPromotion,
      closesOn: [404, 409],
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        fireEvent.click(await screen.findByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
        return invalidate;
      },
      reopen: () => fireEvent.click(screen.getByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' })),
      submit: () => screen.queryByRole('button', { name: 'Lưu thay đổi' }),
      switchToSecond: () => {
        fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
        fireEvent.click(screen.getByRole('button', { name: `Sửa khuyến mãi ${SECOND.title}` }));
      },
      isOnSecond: () => screen.queryByRole('button', { name: 'Lưu thay đổi' }) !== null && (screen.getByPlaceholderText(/Tiêu đề/) as HTMLInputElement).value === SECOND.title,
    },
    {
      name: 'hộp xoá khuyến mãi (delPromo)',
      write: mocks.deleteOwnedPromotion,
      closesOn: [400, 404, 409, 422],
      open: async (refresh) => {
        const invalidate = renderLive(refresh);
        fireEvent.click(await screen.findByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
        return invalidate;
      },
      reopen: () => fireEvent.click(screen.getByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' })),
      submit: () => sheetButton('Xoá'),
      switchToSecond: () => {
        fireEvent.click(sheetButton('Huỷ')!);
        fireEvent.click(screen.getByRole('button', { name: `Xoá khuyến mãi ${SECOND.title}` }));
      },
      isOnSecond: () => sheetButton('Xoá') !== null,
    },
  ];
  const tap = (c: Case) => {
    const send = c.submit();
    if (send) fireEvent.click(send);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [mocks.updateOwnedBrand, mocks.createOwnedPromotion, mocks.updateOwnedPromotion, mocks.deleteOwnedPromotion]) {
      fn.mockReset();
      fn.mockResolvedValue({});
    }
    mocks.getOwnedBrand.mockResolvedValue({ ...BRAND, promotions: [...BRAND.promotions, SECOND] });
  });

  describe.each(CASES)('$name', (c) => {
    it.each(STALE.filter(([status]) => c.closesOn.includes(status)))('bị từ chối %i: còn mở và nút còn bận khi hồ sơ chưa về, đóng đúng một lần sau khi về, rồi nhả khoá', async (status, message) => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({});
      const refresh = deferred();
      const invalidate = await c.open(() => refresh.promise);
      tap(c);
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
      await settle();
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(c.submit()).not.toBeNull();
      expect(c.submit()).toHaveAttribute('aria-busy', 'true');
      tap(c);
      await settle();
      expect(c.write).toHaveBeenCalledTimes(1);
      await act(async () => refresh.resolve());
      await settle();
      await waitFor(() => expect(c.submit()).toBeNull());
      expect(errorSnackbars()).toBe(1);
      expect(invalidate).toHaveBeenCalledTimes(1);
      // Đã đóng đúng một lần: mở lại cùng khuyến mãi thì không bị lệnh đóng nào gạt đi, nút đã nhả khoá.
      c.reopen();
      await settle();
      expect(c.submit()).not.toBeNull();
      expect(c.submit()).not.toHaveAttribute('aria-busy');
      tap(c);
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it('tải lại treo mãi: đóng đúng sau LOCK_REFRESH_WAIT_MS, không sớm hơn', async () => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue({});
      await c.open(() => new Promise(() => undefined));
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        tap(c);
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
        });
        expect(c.submit()).not.toBeNull();
        expect(c.submit()).toHaveAttribute('aria-busy', 'true');
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        await waitFor(() => expect(c.submit()).toBeNull());
      } finally {
        vi.useRealTimers();
      }
      c.reopen();
      expect(c.submit()).not.toHaveAttribute('aria-busy');
      tap(c);
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it('đã chuyển sang khuyến mãi khác trong lúc chờ hồ sơ về: bề mặt của khuyến mãi mới không bị đóng', async () => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(serverError('Không tìm thấy nữa', 404)).mockResolvedValue({});
      const refresh = deferred();
      await c.open(() => refresh.promise);
      tap(c);
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await settle();
      expect(c.submit()).not.toBeNull();
      c.switchToSecond();
      expect(c.isOnSecond()).toBe(true);
      await act(async () => refresh.resolve());
      await settle();
      expect(c.isOnSecond()).toBe(true);
      await waitFor(() => expect(c.submit()).not.toHaveAttribute('aria-busy'));
      tap(c);
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
      expect(c.write.mock.calls[1]![0]).toBe('p2');
    });

    if (c.closesOn.includes(422)) {
      it('bị từ chối 422: không có gì để chờ nên đóng ngay, không tải lại', async () => {
        c.write.mockReset();
        c.write.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue({});
        const invalidate = await c.open(() => new Promise(() => undefined));
        tap(c);
        await waitFor(() => expect(errorSnackbars()).toBe(1));
        await waitFor(() => expect(c.submit()).toBeNull());
        expect(invalidate).not.toHaveBeenCalled();
      });
    }

    const HOLDING: [string, unknown, boolean][] = [
      ...(STALE.filter(([status]) => !c.closesOn.includes(status)).map(([status, message]) => [`${status} (lỗi ở ô nhập, có tải lại)`, serverError(message, status), true]) as [string, unknown, boolean][]),
      ...(c.closesOn.includes(422) ? [] : ([['422 (lỗi ở ô nhập, không tải lại)', serverError('Dữ liệu không hợp lệ', 422), false]] as [string, unknown, boolean][])),
      ...TEMPORARY.map(([label, error]) => [label, error, false] as [string, unknown, boolean]),
    ];
    it.each(HOLDING)('%s: bề mặt giữ mở, kể cả sau khi hồ sơ về', async (_label, error, refetches) => {
      c.write.mockReset();
      c.write.mockRejectedValueOnce(error).mockResolvedValue({});
      const refresh = deferred();
      const invalidate = await c.open(() => refresh.promise);
      tap(c);
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await settle();
      expect(invalidate).toHaveBeenCalledTimes(refetches ? 1 : 0);
      expect(c.submit()).not.toBeNull();
      await act(async () => refresh.resolve());
      await settle();
      expect(c.submit()).not.toBeNull();
      await waitFor(() => expect(c.submit()).not.toHaveAttribute('aria-busy'));
      tap(c);
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });
  });

  it('form sửa p1 bị từ chối 409 trễ, form đã chuyển sang p2 và hồ sơ về sau: form p2 giữ nguyên, chữ đã gõ còn đó', async () => {
    mocks.updateOwnedPromotion.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue({});
    const refresh = deferred();
    renderLive(() => refresh.promise);
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(errorSnackbars()).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    fireEvent.click(screen.getByRole('button', { name: `Sửa khuyến mãi ${SECOND.title}` }));
    fireEvent.change(screen.getByPlaceholderText(/Tiêu đề/), { target: { value: 'Giảm 10% hôm nay' } });
    await act(async () => refresh.resolve());
    await settle();
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Tiêu đề/)).toHaveValue('Giảm 10% hôm nay');
  });
});

// W116A: phản hồi muộn (từ chối sau khi hồ sơ về, hoặc báo xong) của lệnh gửi ở lần sửa/lần mở trước không được đóng form hay hộp mà khách đã đóng rồi mở lại (kể cả CÙNG khuyến mãi) và không xoá chữ đang gõ. Lời báo, tải lại hồ sơ và nhả khoá vẫn chạy như cũ.
describe('BrandOwnerPage: phản hồi muộn của lần sửa/lần mở trước không đóng lần sau (W116A)', () => {
  type Refresh = () => Promise<unknown>;
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter((c) => c[0].type === 'error').length;
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const renderLive = (refresh: Refresh) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockImplementation((() => refresh()) as never);
    render(<QueryClientProvider client={qc}><BrandOwnerPage /></QueryClientProvider>);
    return invalidate;
  };
  const sheetButton = (name: string) => (screen.queryByTestId('sheet') ? within(screen.getByTestId('sheet')).queryByRole('button', { name }) : null);
  const SECOND = { id: 'p2', title: 'Giảm 10%', subtitle: null, couponCode: null, startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z', isActive: true };
  const editButton = (title = 'MUA 2 TẶNG 1') => screen.getByRole('button', { name: `Sửa khuyến mãi ${title}` });
  const deleteButton = (title = 'MUA 2 TẶNG 1') => screen.getByRole('button', { name: `Xoá khuyến mãi ${title}` });
  const titleInput = () => screen.getByPlaceholderText(/Tiêu đề/) as HTMLInputElement;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [mocks.updateOwnedBrand, mocks.createOwnedPromotion, mocks.updateOwnedPromotion, mocks.deleteOwnedPromotion]) {
      fn.mockReset();
      fn.mockResolvedValue({});
    }
    mocks.getOwnedBrand.mockResolvedValue({ ...BRAND, promotions: [...BRAND.promotions, SECOND] });
  });

  describe('form sửa khuyến mãi (updPromo)', () => {
    it('bị từ chối 409 trễ: bấm Huỷ rồi sửa lại CHÍNH khuyến mãi đó và gõ chữ mới, hồ sơ về sau thì form mới còn mở, chữ còn nguyên; lời báo, tải lại và nhả khoá vẫn chạy', async () => {
      mocks.updateOwnedPromotion.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue({});
      const refresh = deferred();
      const invalidate = renderLive(() => refresh.promise);
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await settle();
      expect(invalidate).toHaveBeenCalledTimes(1);
      // Lỗi đã về, hồ sơ chưa về: khách huỷ rồi sửa lại đúng khuyến mãi đó và đang gõ.
      fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
      fireEvent.click(editButton());
      fireEvent.change(titleInput(), { target: { value: 'Tiêu đề đang gõ' } });
      await act(async () => refresh.resolve());
      await settle();
      expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument();
      expect(titleInput()).toHaveValue('Tiêu đề đang gõ');
      expect(errorSnackbars()).toBe(1);
      expect(invalidate).toHaveBeenCalledTimes(1);
      // Khoá đã nhả: bấm Lưu gửi lệnh thứ hai, kèm chữ đang gõ.
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).not.toHaveAttribute('aria-busy'));
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      await waitFor(() => expect(mocks.updateOwnedPromotion).toHaveBeenCalledTimes(2));
      expect(mocks.updateOwnedPromotion).toHaveBeenLastCalledWith('p1', expect.objectContaining({ title: 'Tiêu đề đang gõ' }));
    });

    it('báo xong trễ: bấm Huỷ rồi sửa lại CHÍNH khuyến mãi đó và gõ chữ mới, lệnh cũ xong sau thì form mới còn mở, chữ còn nguyên; lời báo và tải lại hồ sơ vẫn chạy', async () => {
      const slow = deferred();
      mocks.updateOwnedPromotion.mockImplementation(() => slow.promise.then(() => ({})));
      const invalidate = renderLive(() => Promise.resolve());
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      await waitFor(() => expect(mocks.updateOwnedPromotion).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
      fireEvent.click(editButton());
      fireEvent.change(titleInput(), { target: { value: 'Tiêu đề đang gõ' } });
      await act(async () => slow.resolve());
      await settle();
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cập nhật khuyến mãi', type: 'success' });
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument();
      expect(titleInput()).toHaveValue('Tiêu đề đang gõ');
    });

    it('báo xong khi form vẫn là lần sửa đã gửi lệnh: form đóng và ô được xoá như cũ', async () => {
      const slow = deferred();
      mocks.updateOwnedPromotion.mockImplementation(() => slow.promise.then(() => ({})));
      renderLive(() => Promise.resolve());
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      await waitFor(() => expect(mocks.updateOwnedPromotion).toHaveBeenCalledTimes(1));
      await act(async () => slow.resolve());
      await settle();
      expect(screen.queryByRole('button', { name: 'Lưu thay đổi' })).toBeNull();
      expect(titleInput()).toHaveValue('');
    });
  });

  describe('hộp xoá khuyến mãi (delPromo)', () => {
    it('bị từ chối 409 trễ: đóng hộp rồi mở lại cho CHÍNH khuyến mãi đó, hồ sơ về sau thì hộp mới còn mở; lời báo, tải lại và nhả khoá vẫn chạy', async () => {
      mocks.deleteOwnedPromotion.mockRejectedValueOnce(serverError('Vừa có thay đổi, bạn thử lại nhé', 409)).mockResolvedValue({});
      const refresh = deferred();
      const invalidate = renderLive(() => refresh.promise);
      fireEvent.click(await screen.findByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
      fireEvent.click(sheetButton('Xoá')!);
      await waitFor(() => expect(errorSnackbars()).toBe(1));
      await settle();
      expect(invalidate).toHaveBeenCalledTimes(1);
      fireEvent.click(sheetButton('Huỷ')!);
      expect(sheetButton('Xoá')).toBeNull();
      fireEvent.click(deleteButton());
      expect(sheetButton('Xoá')).not.toBeNull();
      await act(async () => refresh.resolve());
      await settle();
      expect(sheetButton('Xoá')).not.toBeNull();
      expect(errorSnackbars()).toBe(1);
      expect(invalidate).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(sheetButton('Xoá')).not.toHaveAttribute('aria-busy'));
      fireEvent.click(sheetButton('Xoá')!);
      await waitFor(() => expect(mocks.deleteOwnedPromotion).toHaveBeenCalledTimes(2));
    });

    it('báo xong trễ: đóng hộp rồi mở lại cho CHÍNH khuyến mãi đó, lệnh cũ xong sau thì hộp mới còn mở; tải lại hồ sơ vẫn chạy', async () => {
      const slow = deferred();
      mocks.deleteOwnedPromotion.mockImplementation(() => slow.promise.then(() => ({})));
      const invalidate = renderLive(() => Promise.resolve());
      fireEvent.click(await screen.findByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
      fireEvent.click(sheetButton('Xoá')!);
      await waitFor(() => expect(mocks.deleteOwnedPromotion).toHaveBeenCalledTimes(1));
      fireEvent.click(sheetButton('Huỷ')!);
      fireEvent.click(deleteButton());
      await act(async () => slow.resolve());
      await settle();
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(sheetButton('Xoá')).not.toBeNull();
    });

    it('báo xong trễ: hộp đã mở cho khuyến mãi KHÁC thì không bị đóng theo lệnh xoá của khuyến mãi trước', async () => {
      const slow = deferred();
      mocks.deleteOwnedPromotion.mockImplementation(() => slow.promise.then(() => ({})));
      renderLive(() => Promise.resolve());
      fireEvent.click(await screen.findByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
      fireEvent.click(sheetButton('Xoá')!);
      await waitFor(() => expect(mocks.deleteOwnedPromotion).toHaveBeenCalledTimes(1));
      fireEvent.click(sheetButton('Huỷ')!);
      fireEvent.click(deleteButton(SECOND.title));
      await act(async () => slow.resolve());
      await settle();
      expect(sheetButton('Xoá')).not.toBeNull();
      fireEvent.click(sheetButton('Xoá')!);
      await waitFor(() => expect(mocks.deleteOwnedPromotion).toHaveBeenCalledTimes(2));
      expect(mocks.deleteOwnedPromotion).toHaveBeenLastCalledWith('p2');
    });

    it('báo xong khi hộp vẫn là lần mở đã gửi lệnh: hộp đóng như cũ', async () => {
      const slow = deferred();
      mocks.deleteOwnedPromotion.mockImplementation(() => slow.promise.then(() => ({})));
      renderLive(() => Promise.resolve());
      fireEvent.click(await screen.findByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
      fireEvent.click(sheetButton('Xoá')!);
      await waitFor(() => expect(mocks.deleteOwnedPromotion).toHaveBeenCalledTimes(1));
      await act(async () => slow.resolve());
      await settle();
      expect(sheetButton('Xoá')).toBeNull();
    });

    it('xoá đúng khuyến mãi đang sửa dở (form mở trước lúc gửi): form sửa được đóng và xoá ô như cũ', async () => {
      const slow = deferred();
      mocks.deleteOwnedPromotion.mockImplementation(() => slow.promise.then(() => ({})));
      renderLive(() => Promise.resolve());
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa khuyến mãi MUA 2 TẶNG 1' }));
      fireEvent.click(deleteButton());
      fireEvent.click(sheetButton('Xoá')!);
      await waitFor(() => expect(mocks.deleteOwnedPromotion).toHaveBeenCalledTimes(1));
      await act(async () => slow.resolve());
      await settle();
      expect(screen.queryByRole('button', { name: 'Lưu thay đổi' })).toBeNull();
      expect(titleInput()).toHaveValue('');
      expect(sheetButton('Xoá')).toBeNull();
    });

    it('lệnh xoá khuyến mãi gửi khi form sửa còn đóng: mở sửa chính khuyến mãi đó sau lúc gửi và gõ chữ, lệnh xong sau thì form sửa mới giữ nguyên chữ đang gõ', async () => {
      const slow = deferred();
      mocks.deleteOwnedPromotion.mockImplementation(() => slow.promise.then(() => ({})));
      renderLive(() => Promise.resolve());
      fireEvent.click(await screen.findByRole('button', { name: 'Xoá khuyến mãi MUA 2 TẶNG 1' }));
      fireEvent.click(sheetButton('Xoá')!);
      await waitFor(() => expect(mocks.deleteOwnedPromotion).toHaveBeenCalledTimes(1));
      fireEvent.click(sheetButton('Huỷ')!);
      fireEvent.click(editButton());
      fireEvent.change(titleInput(), { target: { value: 'Tiêu đề đang gõ' } });
      await act(async () => slow.resolve());
      await settle();
      expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument();
      expect(titleInput()).toHaveValue('Tiêu đề đang gõ');
    });
  });
});
