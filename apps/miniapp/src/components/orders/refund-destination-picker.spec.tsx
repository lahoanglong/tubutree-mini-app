import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RefundDestinationPicker } from './refund-destination-picker';

describe('RefundDestinationPicker: lỗi tài khoản nằm dưới đúng ô (R2-BUYERMINI-6)', () => {
  const bank = { bankName: 'Techcombank', accountNumber: 'abc', accountName: 'Nguyen Van A' };

  it('số tài khoản sai → lỗi dưới ô Số tài khoản, không dưới ô Chủ tài khoản', () => {
    render(<RefundDestinationPicker method="BANK" onMethod={vi.fn()} bank={bank} onBank={vi.fn()} showBankErrors />);
    const msg = 'Số tài khoản chỉ gồm chữ số, từ 6 đến 24 số.';
    expect(screen.getByLabelText('Số tài khoản')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Số tài khoản')).toHaveAccessibleDescription(expect.stringContaining(msg));
    expect(screen.getByLabelText('Chủ tài khoản')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Tên ngân hàng')).not.toHaveAttribute('aria-invalid');
    expect(screen.getAllByText(msg)).toHaveLength(1);
  });

  it('chưa bấm gửi thì chưa hiện lỗi', () => {
    render(<RefundDestinationPicker method="BANK" onMethod={vi.fn()} bank={bank} onBank={vi.fn()} />);
    expect(screen.queryByText('Số tài khoản chỉ gồm chữ số, từ 6 đến 24 số.')).toBeNull();
  });
});
