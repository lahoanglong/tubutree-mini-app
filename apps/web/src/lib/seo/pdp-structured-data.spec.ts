import { describe, expect, it } from 'vitest';
import type { ProductDetail } from '../api';
import type { FlashItem } from '../flash-price';
import { jsonLdScript } from '../product-seo';
import { pdpCategoryCrumbs, pdpCrumbs, pdpJsonLd, vnDateOf } from './pdp-structured-data';

const URL = 'https://app.tubutree.com/san-pham/dau-goi';
const NOW = Date.parse('2026-11-21T05:00:00Z');

const BASE: ProductDetail = {
  id: 'p1', slug: 'dau-goi', brand: 'Xanh Việt', name: 'Dầu gội bồ kết', shortDesc: 'Sạch dịu nhẹ', description: 'Mô tả dài.',
  images: [], thumbnail: null, basePrice: 200000, salePrice: 150000, certifications: [],
  variations: [{ id: 'v1', sku: 'DG-250', name: '250ml', retailPrice: 200000, salePrice: 150000, stock: 5 }],
};
const TWO: ProductDetail = {
  ...BASE,
  variations: [
    { id: 'v1', sku: 'DG-250', name: '250ml', retailPrice: 200000, salePrice: 150000, stock: 0 },
    { id: 'v2', sku: ' DG-500 ', name: '500ml', retailPrice: 300000, salePrice: null, stock: 4 },
  ],
};
const flashItem = (variationId: string, flashPrice: number, endAt = '2026-11-21T14:30:00Z'): FlashItem => ({
  itemId: `f-${variationId}`, variationId, productSlug: 'dau-goi', flashPrice, retailPrice: 200000, soldCount: 1, quota: 10, endAt,
});

const blocks = (p: ProductDetail, flash: FlashItem[] = [], policy?: Parameters<typeof pdpJsonLd>[0]['policy']) => pdpJsonLd({ product: p, url: URL, policy, flash, now: NOW });
const byType = (list: Record<string, unknown>[], type: string) => list.find((b) => b['@type'] === type) as Record<string, any> | undefined;

describe('pdpJsonLd — Product', () => {
  it('Product + BreadcrumbList, @id ổn định, giá VND, sku, tình trạng theo tồn kho', () => {
    const list = blocks(BASE);
    expect(list.map((b) => b['@type'])).toEqual(['Product', 'BreadcrumbList']);
    const product = byType(list, 'Product')!;
    expect(product['@id']).toBe(`${URL}#product`);
    expect(product.sku).toBe('DG-250');
    expect(product.brand).toEqual({ '@type': 'Brand', name: 'Xanh Việt' });
    expect(product.offers).toMatchObject({
      '@type': 'Offer', url: URL, priceCurrency: 'VND', price: 150000, availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition',
    });
    // Không có giá có hạn thật thì không bịa ngày hết hạn.
    expect(product.offers).not.toHaveProperty('priceValidUntil');
  });

  it('Giờ vàng đang chạy và rẻ hơn: giá trong JSON-LD là giá khách thấy, priceValidUntil là ngày kết thúc theo giờ Việt Nam', () => {
    const product = byType(blocks(BASE, [flashItem('v1', 99000, '2026-11-21T18:30:00Z')]), 'Product')!;
    expect(product.offers.price).toBe(99000);
    // 18:30 UTC = 01:30 ngày 22/11 giờ Việt Nam.
    expect(product.offers.priceValidUntil).toBe('2026-11-22');
  });

  it('Giờ vàng đã hết giờ hoặc không rẻ hơn giá đang bán: giá thường, không priceValidUntil', () => {
    for (const flash of [[flashItem('v1', 99000, '2026-11-21T04:59:59Z')], [flashItem('v1', 160000)], [flashItem('v-khac', 50000)]]) {
      const product = byType(blocks(BASE, flash), 'Product')!;
      expect(product.offers.price, JSON.stringify(flash)).toBe(150000);
      expect(product.offers, JSON.stringify(flash)).not.toHaveProperty('priceValidUntil');
    }
  });

  it('nhiều phân loại: AggregateOffer khoảng giá đã gồm Giờ vàng, mỗi phân loại một Offer có sku, giá và tồn kho riêng', () => {
    const product = byType(blocks(TWO, [flashItem('v2', 250000)]), 'Product')!;
    expect(product).not.toHaveProperty('sku');
    expect(product.offers).toMatchObject({ '@type': 'AggregateOffer', priceCurrency: 'VND', lowPrice: 150000, highPrice: 250000, offerCount: 2, availability: 'https://schema.org/InStock' });
    expect(product.offers.offers).toEqual([
      { '@type': 'Offer', name: '250ml', sku: 'DG-250', priceCurrency: 'VND', price: 150000, availability: 'https://schema.org/OutOfStock', itemCondition: 'https://schema.org/NewCondition' },
      {
        '@type': 'Offer', name: '500ml', sku: 'DG-500', priceCurrency: 'VND', price: 250000, availability: 'https://schema.org/InStock',
        itemCondition: 'https://schema.org/NewCondition', priceValidUntil: '2026-11-21',
      },
    ]);
  });

  it('phân loại không có sku thì Offer của nó không khai sku (không bịa mã)', () => {
    const product = byType(blocks({ ...TWO, variations: TWO.variations.map((v) => ({ ...v, sku: '  ' })) }), 'Product')!;
    for (const o of product.offers.offers) expect(o).not.toHaveProperty('sku');
  });

  it('gian hàng đã ngừng bán: mọi Offer theo tình trạng của sản phẩm (Discontinued), kể cả phân loại còn tồn', () => {
    const closed = { ...TWO, fulfiller: { kind: 'UNAVAILABLE' as const, name: 'Shop', shippingFee: null, freeShipFrom: null, reason: 'STORE_CLOSED' as const } };
    const product = byType(blocks(closed), 'Product')!;
    expect(product.offers.availability).toBe('https://schema.org/Discontinued');
    expect(product.offers.offers.map((o: { availability: string }) => o.availability)).toEqual(['https://schema.org/Discontinued', 'https://schema.org/Discontinued']);
  });

  it('AggregateRating chỉ khi có đánh giá thật (reviewCount > 0); reviewCount 0 thì không khai, dù ratingAvg có số', () => {
    expect(byType(blocks({ ...BASE, ratingAvg: 4.8, reviewCount: 0 }), 'Product')).not.toHaveProperty('aggregateRating');
    expect(byType(blocks({ ...BASE, ratingAvg: undefined, reviewCount: undefined }), 'Product')).not.toHaveProperty('aggregateRating');
    expect(byType(blocks({ ...BASE, ratingAvg: 4.5, reviewCount: 3 }), 'Product')!.aggregateRating).toEqual({
      '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 3, bestRating: 5, worstRating: 1,
    });
  });

  it('ngưỡng miễn phí vận chuyển xét trên giá đã khai: Giờ vàng kéo giá dưới ngưỡng thì phí ship là phí thật, không phải 0 đ', () => {
    const shipping = { shipping: { freeThreshold: 120000, flatFee: 19000 } };
    const flashed = byType(blocks(BASE, [flashItem('v1', 99000)], shipping), 'Product')!;
    expect(flashed.offers.price).toBe(99000);
    expect(flashed.offers.shippingDetails.shippingRate.value).toBe(19000);
    const regular = byType(blocks(BASE, [], shipping), 'Product')!;
    expect(regular.offers.price).toBe(150000);
    expect(regular.offers.shippingDetails.shippingRate.value).toBe(0);
  });

  it('priceValidUntil là ngày cuối còn giá: đợt hết đúng 00:00 giờ Việt Nam thì là ngày hôm trước', () => {
    const atMidnight = byType(blocks(BASE, [flashItem('v1', 99000, '2026-11-21T17:00:00Z')]), 'Product')!;
    expect(atMidnight.offers.priceValidUntil).toBe('2026-11-21');
    const afterMidnight = byType(blocks(BASE, [flashItem('v1', 99000, '2026-11-21T17:00:01Z')]), 'Product')!;
    expect(afterMidnight.offers.priceValidUntil).toBe('2026-11-22');
  });

  it('tên chứa </script> và "<" vẫn an toàn khi nhúng: không đóng được thẻ, đọc lại đúng chữ', () => {
    const evil = { ...BASE, name: 'X</script><script>alert(1)</script>', description: '<h3>Dùng </script> thế nào?</h3><p>a < b</p>' };
    for (const ld of blocks(evil)) {
      const out = jsonLdScript(ld);
      expect(out).not.toMatch(/<\/script/i);
      expect(out).not.toContain('<');
      expect(JSON.parse(out)).toEqual(ld);
    }
  });
});

describe('pdpJsonLd — BreadcrumbList', () => {
  it('Trang chủ › nhãn (canonical của trang nhãn) › sản phẩm, URL tuyệt đối', () => {
    const crumbs = byType(blocks(BASE), 'BreadcrumbList')!;
    expect(crumbs.itemListElement.map((i: { name: string; item: string }) => [i.name, i.item])).toEqual([
      ['Trang chủ', 'https://app.tubutree.com/'],
      ['Xanh Việt', 'https://app.tubutree.com/san-pham?brand=Xanh+Vi%E1%BB%87t'],
      ['Dầu gội bồ kết', 'https://app.tubutree.com/san-pham/dau-goi'],
    ]);
  });

  it('nhãn trống không tạo mục tên rỗng; chính tả cũ của nhãn đổi sang tên và canonical của nhãn hiện hành', () => {
    expect(pdpCrumbs({ ...BASE, brand: '  ' }).map((c) => c.name)).toEqual(['Trang chủ', 'Dầu gội bồ kết']);
    expect(pdpCrumbs({ ...BASE, brand: 'Sokfram' })[1]).toEqual({ name: 'Sokfarm', href: '/san-pham?brand=Sokfarm' });
  });

  it('có vệt danh mục: thêm BreadcrumbList thứ hai Trang chủ › Danh mục › cha › lá › sản phẩm, cùng URL với breadcrumb của trang danh mục', () => {
    const trail = [{ id: 'c-nha', name: 'Nhà cửa' }, { id: 'c gội', name: 'Gội & xả' }];
    const list = pdpJsonLd({ product: BASE, url: URL, now: NOW, categoryTrail: trail });
    expect(list.map((b) => b['@type'])).toEqual(['Product', 'BreadcrumbList', 'BreadcrumbList']);
    expect((list[2] as Record<string, any>).itemListElement.map((i: { position: number; name: string; item: string }) => [i.position, i.name, i.item])).toEqual([
      [1, 'Trang chủ', 'https://app.tubutree.com/'],
      [2, 'Danh mục', 'https://app.tubutree.com/san-pham'],
      [3, 'Nhà cửa', 'https://app.tubutree.com/san-pham?category=c-nha'],
      [4, 'Gội & xả', 'https://app.tubutree.com/san-pham?category=c%20g%E1%BB%99i'],
      [5, 'Dầu gội bồ kết', 'https://app.tubutree.com/san-pham/dau-goi'],
    ]);
  });

  it('không có danh mục (vệt rỗng hoặc không truyền): chỉ một BreadcrumbList theo nhãn', () => {
    expect(pdpCategoryCrumbs(BASE, [])).toEqual([]);
    expect(pdpCategoryCrumbs(BASE, undefined)).toEqual([]);
    expect(pdpJsonLd({ product: BASE, url: URL, now: NOW, categoryTrail: [] }).filter((b) => b['@type'] === 'BreadcrumbList')).toHaveLength(1);
  });
});

describe('pdpJsonLd — FAQPage', () => {
  it('chỉ khai khi mô tả có tiêu đề dạng câu hỏi kèm câu trả lời; câu hỏi và trả lời đúng chữ trên trang', () => {
    const p = { ...BASE, description: '<p>Giới thiệu.</p><h3>Dùng cho da nhạy cảm được không?</h3><p>Được, công thức dịu nhẹ.</p><h3>Thành phần</h3><p>Bồ kết.</p>' };
    const faq = byType(blocks(p), 'FAQPage')!;
    expect(faq.mainEntity).toEqual([{ '@type': 'Question', name: 'Dùng cho da nhạy cảm được không?', acceptedAnswer: { '@type': 'Answer', text: 'Được, công thức dịu nhẹ.' } }]);
  });

  it('mô tả không có câu hỏi: không có FAQPage', () => {
    expect(byType(blocks({ ...BASE, description: '<h3>Hướng dẫn sử dụng</h3><p>Thoa lên tóc ướt.</p>' }), 'FAQPage')).toBeUndefined();
  });

  it('hỏi–đáp của khối "Hỏi nhanh": MỘT FAQPage, câu của mô tả đứng trước, câu trùng (khác hoa thường, khoảng trắng) giữ câu của mô tả', () => {
    const p = { ...BASE, description: '<h3>Dầu gội bồ kết có thành phần gì?</h3><p>Bồ kết, gừng và bưởi.</p>' };
    const list = pdpJsonLd({
      product: p,
      url: URL,
      now: NOW,
      faq: [
        { q: 'dầu gội  bồ kết có thành phần gì?', a: 'Thành phần: Bồ kết.' },
        { q: 'Dùng Dầu gội bồ kết thế nào?', a: 'Thoa lên tóc ướt.\nXả sạch.' },
        { q: 'Câu không có trả lời?', a: '  ' },
      ],
    });
    expect(list.filter((b) => b['@type'] === 'FAQPage')).toHaveLength(1);
    expect(byType(list, 'FAQPage')!.mainEntity).toEqual([
      { '@type': 'Question', name: 'Dầu gội bồ kết có thành phần gì?', acceptedAnswer: { '@type': 'Answer', text: 'Bồ kết, gừng và bưởi.' } },
      { '@type': 'Question', name: 'Dùng Dầu gội bồ kết thế nào?', acceptedAnswer: { '@type': 'Answer', text: 'Thoa lên tóc ướt.\nXả sạch.' } },
    ]);
  });

  it('chỉ có hỏi–đáp của khối "Hỏi nhanh" (mô tả không có câu hỏi): vẫn có FAQPage', () => {
    const faq = byType(pdpJsonLd({ product: BASE, url: URL, now: NOW, faq: [{ q: 'Dầu gội bồ kết có bản Refill không?', a: 'Có: Túi Refill 1L.' }] }), 'FAQPage')!;
    expect(faq.mainEntity).toEqual([{ '@type': 'Question', name: 'Dầu gội bồ kết có bản Refill không?', acceptedAnswer: { '@type': 'Answer', text: 'Có: Túi Refill 1L.' } }]);
  });
});

describe('vnDateOf', () => {
  it('ngày theo giờ Việt Nam (+07, không đổi giờ); mốc hỏng hoặc thiếu thì undefined', () => {
    expect(vnDateOf('2026-11-21T16:59:59Z')).toBe('2026-11-21');
    expect(vnDateOf('2026-11-21T17:00:00Z')).toBe('2026-11-22');
    expect(vnDateOf('không phải ngày')).toBeUndefined();
    expect(vnDateOf(undefined)).toBeUndefined();
  });
});
