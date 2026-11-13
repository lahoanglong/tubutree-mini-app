import { describe, expect, it } from 'vitest';
import { hideBrokenImage } from './image-fallback';

describe('hideBrokenImage', () => {
  it('ẩn ảnh lỗi bằng visibility để khung giữ chỗ, không dùng display:none', () => {
    const style = { visibility: 'visible', display: 'block' };
    hideBrokenImage({ currentTarget: { style } });
    expect(style.visibility).toBe('hidden');
    expect(style.display).toBe('block');
  });

  it('gọi lại nhiều lần vẫn giữ hidden', () => {
    const style = { visibility: '' };
    hideBrokenImage({ currentTarget: { style } });
    hideBrokenImage({ currentTarget: { style } });
    expect(style.visibility).toBe('hidden');
  });
});
