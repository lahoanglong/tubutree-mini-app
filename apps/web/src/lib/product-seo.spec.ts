import { describe, expect, it } from 'vitest';
import type { ProductDetail } from './api';
import { brandMetaDescription, breadcrumbJsonLd, galleryImages, jsonLdScript, plainText, productAvailability, productJsonLd, productMetaDescription, productTitle, trimAtWord } from './product-seo';

const BASE: ProductDetail = {
  id: 'p1', slug: 'dau-goi', brand: 'Xanh Việt', name: 'Dầu gội bồ kết', shortDesc: 'Sạch dịu nhẹ', description: 'Mô tả dài.',
  images: [], thumbnail: null, basePrice: 200000, salePrice: 150000, certifications: [],
  variations: [{ id: 'v1', sku: 'DG-250', name: '250ml', retailPrice: 200000, salePrice: 150000, stock: 5 }],
};

describe('galleryImages — ảnh sản phẩm cho thư viện ảnh và og:image (BUYERWEB-17)', () => {
  it('thumbnail đứng đầu, theo sau là images, bỏ trùng', () => {
    expect(
      galleryImages({ thumbnail: 'https://cdn/a.jpg', images: ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg'] }),
    ).toEqual(['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg']);
  });

  it('không có thumbnail thì ảnh đầu của images làm ảnh chính', () => {
    expect(galleryImages({ thumbnail: null, images: ['https://cdn/b.jpg'] })).toEqual(['https://cdn/b.jpg']);
  });

  it('bỏ giá trị rỗng/không phải http(s) (javascript:, data:), không có ảnh nào thì mảng rỗng', () => {
    expect(galleryImages({ thumbnail: '', images: ['', 'javascript:alert(1)', 'data:image/png;base64,AA', '  https://cdn/x.jpg  '] })).toEqual([
      'https://cdn/x.jpg',
    ]);
    expect(galleryImages({ thumbnail: null, images: [] })).toEqual([]);
  });

  it('API cũ không trả images: vẫn chạy với thumbnail', () => {
    expect(galleryImages({ thumbnail: 'https://cdn/a.jpg' } as Pick<ProductDetail, 'thumbnail' | 'images'>)).toEqual(['https://cdn/a.jpg']);
  });

  it('chặn ở 12 ảnh', () => {
    const images = Array.from({ length: 30 }, (_, i) => `https://cdn/${i}.jpg`);
    expect(galleryImages({ thumbnail: null, images })).toHaveLength(12);
  });
});

describe('plainText — mô tả sản phẩm đã làm sạch HTML (BUYERWEB-17)', () => {
  it('văn bản thường giữ nguyên, xuống dòng giữ nguyên', () => {
    expect(plainText('Dòng 1\nDòng 2')).toBe('Dòng 1\nDòng 2');
  });

  it('thẻ khối thành xuống dòng, <li> thành gạch đầu dòng, thẻ khác bị bỏ', () => {
    expect(plainText('<p>Thành phần</p><ul><li>Bồ kết</li><li>Gừng</li></ul><b>Dùng:</b> gội<br/>mỗi ngày')).toBe(
      'Thành phần\n• Bồ kết\n• Gừng\nDùng: gội\nmỗi ngày',
    );
  });

  it('script/style bị bỏ cả nội dung, không còn thẻ nào sống sót', () => {
    const out = plainText('a<script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)>b');
    expect(out).toBe('ab');
  });

  it('giải mã thực thể thường gặp, không giải mã hai lần', () => {
    expect(plainText('Tinh dầu &amp; gừng&nbsp;&quot;sạch&quot; &#39;xanh&#39; &lt;b&gt; &amp;lt;')).toBe('Tinh dầu & gừng "sạch" \'xanh\' <b> &lt;');
  });

  it('gộp dòng trống thừa, cắt khoảng trắng đầu/cuối; rỗng/null thì chuỗi rỗng', () => {
    expect(plainText('\n\n a \n\n\n\n b \n')).toBe('a\n\nb');
    expect(plainText('')).toBe('');
    expect(plainText(null)).toBe('');
  });
});

describe('productJsonLd — dữ liệu có cấu trúc cho Google (BUYERWEB-16)', () => {
  const URL = 'https://app.tubutree.com/san-pham/dau-goi';

  it('một phân loại: Offer với giá khuyến mãi, VND, còn hàng', () => {
    const ld = productJsonLd({ ...BASE, thumbnail: 'https://cdn/a.jpg', images: ['https://cdn/b.jpg'] }, URL);
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Dầu gội bồ kết',
      sku: 'DG-250',
      url: URL,
      image: ['https://cdn/a.jpg', 'https://cdn/b.jpg'],
      brand: { '@type': 'Brand', name: 'Xanh Việt' },
      description: 'Sạch dịu nhẹ',
      offers: { '@type': 'Offer', url: URL, priceCurrency: 'VND', price: 150000, availability: 'https://schema.org/InStock' },
    });
  });

  it('nhiều phân loại: AggregateOffer với giá thấp nhất–cao nhất và số phân loại', () => {
    const ld = productJsonLd(
      {
        ...BASE,
        variations: [
          { id: 'v1', sku: 'a', name: '250ml', retailPrice: 200000, salePrice: 150000, stock: 0 },
          { id: 'v2', sku: 'b', name: '500ml', retailPrice: 300000, salePrice: null, stock: 4 },
        ],
      },
      URL,
    );
    expect(ld.offers).toEqual({
      '@type': 'AggregateOffer', priceCurrency: 'VND', lowPrice: 150000, highPrice: 300000, offerCount: 2, availability: 'https://schema.org/InStock',
    });
  });

  it('mọi phân loại hết hàng (hoặc không có phân loại) → OutOfStock', () => {
    const out = productJsonLd({ ...BASE, variations: [{ ...BASE.variations[0]!, stock: 0 }] }, URL);
    expect((out.offers as { availability: string }).availability).toBe('https://schema.org/OutOfStock');
    const none = productJsonLd({ ...BASE, variations: [] }, URL);
    expect((none.offers as { availability: string; price: number }).availability).toBe('https://schema.org/OutOfStock');
    expect((none.offers as { price: number }).price).toBe(150000);
  });

  it('chỉ có aggregateRating khi đã có đánh giá thật; không bịa ảnh khi không có ảnh', () => {
    expect(productJsonLd(BASE, URL)).not.toHaveProperty('aggregateRating');
    expect(productJsonLd(BASE, URL)).not.toHaveProperty('image');
    expect(productJsonLd({ ...BASE, ratingAvg: 4.6, reviewCount: 12 }, URL).aggregateRating).toEqual({
      '@type': 'AggregateRating', ratingValue: 4.6, reviewCount: 12,
    });
    expect(productJsonLd({ ...BASE, ratingAvg: 0, reviewCount: 0 }, URL)).not.toHaveProperty('aggregateRating');
  });

  it('mô tả lấy từ bản đã làm sạch, rút gọn 500 ký tự', () => {
    const ld = productJsonLd({ ...BASE, shortDesc: null, description: `<p>${'a'.repeat(900)}</p>` }, URL);
    expect((ld.description as string).length).toBe(500);
  });
});

describe('jsonLdScript — nhúng an toàn vào <script>', () => {
  it('thoát "<" để tên sản phẩm không đóng được thẻ script', () => {
    const out = jsonLdScript({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script>');
  });
});

describe('productAvailability — gian hàng chưa nhận đơn (S6)', () => {
  const unavailable = (reason?: 'STORE_PAUSED' | 'STORE_CLOSED') => ({ ...BASE, fulfiller: { kind: 'UNAVAILABLE' as const, name: 'Shop', shippingFee: null, freeShipFrom: null, ...(reason ? { reason } : {}) } });
  it('STORE_PAUSED → OutOfStock dù còn tồn; lý do khác hoặc thiếu lý do → Discontinued', () => {
    expect(productAvailability(unavailable('STORE_PAUSED'))).toBe('https://schema.org/OutOfStock');
    expect(productAvailability(unavailable('STORE_CLOSED'))).toBe('https://schema.org/Discontinued');
    expect(productAvailability(unavailable())).toBe('https://schema.org/Discontinued');
  });
  it('còn lại theo tồn kho, cả khi fulfiller là TUBU/MERCHANT', () => {
    expect(productAvailability(BASE)).toBe('https://schema.org/InStock');
    expect(productAvailability({ ...BASE, fulfiller: { kind: 'MERCHANT', name: 'S', shippingFee: null, freeShipFrom: null } })).toBe('https://schema.org/InStock');
    expect(productAvailability({ ...BASE, variations: [{ ...BASE.variations[0]!, stock: 0 }] })).toBe('https://schema.org/OutOfStock');
  });
  it('productJsonLd dùng cùng quy tắc (Offer và AggregateOffer)', () => {
    const p = { ...unavailable('STORE_CLOSED') };
    expect((productJsonLd(p, 'u').offers as { availability: string }).availability).toBe('https://schema.org/Discontinued');
    const two = { ...p, variations: [BASE.variations[0]!, { ...BASE.variations[0]!, id: 'v2' }] };
    expect((productJsonLd(two, 'u').offers as { availability: string }).availability).toBe('https://schema.org/Discontinued');
  });
});

describe('trimAtWord — mô tả meta ≤ 160, cắt ở ranh giới từ', () => {
  it('ngắn thì giữ nguyên (gộp khoảng trắng/xuống dòng)', () => {
    expect(trimAtWord('một\n  hai')).toBe('một hai');
  });
  it('dài thì cắt ở từ, thêm …, không vượt max và không bỏ lửng giữa từ', () => {
    const text = Array.from({ length: 60 }, (_, i) => `từ${i}`).join(' ');
    const out = trimAtWord(text, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('…')).toBe(true);
    expect(text.startsWith(out.slice(0, -1))).toBe(true);
    expect(text[out.length - 1]).toBe(' ');
  });
  it('từ đơn quá dài vẫn bị cắt cứng ở max', () => {
    expect(trimAtWord('x'.repeat(300)).length).toBeLessThanOrEqual(160);
  });
});

describe('productTitle / productMetaDescription (S9, S16)', () => {
  it('nhãn Tubu Tree không bị lặp trong tiêu đề; nhãn khác thì "Tên — Nhãn"', () => {
    expect(productTitle({ name: 'Xịt tràm 150ml', brand: 'Tubu Tree' })).toBe('Xịt tràm 150ml');
    expect(productTitle({ name: 'Xịt tràm 150ml', brand: ' tubu tree ' })).toBe('Xịt tràm 150ml');
    expect(productTitle({ name: 'Dầu gội', brand: 'Xanh Việt' })).toBe('Dầu gội — Xanh Việt');
  });
  it('mô tả: ngắn → đầy đủ khi ngắn rỗng ("" không lọt qua ??) → dựng từ tên + nhãn', () => {
    expect(productMetaDescription({ ...BASE, shortDesc: '', description: '<p>Mô tả   dài.</p>' })).toBe('Mô tả dài.');
    expect(productMetaDescription({ ...BASE, shortDesc: null, description: '' })).toBe('Dầu gội bồ kết — Xanh Việt, bán tại Tubu Tree.');
    expect(productMetaDescription({ ...BASE, brand: 'Tubu Tree', shortDesc: ' ', description: null as unknown as string })).toBe('Dầu gội bồ kết — sản phẩm thiên nhiên tại Tubu Tree.');
  });
  it('mô tả dài bị cắt ≤ 160 ở ranh giới từ', () => {
    const long = Array.from({ length: 80 }, (_, i) => `từ${i}`).join(' ');
    const out = productMetaDescription({ ...BASE, shortDesc: long });
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('W160 — metaTitle/metaDesc đã duyệt trong DB được ưu tiên', () => {
  it('productTitle dùng đúng metaTitle đã duyệt; layout tự thêm " — Tubu Tree" nên hậu tố thương hiệu Tubu Tree của chính nó bị gỡ để khỏi lặp', () => {
    expect(productTitle({ name: 'Dầu gội', brand: 'Xanh Việt', metaTitle: 'Dầu gội bồ kết | Xanh Việt' })).toBe('Dầu gội bồ kết | Xanh Việt');
    expect(productTitle({ name: 'Dầu gội', brand: 'Tubu Tree', metaTitle: 'Dầu gội bồ kết | Tubu Tree' })).toBe('Dầu gội bồ kết');
    expect(productTitle({ name: 'Dầu gội', brand: 'Tubu Tree', metaTitle: 'Dầu gội bồ kết — Tubu Tree' })).toBe('Dầu gội bồ kết');
    expect(productTitle({ name: 'Dầu gội', brand: 'Tubu Tree', metaTitle: 'Dầu gội bồ kết | TUBU TREE' })).toBe('Dầu gội bồ kết');
  });

  it('metaTitle trống, chỉ khoảng trắng hay null: rơi về cách dựng từ tên + nhãn như cũ', () => {
    for (const metaTitle of [null, undefined, '', '   ']) {
      expect(productTitle({ name: 'Dầu gội', brand: 'Xanh Việt', metaTitle })).toBe('Dầu gội — Xanh Việt');
    }
  });

  it('metaTitle vượt trần 65 ký tự bị cắt an toàn ở ranh giới từ, không vượt trần', () => {
    const long = Array.from({ length: 30 }, (_, i) => `từ${i}`).join(' ');
    const out = productTitle({ name: 'Dầu gội', brand: 'Xanh Việt', metaTitle: long });
    expect(out.length).toBeLessThanOrEqual(65);
    expect(out.endsWith('…')).toBe(true);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
  });

  it('metaTitle đủ ngắn: giữ nguyên, chỉ cắt khoảng trắng hai đầu', () => {
    expect(productTitle({ name: 'x', brand: 'Xanh Việt', metaTitle: '  Dầu gội bồ kết | Xanh Việt  ' })).toBe('Dầu gội bồ kết | Xanh Việt');
  });

  it('productMetaDescription dùng metaDesc đã duyệt trước mô tả ngắn/đầy đủ; trống thì như cũ', () => {
    expect(productMetaDescription({ ...BASE, metaDesc: 'Mô tả đã duyệt.' })).toBe('Mô tả đã duyệt.');
    for (const metaDesc of [null, undefined, '', '  ']) {
      expect(productMetaDescription({ ...BASE, metaDesc })).toBe('Sạch dịu nhẹ');
    }
  });

  it('metaDesc vượt trần 155 ký tự bị cắt an toàn ở ranh giới từ', () => {
    const long = Array.from({ length: 80 }, (_, i) => `từ${i}`).join(' ');
    const out = productMetaDescription({ ...BASE, metaDesc: long });
    expect(out.length).toBeLessThanOrEqual(155);
    expect(out.endsWith('…')).toBe(true);
  });

  it('productJsonLd: shortDesc rỗng ("" không lọt qua ??) thì mô tả lấy từ description, rồi metaDesc, rồi dựng từ tên + nhãn; không bao giờ rỗng', () => {
    const URL = 'https://app.tubutree.com/san-pham/dau-goi';
    expect(productJsonLd({ ...BASE, shortDesc: '', description: '<p>Mô tả dài.</p>' }, URL).description).toBe('Mô tả dài.');
    expect(productJsonLd({ ...BASE, shortDesc: ' ', description: '', metaDesc: 'Mô tả đã duyệt.' } as ProductDetail, URL).description).toBe('Mô tả đã duyệt.');
    expect(productJsonLd({ ...BASE, shortDesc: null, description: '' }, URL).description).toBe('Dầu gội bồ kết — Xanh Việt, bán tại Tubu Tree.');
  });

  it('productJsonLd: nhãn trống thì brand là "Tubu Tree" (JSON-LD không có name rỗng); có sku và offers khi một phân loại', () => {
    const URL = 'https://app.tubutree.com/san-pham/dau-goi';
    const ld = productJsonLd({ ...BASE, brand: '  ' }, URL);
    expect(ld.brand).toEqual({ '@type': 'Brand', name: 'Tubu Tree' });
    expect(ld.sku).toBe('DG-250');
    expect(ld.offers).toMatchObject({ '@type': 'Offer', priceCurrency: 'VND' });
  });
});

describe('brandMetaDescription (S2)', () => {
  it('khẩu hiệu → câu giới thiệu → dựng từ tên (+ xuất xứ)', () => {
    expect(brandMetaDescription({ name: 'Hector', tagline: 'Sống xanh', story: 'dài' })).toBe('Sống xanh');
    expect(brandMetaDescription({ name: 'Hector', tagline: '', story: '<p>Câu chuyện nhãn.</p>' })).toBe('Hector trên Tubu Tree: Câu chuyện nhãn.');
    expect(brandMetaDescription({ name: 'Hector', tagline: null, story: null, origin: 'Đà Lạt' })).toBe('Hector đến từ Đà Lạt — thương hiệu sống xanh trên Tubu Tree.');
    expect(brandMetaDescription({ name: 'Hector' })).toBe('Hector — thương hiệu sống xanh trên Tubu Tree.');
    expect(brandMetaDescription({ name: 'H', story: 'x '.repeat(300) }).length).toBeLessThanOrEqual(160);
  });
});

describe('breadcrumbJsonLd (S5)', () => {
  it('URL tuyệt đối, position từ 1; mục không có href thì không có item', () => {
    const ld = breadcrumbJsonLd([{ name: 'Trang chủ', href: '/' }, { name: 'Nhãn', href: '/san-pham?brand=A%20B' }, { name: 'SP' }]);
    expect(ld).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Trang chủ', item: 'https://app.tubutree.com/' },
        { '@type': 'ListItem', position: 2, name: 'Nhãn', item: 'https://app.tubutree.com/san-pham?brand=A%20B' },
        { '@type': 'ListItem', position: 3, name: 'SP' },
      ],
    });
  });
});
