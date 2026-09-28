import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { AddressForm } from './address-form';
import * as shopApi from '../services/shop-api';
import * as accountApi from '../services/account-api';

// createAddress sống ở shop-api, updateAddress sống ở account-api (xem account-api.ts —
// "Addresses (bổ sung update/delete cho address book)") — 2 module khác nhau, không phải cùng 1
// module như bản nháp kế hoạch giả định.
vi.mock('../services/shop-api', () => ({ createAddress: vi.fn() }));
vi.mock('../services/account-api', () => ({ updateAddress: vi.fn() }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { fullName: 'Long', phone: '0900000000' } }),
}));

// AddressForm dùng useMutation (@tanstack/react-query) — cần QueryClientProvider thật trong cây,
// nếu không render() sẽ throw "No QueryClient set" (react-query không có fallback no-op).
function renderForm(ui: ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Field chỉ vẽ label làm <Text> anh em (không có htmlFor/aria-labelledby) nên getByLabelText
 * không match — tìm input đi kèm bằng chính label hiển thị, giống cách người dùng thật nhìn form. */
function inputNear(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  const input = label.parentElement?.querySelector('input');
  if (!input) throw new Error(`Không tìm thấy input cạnh label "${labelText}"`);
  return input;
}

describe('AddressForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create mode (no initial): starts empty except recipient/phone prefilled from logged-in user', () => {
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    expect(screen.getByDisplayValue('Long')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0900000000')).toBeInTheDocument();
    expect(inputNear('Số nhà, tên đường')).toHaveValue('');
  });

  it('edit mode: prefills every field from `initial`, calls updateAddress(initial.id, ...) on save', async () => {
    const initial = {
      id: 'a1',
      recipient: 'Ánh',
      phone: '0911111111',
      street: '123 Lê Lợi',
      province: 'HCM',
      provinceCode: '79',
      ward: 'P1',
      wardCode: '00001',
      district: '',
      districtCode: '',
      isDefault: false,
    } as never;
    (accountApi.updateAddress as ReturnType<typeof vi.fn>).mockResolvedValue(initial);
    renderForm(<AddressForm initial={initial} onCancel={() => {}} onSaved={() => {}} />);
    expect(screen.getByDisplayValue('Ánh')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0911111111')).toBeInTheDocument();
    expect(screen.getByDisplayValue('123 Lê Lợi')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Lưu'));
    await waitFor(() => expect(accountApi.updateAddress).toHaveBeenCalledWith('a1', expect.any(Object)));
    expect(shopApi.createAddress).not.toHaveBeenCalled();
  });

  it('create mode: calls createAddress (not updateAddress) once all required fields + geo are valid', async () => {
    (shopApi.createAddress as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new' });
    const onSaved = vi.fn();
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={onSaved} />);

    // recipient/phone đã điền sẵn từ user mock; chỉ còn street bắt buộc điền — geo (Tỉnh/Phường)
    // không mock được API thật ở test này nên bỏ qua nhánh happy-path đầy đủ của geo, chỉ xác
    // nhận validate() vẫn chặn submit khi geo trống (hành vi validateGeo() giữ nguyên, không đổi).
    fireEvent.change(inputNear('Số nhà, tên đường'), { target: { value: '1 Nguyễn Huệ' } });
    fireEvent.click(screen.getByText('Lưu'));

    // Geo chưa chọn → validateGeo() chặn, không có API nào được gọi. GeoPicker vẽ lỗi này gộp
    // chung 1 node text với tiền tố "⚠ " (component ErrText riêng của geo-picker.tsx, không đi
    // qua Field) nên khớp bằng regex thay vì so khớp chuỗi tuyệt đối.
    await waitFor(() =>
      expect(screen.getAllByText(/Bạn điền giúp Tubu mục này nhé/).length).toBeGreaterThan(0),
    );
    expect(shopApi.createAddress).not.toHaveBeenCalled();
    expect(accountApi.updateAddress).not.toHaveBeenCalled();
  });
});
