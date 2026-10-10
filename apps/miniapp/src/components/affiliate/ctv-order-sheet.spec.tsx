import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveRecentCustomer, loadRecentCustomers } from './recent-customers';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  createCtvOrder: vi.fn(),
  suggestProducts: vi.fn(),
  fetchProduct: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
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
vi.mock('../../services/affiliate-api', () => ({ createCtvOrder: mocks.createCtvOrder }));
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

async function addProduct() {
  fireEvent.change(screen.getByPlaceholderText('Tìm sản phẩm để thêm…'), { target: { value: 'nước' } });
  fireEvent.click(await screen.findByText('Nước rửa chén'));
  fireEvent.click(await screen.findByText('Chanh'));
  await screen.findByRole('button', { name: 'Giảm số lượng' });
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
});
