import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveRecentCustomer, loadRecentCustomers } from './recent-customers';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  createCtvOrder: vi.fn(),
  quoteCtvOrder: vi.fn(),
  suggestProducts: vi.fn(),
  fetchProduct: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'ctv1' } }),
}));
vi.mock('../geo-picker', () => ({
  EMPTY_GEO: { province: '', provinceCode: '', ward: '', wardCode: '' },
  GeoPicker: ({ value, onChange }: { value: { province: string; ward: string }; onChange: (v: unknown) => void }) => (
    <div>
      <div data-testid="geo">{value.province ? `${value.province} / ${value.ward}` : 'chưa chọn địa bàn'}</div>
      <button
        type="button"
        onClick={() =>
          onChange({ province: 'Đà Nẵng', provinceCode: '84_VN48', ward: 'Phường Hải Châu', wardCode: '84_VN4801' })
        }
      >
        Chọn địa bàn thử
      </button>
    </div>
  ),
}));
vi.mock('../../services/shop-api', () => ({
  suggestProducts: mocks.suggestProducts,
  fetchProduct: mocks.fetchProduct,
}));
vi.mock('../../services/affiliate-api', () => ({ createCtvOrder: mocks.createCtvOrder, quoteCtvOrder: mocks.quoteCtvOrder }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { CtvOrderSheet } from './ctv-order-sheet';

const AN = {
  recipient: 'Nguyễn An', phone: '0901234567', street: '12 Lê Lợi',
  province: 'Hà Nội', provinceCode: '84_VN01', ward: 'Phường Ba Đình', wardCode: '84_VN0101', usedAt: 0,
};
const BINH = {
  recipient: 'Trần Bình', phone: '0912345678', street: '5 Nguyễn Huệ',
  province: 'TP Hồ Chí Minh', provinceCode: '84_VN79', ward: 'Phường Bến Nghé', wardCode: '84_VN7901', usedAt: 0,
};

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CtvOrderSheet onClose={() => {}} />
    </QueryClientProvider>,
  );
}

/** zmp-ui Input vẽ nhãn là phần tử riêng (không htmlFor) nên tìm ô nhập đi kèm nhãn hiển thị. */
function inputNear(labelText: string): HTMLInputElement {
  let node: HTMLElement | null = screen.getByText(labelText);
  while (node && !node.querySelector('input')) node = node.parentElement;
  const input = node?.querySelector('input');
  if (!input) throw new Error('Không thấy ô nhập cạnh nhãn: ' + labelText);
  return input;
}

/** `settle: false` giữ báo giá đang tính (nút Tạo đơn khoá); mặc định đợi báo giá xong để các test bấm Tạo đơn như CTV thật. */
async function addProduct(opts: { settle?: boolean } = {}) {
  fireEvent.change(screen.getByPlaceholderText('Tìm sản phẩm để thêm…'), { target: { value: 'nước' } });
  fireEvent.click(await screen.findByText('Nước rửa chén'));
  fireEvent.click(await screen.findByText('Chanh'));
  await screen.findByRole('button', { name: 'Giảm số lượng' });
  if (opts.settle === false) return;
  await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo đơn hộ khách' })).not.toBeDisabled());
}

describe('CtvOrderSheet — khách gần đây, giảm chạm (C-064)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.suggestProducts.mockResolvedValue([{ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65_000 }]);
    mocks.fetchProduct.mockResolvedValue({
      name: 'Nước rửa chén',
      variations: [{ id: 'var1', name: 'Chanh', retailPrice: 65_000, salePrice: null, stock: 10 }],
    });
    mocks.createCtvOrder.mockResolvedValue({ code: 'TUBU9', total: 65_000, items: [] });
    mocks.quoteCtvOrder.mockRejectedValue(new Error('chưa có báo giá'));
  });

  it('chưa có khách gần đây thì không hiện hàng chip', () => {
    renderSheet();
    expect(screen.queryByText('Khách gần đây')).toBeNull();
  });

  it('có khách gần đây: hiện chip theo tên + 3 số cuối SĐT, chạm là điền sẵn cả 5 trường', async () => {
    saveRecentCustomer('ctv1', AN, 2);
    saveRecentCustomer('ctv1', BINH, 1);
    renderSheet();
    expect(screen.getByText('Khách gần đây')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nguyễn An · …567' }));
    expect(inputNear('Tên người nhận')).toHaveValue('Nguyễn An');
    expect(inputNear('Số điện thoại')).toHaveValue('0901234567');
    expect(inputNear('Địa chỉ (số nhà, đường)')).toHaveValue('12 Lê Lợi');
    expect(screen.getByTestId('geo')).toHaveTextContent('Hà Nội / Phường Ba Đình');
  });

  it('chip "Khách mới" xoá thông tin người nhận để nhập khách khác', () => {
    saveRecentCustomer('ctv1', AN, 1);
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Nguyễn An · …567' }));
    fireEvent.click(screen.getByRole('button', { name: 'Khách mới' }));
    expect(inputNear('Tên người nhận')).toHaveValue('');
    expect(inputNear('Số điện thoại')).toHaveValue('');
    expect(screen.getByTestId('geo')).toHaveTextContent('chưa chọn địa bàn');
  });

  it('luồng nhanh: chọn khách gần đây + thêm sản phẩm + tạo đơn gửi đúng thông tin khách', async () => {
    saveRecentCustomer('ctv1', AN, 1);
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Nguyễn An · …567' }));
    await addProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn hộ khách' }));
    await waitFor(() => expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1));
    const dto = mocks.createCtvOrder.mock.calls[0]![0];
    expect(dto.customer).toMatchObject({
      recipient: 'Nguyễn An', phone: '0901234567', street: '12 Lê Lợi',
      province: 'Hà Nội', provinceCode: '84_VN01', ward: 'Phường Ba Đình', wardCode: '84_VN0101',
    });
    expect(dto.items).toEqual([{ variationId: 'var1', quantity: 1 }]);
    expect(dto.paymentMethod).toBe('COD');
  });

  it('đang gửi đơn: nút hiện spinner (không bị disabled), bấm lại không tạo đơn lần 2', async () => {
    mocks.createCtvOrder.mockReturnValue(new Promise(() => {}));
    saveRecentCustomer('ctv1', AN, 1);
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Nguyễn An · …567' }));
    await addProduct();
    const btn = screen.getByRole('button', { name: 'Tạo đơn hộ khách' });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveClass('zaui-btn-loading'));
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1);
  });

  it('khách nhập tay, đơn tạo thành công thì được nhớ cho lần sau (SĐT bỏ khoảng trắng)', async () => {
    renderSheet();
    fireEvent.change(inputNear('Tên người nhận'), { target: { value: 'Lê Cúc' } });
    fireEvent.change(inputNear('Số điện thoại'), { target: { value: '0933 444 555' } });
    fireEvent.change(inputNear('Địa chỉ (số nhà, đường)'), { target: { value: '9 Trần Phú' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chọn địa bàn thử' }));
    await addProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn hộ khách' }));
    await screen.findByText(/Đã tạo đơn hộ khách/);
    expect(loadRecentCustomers('ctv1')).toEqual([
      expect.objectContaining({
        recipient: 'Lê Cúc', phone: '0933444555', street: '9 Trần Phú',
        province: 'Đà Nẵng', provinceCode: '84_VN48', ward: 'Phường Hải Châu', wardCode: '84_VN4801',
      }),
    ]);
  });

  it('đơn lỗi (máy chủ từ chối) thì KHÔNG nhớ khách', async () => {
    mocks.createCtvOrder.mockRejectedValue(new Error('hết hàng'));
    saveRecentCustomer('ctv1', AN, 1);
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Khách mới' }));
    fireEvent.change(inputNear('Tên người nhận'), { target: { value: 'Lê Cúc' } });
    fireEvent.change(inputNear('Số điện thoại'), { target: { value: '0933444555' } });
    fireEvent.change(inputNear('Địa chỉ (số nhà, đường)'), { target: { value: '9 Trần Phú' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chọn địa bàn thử' }));
    await addProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn hộ khách' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(loadRecentCustomers('ctv1').map((c) => c.recipient)).toEqual(['Nguyễn An']);
  });

  it('sau khi tạo đơn thành công, khách vừa dùng đứng đầu danh sách gần đây', async () => {
    saveRecentCustomer('ctv1', AN, 1);
    saveRecentCustomer('ctv1', BINH, 2);
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Nguyễn An · …567' }));
    await addProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn hộ khách' }));
    await screen.findByText(/Đã tạo đơn hộ khách/);
    expect(loadRecentCustomers('ctv1').map((c) => c.recipient)).toEqual(['Nguyễn An', 'Trần Bình']);
  });

  it('nút tạo đơn dùng Button DS v2 (cao >= 44px) và các nút tăng/giảm/xoá có vùng chạm 44px', async () => {
    saveRecentCustomer('ctv1', AN, 1);
    renderSheet();
    await addProduct();
    expect(screen.getByRole('button', { name: 'Tạo đơn hộ khách' }).style.minHeight).toBe('44px');
    for (const name of ['Giảm số lượng', 'Tăng số lượng', 'Xoá sản phẩm']) {
      const btn = screen.getByRole('button', { name });
      expect(btn.style.width).toBe('44px');
      expect(btn.style.height).toBe('44px');
    }
  });

  it('nhập thiếu: báo lỗi từng trường bằng icon DS, không còn ký tự ⚠ trong chữ', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn hộ khách' }));
    expect(screen.getAllByText('Vui lòng nhập')).toHaveLength(3);
    expect(screen.getByText('Thêm ít nhất 1 sản phẩm')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('⚠');
  });

  it('chọn Chuyển khoản: thẻ báo aria-pressed, đơn gửi BANK_TRANSFER và có lối mở trang thanh toán', async () => {
    saveRecentCustomer('ctv1', AN, 1);
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Nguyễn An · …567' }));
    await addProduct();
    const cod = screen.getByRole('button', { name: /COD/ });
    const bank = screen.getByRole('button', { name: /Chuyển khoản/ });
    expect(cod).toHaveAttribute('aria-pressed', 'true');
    expect(bank).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(bank);
    expect(bank).toHaveAttribute('aria-pressed', 'true');
    expect(cod).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn hộ khách' }));
    await waitFor(() => expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1));
    expect(mocks.createCtvOrder.mock.calls[0]![0].paymentMethod).toBe('BANK_TRANSFER');
    fireEvent.click(await screen.findByRole('button', { name: 'Mở trang thanh toán (gửi khách)' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TUBU9');
  });

  it('phân loại hết hàng không thêm được vào đơn, phân loại còn hàng thì thêm', async () => {
    mocks.fetchProduct.mockResolvedValue({
      name: 'Nước rửa chén',
      variations: [
        { id: 'var0', name: 'Cam', retailPrice: 70_000, salePrice: null, stock: 0 },
        { id: 'var1', name: 'Chanh', retailPrice: 65_000, salePrice: null, stock: 10 },
      ],
    });
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText('Tìm sản phẩm để thêm…'), { target: { value: 'nước' } });
    fireEvent.click(await screen.findByText('Nước rửa chén'));
    fireEvent.click(await screen.findByText('Cam'));
    expect(screen.getByText('Tạm hết hàng')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Giảm số lượng' })).toBeNull();
    fireEvent.click(screen.getByText('Chanh'));
    expect(await screen.findByRole('button', { name: 'Giảm số lượng' })).toBeInTheDocument();
  });

  it('gợi ý sản phẩm lỗi tải: có nút Thử lại gọi lại API', async () => {
    mocks.suggestProducts.mockRejectedValueOnce(new Error('mạng lỗi'));
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText('Tìm sản phẩm để thêm…'), { target: { value: 'nước' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.suggestProducts).toHaveBeenCalledTimes(2));
  });
});

describe('CtvOrderSheet — giá như khách tự đặt, kể cả giờ vàng (R4-CHECKOUT-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.suggestProducts.mockResolvedValue([{ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65_000 }]);
    mocks.fetchProduct.mockResolvedValue({
      name: 'Nước rửa chén',
      variations: [{ id: 'var1', name: 'Chanh', retailPrice: 65_000, salePrice: null, stock: 10 }],
    });
  });

  it('đang giờ vàng: dòng hàng, tạm tính, phí giao và tổng lấy từ báo giá của máy chủ (đúng số sẽ ghi vào đơn)', async () => {
    mocks.quoteCtvOrder.mockResolvedValue({
      items: [{ variationId: 'var1', unitPrice: 52_000, quantity: 1, total: 52_000, isFlash: true, flashLimitNotice: null }],
      goods: 52_000, shippingFee: 19_000, total: 71_000,
    });
    renderSheet();
    await addProduct();
    expect(await screen.findByText('Chanh · 52.000đ')).toBeInTheDocument();
    expect(screen.getByText('Giá giờ vàng')).toBeInTheDocument();
    expect(screen.getByTestId('ctv-order-goods')).toHaveTextContent('52.000đ');
    expect(screen.getByTestId('ctv-order-shipping')).toHaveTextContent('19.000đ');
    expect(screen.getByTestId('ctv-order-total')).toHaveTextContent('71.000đ');
    expect(screen.queryByText('Phí ship tính khi tạo đơn')).toBeNull();
    expect(mocks.quoteCtvOrder).toHaveBeenLastCalledWith([{ variationId: 'var1', quantity: 1 }]);
  });

  it('vượt số suất giờ vàng: báo lý do ngay dưới dòng hàng, giá thường', async () => {
    const notice = 'Giá giờ vàng chỉ áp dụng tối đa 1 sản phẩm cho bạn. Giảm số lượng còn 1 để được giá giờ vàng, hoặc mua 2 sản phẩm với giá thường.';
    mocks.quoteCtvOrder.mockImplementation(async (items: { variationId: string; quantity: number }[]) => {
      const q = items[0]!.quantity;
      return q === 1
        ? { items: [{ variationId: 'var1', unitPrice: 52_000, quantity: 1, total: 52_000, isFlash: true, flashLimitNotice: null }], goods: 52_000, shippingFee: 19_000, total: 71_000 }
        : { items: [{ variationId: 'var1', unitPrice: 65_000, quantity: q, total: 65_000 * q, isFlash: false, flashLimitNotice: notice }], goods: 65_000 * q, shippingFee: 19_000, total: 65_000 * q + 19_000 };
    });
    renderSheet();
    await addProduct();
    await screen.findByText('Chanh · 52.000đ');
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(screen.getByText('Chanh · 65.000đ')).toBeInTheDocument();
    expect(screen.getByTestId('ctv-order-total')).toHaveTextContent('149.000đ');
  });

  it('chưa lấy được báo giá: hiện giá niêm yết như trước và ghi phí giao tính khi tạo đơn', async () => {
    mocks.quoteCtvOrder.mockRejectedValue(new Error('mạng lỗi'));
    renderSheet();
    await addProduct();
    await waitFor(() => expect(mocks.quoteCtvOrder).toHaveBeenCalled());
    expect(screen.getByText('Chanh · 65.000đ')).toBeInTheDocument();
    expect(screen.getByText('Phí ship tính khi tạo đơn')).toBeInTheDocument();
    expect(screen.getByTestId('ctv-order-goods')).toHaveTextContent('65.000đ');
  });
});

const rejected = (code: string, message: string) =>
  new AxiosError('Bad Request', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 400,
    data: { statusCode: 400, code, message },
  } as AxiosResponse);

describe('CtvOrderSheet — đơn tạo ra đúng tổng CTV đã báo khách (R7 review #6)', () => {
  const FLASH_QUOTE = {
    items: [{ variationId: 'var1', unitPrice: 52_000, quantity: 1, total: 52_000, isFlash: true, flashLimitNotice: null }],
    goods: 52_000, shippingFee: 19_000, total: 71_000,
  };
  const REGULAR_QUOTE = {
    items: [{ variationId: 'var1', unitPrice: 65_000, quantity: 1, total: 65_000, isFlash: false, flashLimitNotice: null }],
    goods: 65_000, shippingFee: 19_000, total: 84_000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.suggestProducts.mockResolvedValue([{ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65_000 }]);
    mocks.fetchProduct.mockResolvedValue({
      name: 'Nước rửa chén',
      variations: [{ id: 'var1', name: 'Chanh', retailPrice: 65_000, salePrice: null, stock: 10 }],
    });
    mocks.createCtvOrder.mockResolvedValue({ code: 'TUBU9', total: 71_000, items: [] });
  });

  async function readyToSubmit(opts: { settle?: boolean } = {}) {
    saveRecentCustomer('ctv1', AN, 1);
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Nguyễn An · …567' }));
    await addProduct(opts);
  }

  it('tạo đơn gửi kèm tổng đang hiện ở báo giá (expectedTotal)', async () => {
    mocks.quoteCtvOrder.mockResolvedValue(FLASH_QUOTE);
    await readyToSubmit();
    await waitFor(() => expect(screen.getByTestId('ctv-order-total')).toHaveTextContent('71.000đ'));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn hộ khách' }));
    await waitFor(() => expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1));
    expect(mocks.createCtvOrder.mock.calls[0]![0]).toMatchObject({ expectedTotal: 71_000 });
  });

  it('báo giá còn đang tính: bấm Tạo đơn không gửi đơn (không có tổng để bảo vệ); có báo giá rồi mới gửi', async () => {
    let resolveQuote: (v: typeof FLASH_QUOTE) => void = () => {};
    mocks.quoteCtvOrder.mockImplementation(() => new Promise((r) => { resolveQuote = r; }));
    await readyToSubmit({ settle: false });
    await waitFor(() => expect(mocks.quoteCtvOrder).toHaveBeenCalled());
    const submitBtn = screen.getByRole('button', { name: 'Tạo đơn hộ khách' });
    expect(submitBtn).toBeDisabled();
    fireEvent.click(submitBtn);
    expect(mocks.createCtvOrder).not.toHaveBeenCalled();

    resolveQuote(FLASH_QUOTE);
    await waitFor(() => expect(screen.getByTestId('ctv-order-total')).toHaveTextContent('71.000đ'));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn hộ khách' }));
    await waitFor(() => expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1));
    expect(mocks.createCtvOrder.mock.calls[0]![0]).toMatchObject({ expectedTotal: 71_000 });
  });

  it('giờ vàng vừa hết (TOTAL_CHANGED): báo CTV tổng mới, tải lại báo giá, không tạo đơn; bấm lại gửi tổng mới', async () => {
    const message = 'Tổng tiền đơn vừa thay đổi từ 71.000đ thành 84.000đ do giá, phí giao hoặc ưu đãi vừa thay đổi. Vui lòng xem lại trước khi đặt.';
    let ended = false;
    mocks.quoteCtvOrder.mockImplementation(async () => (ended ? REGULAR_QUOTE : FLASH_QUOTE));
    mocks.createCtvOrder.mockRejectedValueOnce(rejected('TOTAL_CHANGED', message)).mockResolvedValue({ code: 'TUBU9', total: 84_000, items: [] });
    await readyToSubmit();
    await waitFor(() => expect(screen.getByTestId('ctv-order-total')).toHaveTextContent('71.000đ'));

    ended = true;
    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn hộ khách' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveTextContent('Báo lại khách tổng tiền mới bên dưới rồi bấm tạo đơn lần nữa.');
    await waitFor(() => expect(screen.getByTestId('ctv-order-total')).toHaveTextContent('84.000đ'));
    expect(screen.getByText('Chanh · 65.000đ')).toBeInTheDocument();
    expect(screen.queryByText(/Đã tạo đơn hộ khách/)).toBeNull();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn hộ khách' }));
    await screen.findByText(/Đã tạo đơn hộ khách/);
    expect(mocks.createCtvOrder.mock.calls[1]![0]).toMatchObject({ expectedTotal: 84_000 });
  });

  it('báo giá từ chối hàng gian hàng đối tác tự giao: hiện lý do ngay trên form, trước khi tạo đơn', async () => {
    const message = 'Sản phẩm "Nước rửa chén" do gian hàng đối tác tự giao, chỉ đặt được qua giỏ hàng.';
    mocks.quoteCtvOrder.mockRejectedValue(rejected('NOT_TUBU_FULFILLED', message));
    await readyToSubmit();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mocks.createCtvOrder).not.toHaveBeenCalled();
  });
});

// /search/suggest trả [] cho từ khoá chưa đủ 2 ký tự (sau khi gấp dấu): gọi từ 1 ký tự chỉ cho ra "Không tìm thấy" sai.
describe('CtvOrderSheet — ô tìm sản phẩm chỉ gợi ý từ 2 ký tự', () => {
  const HINT = 'Nhập ít nhất 2 ký tự';
  const searchBox = () => screen.getByPlaceholderText('Tìm sản phẩm để thêm…');
  const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.suggestProducts.mockResolvedValue([{ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65_000 }]);
  });

  it('1 ký tự → không gọi API, báo "Nhập ít nhất 2 ký tự" thay cho "Không tìm thấy"', async () => {
    renderSheet();
    fireEvent.change(searchBox(), { target: { value: 'n' } });
    expect(screen.getByText(HINT)).toBeInTheDocument();
    await wait(450);
    expect(mocks.suggestProducts).not.toHaveBeenCalled();
    expect(screen.queryByText('Không tìm thấy sản phẩm phù hợp')).toBeNull();
  });

  it('gõ tới 2 ký tự → gọi API, câu báo biến mất; xoá về 1 ký tự → gợi ý ẩn ngay', async () => {
    renderSheet();
    fireEvent.change(searchBox(), { target: { value: 'nư' } });
    expect(await screen.findByText('Nước rửa chén')).toBeInTheDocument();
    expect(mocks.suggestProducts).toHaveBeenCalledWith('nư');
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.change(searchBox(), { target: { value: 'n' } });
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(screen.queryByText('Nước rửa chén')).toBeNull();
  });
});
