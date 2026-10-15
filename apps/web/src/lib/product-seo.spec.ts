import { describe, expect, it } from 'vitest';
import type { ProductDetail } from './api';
import { galleryImages, jsonLdScript, plainText, productJsonLd } from './product-seo';

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
