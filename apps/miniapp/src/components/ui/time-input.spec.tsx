import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Field } from './form';
import { TimeInput } from './time-input';

describe('TimeInput', () => {
  it('đổi giờ gọi onChange với chuỗi HH:mm', () => {
    const onChange = vi.fn();
    render(<TimeInput value="08:00" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Giờ'), { target: { value: '09:30' } });
    expect(onChange).toHaveBeenCalledWith('09:30');
  });

  it('không có nhãn nào từ chỗ gọi: vẫn có tên truy cập mặc định "Giờ" (axe label)', () => {
    render(<TimeInput value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Giờ')).toHaveAttribute('type', 'time');
  });

  it('aria-label của chỗ gọi thay tên mặc định', () => {
    render(<TimeInput value="" onChange={() => {}} aria-label="Giờ bắt đầu ca" />);
    expect(screen.getByLabelText('Giờ bắt đầu ca')).toBeInTheDocument();
  });

  it('đặt trong Field: nhãn của Field là tên truy cập (không bị tên mặc định đè lên)', () => {
    render(
      <Field label="Giờ vào ca">
        <TimeInput value="" onChange={() => {}} />
      </Field>,
    );
    expect(screen.getByLabelText('Giờ vào ca')).toHaveAttribute('type', 'time');
    expect(screen.queryByLabelText('Giờ')).toBeNull();
  });
});
