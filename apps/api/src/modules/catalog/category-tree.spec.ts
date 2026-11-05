import { CAMPAIGN_ENTITY_SLUG_MAX, CAMPAIGN_ENTITY_SLUG_RE } from '@tubutree/shared-types';
import {
  CATEGORY_MAX_CHILDREN,
  CATEGORY_MAX_ROOTS,
  CATEGORY_MSG,
  CATEGORY_NAME_MAX,
  categorySlugBase,
  sameCategoryName,
  uniqueCategorySlug,
} from './category-tree';

describe('category-tree', () => {
  it('trần mặc định là 8 gốc × 8 con', () => {
    expect(CATEGORY_MAX_ROOTS).toBe(8);
    expect(CATEGORY_MAX_CHILDREN).toBe(8);
  });

  it('categorySlugBase bỏ dấu, gom ký tự lạ, rỗng thì "danh-muc"', () => {
    expect(categorySlugBase('Chăm sóc  cá nhân!')).toBe('cham-soc-ca-nhan');
    expect(categorySlugBase('Đồ dùng Nhà bếp')).toBe('do-dung-nha-bep');
    expect(categorySlugBase('???')).toBe('danh-muc');
  });

  it('uniqueCategorySlug thêm hậu tố -2, -3 khi trùng', () => {
    expect(uniqueCategorySlug('bep', new Set())).toBe('bep');
    expect(uniqueCategorySlug('bep', new Set(['bep', 'bep-2']))).toBe('bep-3');
  });

  it('slug danh mục từ tên dài nhất cộng hậu tố trùng (đến -99999) vừa CAMPAIGN_ENTITY_SLUG_MAX và khớp CAMPAIGN_ENTITY_SLUG_RE', () => {
    const base = categorySlugBase('a'.repeat(CATEGORY_NAME_MAX));
    const taken = new Set([base, ...Array.from({ length: 99_997 }, (_, i) => `${base}-${i + 2}`)]);
    const slug = uniqueCategorySlug(base, taken);
    expect(slug.endsWith('-99999')).toBe(true);
    expect(slug.length).toBeLessThanOrEqual(CAMPAIGN_ENTITY_SLUG_MAX);
    expect(slug).toMatch(CAMPAIGN_ENTITY_SLUG_RE);
  });

  it('sameCategoryName so tên không phân biệt hoa thường, dấu, khoảng trắng đầu cuối', () => {
    expect(sameCategoryName(' Nhà Bếp ', 'nha bep')).toBe(true);
    expect(sameCategoryName('Nhà bếp', 'Phòng tắm')).toBe(false);
  });

  it('thông báo vượt trần nêu số 8 và tên cha', () => {
    expect(CATEGORY_MSG.rootsFull()).toContain('8');
    const m = CATEGORY_MSG.childrenFull('Gia dụng');
    expect(m).toContain('"Gia dụng"');
    expect(m).toContain('8');
  });
});
