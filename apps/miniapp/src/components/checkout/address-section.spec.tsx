import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AddressDTO } from '../../services/shop-api';

const mocks = vi.hoisted(() => ({ formProps: vi.fn() }));
vi.mock('../address-form', () => ({
  AddressForm: (props: { askZaloProfile?: boolean }) => {
    mocks.formProps(props);
    return <div data-testid="address-form" />;
  },
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { AddressSection } from './address-section';

const ADDR: AddressDTO = {
  id: 'a1', recipient: 'Ánh', phone: '0911111111', street: '1 X', province: 'HCM', provinceCode: '84_VN79',
  ward: 'P1', wardCode: '84_VN79_001', district: '', districtCode: '', isDefault: true,
};

function renderSection(addresses: AddressDTO[], onSelect: (id: string) => void = () => {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AddressSection addresses={addresses} selectedId={null} onSelect={onSelect} />
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

  it('khách đã có địa chỉ (thêm địa chỉ thứ 2) → KHÔNG xin quyền Zalo', () => {
    renderSection([ADDR]);
    fireEvent.click(screen.getByText('Thêm địa chỉ mới'));
    expect(mocks.formProps).toHaveBeenLastCalledWith(expect.objectContaining({ askZaloProfile: false }));
  });
});

describe('AddressSection — hàng chọn địa chỉ dùng được bằng bàn phím', () => {
  beforeEach(() => vi.clearAllMocks());

  // Hàng là <button role="radio"> thật: Tab tới và Enter/Space là hành vi gốc của trình duyệt, không cần rowKeyboardProps
  // (chỉ dành cho <div role="radio">). Đổi hàng về div không focus được thì test này đỏ.
  it('Tab tới hàng, Enter rồi Space mỗi phím chọn đúng một lần', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderSection([ADDR, { ...ADDR, id: 'a2', recipient: 'Bình', isDefault: false }], onSelect);

    const rows = screen.getAllByRole('radio');
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.tagName).toBe('BUTTON');

    await user.tab();
    expect(rows[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith('a1');

    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledTimes(2);

    await user.tab();
    expect(rows[1]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenLastCalledWith('a2');
  });
});
