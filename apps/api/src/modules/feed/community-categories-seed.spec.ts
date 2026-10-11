import {
  COMMUNITY_CATEGORIES,
  RETIRED_COMMUNITY_CATEGORY_SLUGS,
  communityCategoryUpsertArgs,
  retireCommunityCategoriesArgs,
} from './community-categories-seed';

// C-073: danh mục cộng đồng phải theo ngành hàng thật (mỹ phẩm, tẩy rửa, mẹ & bé, cà phê, thực phẩm).
describe('community-categories-seed', () => {
  const PLANT = /cây|vườn|sâu bệnh|décor|phối cảnh|chậu/i;

  it('danh mục đang dùng không còn nói về cây cảnh', () => {
    expect(COMMUNITY_CATEGORIES.filter((c) => PLANT.test(c.name))).toEqual([]);
  });

  it('phủ đủ các nhóm hàng đang bán', () => {
    const names = COMMUNITY_CATEGORIES.map((c) => c.name).join(' | ');
    for (const group of [/mỹ phẩm/i, /tẩy rửa/i, /mẹ & bé/i, /cà phê/i, /thực phẩm/i]) {
      expect(names).toMatch(group);
    }
  });

  it('giữ hai danh mục trung tính cũ (hoi-mua-gi, meo-hay) với cùng slug để bài cũ không mồ côi', () => {
    const slugs = COMMUNITY_CATEGORIES.map((c) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(['hoi-mua-gi', 'meo-hay']));
  });

  it('slug duy nhất, order duy nhất, slug đã nghỉ không dùng lại cho danh mục mới', () => {
    const slugs = COMMUNITY_CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(COMMUNITY_CATEGORIES.map((c) => c.order)).size).toBe(slugs.length);
    expect(slugs.filter((s) => RETIRED_COMMUNITY_CATEGORY_SLUGS.includes(s))).toEqual([]);
  });

  it('danh mục cây cảnh cũ chỉ bị ẩn (isActive=false), không xoá — bài đã đăng vẫn còn nguyên', () => {
    expect(RETIRED_COMMUNITY_CATEGORY_SLUGS).toEqual(['cham-soc', 'sau-benh', 'phoi-canh', 'khoe-vuon']);
    expect(retireCommunityCategoriesArgs()).toEqual({
      where: { slug: { in: RETIRED_COMMUNITY_CATEGORY_SLUGS } },
      data: { isActive: false },
    });
  });

  it('upsert không đụng isActive của danh mục đang dùng (admin tắt tay thì deploy không bật lại)', () => {
    const c = COMMUNITY_CATEGORIES.find((x) => x.slug === 'meo-hay');
    if (!c) throw new Error('thiếu danh mục meo-hay');
    const args = communityCategoryUpsertArgs(c);
    expect(args.where).toEqual({ slug: c.slug });
    expect(args.create).toEqual(c);
    expect(args.update).toEqual({ name: c.name, icon: c.icon, order: c.order });
    expect(args.update).not.toHaveProperty('isActive');
  });
});
