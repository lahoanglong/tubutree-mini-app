import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RefundDestinationPicker } from './refund-destination-picker';

describe('RefundDestinationPicker: lỗi tài khoản nằm dưới đúng ô (R2-BUYERMINI-6)', () => {
  const bank = { bankName: 'Techcombank', accountNumber: 'abc', accountName: 'Nguyen Van A' };

  it('số tài khoản sai → lỗi dưới ô Số tài khoản, không dưới ô Chủ tài khoản', () => {
    render(<RefundDestinationPicker method="BANK" onMethod={vi.fn()} bank={bank} onBank={vi.fn()} showBankErrors />);
    const msg = 'Số tài khoản nhận tiền hoàn chỉ gồm chữ số, từ 6 đến 24 số.';
    expect(screen.getByLabelText('Số tài khoản')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Số tài khoản')).toHaveAccessibleDescription(expect.stringContaining(msg));
    expect(screen.getByLabelText('Chủ tài khoản')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Tên ngân hàng')).not.toHaveAttribute('aria-invalid');
    expect(screen.getAllByText(msg)).toHaveLength(1);
  });

  it('chưa bấm gửi thì chưa hiện lỗi', () => {
    render(<RefundDestinationPicker method="BANK" onMethod={vi.fn()} bank={bank} onBank={vi.fn()} />);
    expect(screen.queryByText('Số tài khoản nhận tiền hoàn chỉ gồm chữ số, từ 6 đến 24 số.')).toBeNull();
  });

  it('để trống cả ba ô: mỗi ô báo lỗi riêng', () => {
    render(<RefundDestinationPicker method="BANK" onMethod={vi.fn()} bank={{ bankName: '', accountNumber: '', accountName: '' }} onBank={vi.fn()} showBankErrors />);
    for (const label of ['Tên ngân hàng', 'Số tài khoản', 'Chủ tài khoản']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    }
  });

  it('chỉ tên ngân hàng quá ngắn: chỉ ô đó bị đánh dấu', () => {
    render(<RefundDestinationPicker method="BANK" onMethod={vi.fn()} bank={{ ...bank, bankName: 'A', accountNumber: '0123456789' }} onBank={vi.fn()} showBankErrors />);
    expect(screen.getByLabelText('Tên ngân hàng')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Số tài khoản')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Chủ tài khoản')).not.toHaveAttribute('aria-invalid');
  });

  it('tài khoản hợp lệ: không ô nào bị đánh dấu dù đã bấm gửi', () => {
    render(<RefundDestinationPicker method="BANK" onMethod={vi.fn()} bank={{ ...bank, accountNumber: '0123456789' }} onBank={vi.fn()} showBankErrors />);
    for (const label of ['Tên ngân hàng', 'Số tài khoản', 'Chủ tài khoản']) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute('aria-invalid');
    }
  });

  it('gõ vào một ô: gọi onBank với ba ô, chỉ ô đó đổi', () => {
    const onBank = vi.fn();
    render(<RefundDestinationPicker method="BANK" onMethod={vi.fn()} bank={bank} onBank={onBank} />);
    fireEvent.change(screen.getByLabelText('Tên ngân hàng'), { target: { value: 'ACB' } });
    expect(onBank).toHaveBeenCalledWith({ ...bank, bankName: 'ACB' });
  });

  it('chọn Ví Tubu: không vẽ ô tài khoản; chọn Ngân hàng gọi onMethod, chọn lại phương thức đang chọn thì bỏ qua', () => {
    const onMethod = vi.fn();
    const { rerender } = render(<RefundDestinationPicker method="WALLET" onMethod={onMethod} bank={bank} onBank={vi.fn()} />);
    expect(screen.queryByLabelText('Số tài khoản')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Ví Tubu/ }));
    expect(onMethod).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /Tài khoản ngân hàng/ }));
    expect(onMethod).toHaveBeenCalledWith('BANK');
    rerender(<RefundDestinationPicker method="BANK" onMethod={onMethod} bank={bank} onBank={vi.fn()} />);
    expect(screen.getByLabelText('Số tài khoản')).toBeInTheDocument();
  });
});
