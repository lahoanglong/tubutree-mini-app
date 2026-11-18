import { useState } from 'react';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AddressDTO } from '../../services/shop-api';

const mocks = vi.hoisted(() => ({ formProps: vi.fn(), track: vi.fn() }));
vi.mock('../address-form', () => ({
  AddressForm: (props: { askZaloProfile?: boolean; onCancel?: () => void }) => {
    mocks.formProps(props);
    return <div data-testid="address-form" />;
  },
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/analytics', () => ({ trackEvent: mocks.track }));

import { AddressSection } from './address-section';
import { vi as viCopy } from '../../i18n/vi';

const ADDR: AddressDTO = {
  id: 'a1', recipient: 'Ánh', phone: '0911111111', street: '1 X', province: 'HCM', provinceCode: '84_VN79',
  ward: 'P1', wardCode: '84_VN79_001', district: '', districtCode: '', isDefault: true,
};

function renderSection(addresses: AddressDTO[], onSelect: (id: string) => void = () => {}, selectedId: string | null = null) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AddressSection addresses={addresses} selectedId={selectedId} onSelect={onSelect} />
    </QueryClientProvider>,
  );
}

describe('AddressSection — xin tên + SĐT Zalo chỉ ở đơn đầu (C-065, Q-27)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('chưa có địa chỉ nào (đơn đầu) → form thêm địa chỉ được mở với askZaloProfile', () => {
    renderSection([]);
    fireEvent.click(screen.getByText('Thêm địa chỉ mới'));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();
    expect(mocks.formProps).toHaveBeenLastCalledWith(expect.objectContaining({ askZaloProfile: true }));
  });

  it('khách đã có địa chỉ (thêm địa chỉ thứ 2, nút ở cuối tấm chọn) → KHÔNG xin quyền Zalo', () => {
    renderSection([ADDR], () => {}, 'a1');
    fireEvent.click(screen.getByRole('button', { name: /Đổi địa chỉ giao hàng/ }));
    fireEvent.click(screen.getByText('Thêm địa chỉ mới'));
    expect(mocks.formProps).toHaveBeenLastCalledWith(expect.objectContaining({ askZaloProfile: false }));
  });
});

describe('AddressSection — sổ trống thì mở sẵn form (bớt một chạm ở đơn đầu)', () => {
  beforeEach(() => vi.clearAllMocks());
  const mount = (addresses: AddressDTO[], autoOpen: boolean) => (
    <QueryClientProvider client={new QueryClient()}>
      <AddressSection addresses={addresses} selectedId={null} onSelect={() => {}} autoOpen={autoOpen} />
    </QueryClientProvider>
  );

  it('sổ đã tải và trống → form thêm địa chỉ mở sẵn nhưng KHÔNG tự xin Zalo (khách chưa chạm gì); không còn câu "chưa có địa chỉ"', () => {
    render(mount([], true));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();
    expect(mocks.formProps).toHaveBeenLastCalledWith(expect.objectContaining({ askZaloProfile: false }));
    expect(screen.queryByText(viCopy.checkout.addressEmpty)).toBeNull();
  });

  it('khách tự bấm "Thêm địa chỉ mới" sau khi đóng form tự mở → lúc đó mới xin Zalo', () => {
    render(mount([], true));
    const cancel = mocks.formProps.mock.calls.at(-1)![0] as { onCancel: () => void };
    act(() => cancel.onCancel());
    fireEvent.click(screen.getByText('Thêm địa chỉ mới'));
    expect(mocks.formProps).toHaveBeenLastCalledWith(expect.objectContaining({ askZaloProfile: true }));
  });

  it('sổ đang tải (autoOpen chưa bật) → chưa mở; khách đóng form tự mở thì không tự mở lại', () => {
    const { rerender } = render(mount([], false));
    expect(screen.queryByTestId('address-form')).toBeNull();
    rerender(mount([], true));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();
    const cancel = mocks.formProps.mock.calls.at(-1)![0] as { onCancel: () => void };
    act(() => cancel.onCancel());
    rerender(mount([], true));
    expect(screen.queryByTestId('address-form')).toBeNull();
    expect(screen.getByText('Thêm địa chỉ mới')).toBeInTheDocument();
  });
});

const BINH: AddressDTO = { ...ADDR, id: 'a2', recipient: 'Bình', phone: '0922222222', street: '2 Y', isDefault: false };

describe('AddressSection — một dòng gọn + tấm chọn (đổi địa chỉ trong 2 chạm)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('khối địa chỉ chỉ một dòng: tên, SĐT che bớt, địa chỉ một dòng và "Đổi"; không liệt kê địa chỉ khác', () => {
    renderSection([ADDR, BINH], () => {}, 'a1');
    const row = screen.getByTestId('checkout-address-row');
    expect(row).toHaveTextContent('Ánh · 091****111');
    expect(row).toHaveTextContent('1 X, P1, HCM');
    expect(row).not.toHaveTextContent('0911111111');
    expect(screen.queryByText(/Bình/)).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('chạm 1 mở tấm chọn, chạm 2 chọn địa chỉ khác và đóng; ghi checkout_address_switched không kèm địa chỉ', async () => {
    const onSelect = vi.fn();
    renderSection([ADDR, BINH], onSelect, 'a1');
    fireEvent.click(screen.getByRole('button', { name: /Đổi địa chỉ giao hàng/ }));
    const rows = screen.getAllByRole('radio');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /Bình/ }));
    expect(onSelect).toHaveBeenCalledWith('a2');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith('checkout_address_switched', 'miniapp', { from: 'sheet' });
  });

  it('chọn lại đúng địa chỉ đang dùng: đóng tấm, không đổi, không ghi sự kiện', () => {
    const onSelect = vi.fn();
    renderSection([ADDR, BINH], onSelect, 'a1');
    fireEvent.click(screen.getByRole('button', { name: /Đổi địa chỉ giao hàng/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Ánh/ }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('thứ tự tấm: mặc định đầu, kế đến địa chỉ dùng gần nhất của đúng tài khoản', () => {
    const CHI: AddressDTO = { ...BINH, id: 'a3', recipient: 'Chi' };
    localStorage.setItem('tubu_recent_address_ids:u1', JSON.stringify(['a3']));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddressSection addresses={[BINH, CHI, ADDR]} selectedId="a2" onSelect={() => {}} userId="u1" />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Đổi địa chỉ giao hàng/ }));
    expect(screen.getAllByRole('radio').map((r) => r.textContent?.slice(0, 3))).toEqual(['Ánh', 'Chi', 'Bìn']);
  });

  it('hàng trong tấm là <button role="radio"> thật: Tab tới và Enter chọn đúng một lần', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderSection([ADDR, BINH], onSelect, 'a1');
    fireEvent.click(screen.getByRole('button', { name: /Đổi địa chỉ giao hàng/ }));
    const target = screen.getByRole('radio', { name: /Bình/ });
    expect(target.tagName).toBe('BUTTON');
    target.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith('a2');
  });
});

describe('AddressSection — cảnh báo địa giới cũ nằm ngay dưới dòng địa chỉ đang chọn (D6-03)', () => {
  const LEGACY: AddressDTO = { ...ADDR, id: 'a1', provinceCode: '79', wardCode: '00' };
  const OK: AddressDTO = { ...ADDR, id: 'a2', recipient: 'Bình', isDefault: false };

  it('đang chọn địa chỉ địa giới cũ → một cảnh báo trong khối dòng địa chỉ, nút cập nhật mở form sửa', () => {
    renderSection([LEGACY, OK], () => {}, 'a1');
    const row = screen.getByTestId('checkout-address-row');
    expect(within(row).getAllByRole('alert')).toHaveLength(1);
    fireEvent.click(within(row).getByRole('button', { name: viCopy.checkout.addressLegacyCta }));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('chọn địa chỉ hợp lệ trong khi sổ còn địa chỉ cũ → không có cảnh báo nào', () => {
    renderSection([LEGACY, OK], () => {}, 'a2');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('đang sửa địa chỉ mà nó biến khỏi danh sách (xoá ở màn khác) → form đóng, dòng đang chọn lại có nút sửa địa giới', () => {
    const LEGACY2: AddressDTO = { ...LEGACY, id: 'a3', recipient: 'Chi', isDefault: false };
    const client = new QueryClient();
    const ui = (list: AddressDTO[], sel: string) => (
      <QueryClientProvider client={client}>
        <AddressSection addresses={list} selectedId={sel} onSelect={() => {}} />
      </QueryClientProvider>
    );
    const { rerender } = render(ui([LEGACY, LEGACY2], 'a1'));
    fireEvent.click(screen.getByRole('button', { name: viCopy.checkout.addressLegacyCta }));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();
    rerender(ui([LEGACY2], 'a3'));
    expect(screen.queryByTestId('address-form')).toBeNull();
    expect(within(screen.getByTestId('checkout-address-row')).getByRole('button', { name: viCopy.checkout.addressLegacyCta })).toBeInTheDocument();
  });

  it('đang sửa địa chỉ cũ rồi đổi sang địa chỉ khác qua tấm chọn → form sửa đóng', () => {
    function Harness() {
      const [sel, setSel] = useState<string | null>('a1');
      return (
        <QueryClientProvider client={new QueryClient()}>
          <AddressSection addresses={[LEGACY, OK]} selectedId={sel} onSelect={setSel} />
        </QueryClientProvider>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: viCopy.checkout.addressLegacyCta }));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Đổi địa chỉ giao hàng/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Bình/ }));
    expect(screen.queryByTestId('address-form')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AddressSection — máy chủ báo địa chỉ hệ mới không giao được (ADDRESS_OUTDATED, W33)', () => {
  const OK2: AddressDTO = { ...ADDR, id: 'a2', recipient: 'Bình', isDefault: false };
  const ui = (quoteOutdated: boolean) => (
    <QueryClientProvider client={new QueryClient()}>
      <AddressSection addresses={[ADDR, OK2]} selectedId="a1" onSelect={() => {}} quoteOutdated={quoteOutdated} />
    </QueryClientProvider>
  );

  it('quoteOutdated → cảnh báo phường không khớp + nút Sửa địa chỉ dưới dòng đang chọn, mở form sửa', () => {
    render(ui(true));
    const alert = within(screen.getByTestId('checkout-address-row')).getByRole('alert');
    expect(alert).toHaveTextContent(viCopy.checkout.addressMismatch);
    fireEvent.click(within(alert).getByRole('button', { name: viCopy.checkout.addressFixCta }));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('báo giá hợp lệ → không cảnh báo', () => {
    render(ui(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
