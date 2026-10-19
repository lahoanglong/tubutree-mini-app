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

describe('skin.plain, outlineCard, dealerInkBtn, cardTitleSans', () => {
  it('plain: hàng trơn trên nền, không chứa box-shadow tuỳ ý để max-md:shadow-none thắng', () => {
    expect(skin.plain).toContain(ui.card);
    expect(skin.plain).toContain('max-md:shadow-none');
    expect(skin.plain).toContain('max-md:bg-transparent');
    expect(skin.plain).toContain('max-md:border-transparent');
    expect(skin.plain).not.toContain('box-shadow:var(--elevation');
  });
  it('outlineCard: giữ viền, bỏ bóng ở điện thoại như Card variant outline', () => {
    expect(skin.outlineCard).toContain(ui.card);
    expect(skin.outlineCard).toContain('max-md:shadow-none');
    expect(skin.outlineCard).not.toContain('border-[color:');
    expect(skin.outlineCard).toContain('border-stone-200');
    expect(skin.outlineCard).not.toContain('max-md:border-transparent');
  });
  it('dealerInkBtn: chỉ nút đang bật mới navy, kể cả khi hover; nút khoá giữ kiểu khoá', () => {
    expect(skin.dealerInkBtn).toContain('max-md:enabled:bg-[var(--color-dealer-ink,');
    expect(skin.dealerInkBtn).toContain('max-md:enabled:hover:bg-[var(--color-dealer-ink,');
    expect(skin.dealerInkBtn).toContain('var(--color-dealer-ink,');
    expect(skin.dealerInkBtn).not.toMatch(/max-md:hover:bg/);
  });
  it('cardTitleSans: máy tính giữ sans 16px, chỉ điện thoại đổi serif title-sm', () => {
    expect(skin.cardTitleSans).toContain('text-base font-semibold');
    expect(skin.cardTitleSans).not.toMatch(/(^|\s)font-display/);
    expect(skin.cardTitleSans).toContain('max-md:font-display');
    expect(skin.cardTitleSans).toContain('max-md:text-[length:var(--type-title-sm-size)]');
  });
});
