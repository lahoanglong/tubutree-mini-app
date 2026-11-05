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

  it('mã Pancake UUID hoặc số cho kết quả y như cũ (6 ký tự cuối, viết thường)', () => {
    expect(pancakeProductSlug('Trà Sen', '3f2b8c1e-7a41-4d0e-9b6a-1c2d3e4f5a6b')).toBe('tra-sen-4f5a6b');
    expect(pancakeProductSlug('Trà Sen', '1234567890')).toBe('tra-sen-567890');
    expect(pancakeProductSlug('Trà Sen', 'ab_cd-')).toBe('tra-sen-ab_cd-');
  });

  it('mã có ký tự ngoài [a-z0-9_-] hoặc rỗng: hậu tố là 6 ký tự hex băm từ cả mã, slug vẫn khớp RE, ổn định và khác nhau theo mã', () => {
    const odd = ['mã sản phẩm é☃', 'ab/cd?ef#', 'xx xx x', '', '   '];
    const slugs = odd.map((c) => pancakeProductSlug('Trà Sen', c));
    for (const slug of slugs) {
      expect(slug).toMatch(CAMPAIGN_ENTITY_SLUG_RE);
      expect(slug).toMatch(/^tra-sen-[0-9a-f]{6}$/);
    }
    expect(new Set(slugs).size).toBe(odd.length);
    expect(pancakeProductSlug('Trà Sen', odd[0]!)).toBe(slugs[0]);
  });
});
