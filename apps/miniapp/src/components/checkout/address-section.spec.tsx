import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

describe('AddressSection — cảnh báo địa giới cũ nằm trong đúng thẻ đang chọn (D6-03)', () => {
  const LEGACY: AddressDTO = { ...ADDR, id: 'a1', provinceCode: '79', wardCode: '00' };
  const OK: AddressDTO = { ...ADDR, id: 'a2', recipient: 'Bình', isDefault: false };
  const cardOf = (name: RegExp) => screen.getByRole('radio', { name }).parentElement as HTMLElement;

  it('chọn thẻ 1 (địa giới cũ), thẻ 2 hợp lệ → alert nằm trong thẻ 1, thẻ 2 không có alert', () => {
    renderSection([LEGACY, OK], () => {}, 'a1');
    const first = cardOf(/Ánh/);
    const second = cardOf(/Bình/);
    expect(within(first).getByRole('alert')).toBeInTheDocument();
    expect(within(second).queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('nút "chọn lại tỉnh/phường" nằm cùng thẻ với cảnh báo và mở form sửa', () => {
    renderSection([LEGACY, OK], () => {}, 'a1');
    const first = cardOf(/Ánh/);
    fireEvent.click(within(first).getByRole('button', { name: viCopy.checkout.addressLegacyCta }));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();
  });

  it('chọn thẻ hợp lệ trong khi thẻ 1 cũ → không có cảnh báo nào', () => {
    renderSection([LEGACY, OK], () => {}, 'a2');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('đang mở form sửa thẻ 1, chạm sang thẻ 2 cũng địa giới cũ → thẻ 2 chưa hiện cảnh báo (nút của nó sẽ đè form đang gõ)', () => {
    const LEGACY2: AddressDTO = { ...LEGACY, id: 'a3', recipient: 'Chi', isDefault: false };
    function Harness() {
      const [sel, setSel] = useState<string | null>('a1');
      return (
        <QueryClientProvider client={new QueryClient()}>
          <AddressSection addresses={[LEGACY, LEGACY2]} selectedId={sel} onSelect={setSel} />
        </QueryClientProvider>
      );
    }
    render(<Harness />);
    fireEvent.click(within(cardOf(/Ánh/)).getByRole('button', { name: viCopy.checkout.addressLegacyCta }));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Chi/ }));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();
    expect(within(cardOf(/Chi/)).queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('đang sửa thẻ 1 mà thẻ 1 biến khỏi danh sách (xoá ở màn khác, làm mới) → form đóng và thẻ đang chọn lại có nút sửa địa giới', () => {
    const LEGACY2: AddressDTO = { ...LEGACY, id: 'a3', recipient: 'Chi', isDefault: false };
    const client = new QueryClient();
    const ui = (list: AddressDTO[], sel: string) => (
      <QueryClientProvider client={client}>
        <AddressSection addresses={list} selectedId={sel} onSelect={() => {}} />
      </QueryClientProvider>
    );
    const { rerender } = render(ui([LEGACY, LEGACY2], 'a1'));
    fireEvent.click(within(cardOf(/Ánh/)).getByRole('button', { name: viCopy.checkout.addressLegacyCta }));
    expect(screen.getByTestId('address-form')).toBeInTheDocument();
    rerender(ui([LEGACY2], 'a3'));
    expect(screen.queryByTestId('address-form')).toBeNull();
    expect(within(cardOf(/Chi/)).getByRole('button', { name: viCopy.checkout.addressLegacyCta })).toBeInTheDocument();
  });
});
