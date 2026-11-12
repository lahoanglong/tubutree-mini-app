import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { REQUIRED_FIELD } from '@tubutree/app-core/client-copy';
import { HttpError } from '../../services/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { LOCK_REFRESH_WAIT_MS } from '../../utils/settle-within';
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

  it('ô ghi chú giới hạn 500 ký tự như API', () => {
    renderSheet();
    expect(document.querySelector('textarea')?.getAttribute('maxlength')).toBe('500');
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
    expect(screen.getAllByText(REQUIRED_FIELD)).toHaveLength(3);
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
    expect(screen.getByText('Giá Giờ vàng')).toBeInTheDocument();
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
  new HttpError('Bad Request', 'ERR_BAD_REQUEST', {
    status: 400,
    data: { statusCode: 400, code, message },
  });

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

const REGULAR = {
  items: [{ variationId: 'var1', unitPrice: 65_000, quantity: 1, total: 65_000, isFlash: false, flashLimitNotice: null }],
  goods: 65_000, shippingFee: 19_000, total: 84_000, blockedPaymentMethods: {},
};
const timeoutError = () => new HttpError('timeout of 15000ms exceeded', 'ECONNABORTED');
const submitBtn = () => screen.getByRole('button', { name: 'Tạo đơn hộ khách' });

function resetMocks() {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.suggestProducts.mockResolvedValue([{ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65_000 }]);
  mocks.fetchProduct.mockResolvedValue({
    name: 'Nước rửa chén',
    variations: [{ id: 'var1', name: 'Chanh', retailPrice: 65_000, salePrice: null, stock: 10 }],
  });
  mocks.quoteCtvOrder.mockResolvedValue(REGULAR);
  mocks.createCtvOrder.mockResolvedValue({ code: 'TUBU9', total: 84_000, items: [] });
}

async function readyWithAn() {
  saveRecentCustomer('ctv1', AN, 1);
  renderSheet();
  fireEvent.click(screen.getByRole('button', { name: 'Nguyễn An · …567' }));
  await addProduct();
}

const keyOfCall = (n: number) => mocks.createCtvOrder.mock.calls[n]![1] as string;

describe('CtvOrderSheet — mạng chậm không tạo đơn thứ hai (R5-CHECKOUT-1)', () => {
  beforeEach(resetMocks);

  it('mỗi lần tạo đơn gửi kèm Idempotency-Key', async () => {
    await readyWithAn();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1));
    expect(keyOfCall(0)).toEqual(expect.any(String));
    expect(keyOfCall(0).length).toBeGreaterThan(0);
  });

  it('quá thời gian: tự kiểm tra lại bằng đúng key cũ và báo "Đang kiểm tra đơn…", không mời CTV bấm lại; lần kiểm tra trả đơn đã tạo → màn thành công', async () => {
    let resolveCheck: (v: unknown) => void = () => {};
    mocks.createCtvOrder
      .mockRejectedValueOnce(timeoutError())
      .mockImplementationOnce(() => new Promise((r) => { resolveCheck = r; }));
    await readyWithAn();
    fireEvent.click(submitBtn());

    expect(await screen.findByText(/Đang kiểm tra đơn…/)).toBeInTheDocument();
    expect(submitBtn()).toHaveClass('zaui-btn-loading');
    await waitFor(() => expect(mocks.createCtvOrder).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(keyOfCall(1)).toBe(keyOfCall(0));
    expect(mocks.openSnackbar).not.toHaveBeenCalled();

    resolveCheck({ code: 'TUBU9', total: 84_000, items: [] });
    await screen.findByText(/Đã tạo đơn hộ khách/);
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(2);
  });

  it('kiểm tra lại vẫn không được: báo ngay trên form (không snackbar), nút thành "Gửi lại đơn" và gửi đúng key cũ', async () => {
    mocks.createCtvOrder
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce({ code: 'TUBU9', total: 84_000, items: [] });
    await readyWithAn();
    fireEvent.click(submitBtn());

    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent('Mạng yếu nên chưa biết đơn đã được tạo chưa.');
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    expect(keyOfCall(1)).toBe(keyOfCall(0));

    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại đơn' }));
    await screen.findByText(/Đã tạo đơn hộ khách/);
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(3);
    expect(keyOfCall(2)).toBe(keyOfCall(0));
  });

  it('chưa rõ kết quả rồi CTV sửa đơn: cảnh báo đơn trước có thể đã tạo; gửi là đơn mới với key mới', async () => {
    mocks.createCtvOrder
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce({ code: 'TUBU9', total: 149_000, items: [] });
    await readyWithAn();
    fireEvent.click(submitBtn());
    await screen.findByRole('button', { name: 'Gửi lại đơn' }, { timeout: 4000 });

    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Đơn gửi lúc nãy có thể đã được tạo');
    await waitFor(() => expect(submitBtn()).not.toBeDisabled());
    fireEvent.click(submitBtn());
    await screen.findByText(/Đã tạo đơn hộ khách/);
    expect(keyOfCall(2)).not.toBe(keyOfCall(0));
  });

  it('máy chủ từ chối (400): không tự gửi lại, báo lỗi như cũ', async () => {
    mocks.createCtvOrder.mockRejectedValueOnce(rejected('OUT_OF_STOCK', 'Sản phẩm "Nước rửa chén" không đủ tồn kho.'));
    await readyWithAn();
    fireEvent.click(submitBtn());
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Sản phẩm "Nước rửa chén" không đủ tồn kho.' })),
    );
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1);
  });

  it('đơn tạo xong, "Lên đơn khác" với cùng khách và cùng món → đơn mới, key mới', async () => {
    await readyWithAn();
    fireEvent.click(submitBtn());
    await screen.findByText(/Đã tạo đơn hộ khách/);
    fireEvent.click(screen.getByRole('button', { name: 'Lên đơn khác' }));
    await addProduct();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.createCtvOrder).toHaveBeenCalledTimes(2));
    expect(keyOfCall(1)).not.toBe(keyOfCall(0));
  });
});

describe('CtvOrderSheet — trần COD 5.000.000đ báo trước khi gửi (R5-CHECKOUT-3)', () => {
  const COD_OVER = 'Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ, đơn này là 5.400.000đ. Vui lòng chọn chuyển khoản.';
  const BIG = {
    items: [{ variationId: 'var1', unitPrice: 5_381_000, quantity: 1, total: 5_381_000, isFlash: false, flashLimitNotice: null }],
    goods: 5_381_000, shippingFee: 19_000, total: 5_400_000, blockedPaymentMethods: { COD: COD_OVER },
  };
  beforeEach(resetMocks);

  it('báo giá khoá COD: thẻ COD mờ kèm lý do ngay dưới, tự chuyển sang Chuyển khoản, đơn gửi BANK_TRANSFER', async () => {
    mocks.quoteCtvOrder.mockResolvedValue(BIG);
    await readyWithAn();
    const cod = screen.getByRole('button', { name: /COD/ });
    const bank = screen.getByRole('button', { name: /Chuyển khoản/ });
    await waitFor(() => expect(bank).toHaveAttribute('aria-pressed', 'true'));
    expect(cod).toHaveAttribute('aria-disabled', 'true');
    expect(cod).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(COD_OVER)).toBeInTheDocument();

    fireEvent.click(cod);
    expect(bank).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1));
    expect(mocks.createCtvOrder.mock.calls[0]![0].paymentMethod).toBe('BANK_TRANSFER');
  });

  it('báo giá không khoá COD: giữ COD mặc định, không có câu trần COD', async () => {
    await readyWithAn();
    expect(screen.getByRole('button', { name: /COD/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /COD/ })).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText(/chỉ nhận đơn tối đa/)).toBeNull();
  });

  it('báo giá cũ còn cho COD mà máy chủ từ chối (PAYMENT_METHOD_NOT_ALLOWED) → tải lại báo giá, khoá COD và chuyển khoản', async () => {
    let blocked = false;
    mocks.quoteCtvOrder.mockImplementation(async () => (blocked ? BIG : { ...BIG, blockedPaymentMethods: {} }));
    mocks.createCtvOrder.mockRejectedValueOnce(rejected('PAYMENT_METHOD_NOT_ALLOWED', COD_OVER));
    await readyWithAn();
    blocked = true;
    fireEvent.click(submitBtn());
    await waitFor(() => expect(screen.getByRole('button', { name: /Chuyển khoản/ })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: /COD/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(COD_OVER)).toBeInTheDocument();
  });
});

describe('CtvOrderSheet — SĐT và tên người nhận cùng luật với máy chủ (R5-CHECKOUT-2)', () => {
  beforeEach(resetMocks);

  async function fillManual(recipient: string, phone: string) {
    renderSheet();
    fireEvent.change(inputNear('Tên người nhận'), { target: { value: recipient } });
    fireEvent.change(inputNear('Số điện thoại'), { target: { value: phone } });
    fireEvent.change(inputNear('Địa chỉ (số nhà, đường)'), { target: { value: '9 Trần Phú' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chọn địa bàn thử' }));
    await addProduct();
    fireEvent.click(submitBtn());
  }

  it('SĐT gõ có dấu chấm hay 84 đầu vẫn hợp lệ, gửi dạng 0xxxxxxxxx', async () => {
    await fillManual('  Lê Cúc ', '84.933.444.555');
    await waitFor(() => expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1));
    expect(mocks.createCtvOrder.mock.calls[0]![0].customer).toMatchObject({ recipient: 'Lê Cúc', phone: '0933444555' });
  });

  it('SĐT 9 số không có 0 đầu → báo chưa đúng, không gửi', async () => {
    await fillManual('Lê Cúc', '933444555');
    expect(screen.getByText('Số điện thoại chưa đúng')).toBeInTheDocument();
    expect(mocks.createCtvOrder).not.toHaveBeenCalled();
  });

  it('tên người nhận 1 ký tự → báo cần ít nhất 2 ký tự, không gửi', async () => {
    await fillManual(' A ', '0933444555');
    expect(screen.getByText('Tên người nhận cần ít nhất 2 ký tự')).toBeInTheDocument();
    expect(mocks.createCtvOrder).not.toHaveBeenCalled();
  });
});

describe('CtvOrderSheet — khoá đồng bộ khi tạo đơn hộ khách (W82A)', () => {
  beforeEach(resetMocks);

  const deferredOrder = () => {
    let finish!: (v: unknown) => void;
    let fail!: (e: unknown) => void;
    mocks.createCtvOrder.mockImplementationOnce(
      () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }),
    );
    return { finish: (v: unknown) => finish(v), fail: (e: unknown) => fail(e) };
  };

  it('hai cú chạm "Tạo đơn" trong cùng một nhịp (trước khi vẽ lại): chỉ tạo một đơn, một key', async () => {
    const order = deferredOrder();
    await readyWithAn();
    const btn = submitBtn();
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1);

    await act(async () => order.finish({ code: 'TUBU9', total: 84_000, items: [] }));
    expect(await screen.findByText(/Đã tạo đơn hộ khách/)).toBeInTheDocument();
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1);
  });

  it('cú chạm thứ hai cách cú đầu một microtask vẫn chưa vẽ lại: vẫn chỉ một đơn', async () => {
    deferredOrder();
    await readyWithAn();
    const btn = submitBtn();
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      fireEvent.click(btn);
    });
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1);
  });

  it('máy chủ từ chối: nhả khoá, báo lỗi, bấm lại gửi tiếp đúng key cũ (key chỉ đổi khi tạo đơn xong)', async () => {
    const order = deferredOrder();
    await readyWithAn();
    await act(async () => {
      fireEvent.click(submitBtn());
      fireEvent.click(submitBtn());
    });
    await act(async () => order.fail(rejected('OUT_OF_STOCK', 'Sản phẩm "Nước rửa chén" không đủ tồn kho.')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Sản phẩm "Nước rửa chén" không đủ tồn kho.' })));
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1);

    fireEvent.click(submitBtn());
    await screen.findByText(/Đã tạo đơn hộ khách/);
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(2);
    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  it('lỗi mạng chưa rõ kết quả: nhả khoá sau lần tự kiểm tra lại, "Gửi lại đơn" gửi đúng key cũ và chạm đúp vẫn một lần', async () => {
    mocks.createCtvOrder.mockRejectedValueOnce(timeoutError()).mockRejectedValueOnce(timeoutError());
    await readyWithAn();
    fireEvent.click(submitBtn());
    await screen.findByRole('alert', {}, { timeout: 4000 });
    const resend = screen.getByRole('button', { name: 'Gửi lại đơn' });
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(2);

    const order = deferredOrder();
    await act(async () => {
      fireEvent.click(resend);
      fireEvent.click(resend);
    });
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(3);
    expect(keyOfCall(2)).toBe(keyOfCall(0));
    await act(async () => order.finish({ code: 'TUBU9', total: 84_000, items: [] }));
    expect(await screen.findByText(/Đã tạo đơn hộ khách/)).toBeInTheDocument();
  });

  it('"Thử lại" của ô chọn phân loại trả Promise: hai cú chạm cùng nhịp chỉ tải lại một lần', async () => {
    let finishRetry!: (v: unknown) => void;
    mocks.fetchProduct
      .mockResolvedValueOnce({ name: 'Nước rửa chén', variations: [{ id: 'var1', name: 'Chanh', retailPrice: 65_000, salePrice: null, stock: 10 }] })
      .mockRejectedValueOnce(new Error('mạng lỗi'))
      .mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve; }));
    renderSheet();
    const pickProduct = async () => {
      fireEvent.change(screen.getByPlaceholderText('Tìm sản phẩm để thêm…'), { target: { value: 'nước' } });
      fireEvent.click(await screen.findByText('Nước rửa chén'));
    };
    await pickProduct();
    await screen.findByText('Chanh');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    // Mở lại cùng sản phẩm: dữ liệu cũ còn trong cache, lần tải nền lỗi nên vừa có dữ liệu vừa có lỗi (refetch lúc đó huỷ lần đang chạy rồi chạy lại).
    await pickProduct();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(mocks.fetchProduct).toHaveBeenCalledTimes(2);

    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.fetchProduct).toHaveBeenCalledTimes(3);
    await act(async () => finishRetry({ name: 'Nước rửa chén', variations: [{ id: 'var1', name: 'Chanh', retailPrice: 65_000, salePrice: null, stock: 10 }] }));
    expect(await screen.findByText('Chanh')).toBeInTheDocument();
  });

  it('"Thử lại" của gợi ý sản phẩm trả Promise: hai cú chạm cùng nhịp chỉ tải lại một lần', async () => {
    let finishRetry!: (v: unknown) => void;
    mocks.suggestProducts
      .mockResolvedValueOnce([{ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65_000 }])
      .mockRejectedValueOnce(new Error('mạng lỗi'))
      .mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve; }));
    renderSheet();
    const search = screen.getByPlaceholderText('Tìm sản phẩm để thêm…');
    fireEvent.change(search, { target: { value: 'nước' } });
    await screen.findByText('Nước rửa chén');
    // Xoá ô tìm rồi gõ lại đúng từ khoá: dữ liệu cũ còn trong cache, lần tải nền lỗi nên vừa có dữ liệu vừa có lỗi.
    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(screen.queryByText('Nước rửa chén')).toBeNull());
    fireEvent.change(search, { target: { value: 'nước' } });
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(mocks.suggestProducts).toHaveBeenCalledTimes(2);

    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.suggestProducts).toHaveBeenCalledTimes(3);
    await act(async () => finishRetry([{ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65_000 }]));
    expect(await screen.findByText('Nước rửa chén')).toBeInTheDocument();
  });
});

describe('CtvOrderSheet: máy chủ từ chối thì giữ khoá tới khi báo giá tải lại (W111A)', () => {
  beforeEach(resetMocks);
  let inv: MockInstance<QueryClient['invalidateQueries']> | undefined;
  afterEach(() => {
    inv?.mockRestore();
    inv = undefined;
    vi.useRealTimers();
  });

  const rejectedWith = (status: number, code: string | undefined, message: string) =>
    new HttpError(message, 'ERR_BAD_REQUEST', { status, data: { statusCode: status, ...(code ? { code } : {}), message } } as never);
  // TanStack báo cache qua setTimeout(0): đợi một nhịp để `isPending` kịp về false.
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  /** Thay `invalidateQueries` để soi khoá tải lại và giữ lời hứa tải lại trong tay. */
  const holdRefresh = () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockImplementation((() => pending) as never);
    return { finish: () => finish() };
  };
  const quoteRefreshes = () =>
    (inv?.mock.calls ?? []).filter((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey) === '["ctv-order-quote"]');
  const errorSnackbars = () => mocks.openSnackbar.mock.calls.filter(([arg]) => arg.type === 'error');

  it.each([
    [400, 'OUT_OF_STOCK', 'Sản phẩm "Nước rửa chén" không đủ tồn kho.'],
    [404, undefined, 'Không tìm thấy sản phẩm'],
    [409, undefined, 'Bạn thử lại nhé'],
  ])('bị từ chối %i: báo lỗi một lần, tải lại báo giá, khoá giữ tới khi báo giá về rồi mới nhả, vẫn đúng key cũ', async (status, code, message) => {
    const refresh = holdRefresh();
    mocks.createCtvOrder.mockRejectedValueOnce(rejectedWith(status, code, message));
    await readyWithAn();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
    expect(quoteRefreshes()).toHaveLength(1);
    expect(errorSnackbars()).toHaveLength(1);
    await settle();
    expect(submitBtn()).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(submitBtn());
    });
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1);
    expect(errorSnackbars()).toHaveLength(1);

    await act(async () => refresh.finish());
    await settle();
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(submitBtn());
    await screen.findByText(/Đã tạo đơn hộ khách/);
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(2);
    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  it.each(['TOTAL_CHANGED', 'PRICE_CHANGED'])('%s: báo giá đổi hiện trên form, tải lại báo giá, khoá giữ tới khi báo giá về', async (code) => {
    const message = 'Tổng tiền đơn vừa thay đổi. Vui lòng xem lại trước khi đặt.';
    const refresh = holdRefresh();
    mocks.createCtvOrder.mockRejectedValueOnce(rejectedWith(400, code, message));
    await readyWithAn();
    fireEvent.click(submitBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(quoteRefreshes()).toHaveLength(1);
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    await settle();
    expect(submitBtn()).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(submitBtn());
    });
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1);

    await act(async () => refresh.finish());
    await settle();
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.createCtvOrder).toHaveBeenCalledTimes(2));
  });

  it('PAYMENT_METHOD_NOT_ALLOWED (kể cả khi không phải 400/404/409): tải lại báo giá và giữ khoá tới khi về', async () => {
    const message = 'Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ. Vui lòng chọn chuyển khoản.';
    const refresh = holdRefresh();
    mocks.createCtvOrder.mockRejectedValueOnce(rejectedWith(422, 'PAYMENT_METHOD_NOT_ALLOWED', message));
    await readyWithAn();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
    expect(quoteRefreshes()).toHaveLength(1);
    await settle();
    expect(submitBtn()).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(submitBtn());
    });
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1);
    await act(async () => refresh.finish());
    await settle();
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy', 'true'));
  });

  it.each([
    [401, 'Hết phiên đăng nhập'],
    [422, 'Dữ liệu chưa hợp lệ'],
  ])('bị từ chối %i (không nói gì về trạng thái thật): không tải lại báo giá, khoá nhả ngay', async (status, message) => {
    holdRefresh();
    mocks.createCtvOrder.mockRejectedValueOnce(rejectedWith(status, undefined, message));
    await readyWithAn();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
    await settle();
    await waitFor(() => expect(submitBtn()).not.toHaveAttribute('aria-busy', 'true'));
    expect(quoteRefreshes()).toHaveLength(0);
    fireEvent.click(submitBtn());
    await screen.findByText(/Đã tạo đơn hộ khách/);
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(2);
    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  it.each([
    ['mất mạng', () => new HttpError('Network Error', 'ERR_NETWORK')],
    ['máy chủ lỗi 503', () => rejectedWith(503, undefined, 'Service Unavailable')],
  ])('%s: tự kiểm tra lại một lần rồi nhả khoá, không tải lại báo giá, "Gửi lại đơn" chạy ngay', async (_label, makeError) => {
    holdRefresh();
    mocks.createCtvOrder.mockRejectedValueOnce(makeError()).mockRejectedValueOnce(makeError());
    await readyWithAn();
    fireEvent.click(submitBtn());
    await screen.findByRole('alert', {}, { timeout: 4000 });
    await settle();
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(2);
    expect(quoteRefreshes()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Gửi lại đơn' })).not.toHaveAttribute('aria-busy', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại đơn' }));
    await waitFor(() => expect(mocks.createCtvOrder).toHaveBeenCalledTimes(3));
    expect(keyOfCall(2)).toBe(keyOfCall(0));
  });

  it('tải lại báo giá treo mãi: khoá nhả sau LOCK_REFRESH_WAIT_MS', async () => {
    inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockImplementation((() => new Promise<void>(() => undefined)) as never);
    mocks.createCtvOrder.mockRejectedValueOnce(rejectedWith(409, undefined, 'Bạn thử lại nhé'));
    await readyWithAn();
    vi.useFakeTimers();
    fireEvent.click(submitBtn());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
    });
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(submitBtn()).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(submitBtn());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(submitBtn()).not.toHaveAttribute('aria-busy', 'true');
    fireEvent.click(submitBtn());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.createCtvOrder).toHaveBeenCalledTimes(2);
  });
});

describe('CtvOrderSheet Mini — phân loại không có tên', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.suggestProducts.mockResolvedValue([{ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65_000 }]);
    mocks.createCtvOrder.mockResolvedValue({ code: 'TUBU9', total: 65_000, items: [] });
    mocks.quoteCtvOrder.mockRejectedValue(new Error('chưa có báo giá'));
  });
  const productWith = (names: string[]) =>
    mocks.fetchProduct.mockResolvedValue({
      name: 'Nước rửa chén',
      variations: names.map((name, i) => ({ id: `var${i + 1}`, name, retailPrice: 65_000, salePrice: null, stock: 10 })),
    });
  const openPicker = async () => {
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText('Tìm sản phẩm để thêm…'), { target: { value: 'nước' } });
    fireEvent.click(await screen.findByText('Nước rửa chén'));
    await screen.findAllByText('65.000đ');
  };
  const lineColumn = () => Array.from(screen.getByText('Nước rửa chén', { selector: 'div' }).parentElement!.children).map((n) => n.textContent);

  it('nhiều phân loại, một cái tên trống hoặc toàn khoảng trắng: dòng chọn ghi "Mặc định", cái có tên giữ nguyên', async () => {
    productWith(['', '  ', 'Chanh']);
    await openPicker();
    expect(screen.getAllByText('Mặc định')).toHaveLength(2);
    expect(screen.getByText('Chanh')).toBeInTheDocument();
  });

  it('chỉ một phân loại tên trống: dòng chọn lấy tên sản phẩm (không dòng trống); chọn xong dòng đơn chỉ có giá, không " · " mở đầu', async () => {
    productWith(['']);
    await openPicker();
    expect(screen.getAllByText('Nước rửa chén')).toHaveLength(2);
    fireEvent.click(screen.getAllByText('Nước rửa chén')[1]!);
    await screen.findByRole('button', { name: 'Giảm số lượng' });
    expect(lineColumn()).toEqual(['Nước rửa chén', '65.000đ']);
  });

  it('phân loại có tên: dòng đơn vẫn "tên · giá"', async () => {
    productWith(['Chanh']);
    await openPicker();
    fireEvent.click(screen.getByText('Chanh'));
    await screen.findByRole('button', { name: 'Giảm số lượng' });
    expect(lineColumn()).toEqual(['Nước rửa chén', 'Chanh · 65.000đ']);
  });
});
