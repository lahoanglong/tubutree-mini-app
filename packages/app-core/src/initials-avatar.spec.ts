import { describe, expect, it } from 'vitest';
import { AVATAR_TONES, avatarInitial, avatarTone } from './initials-avatar';

describe('avatarInitial', () => {
  it('chữ cái đầu của tên đang hiển thị, viết hoa, giữ dấu tiếng Việt', () => {
    expect(avatarInitial('Lại N.')).toBe('L');
    expect(avatarInitial('Đỗ Hương')).toBe('Đ');
    expect(avatarInitial('lan')).toBe('L');
    expect(avatarInitial('  Ánh ')).toBe('Á');
  });
  it('tên chung và tên rỗng dùng "T"', () => {
    expect(avatarInitial('Bạn Tubu')).toBe('T');
    expect(avatarInitial('Khách Tubu')).toBe('T');
    expect(avatarInitial('')).toBe('T');
    expect(avatarInitial(null)).toBe('T');
    expect(avatarInitial('🌸')).toBe('T');
  });
  it('bỏ qua emoji đứng đầu', () => {
    expect(avatarInitial('🌸 Hoa')).toBe('H');
  });
});

describe('avatarTone', () => {
  it('cùng tên cùng màu, màu nằm trong bảng', () => {
    expect(avatarTone('Lại N.')).toEqual(avatarTone('Lại N.'));
    expect(AVATAR_TONES).toContainEqual(avatarTone('Hoa'));
    expect(AVATAR_TONES).toContainEqual(avatarTone(''));
  });
});
