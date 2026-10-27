import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InitialsAvatar } from './initials-avatar';

describe('InitialsAvatar (B-136)', () => {
  it('chữ cái đầu của tên đang hiển thị, không có ảnh, ẩn khỏi trình đọc màn hình', () => {
    const { container } = render(<InitialsAvatar name="Lại N." size={32} />);
    const el = screen.getByTestId('initials-avatar');
    expect(el.textContent).toBe('L');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.width).toBe('32px');
    expect(el.style.height).toBe('32px');
    expect(container.querySelector('img')).toBeNull();
  });
  it('tên chung "Bạn Tubu" và "Khách Tubu" dùng chữ T', () => {
    render(<><InitialsAvatar name="Bạn Tubu" /><InitialsAvatar name="Khách Tubu" /></>);
    expect(screen.getAllByTestId('initials-avatar').map((e) => e.textContent)).toEqual(['T', 'T']);
  });
  it('cùng tên cùng màu nền', () => {
    render(<><InitialsAvatar name="Hoa" /><InitialsAvatar name="Hoa" /></>);
    const [a, b] = screen.getAllByTestId('initials-avatar');
    expect(a!.style.background).toBe(b!.style.background);
    expect(a!.style.background).not.toBe('');
  });
});
