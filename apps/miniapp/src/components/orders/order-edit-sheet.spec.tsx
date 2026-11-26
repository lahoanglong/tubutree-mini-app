import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  openSnackbar: vi.fn(),
  getCommunes: vi.fn(),
  getProvinces: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/core-http', async (orig) => ({
  ...(await orig<object>()),
  coreHttp: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: mocks.patch, delete: vi.fn() },
}));
vi.mock('../../services/geo-api', () => ({ getProvinces: mocks.getProvinces, getCommunes: mocks.getCommunes }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { HttpError } from '../../services/http';
import OrderEditSheet from './order-edit-sheet';

const ADDRESS = {
  recipient: 'Nguyễn An',
  phone: '0912345678',
  province: 'Hà Nội',
  district: '',
  ward: 'Phường Cầu Giấy',
  street: '1 Xuân Thuỷ',
  provinceCode: '84_VN01',
  districtCode: '',
  wardCode: '84_VN0100166',
};
const WARDS = [
  { code: '84_VN0100166', name: 'Phường Cầu Giấy' },
  { code: '84_VN0100004', name: 'Phường Ba Đình' },
];

/** Lỗi máy chủ trả mã ngoài 2xx (services/api đọc `response.status` và `response.data`). */
const httpError = (status: number, data: Record<string, unknown>) => new HttpError(String(data.message ?? 'x'), undefined, { status, data } as never);

function setup(opts: { address?: typeof ADDRESS; note?: string | null; split?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <OrderEditSheet
        code="TT001"
        address={opts.address ?? ADDRESS}
        note={opts.note === undefined ? 'Gọi trước' : opts.note}
        split={opts.split ?? false}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  const sheet = () => screen.getByTestId('order-edit-sheet');
  const field = (label: string) => within(sheet()).getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  return { onClose, invalidate, sheet, field, save };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCommunes.mockResolvedValue(WARDS);
  mocks.patch.mockResolvedValue({ code: 'TT001', shippingAddress: ADDRESS, note: null, notifyRecipientZalo: false, editsLeft: 2 });
});

describe('OrderEditSheet (Mini)', () => {
  it('tỉnh khoá theo đơn: không có ô chọn tỉnh, không tải danh sách tỉnh; ô điền sẵn theo đơn', async () => {
    const t = setup();
    expect(t.sheet().textContent).toContain('Tỉnh/thành: Hà Nội (không đổi được)');
    expect(t.sheet().textContent).toContain('Muốn giao tỉnh khác, bạn huỷ đơn rồi đặt lại nhé.');
    expect(screen.queryByRole('button', { name: /^Tỉnh\/Thành phố/ })).toBeNull();
    await waitFor(() => expect(mocks.getCommunes).toHaveBeenCalledWith('84_VN01'));
    expect(mocks.getProvinces).not.toHaveBeenCalled();
    expect(t.field('Người nhận').value).toBe('Nguyễn An');
    expect(t.field('Số điện thoại').value).toBe('0912345678');
    expect(t.field('Số nhà, tên đường').value).toBe('1 Xuân Thuỷ');
    expect(t.field('Ghi chú cho đơn').value).toBe('Gọi trước');
  });

  it('đổi phường, số nhà và ghi chú: PATCH đủ 7 trường (tỉnh của đơn); lưu xong báo lượt còn, tải lại đơn, đóng tấm', async () => {
    const t = setup();
    await waitFor(() => expect(mocks.getCommunes).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^Phường\/Xã/ }));
    const list = await screen.findByRole('listbox', { name: 'Phường/Xã' });
    fireEvent.click(within(list).getByRole('option', { name: 'Phường Ba Đình' }));
    fireEvent.change(t.field('Số nhà, tên đường'), { target: { value: '5 Điện Biên Phủ' } });
    fireEvent.change(t.field('Ghi chú cho đơn'), { target: { value: 'Giao giờ hành chính' } });
    t.save();
    await waitFor(() => expect(t.onClose).toHaveBeenCalled());
    expect(mocks.patch).toHaveBeenCalledWith('/orders/TT001/delivery', {
      address: {
        recipient: 'Nguyễn An',
        phone: '0912345678',
        ward: 'Phường Ba Đình',
        street: '5 Điện Biên Phủ',
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '84_VN0100004',
      },
      note: 'Giao giờ hành chính',
    });
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã cập nhật đơn TT001. Còn 2 lần sửa cho đơn này.', type: 'success' }));
    expect(t.invalidate).toHaveBeenCalledWith({ queryKey: ['order', 'TT001'] });
    expect(t.invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] });
  });

  it('không đổi gì: báo tại chỗ, không gọi máy chủ', async () => {
    const t = setup();
    t.save();
    expect((await screen.findByTestId('order-edit-error')).textContent).toBe('Bạn chưa đổi gì.');
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('chạm Lưu hai lần liền: chỉ một lần gửi (một lượt sửa)', async () => {
    let resolve!: (v: unknown) => void;
    mocks.patch.mockImplementation(() => new Promise((r) => (resolve = r)));
    const t = setup();
    fireEvent.change(t.field('Ghi chú cho đơn'), { target: { value: 'mới' } });
    t.save();
    t.save();
    await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
    t.save();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    resolve({ code: 'TT001', shippingAddress: ADDRESS, note: 'mới', notifyRecipientZalo: false, editsLeft: 2 });
    await waitFor(() => expect(t.onClose).toHaveBeenCalled());
  });

  it('409 ORDER_EDIT_REFUSED: báo câu máy chủ, tải lại đơn, đóng tấm', async () => {
    const message = 'Kho đã bắt đầu đóng gói đơn này nên không sửa được nữa. Bạn nhắn Zalo OA hoặc gọi hotline Tubu nhé.';
    mocks.patch.mockRejectedValue(httpError(409, { code: 'ORDER_EDIT_REFUSED', reason: 'PACKING_ON_PANCAKE', message }));
    const t = setup();
    fireEvent.change(t.field('Ghi chú cho đơn'), { target: { value: 'mới' } });
    t.save();
    await waitFor(() => expect(t.onClose).toHaveBeenCalled());
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: message, type: 'error' }));
    expect(t.invalidate).toHaveBeenCalledWith({ queryKey: ['order', 'TT001'] });
  });

  it('400 nhập sai (SĐT): ở lại trong tấm, hiện câu máy chủ', async () => {
    mocks.patch.mockRejectedValue(httpError(400, { message: 'Số điện thoại không hợp lệ' }));
    const t = setup();
    fireEvent.change(t.field('Số điện thoại'), { target: { value: '123' } });
    t.save();
    expect((await screen.findByTestId('order-edit-error')).textContent).toBe('Số điện thoại không hợp lệ');
    expect(t.onClose).not.toHaveBeenCalled();
  });

  it('đơn địa giới cũ: chỉ ô ghi chú kèm lời giải thích, chỉ gửi ghi chú; đơn tách nói rõ chỉ áp cho đơn này', async () => {
    const t = setup({ address: { ...ADDRESS, provinceCode: '' }, split: true });
    expect(t.sheet().textContent).toContain('Địa chỉ của đơn này chưa theo địa giới mới nên chỉ sửa được ghi chú.');
    expect(t.sheet().textContent).toContain('Thay đổi chỉ áp dụng cho đơn TT001.');
    expect(t.sheet().querySelectorAll('input')).toHaveLength(0);
    fireEvent.change(t.field('Ghi chú cho đơn'), { target: { value: 'x' } });
    t.save();
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/orders/TT001/delivery', { note: 'x' }));
  });
});
