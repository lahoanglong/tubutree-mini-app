import { describe, expect, it } from 'vitest';
import { siteJsonLd } from './home-seo';
import { OG_IMAGE } from './og';
import { staticPageJsonLd, staticPageMetadata } from './page-seo';
import { SITE_URL } from './site';

const SEO = { path: '/gio-vang', title: 'Giờ vàng', description: 'Giá theo khung giờ.' };

describe('staticPageMetadata', () => {
  it('canonical và og:url cùng là đường dẫn của trang; og:title có hậu tố thương hiệu như <title>', () => {
    const m = staticPageMetadata(SEO);
    expect(m.title).toBe('Giờ vàng');
    expect(m.description).toBe('Giá theo khung giờ.');
    expect(m.alternates?.canonical).toBe('/gio-vang');
    expect(m.openGraph).toMatchObject({ url: '/gio-vang', title: 'Giờ vàng — Tubu Tree', description: 'Giá theo khung giờ.' });
  });

  it('openGraph mang đủ nền chung (siteName, locale, ảnh mặc định có kích thước và alt): Next thay nguyên object của cha', () => {
    const og = staticPageMetadata(SEO).openGraph as Record<string, unknown>;
    expect(og).toMatchObject({ type: 'website', siteName: 'Tubu Tree', locale: 'vi_VN', images: [OG_IMAGE] });
    expect(OG_IMAGE).toMatchObject({ width: 1200, height: 630 });
    expect(OG_IMAGE.alt).not.toBe('');
  });

  it('trang được lập chỉ mục: không khai robots', () => {
    expect(staticPageMetadata(SEO).robots).toBeUndefined();
  });
});

describe('staticPageJsonLd', () => {
  const graph = (data: Record<string, unknown>) => data['@graph'] as Record<string, unknown>[];

  it('một @graph gồm WebPage và BreadcrumbList, URL tuyệt đối từ SITE_URL, nối nhau bằng @id', () => {
    const data = staticPageJsonLd(SEO);
    expect(data['@context']).toBe('https://schema.org');
    const [page, crumbs] = graph(data);
    const url = `${SITE_URL}/gio-vang`;
    expect(page).toEqual({
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: 'Giờ vàng',
      description: 'Giá theo khung giờ.',
      inLanguage: 'vi',
      isPartOf: { '@id': `${SITE_URL}/#website` },
      breadcrumb: { '@id': `${url}#breadcrumb` },
    });
    expect(crumbs).toEqual({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Trang chủ', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: 'Giờ vàng', item: url },
      ],
    });
  });

  it('@id của WebSite khớp với siteJsonLd ở trang chủ để Google nối hai trang vào một thực thể', () => {
    const ids = (siteJsonLd(undefined)['@graph'] as { '@id': string }[]).map((n) => n['@id']);
    expect(ids).toContain((graph(staticPageJsonLd(SEO))[0]!.isPartOf as { '@id': string })['@id']);
  });

  it('chỉ khai chữ đã có trong metadata: không giá, đánh giá, bài đăng, ngày giờ hay Organization lặp lại', () => {
    const text = JSON.stringify(staticPageJsonLd(SEO));
    for (const key of ['offers', 'aggregateRating', 'review', 'datePublished', 'dateModified', 'Organization', 'Product']) {
      expect(text, key).not.toContain(key);
    }
  });

  it('vệt breadcrumb tuỳ chỉnh thay mục cuối mặc định; position đánh số liền từ 1', () => {
    const data = staticPageJsonLd({ ...SEO, trail: [{ name: 'Nhóm', href: '/nhom' }, { name: 'Con' }] });
    const items = graph(data)[1]!.itemListElement as { position: number; name: string; item?: string }[];
    expect(items.map((i) => [i.position, i.name, i.item])).toEqual([
      [1, 'Trang chủ', `${SITE_URL}/`],
      [2, 'Nhóm', `${SITE_URL}/nhom`],
      [3, 'Con', undefined],
    ]);
  });
});
