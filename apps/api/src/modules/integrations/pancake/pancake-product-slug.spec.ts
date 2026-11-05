import { CAMPAIGN_ENTITY_SLUG_MAX, CAMPAIGN_ENTITY_SLUG_RE } from '@tubutree/shared-types';
import { pancakeProductSlug } from './pancake-product-slug';

describe('pancakeProductSlug', () => {
  it('tên ngắn giữ nguyên kết quả cũ: bỏ dấu, đ thành d, hậu tố 6 ký tự cuối viết thường', () => {
    expect(pancakeProductSlug('Tinh Dầu Tràm', 'abcdef123456')).toBe('tinh-dau-tram-123456');
    expect(pancakeProductSlug('Đậu Đỏ', 'XYZ999')).toBe('dau-do-xyz999');
    expect(pancakeProductSlug('  Xà Phòng (Bạc Hà) 100g!! ', 'AB12CD')).toBe('xa-phong-bac-ha-100g-ab12cd');
  });

  it('tên 1000 ký tự có dấu, khoảng trắng và ký hiệu: slug ≤ CAMPAIGN_ENTITY_SLUG_MAX, khớp CAMPAIGN_ENTITY_SLUG_RE, giữ hậu tố', () => {
    const name = 'Tinh Dầu Đặc Biệt (Hữu Cơ) - Bản Giới Hạn! '.repeat(30).slice(0, 1000);
    expect(name.length).toBe(1000);
    const slug = pancakeProductSlug(name, 'zz-ABC123');
    expect(slug.length).toBeLessThanOrEqual(CAMPAIGN_ENTITY_SLUG_MAX);
    expect(slug).toMatch(CAMPAIGN_ENTITY_SLUG_RE);
    expect(slug.endsWith('-abc123')).toBe(true);
    expect(slug.startsWith('tinh-dau-dac-biet-huu-co-ban-gioi-han')).toBe(true);
  });

  it('cắt xong không để dấu - thừa cuối phần tên, hậu tố vẫn nguyên và vừa MAX đúng', () => {
    const room = CAMPAIGN_ENTITY_SLUG_MAX - 1 - 6;
    const cutOnDash = `${'a'.repeat(room - 1)} ${'b'.repeat(50)}`;
    const slug = pancakeProductSlug(cutOnDash, 'SUFFIX');
    expect(slug).toBe(`${'a'.repeat(room - 1)}-suffix`);
    expect(slug.includes('--')).toBe(false);
    const exact = pancakeProductSlug('a'.repeat(room + 50), 'SUFFIX');
    expect(exact).toHaveLength(CAMPAIGN_ENTITY_SLUG_MAX);
  });

  it('tên toàn ký hiệu hoặc chỉ khoảng trắng: phần tên là "san-pham", slug hợp lệ và giữ hậu tố', () => {
    for (const name of ['!!! ???', '   ', '', '()-_']) {
      const slug = pancakeProductSlug(name, 'ABC123');
      expect(slug).toBe('san-pham-abc123');
      expect(slug).toMatch(CAMPAIGN_ENTITY_SLUG_RE);
    }
  });
});
