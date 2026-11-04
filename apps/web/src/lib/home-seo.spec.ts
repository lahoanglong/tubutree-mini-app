import { describe, expect, it } from 'vitest';
import { BROWSE_INDEX_MAX_PAGE, toE164, browseBreadcrumb, browseCanonicalPath, browseMetadata, browseNoindex, HOME_DESCRIPTION, HOME_TITLE, siteJsonLd } from './home-seo';

// R2-BUYERWEB-9: /san-pham?page=N và ?brand= dùng chung một tiêu đề, không có canonical. Danh mục chuyển từ "/" sang
// /san-pham (00-ma-tran dòng 2) nên canonical, tiêu đề và noindex theo trang mới.

describe('browseCanonicalPath', () => {
  it('trang 1 không bộ lọc → "/san-pham"; có nhãn/trang thì ghi đủ, không neo', () => {
    expect(browseCanonicalPath({})).toBe('/san-pham');
    expect(browseCanonicalPath({ page: 1 })).toBe('/san-pham');
    expect(browseCanonicalPath({ brand: 'A&B' })).toBe('/san-pham?brand=A%26B');
    expect(browseCanonicalPath({ page: 3 })).toBe('/san-pham?page=3');
    expect(browseCanonicalPath({ category: { id: 'c1', name: 'Da' } })).toBe('/san-pham?category=c1');
    expect(browseCanonicalPath({ brand: 'Hector', page: 2 })).toBe('/san-pham?brand=Hector&page=2');
  });
});

describe('browseNoindex', () => {
  it('danh mục đứng một mình được lập chỉ mục; kèm bất kỳ tham số nào khác (nhãn, trang, lọc, tìm) hoặc rỗng thì noindex', () => {
    expect(browseNoindex(new URLSearchParams('category=c1'))).toBe(false);
    expect(browseNoindex(new URLSearchParams('category=c1&utm_source=zalo'))).toBe(false);
    for (const qs of ['category=', 'category=c1&brand=Tubu', 'category=c1&page=2', 'category=c1&sort=newest', 'category=c1&q=gội', 'category=c1&inStock=1']) {
      expect(browseNoindex(new URLSearchParams(qs)), qs).toBe(true);
    }
  });

  it('từ khoá, phân khúc và mọi bộ lọc/sắp xếp khác đều noindex; chỉ nhãn và số trang thì không', () => {
    expect(browseNoindex(new URLSearchParams(''))).toBe(false);
    expect(browseNoindex(new URLSearchParams('brand=Tubu&page=2'))).toBe(false);
    expect(browseNoindex(new URLSearchParams('utm_source=zalo'))).toBe(false);
    for (const qs of ['q=gội', 'segment=eco', 'minPrice=1000', 'maxPrice=9', 'inStock=1', 'rating=4', 'sort=newest', 'all=1']) {
      expect(browseNoindex(new URLSearchParams(qs))).toBe(true);
    }
  });

  it('từ khoá chỉ có khoảng trắng không tính là tìm kiếm', () => {
    expect(browseNoindex(new URLSearchParams('q=%20%20'))).toBe(false);
  });
});

describe('browseMetadata', () => {
  it('trang sâu hơn BROWSE_INDEX_MAX_PAGE noindex kể cả trang nhãn (máy chủ không dựng sẵn danh sách ở đó)', () => {
    expect(browseMetadata({ brand: 'Tubu', page: BROWSE_INDEX_MAX_PAGE }, true).robots).toBeUndefined();
    expect(browseMetadata({ brand: 'Tubu', page: BROWSE_INDEX_MAX_PAGE + 1 }, true).robots).toEqual({ index: false, follow: true });
  });

  it('trang gốc: tiêu đề riêng của trang danh mục, canonical về "/san-pham"', () => {
    const m = browseMetadata({ page: 1 }, true);
    expect(m.title).toBe('Tất cả sản phẩm');
    expect((m.description ?? '').length).toBeGreaterThan(50);
    expect(m.alternates).toEqual({ canonical: '/san-pham' });
    expect(m.robots).toBeUndefined();
  });

  it('danh sách gốc không lọc từ trang 2: noindex, follow, không canonical (nhất quán với ?all=1); vẫn có tiêu đề + mô tả', () => {
    const m = browseMetadata({ page: 2 }, true);
    expect(m.title).toBe('Sản phẩm sống xanh — Trang 2');
    expect(m.description).toContain('Trang 2');
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.alternates).toBeUndefined();
  });

  it('danh mục có thật: tiêu đề là tên danh mục, mô tả ≤ 160, canonical /san-pham?category=<id>, cho lập chỉ mục', () => {
    const m = browseMetadata({ category: { id: 'c1', name: 'Chăm sóc da' } }, true);
    expect(m.title).toBe('Chăm sóc da');
    expect(m.description).toContain('Chăm sóc da');
    expect((m.description as string).length).toBeLessThanOrEqual(160);
    expect(m.alternates).toEqual({ canonical: '/san-pham?category=c1' });
    expect(m.robots).toBeUndefined();
  });

  it('mọi biến thể đều có mô tả, kể cả nhãn lạ', () => {
    for (const f of [{}, { page: 3 }, { brand: 'Hector' }, { brand: 'x', page: 2 }, { category: { id: 'a', name: 'B' } }]) {
      expect(browseMetadata(f, true).description, JSON.stringify(f)).toBeTruthy();
    }
    expect(browseMetadata({ brand: 'khong-co' }, false).description).toBeTruthy();
  });

  it('lọc theo nhãn: tiêu đề nêu tên nhãn; nhãn + trang 2 thì thêm số trang', () => {
    const p1 = browseMetadata({ brand: 'Hector', page: 1 }, true);
    expect(p1.title).toBe('Sản phẩm Hector');
    expect(p1.alternates).toEqual({ canonical: '/san-pham?brand=Hector' });
    const p2 = browseMetadata({ brand: 'Hector', page: 2 }, true);
    expect(p2.title).toBe('Sản phẩm Hector — Trang 2');
    expect(p2.alternates).toEqual({ canonical: '/san-pham?brand=Hector&page=2' });
    expect(browseMetadata({ brand: 'Hector' }, true).description).toContain('Hector');
  });

  it('nhãn không có trong danh mục (URL tự bịa) → không cho lập chỉ mục', () => {
    expect(browseMetadata({ brand: 'khong-co' }, false).robots).toEqual({ index: false, follow: true });
  });

  it('tên nhãn quá dài bị cắt để tiêu đề không phình', () => {
    expect((browseMetadata({ brand: 'x'.repeat(300) }, true).title as string).length).toBeLessThan(120);
  });
});

describe('browseBreadcrumb', () => {
  it('nhãn: Trang chủ › Danh mục › nhãn; danh mục: cả đường từ gốc, URL theo id', () => {
    expect(browseBreadcrumb({ home: 'Trang chủ', browse: 'Danh mục', brand: 'Hector' })).toEqual([
      { name: 'Trang chủ', href: '/' },
      { name: 'Danh mục', href: '/san-pham' },
      { name: 'Hector', href: '/san-pham?brand=Hector' },
    ]);
    const c = browseBreadcrumb({ home: 'Trang chủ', browse: 'Danh mục', category: [{ id: 'a', name: 'Da' }, { id: 'b', name: 'Mặt' }] });
    expect(c.map((x) => x.href)).toEqual(['/', '/san-pham', '/san-pham?category=a', '/san-pham?category=b']);
  });
});

describe('trang chủ', () => {
  it('tiêu đề ≤ 60 ký tự có từ khoá h1 + thương hiệu; mô tả 140–160', () => {
    expect(HOME_TITLE.length).toBeLessThanOrEqual(60);
    expect(HOME_TITLE).toContain('Mỹ Phẩm & Tiêu Dùng Sinh Học Thuần Khiết');
    expect(HOME_TITLE).toContain('Tubu Tree');
    expect(HOME_DESCRIPTION.length).toBeGreaterThanOrEqual(140);
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });
});

describe('toE164', () => {
  it('đúng một số VN: bỏ khoảng trắng, chấm, gạch rồi đổi sang +84; +84 và tổng đài 1800/1900 giữ nguyên', () => {
    expect(toE164('0984 606 774')).toBe('+84984606774');
    expect(toE164('0984-606-774')).toBe('+84984606774');
    expect(toE164('+84 984 606 774')).toBe('+84984606774');
    expect(toE164('028 3822 1234')).toBe('+842838221234');
    expect(toE164('1900 6868')).toBe('19006868');
    expect(toE164('1800-1234')).toBe('18001234');
  });

  it('chữ tự do nhiều số hoặc không đúng dạng thì bỏ (không ghép số)', () => {
    expect(toE164('0984 606 774 - 0912 345 678')).toBeUndefined();
    expect(toE164('Gọi 0984606774')).toBeUndefined();
    expect(toE164('098460677')).toBeUndefined();
    expect(toE164('')).toBeUndefined();
  });
});

describe('siteJsonLd', () => {
  const graph = (ld: Record<string, unknown>) => ld['@graph'] as Record<string, unknown>[];
  it('Organization + WebSite trong một @graph; SearchAction trỏ /san-pham?q=', () => {
    const [org, site] = graph(siteJsonLd({ hotline: '0984 606 774', email: 'a@b.vn' }));
    expect(org).toMatchObject({ '@type': 'Organization', name: 'Tubu Tree', url: 'https://app.tubutree.com', logo: 'https://app.tubutree.com/icon.png' });
    expect(site).toMatchObject({ '@type': 'WebSite', url: 'https://app.tubutree.com' });
    expect((site!.potentialAction as { target: string }).target).toBe('https://app.tubutree.com/san-pham?q={search_term_string}');
  });

  it('contactPoint đổi hotline sang +84; sameAs chỉ gồm link cộng đồng đã có', () => {
    const [org] = graph(siteJsonLd({ hotline: '0984 606 774', email: 'a@b.vn', community: { facebookUrl: 'https://fb.com/x', zaloGroupUrl: 'https://zalo.me/g/y' } }));
    expect(org!.contactPoint).toEqual([expect.objectContaining({ telephone: '+84984606774', email: 'a@b.vn', contactType: 'customer service' })]);
    expect(org!.sameAs).toEqual(['https://fb.com/x', 'https://zalo.me/g/y']);
  });

  it('hotline là chữ tự do nhiều số: bỏ telephone, vẫn giữ email', () => {
    const [org] = graph(siteJsonLd({ hotline: '0984 606 774 - 0912 345 678', email: 'a@b.vn' }));
    expect(org!.contactPoint).toEqual([expect.objectContaining({ email: 'a@b.vn' })]);
    expect(JSON.stringify(org)).not.toContain('telephone');
  });

  it('thiếu dữ liệu thì bỏ trường, không bịa', () => {
    const [org] = graph(siteJsonLd(undefined));
    expect(org).not.toHaveProperty('sameAs');
    expect(org).not.toHaveProperty('contactPoint');
  });
});
