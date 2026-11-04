import { registrySql } from './image-registry-query';

describe('registrySql: nguồn ảnh /img được đổi cỡ', () => {
  const text = registrySql().text;

  it('có sản phẩm, nhãn, đổi rác, banner chiến dịch, ảnh đại diện/bìa gian hàng', () => {
    for (const col of ['"products"', '"brands"', '"categories"', '"waste_items"', '"waste_gifts"', '"campaigns"', '"storefronts"']) expect(text).toContain(col);
    expect(text).toContain('"avatarUrl"');
  });

  it('chiến dịch và gian hàng chỉ nhận host upload tin cậy (tham số LIKE ANY), không nhận mọi https', () => {
    const sql = registrySql(['res.cloudinary.com']);
    expect(sql.values).toEqual([['https://res.cloudinary.com/%'], ['https://res.cloudinary.com/%'], ['https://res.cloudinary.com/%']]);
    expect(sql.text.match(/LIKE ANY/g)).toHaveLength(3);
    for (const table of ['campaigns', 'storefronts']) expect(new RegExp(`FROM "${table}" WHERE left`).test(sql.text)).toBe(false);
  });
});
