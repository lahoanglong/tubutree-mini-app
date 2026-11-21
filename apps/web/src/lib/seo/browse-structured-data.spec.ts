import { describe, expect, it } from 'vitest';
import type { Metadata } from 'next';
import { jsonLdScript } from '../product-seo';
import { browseCollectionJsonLd, withBrowseSocial } from './browse-structured-data';

const META: Metadata = { title: 'Dầu gội', description: 'Dầu gội tại Tubu Tree: sản phẩm thiên nhiên.', alternates: { canonical: '/san-pham?category=c-goi' } };
const CRUMBS = [
  { name: 'Trang chủ', href: '/' },
  { name: 'Danh mục', href: '/san-pham' },
  { name: 'Dầu gội', href: '/san-pham?category=c-goi' },
];
const ITEMS = [
  { slug: 'dau-goi-bo-ket', name: 'Dầu gội bồ kết' },
  { slug: 'dau-xa', name: 'Dầu xả </script>' },
];
const graphOf = (ld: Record<string, unknown> | null) => (ld?.['@graph'] ?? []) as Record<string, any>[];

describe('browseCollectionJsonLd — CollectionPage + ItemList + BreadcrumbList cho trang danh mục', () => {
  it('một @graph: CollectionPage cùng tên, mô tả và canonical với metadata; ItemList là đúng các sản phẩm đang hiện; BreadcrumbList nối bằng @id', () => {
    const ld = browseCollectionJsonLd(META, CRUMBS, ITEMS)!;
    const url = 'https://app.tubutree.com/san-pham?category=c-goi';
    expect(ld['@context']).toBe('https://schema.org');
    const [page, crumbs] = graphOf(ld);
    expect(page).toEqual({
      '@type': 'CollectionPage',
      '@id': `${url}#collection`,
      url,
      name: 'Dầu gội',
      description: 'Dầu gội tại Tubu Tree: sản phẩm thiên nhiên.',
      inLanguage: 'vi',
      isPartOf: { '@id': 'https://app.tubutree.com/#website' },
      breadcrumb: { '@id': `${url}#breadcrumb` },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: 2,
        itemListElement: [
          { '@type': 'ListItem', position: 1, url: 'https://app.tubutree.com/san-pham/dau-goi-bo-ket', name: 'Dầu gội bồ kết' },
          { '@type': 'ListItem', position: 2, url: 'https://app.tubutree.com/san-pham/dau-xa', name: 'Dầu xả </script>' },
        ],
      },
    });
    expect(crumbs).toMatchObject({ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb` });
    expect((crumbs!.itemListElement as { item: string }[]).map((i) => i.item)).toEqual(['https://app.tubutree.com/', 'https://app.tubutree.com/san-pham', url]);
  });

  it('trang N của danh sách: vị trí nối tiếp các trang trước', () => {
    const ld = browseCollectionJsonLd({ ...META, alternates: { canonical: '/san-pham?brand=Tubu&page=3' } }, CRUMBS, ITEMS, 40);
    expect(graphOf(ld)[0]!.mainEntity.itemListElement.map((i: { position: number }) => i.position)).toEqual([41, 42]);
  });

  it('không có sản phẩm (danh sách chưa tải được): CollectionPage không có ItemList, không bịa mục', () => {
    expect(graphOf(browseCollectionJsonLd(META, CRUMBS, []))[0]).not.toHaveProperty('mainEntity');
  });

  it('trang noindex (không canonical) hoặc thiếu tiêu đề: không khai gì', () => {
    expect(browseCollectionJsonLd({ robots: { index: false, follow: true } }, CRUMBS, ITEMS)).toBeNull();
    expect(browseCollectionJsonLd({ ...META, title: undefined }, CRUMBS, ITEMS)).toBeNull();
  });

  it('nhúng an toàn: tên chứa </script> không đóng được thẻ', () => {
    const out = jsonLdScript(browseCollectionJsonLd(META, CRUMBS, ITEMS));
    expect(out).not.toMatch(/<\/script/i);
    expect(JSON.parse(out)['@graph'][0].mainEntity.itemListElement[1].name).toBe('Dầu xả </script>');
  });
});

describe('withBrowseSocial — og/twitter khớp canonical, tiêu đề, mô tả', () => {
  it('trang được lập chỉ mục: og:url là canonical, og:title có hậu tố nhãn như <title>, mô tả trùng meta description', () => {
    const m = withBrowseSocial(META);
    expect(m.alternates).toEqual(META.alternates);
    expect(m.openGraph).toMatchObject({
      type: 'website', siteName: 'Tubu Tree', locale: 'vi_VN', url: '/san-pham?category=c-goi', title: 'Dầu gội — Tubu Tree', description: META.description,
    });
    expect((m.openGraph as { images: unknown[] }).images).toHaveLength(1);
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', title: 'Dầu gội — Tubu Tree', description: META.description });
  });

  it('trang noindex: giữ nguyên metadata (không og:url cho trang không lập chỉ mục)', () => {
    const noindex = { robots: { index: false, follow: true } };
    expect(withBrowseSocial(noindex)).toEqual(noindex);
  });
});
