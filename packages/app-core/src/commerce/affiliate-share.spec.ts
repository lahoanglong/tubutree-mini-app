import { describe, expect, it } from 'vitest';
import { buildAffiliateShareUrl, estimateCommission, featuredAffiliateProducts, type FeaturedSource } from './affiliate-share';

describe('buildAffiliateShareUrl', () => {
  it('trang chủ: gắn ?ref= và lời giới thiệu có link', () => {
    const r = buildAffiliateShareUrl({ baseUrl: 'https://tubutree.com', affiliateCode: 'LINH123' });
    expect(r.url).toBe('https://tubutree.com/?ref=LINH123');
    expect(r.text).toBe('Sống xanh cùng Tubu Tree: https://tubutree.com/?ref=LINH123');
  });

  it('sản phẩm: đường dẫn /san-pham/<slug> rồi ?ref=, lời giới thiệu nêu tên', () => {
    const r = buildAffiliateShareUrl({ baseUrl: 'https://tubutree.com', productSlug: 'sua-tam-thao-moc', productName: 'Sữa tắm thảo mộc', affiliateCode: 'LINH123' });
    expect(r.url).toBe('https://tubutree.com/san-pham/sua-tam-thao-moc?ref=LINH123');
    expect(r.text).toBe('Mình gợi ý Sữa tắm thảo mộc của Tubu Tree: https://tubutree.com/san-pham/sua-tam-thao-moc?ref=LINH123');
  });

  it('Mini App: đường dẫn sản phẩm đổi được (productPath) trên link zalo.me', () => {
    const r = buildAffiliateShareUrl({ baseUrl: 'https://zalo.me/s/2070857098114207963', productPath: '/product', productSlug: 'xa-phong', affiliateCode: 'AFF1' });
    expect(r.url).toBe('https://zalo.me/s/2070857098114207963/product/xa-phong?ref=AFF1');
  });

  it('bỏ dấu / cuối của baseUrl, không ra // kép', () => {
    expect(buildAffiliateShareUrl({ baseUrl: 'https://tubutree.com///', productSlug: 'a', affiliateCode: 'X' }).url).toBe('https://tubutree.com/san-pham/a?ref=X');
  });

  it('slug có ký tự lạ được mã hoá, không phá link', () => {
    expect(buildAffiliateShareUrl({ baseUrl: 'https://tubutree.com', productSlug: 'a b/c?d', affiliateCode: 'X' }).url).toBe('https://tubutree.com/san-pham/a%20b%2Fc%3Fd?ref=X');
  });

  it('có slug mà không có tên: lời giới thiệu chung, vẫn kèm link sản phẩm', () => {
    const r = buildAffiliateShareUrl({ baseUrl: 'https://tubutree.com', productSlug: 'xa-phong', affiliateCode: 'X' });
    expect(r.text).toBe('Sống xanh cùng Tubu Tree: https://tubutree.com/san-pham/xa-phong?ref=X');
  });

  it('mã sai khuôn bị bỏ, không đưa chuỗi lạ vào URL', () => {
    expect(buildAffiliateShareUrl({ baseUrl: 'https://tubutree.com', affiliateCode: 'a&b=1#x' }).url).toBe('https://tubutree.com/');
    expect(buildAffiliateShareUrl({ baseUrl: 'https://tubutree.com', productSlug: 'a', affiliateCode: '' }).url).toBe('https://tubutree.com/san-pham/a');
  });

  it('lời giới thiệu không có dấu chấm than, kể cả khi tên sản phẩm có', () => {
    const r = buildAffiliateShareUrl({ baseUrl: 'https://tubutree.com', productSlug: 'a', productName: 'Giảm sốc!!', affiliateCode: 'X' });
    expect(r.text).not.toContain('!');
  });
});

describe('estimateCommission', () => {
  it('làm tròn xuống như máy chủ (Math.floor)', () => {
    expect(estimateCommission(199000, 8)).toBe(15920);
    expect(estimateCommission(99999, 7)).toBe(6999);
  });

  it('giá hoặc mức không hợp lệ thì 0', () => {
    expect(estimateCommission(0, 8)).toBe(0);
    expect(estimateCommission(100000, 0)).toBe(0);
    expect(estimateCommission(Number.NaN, 8)).toBe(0);
    expect(estimateCommission(-5, 8)).toBe(0);
  });
});

const src = (over: Partial<FeaturedSource> & { id: string }): FeaturedSource => ({
  name: `SP ${over.id}`,
  slug: `sp-${over.id}`,
  thumbnail: null,
  basePrice: 100000,
  salePrice: null,
  maxAffiliateRate: 10,
  ...over,
});

describe('featuredAffiliateProducts', () => {
  const opts = { baseUrl: 'https://tubutree.com', affiliateCode: 'LINH123' };

  it('xếp theo hoa hồng mỗi đơn giảm dần, rồi theo mức %', () => {
    const out = featuredAffiliateProducts(
      [src({ id: 'a', basePrice: 100000, maxAffiliateRate: 10 }), src({ id: 'b', basePrice: 400000, maxAffiliateRate: 5 }), src({ id: 'c', basePrice: 200000, maxAffiliateRate: 10 })],
      opts,
    );
    expect(out.map((p) => p.id)).toEqual(['c', 'b', 'a']);
    expect(out.map((p) => p.commission)).toEqual([20000, 20000, 10000]);
  });

  it('hoa hồng bằng nhau thì mức % cao hơn đứng trước', () => {
    const out = featuredAffiliateProducts([src({ id: 'a', basePrice: 200000, maxAffiliateRate: 5 }), src({ id: 'b', basePrice: 100000, maxAffiliateRate: 10 })], opts);
    expect(out.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('tính theo giá đang bán (giảm giá thấp hơn giá gốc thì lấy giá giảm)', () => {
    const [p] = featuredAffiliateProducts([src({ id: 'a', basePrice: 200000, salePrice: 150000, maxAffiliateRate: 10 })], opts);
    expect(p!.price).toBe(150000);
    expect(p!.commission).toBe(15000);
  });

  it('bỏ sản phẩm không có hoa hồng hoặc không có giá', () => {
    const out = featuredAffiliateProducts([src({ id: 'a', maxAffiliateRate: 0 }), src({ id: 'b', basePrice: 0 }), src({ id: 'c' })], opts);
    expect(out.map((p) => p.id)).toEqual(['c']);
  });

  it('giữ tối đa 5 sản phẩm theo mặc định, đổi được bằng limit', () => {
    const many = Array.from({ length: 9 }, (_, i) => src({ id: String(i), basePrice: 100000 + i * 1000 }));
    expect(featuredAffiliateProducts(many, opts)).toHaveLength(5);
    expect(featuredAffiliateProducts(many, { ...opts, limit: 3 })).toHaveLength(3);
  });

  it('mỗi sản phẩm mang sẵn link giới thiệu có mã CTV', () => {
    const [p] = featuredAffiliateProducts([src({ id: 'a', name: 'Xà phòng', slug: 'xa-phong' })], opts);
    expect(p!.share.url).toBe('https://tubutree.com/san-pham/xa-phong?ref=LINH123');
    expect(p!.share.text).toContain('Xà phòng');
  });

  it('danh sách rỗng hoặc không có sản phẩm hợp lệ thì trả mảng rỗng', () => {
    expect(featuredAffiliateProducts([], opts)).toEqual([]);
    expect(featuredAffiliateProducts([src({ id: 'a', maxAffiliateRate: 0 })], opts)).toEqual([]);
  });

  it('không đổi mảng đầu vào', () => {
    const input = [src({ id: 'a', basePrice: 1 }), src({ id: 'b', basePrice: 900000 })];
    const copy = [...input];
    featuredAffiliateProducts(input, opts);
    expect(input).toEqual(copy);
  });
});
