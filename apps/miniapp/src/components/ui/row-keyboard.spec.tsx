import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox, Radio } from './form';
import { rowKeyboardProps } from './row-keyboard';

describe('rowKeyboardProps', () => {
  it('hàng tự làm role=radio có thể Tab tới, Space và Enter kích hoạt đúng một lần mỗi phím', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <div role="radio" aria-checked={false} aria-label="Chuyển khoản" onClick={onClick} {...rowKeyboardProps()}>
        <Radio checked={false} onChange={() => {}} />
      </div>,
    );
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Chuyển khoản' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(1);
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('chấm chọn trang trí bên trong không thành điểm dừng Tab thứ hai (không bắn đôi)', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <div>
        <div role="checkbox" aria-checked={false} aria-label="Hoá đơn VAT" onClick={onClick} {...rowKeyboardProps()}>
          <Checkbox checked={false} onChange={() => {}} />
        </div>
        <button type="button">Tiếp theo</button>
      </div>,
    );
    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Hoá đơn VAT' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Tiếp theo' })).toHaveFocus();
  });

  it('phím từ phần tử lồng bên trong và phím lặp không kích hoạt hàng', () => {
    const onClick = vi.fn();
    render(
      <div role="checkbox" aria-checked={false} aria-label="Hàng" onClick={onClick} {...rowKeyboardProps()}>
        <button type="button">Xem thêm</button>
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Xem thêm' }), { key: ' ' });
    fireEvent.keyDown(screen.getByRole('checkbox'), { key: ' ', repeat: true });
    fireEvent.keyDown(screen.getByRole('checkbox'), { key: 'a' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('Space trên hàng chặn hành vi mặc định (trang không cuộn)', () => {
    render(<div role="checkbox" aria-checked={false} aria-label="Hàng" onClick={() => {}} {...rowKeyboardProps()} />);
    const notPrevented = fireEvent.keyDown(screen.getByRole('checkbox'), { key: ' ' });
    expect(notPrevented).toBe(false);
  });
});

/**
 * Checkbox/Radio/Switch không tên bị ẩn khỏi Tab (ui/form.tsx), nên hàng cha role=radio|checkbox tự làm
 * ở trang thanh toán phải tự có bàn phím — nếu không, người dùng bàn phím không chọn được phương thức
 * thanh toán. Quét mã nguồn: thẻ mở nào có role radio/checkbox phải gắn rowKeyboardProps (hoặc tabIndex).
 */
function openingTagAround(src: string, roleIndex: number): string {
  const start = Math.max(src.lastIndexOf('<Box', roleIndex), src.lastIndexOf('<div', roleIndex));
  let depth = 0;
  let j = start;
  while (j < src.length) {
    const c = src[j];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0 && src[j - 1] !== '=') break;
    j += 1;
  }
  return src.slice(start, j + 1);
}

describe('hàng role=radio/checkbox ở trang thanh toán có bàn phím', () => {
  const src = readFileSync(resolve(__dirname, '../../pages/checkout.tsx'), 'utf8');
  const rows = [...src.matchAll(/role="(radio|checkbox)"/g)].map((m) => ({ role: m[1], tag: openingTagAround(src, m.index ?? 0) }));

  it('tìm thấy cả 4 hàng (phương thức thanh toán, Điểm Xanh, tái chế, hoá đơn VAT)', () => {
    expect(rows).toHaveLength(4);
  });

  it.each(rows.map((r, i) => [i, r.role, r.tag] as const))('hàng #%i (%s) gắn rowKeyboardProps', (_i, _role, tag) => {
    expect(tag).toMatch(/rowKeyboardProps\(\)|tabIndex=/);
  });
});
