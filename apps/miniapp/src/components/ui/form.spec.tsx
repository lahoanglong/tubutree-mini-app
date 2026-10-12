import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Input } from 'zmp-ui';
import { Field, Checkbox, Radio, Switch } from './form';
import { describeNested, findNestedInteractive } from './nested-interactive';

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

describe('Field gắn nhãn với control (C-077, axe label)', () => {
  it('ô nhập native: nhãn trỏ đúng ô nhập (getByLabelText)', () => {
    render(
      <Field label="Họ tên người nhận">
        <input />
      </Field>,
    );
    expect(screen.getByLabelText('Họ tên người nhận').tagName).toBe('INPUT');
  });

  it('Input của ZaUI: nhãn trỏ đúng <input> thật và id không bị trùng', () => {
    const { container } = render(
      <Field label="Số điện thoại">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Số điện thoại');
    expect(input.tagName).toBe('INPUT');
    expect(container.querySelectorAll(`[id="${input.id}"]`)).toHaveLength(1);
  });

  it('có lỗi: control nhận aria-invalid và aria-describedby trỏ vào thông báo lỗi', () => {
    render(
      <Field label="Tên" error="Vui lòng nhập tên">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText('Tên');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Vui lòng nhập tên');
  });

  it('không lỗi: không gắn aria-invalid / aria-describedby', () => {
    render(
      <Field label="Tên">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText('Tên');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('control đã có id riêng thì giữ nguyên id đó', () => {
    render(
      <Field label="Ghi chú">
        <input id="ghi-chu" />
      </Field>,
    );
    expect(screen.getByLabelText('Ghi chú')).toHaveAttribute('id', 'ghi-chu');
  });

  it('nhiều control con: nhóm có tên theo nhãn của Field', () => {
    render(
      <Field label="Giờ làm">
        <input aria-label="Từ" />
        <input aria-label="Đến" />
      </Field>,
    );
    expect(screen.getByRole('group', { name: 'Giờ làm' })).toBeInTheDocument();
  });
});

describe('control không có tên (C-077)', () => {
  it('Checkbox/Radio/Switch có label hoặc aria-label vẫn là control bình thường, đọc được tên', () => {
    render(
      <>
        <Checkbox label="Chọn tất cả" checked={false} onChange={() => {}} />
        <Radio aria-label="Chuyển khoản" checked={false} onChange={() => {}} />
        <Switch aria-label="Nhận thông báo" checked={false} onChange={() => {}} />
      </>,
    );
    expect(screen.getByRole('checkbox', { name: 'Chọn tất cả' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Chuyển khoản' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Nhận thông báo' })).toBeInTheDocument();
  });

  it('Checkbox có children làm nhãn vẫn được tính là có tên', () => {
    render(<Checkbox checked={false} onChange={() => {}}>Tubu Xà phòng</Checkbox>);
    expect(screen.getByRole('checkbox', { name: 'Tubu Xà phòng' })).toBeInTheDocument();
  });

  it.each([
    ['Checkbox', <Checkbox key="c" checked={false} onChange={() => {}} />, 'checkbox-hit-area'],
    ['Radio', <Radio key="r" checked={false} onChange={() => {}} />, 'radio-hit-area'],
    ['Switch', <Switch key="s" checked={false} onChange={() => {}} />, 'switch-hit-area'],
  ])('%s không tên = thị giác thuần tuý: ẩn khỏi trình đọc màn hình và khỏi thứ tự Tab, nhưng vẫn bấm được', (_n, ui, testId) => {
    render(ui);
    const hit = screen.getByTestId(testId);
    expect(hit).toHaveAttribute('aria-hidden', 'true');
    const input = hit.querySelector('input')!;
    expect(input.tabIndex).toBe(-1);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it.each([
    ['Checkbox', <Checkbox key="c" checked={false} onChange={() => {}} />, 'checkbox-hit-area'],
    ['Radio', <Radio key="r" checked={false} onChange={() => {}} />, 'radio-hit-area'],
    ['Switch', <Switch key="s" checked={false} onChange={() => {}} />, 'switch-hit-area'],
  ])('%s không tên bọc `inert`: tabindex=-1 một mình vẫn là phần tử focus được lồng trong hàng cha (axe nested-interactive)', (_n, ui, testId) => {
    render(<div role="radio" aria-checked="false" tabIndex={0}>{ui}</div>);
    expect(screen.getByTestId(testId)).toHaveAttribute('inert');
    expect(findNestedInteractive(document.body).map(describeNested)).toEqual([]);
  });

  it('control CÓ tên không bị `inert` (là control thật, phải focus và đọc được)', () => {
    render(
      <>
        <Checkbox label="Chọn tất cả" checked={false} onChange={() => {}} />
        <Radio aria-label="Chuyển khoản" checked={false} onChange={() => {}} />
        <Switch aria-label="Nhận thông báo" checked={false} onChange={() => {}} />
      </>,
    );
    for (const id of ['checkbox-hit-area', 'radio-hit-area', 'switch-hit-area']) {
      expect(screen.getByTestId(id)).not.toHaveAttribute('inert');
    }
  });

  it('Checkbox không tên vẫn nhận onChange khi bấm (cha giữ ngữ nghĩa, DS không nuốt sự kiện)', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} />);
    screen.getByTestId('checkbox-hit-area').querySelector('input')!.click();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('Checkbox/Radio/Switch có nhãn qua Field không bị coi là trang trí (C-077)', () => {
  it.each([
    ['Checkbox', <Checkbox checked onChange={() => {}} />, 'checkbox-hit-area'],
    ['Radio', <Radio checked onChange={() => {}} />, 'radio-hit-area'],
    ['Switch', <Switch checked onChange={() => {}} />, 'switch-hit-area'],
  ])('%s trong Field: đọc được tên, nằm trong thứ tự Tab, không có tổ tiên aria-hidden', (_n, ui, testId) => {
    render(<Field label="Đồng ý">{ui}</Field>);
    const input = screen.getByLabelText('Đồng ý') as HTMLInputElement;
    expect(input.tabIndex).not.toBe(-1);
    expect(input.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByTestId(testId)).not.toHaveAttribute('aria-hidden');
  });

  it('Field có lỗi: control vẫn có tên và mô tả lỗi, không bị ẩn', () => {
    render(
      <Field label="Đồng ý" error="Phải đồng ý">
        <Checkbox checked={false} onChange={() => {}} />
      </Field>,
    );
    const input = screen.getByLabelText('Đồng ý');
    expect(input.closest('[aria-hidden="true"]')).toBeNull();
    expect(input).toHaveAccessibleDescription('Phải đồng ý');
  });
});
