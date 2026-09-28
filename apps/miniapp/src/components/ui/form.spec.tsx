import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Field, Checkbox, Radio, Switch } from './form';

describe('Field', () => {
  it('renders label and error message', () => {
    render(
      <Field label="Số điện thoại" error="Không hợp lệ">
        <input />
      </Field>,
    );
    expect(screen.getByText('Số điện thoại')).toBeInTheDocument();
    expect(screen.getByText('Không hợp lệ')).toBeInTheDocument();
  });

  it('omits error text when none given', () => {
    render(
      <Field label="Tên">
        <input />
      </Field>,
    );
    expect(screen.queryByText(/không hợp lệ/i)).not.toBeInTheDocument();
  });

  it('renders its children', () => {
    render(
      <Field label="Tên">
        <input placeholder="Nhập tên" />
      </Field>,
    );
    expect(screen.getByPlaceholderText('Nhập tên')).toBeInTheDocument();
  });
});

describe('Checkbox', () => {
  it('has a 44px min touch target wrapper', () => {
    render(<Checkbox label="Đồng ý điều khoản" checked={false} onChange={() => {}} />);
    // minWidth matters just as much as minHeight: as a flex item with no visible label/children
    // (the common case for a standalone selection checkbox in a row), the wrapper shrinks to the
    // control's own content width (24px) unless minWidth is set explicitly — regression coverage
    // for the real 44x24 hit-area bug found while migrating cart.tsx (Task 25).
    expect(screen.getByRole('checkbox').closest('[data-testid="checkbox-hit-area"]')).toHaveStyle({
      minHeight: '44px',
      minWidth: '44px',
    });
  });

  it('does not require a value prop for standalone use', () => {
    render(<Checkbox label="Nhận thông báo" checked onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Nhận thông báo' })).toBeChecked();
  });

  it('forwards onChange to the underlying ZaUI checkbox', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Đồng ý điều khoản" checked={false} onChange={onChange} />);
    screen.getByRole('checkbox').click();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('Radio', () => {
  it('has a 44px min touch target wrapper', () => {
    render(<Radio label="Tiền mặt" value="cod" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('radio').closest('[data-testid="radio-hit-area"]')).toHaveStyle({ minHeight: '44px' });
  });
});

describe('Switch', () => {
  it('has a 44px min touch target wrapper', () => {
    render(<Switch label="Bật thông báo" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox').closest('[data-testid="switch-hit-area"]')).toHaveStyle({ minHeight: '44px' });
  });
});
