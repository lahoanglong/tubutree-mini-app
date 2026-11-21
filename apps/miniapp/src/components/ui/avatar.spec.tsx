import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProfileAvatar } from '../account/profile-avatar';
import { Avatar } from './avatar';

describe('Avatar — ảnh tròn thay Avatar của zmp-ui', () => {
  it('khung tròn đúng size, nền chuyển sắc như zmp-ui; ảnh phủ kín khung, alt rỗng vì tên nằm cạnh', () => {
    const { container } = render(<Avatar size={40} src="https://cdn.tubutree.com/logo.png" />);
    const box = screen.getByTestId('avatar');
    expect(box.style.width).toBe('40px');
    expect(box.style.height).toBe('40px');
    expect(box.style.borderRadius).toBe('100%');
    expect(box.style.display).toBe('inline-block');
    expect(box.style.position).toBe('relative');
    expect(box.style.background).toContain('linear-gradient');
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.tubutree.com/logo.png');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.style.objectFit).toBe('cover');
    expect(img?.style.position).toBe('absolute');
    expect(img?.style.width).toBe('100%');
  });

  it('ảnh lỗi: ẩn thẻ img (không hiện biểu tượng ảnh gãy), còn vòng nền', () => {
    const { container } = render(<Avatar size={40} src="https://cdn.tubutree.com/gone.png" />);
    const img = container.querySelector('img')!;
    fireEvent.error(img);
    expect(img.style.visibility).toBe('hidden');
    expect(screen.getByTestId('avatar')).toBeTruthy();
  });

  it('chưa có ảnh: chỉ vòng nền, không thẻ img vỡ', () => {
    const { container } = render(<Avatar size={48} src={null} />);
    expect(screen.getByTestId('avatar').style.width).toBe('48px');
    expect(container.querySelector('img')).toBeNull();
  });

  it('style của nơi gọi thắng (ProfileAvatar truyền viền/bóng)', () => {
    render(<Avatar size={56} src="a.png" style={{ border: '2px solid white', width: 60 }} />);
    const box = screen.getByTestId('avatar');
    expect(box.style.border).toBe('2px solid white');
    expect(box.style.width).toBe('60px');
  });

  it('ProfileAvatar có ảnh dùng Avatar nội bộ, chưa có ảnh vẫn là chữ cái đầu', () => {
    const { rerender } = render(<ProfileAvatar name="Lan Anh" size={56} src="me.png" />);
    expect(screen.getByTestId('avatar').querySelector('img')?.getAttribute('src')).toBe('me.png');
    rerender(<ProfileAvatar name="Lan Anh" size={56} src={null} />);
    expect(screen.queryByTestId('avatar')).toBeNull();
    expect(screen.getByTestId('profile-avatar-initial').textContent).toBe('L');
  });
});
