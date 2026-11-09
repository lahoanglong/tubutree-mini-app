import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { walletNegativeCheckoutReason } from '@tubutree/app-core/wallet-rules';

import {
  AddressPicker,
  addressText,
  formatVnDate,
  IntervalPicker,
  isStartDateAllowed,
  nextRunAfterIntervalChange,
  PaymentMethodPicker,
  startDateRange,
  subscriptionWalletBlockedReason,
  vnDateOf,
} from './subscription-options';

describe('ngày bắt đầu gói định kỳ (giờ Việt Nam)', () => {
  it('vnDateOf lấy ngày theo giờ VN, không theo múi giờ máy', () => {
    // 18h UTC ngày 10 = 1h sáng ngày 11 giờ VN
    expect(vnDateOf(new Date('2026-10-10T18:00:00Z'))).toBe('2026-10-11');
    expect(vnDateOf(new Date('2026-10-10T16:59:59Z'))).toBe('2026-10-10');
  });

  it('khoảng hẹn: từ ngày mai tới 60 ngày tới, khớp API', () => {
    const now = new Date('2026-10-10T03:00:00Z');
    expect(startDateRange(now)).toEqual({ min: '2026-10-11', max: '2026-12-09' });
    expect(isStartDateAllowed('2026-10-10', now)).toBe(false);
    expect(isStartDateAllowed('2026-10-11', now)).toBe(true);
    expect(isStartDateAllowed('2026-12-09', now)).toBe(true);
    expect(isStartDateAllowed('2026-12-10', now)).toBe(false);
    expect(isStartDateAllowed('', now)).toBe(false);
  });

  it('formatVnDate + addressText', () => {
    expect(formatVnDate('2026-10-20')).toBe('20/10/2026');
    expect(addressText({ street: '12 Lý Thường Kiệt', ward: 'P.7', district: 'Q.10' })).toBe('12 Lý Thường Kiệt, P.7, Q.10');
  });
});

describe('PaymentMethodPicker', () => {
  it('chỉ có COD / Ví Tubu (kèm số dư) / Chuyển khoản; chọn hàng gọi onChange', () => {
    const onChange = vi.fn();
    render(<PaymentMethodPicker value="COD" onChange={onChange} walletBalance={250000} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /Thanh toán khi nhận hàng/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText(/ZaloPay/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Ví Tubu \(250\.000đ\)/ }));
    expect(onChange).toHaveBeenCalledWith('WALLET');
    fireEvent.keyDown(screen.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('BANK_TRANSFER');
  });

  it('Ví đang âm (thu hồi hoa hồng đơn trả): hàng Ví Tubu bị khoá, ghi đúng câu của màn thanh toán, bấm hay Enter đều không chọn', () => {
    const onChange = vi.fn();
    render(<PaymentMethodPicker value="COD" onChange={onChange} walletBalance={-50000} />);
    const wallet = screen.getByRole('radio', { name: /Ví Tubu/ });
    expect(wallet).toHaveAttribute('aria-disabled', 'true');
    expect(wallet).toHaveTextContent(walletNegativeCheckoutReason('50.000đ'));
    fireEvent.click(wallet);
    fireEvent.keyDown(wallet, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    expect(onChange).toHaveBeenCalledWith('BANK_TRANSFER');
  });

  it('Ví 0đ hoặc chưa tải số dư: hàng Ví Tubu không bị khoá', () => {
    const onChange = vi.fn();
    const { unmount } = render(<PaymentMethodPicker value="COD" onChange={onChange} walletBalance={0} />);
    expect(screen.getByRole('radio', { name: /Ví Tubu/ })).not.toHaveAttribute('aria-disabled');
    unmount();
    render(<PaymentMethodPicker value="COD" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Ví Tubu/ }));
    expect(onChange).toHaveBeenCalledWith('WALLET');
    expect(subscriptionWalletBlockedReason(undefined)).toBeNull();
    expect(subscriptionWalletBlockedReason(-1)).toBe(walletNegativeCheckoutReason('1đ'));
  });
});

describe('khoá bộ chọn khi đang bận (W61A)', () => {
  const ADDRS = [
    { id: 'a1', recipient: 'Lan', phone: '0900000000', street: '1 Lê Lợi', ward: 'P.1', district: 'Q.1' },
    { id: 'a2', recipient: 'Minh', phone: '0911111111', street: '9 Hai Bà Trưng', ward: 'P.2', district: 'Q.3' },
  ] as never;

  it('IntervalPicker: mặc định mở; disabled khoá cả 4 chip và bấm không gọi onChange', () => {
    const onChange = vi.fn();
    const { rerender } = render(<IntervalPicker value={4} onChange={onChange} />);
    screen.getAllByRole('button').forEach((b) => expect(b).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '6 tuần' }));
    expect(onChange).toHaveBeenCalledWith(6);
    onChange.mockClear();
    rerender(<IntervalPicker value={4} onChange={onChange} disabled />);
    const chips = screen.getAllByRole('button');
    expect(chips).toHaveLength(4);
    chips.forEach((b) => expect(b).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '8 tuần' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '4 tuần' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('PaymentMethodPicker: disabled khoá cả ba hàng (kể cả Ví không âm), bấm hay Enter đều không chọn', () => {
    const onChange = vi.fn();
    render(<PaymentMethodPicker value="COD" onChange={onChange} walletBalance={250000} disabled />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    radios.forEach((r) => expect(r).toHaveAttribute('aria-disabled', 'true'));
    radios.forEach((r) => {
      fireEvent.click(r);
      fireEvent.keyDown(r, { key: 'Enter' });
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('PaymentMethodPicker: không truyền disabled thì hàng bình thường mở, chỉ Ví âm bị khoá', () => {
    render(<PaymentMethodPicker value="COD" onChange={vi.fn()} walletBalance={-1000} />);
    expect(screen.getByRole('radio', { name: /Thanh toán khi nhận hàng/ })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('radio', { name: /Chuyển khoản/ })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('radio', { name: /Ví Tubu/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('AddressPicker: mặc định chọn được; disabled khoá mọi hàng và bấm không gọi onChange', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AddressPicker addresses={ADDRS} value="a1" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Hai Bà Trưng/ }));
    expect(onChange).toHaveBeenCalledWith('a2');
    onChange.mockClear();
    rerender(<AddressPicker addresses={ADDRS} value="a1" onChange={onChange} disabled />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    radios.forEach((r) => expect(r).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(screen.getByRole('radio', { name: /Hai Bà Trưng/ }));
    fireEvent.keyDown(screen.getByRole('radio', { name: /Hai Bà Trưng/ }), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('số đều (tabular-nums) ở hàng chọn thanh toán và địa chỉ (W61A)', () => {
  it('nhãn Ví Tubu kèm số dư, câu chặn Ví âm kèm số tiền và tiêu đề địa chỉ kèm số điện thoại đều dùng số đều', () => {
    const { unmount } = render(<PaymentMethodPicker value="WALLET" onChange={vi.fn()} walletBalance={120000} />);
    expect(screen.getByText('Ví Tubu (120.000đ)').style.fontVariantNumeric).toBe('tabular-nums');
    unmount();
    const { unmount: unmountNegative } = render(<PaymentMethodPicker value="COD" onChange={vi.fn()} walletBalance={-50000} />);
    expect(screen.getByText(walletNegativeCheckoutReason('50.000đ')).style.fontVariantNumeric).toBe('tabular-nums');
    unmountNegative();
    render(
      <AddressPicker
        addresses={[{ id: 'a1', recipient: 'Lan', phone: '0900000000', street: '12 Lê Lợi', ward: 'P.1', district: 'Q.1' }] as never}
        value="a1"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Lan · 0900000000').style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByText('12 Lê Lợi, P.1, Q.1').style.fontVariantNumeric).toBe('tabular-nums');
  });
});

describe('nextRunAfterIntervalChange: cùng luật với API (Q22)', () => {
  const now = new Date('2026-10-20T05:00:00.000Z');
  const sub = { intervalWeeks: 4, nextRunAt: '2026-11-07T03:00:00.000Z', lastOrderAt: '2026-10-10T03:00:00.000Z' };

  it('ACTIVE có đơn gần nhất: 0h VN của ngày đơn + chu kỳ mới', () => {
    expect(nextRunAfterIntervalChange(sub, 6, now)?.toISOString()).toBe('2026-11-20T17:00:00.000Z');
  });

  it('đơn cron ghi 03:00:00.200 giờ VN: vẫn neo 0h VN của ngày đơn, khớp API để ngày báo = ngày giao', () => {
    expect(nextRunAfterIntervalChange({ ...sub, lastOrderAt: '2026-10-09T20:00:00.200Z' }, 6, now)?.toISOString()).toBe(
      '2026-11-20T17:00:00.000Z',
    );
  });

  it('mốc mới đã qua hoặc trong hôm nay → 0h ngày mai giờ VN', () => {
    expect(nextRunAfterIntervalChange({ ...sub, intervalWeeks: 10, lastOrderAt: '2026-08-01T03:00:00.000Z' }, 4, now)?.toISOString()).toBe(
      '2026-10-20T17:00:00.000Z',
    );
  });

  it('chưa có đơn nào: giữ ngày bắt đầu hiện có', () => {
    expect(nextRunAfterIntervalChange({ ...sub, lastOrderAt: null }, 8, now)?.toISOString()).toBe('2026-11-07T03:00:00.000Z');
  });

  it('không phân biệt trạng thái gói: gói tạm dừng tính như gói đang chạy (API ghi sẵn ngày để bật lại giữ đúng)', () => {
    expect(nextRunAfterIntervalChange(sub, 6, now)?.toISOString()).toBe('2026-11-20T17:00:00.000Z');
  });

  it('chưa có đơn nào nhưng ngày bắt đầu đã qua: không hứa ngày', () => {
    expect(
      nextRunAfterIntervalChange({ ...sub, lastOrderAt: null, nextRunAt: '2026-10-01T03:00:00.000Z' }, 8, now),
    ).toBeNull();
  });

  it('không tính được: cùng chu kỳ, hoặc API cũ chưa trả lastOrderAt', () => {
    expect(nextRunAfterIntervalChange(sub, 4, now)).toBeNull();
    expect(nextRunAfterIntervalChange({ ...sub, lastOrderAt: undefined }, 6, now)).toBeNull();
  });
});
