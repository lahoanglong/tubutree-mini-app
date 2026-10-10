import { render, screen, fireEvent } from '@testing-library/react';
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

function renderSection(addresses: AddressDTO[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AddressSection addresses={addresses} selectedId={null} onSelect={() => {}} />
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
