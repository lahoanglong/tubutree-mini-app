import { describe, expect, it } from 'vitest';
import { ui } from '@/lib/guest-ui';
import { skin } from './mini-skin';

describe('skin (lớp phủ Mini App cho nhóm pro)', () => {
  it('nút phụ giữ lớp máy tính và đổi sang nền secondary không viền ở điện thoại', () => {
    expect(skin.btnSecondary).toContain(ui.btnSecondary);
    expect(skin.btnSecondary).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
    expect(skin.btnSecondary).toContain('max-md:border-transparent');
  });
  it('thẻ bỏ viền, dùng bóng elevation-1 ở điện thoại', () => {
    expect(skin.card).toContain(ui.card);
    expect(skin.card).toContain('max-md:border-transparent');
    expect(skin.card).toContain('max-md:[box-shadow:var(--elevation-1)]');
  });
  it('mọi lớp phủ đều nằm sau tiền tố max-md', () => {
    for (const cls of [skin.pageTitle, skin.cardTitle]) expect(cls).toMatch(/max-md:/);
  });
});

describe('skin.mainUp', () => {
  it('chỉ kéo lên khi body có nút lùi nổi và chỉ ở điện thoại', () => {
    expect(skin.mainUp).toContain('max-md:[body.with-back-btn_&]:-mt-12');
    expect(skin.mainUp).toContain('max-md:[body.with-back-btn_&]:pt-0');
  });
});
