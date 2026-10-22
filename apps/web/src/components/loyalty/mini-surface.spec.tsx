// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { miniBleed, miniBtnSecondary, miniCard, miniOutline, miniSectionTitle } from './mini-surface';

describe('bề mặt kiểu Mini App ở điện thoại', () => {
  it('thẻ: nền trắng, đổ bóng, viền chỉ từ md', () => {
    expect(miniCard).toContain('bg-stone-0');
    expect(miniCard).toContain('shadow-card');
    expect(miniCard).toContain('md:border');
    expect(miniCard.split(' ')).not.toContain('border');
  });

  it('thẻ viền: có viền, bóng chỉ từ md', () => {
    expect(miniOutline.split(' ')).toContain('border');
    expect(miniOutline).toContain('max-md:shadow-none');
  });

  it('khối tràn ngang: bỏ bo, viền, bóng và bù lề cha ở điện thoại', () => {
    for (const c of ['max-md:-mx-4', 'max-md:rounded-none', 'max-md:border-0', 'max-md:shadow-none']) expect(miniBleed).toContain(c);
  });

  it('nút phụ: giữ nút viền của máy tính, dưới md đổi sang nền xanh nhạt không viền như ZaUI secondary', () => {
    expect(miniBtnSecondary).toContain('border-stone-450');
    expect(miniBtnSecondary).toContain('max-md:border-transparent');
    expect(miniBtnSecondary).toContain('max-md:bg-forest-50');
    expect(miniBtnSecondary).toContain('max-md:text-forest-700');
    expect(miniBtnSecondary).toContain('max-md:disabled:bg-stone-200');
  });
});

describe('tiêu đề khối', () => {
  it('tiêu đề khối cỡ title-sm ở điện thoại', () => {
    expect(miniSectionTitle).toContain('max-md:text-[length:var(--type-title-sm-size)]');
  });
});
