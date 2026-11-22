import { describe, expect, it } from 'vitest';
import { jsonLdScript } from '../product-seo';
import { SITE_URL } from '../site';
import { STOREFRONT_LD_MAX_ITEMS, storefrontJsonLd, type StorefrontLdInput } from './storefront-structured-data';

const product = (slug: string, name = `Sản phẩm ${slug}`) => ({ product: { slug, name } });
const SF: StorefrontLdInput = {
  slug: 'linh',
  title: 'Shop của Linh',
  headerNote: 'Hàng sống xanh',
  avatarUrl: 'https://api.tubutree.com/api/storefront/image/s1/avatar?v=1',
  collections: [{ items: [product('binh-nuoc'), product('dau-goi')] }, { items: [product('dau-goi'), product('xa-phong')] }],
};
const graphOf = (ld: Record<string, unknown> | null) => (ld?.['@graph'] ?? []) as Record<string, any>[];

describe('storefrontJsonLd — OnlineStore + ItemList cho gian hàng đã đăng', () => {
  it('một @graph: OnlineStore có tên, URL canonical, mô tả, ảnh; ItemList theo thứ tự bộ sưu tập, mỗi sản phẩm một lần', () => {
    const [store, list] = graphOf(storefrontJsonLd(SF)) as [Record<string, any>, Record<string, any>];
    expect(store).toEqual({
      '@type': 'OnlineStore',
      '@id': `${SITE_URL}/s/linh#store`,
      name: 'Shop của Linh',
      url: `${SITE_URL}/s/linh`,
      description: 'Hàng sống xanh',
      image: SF.avatarUrl,
    });
    expect(list['@type']).toBe('ItemList');
    expect(list.numberOfItems).toBe(3);
    expect(list.itemListElement.map((e: { position: number; url: string }) => [e.position, e.url])).toEqual([
      [1, `${SITE_URL}/san-pham/binh-nuoc`],
      [2, `${SITE_URL}/san-pham/dau-goi`],
      [3, `${SITE_URL}/san-pham/xa-phong`],
    ]);
  });

  it('gian hàng mẫu (noindex, không phải người bán thật): không có JSON-LD', () => {
    expect(storefrontJsonLd({ ...SF, isSample: true })).toBeNull();
  });

  it('gian hàng chưa có sản phẩm: chỉ OnlineStore, không ItemList rỗng', () => {
    const graph = graphOf(storefrontJsonLd({ ...SF, collections: [] }));
    expect(graph.map((n) => n['@type'])).toEqual(['OnlineStore']);
  });

  it('ảnh base64 hay đường dẫn tương đối không vào JSON-LD; ghi chú trống thì không có mô tả', () => {
    const [store] = graphOf(storefrontJsonLd({ ...SF, avatarUrl: 'data:image/png;base64,AAAA', headerNote: '  ' }));
    expect(store).not.toHaveProperty('image');
    expect(store).not.toHaveProperty('description');
    expect(graphOf(storefrontJsonLd({ ...SF, avatarUrl: '/api/x.png' }))[0]).not.toHaveProperty('image');
  });

  it(`ItemList tối đa ${STOREFRONT_LD_MAX_ITEMS} món`, () => {
    const many = { ...SF, collections: [{ items: Array.from({ length: STOREFRONT_LD_MAX_ITEMS + 5 }, (_, i) => product(`sp-${i}`)) }] };
    expect(graphOf(storefrontJsonLd(many))[1]!.numberOfItems).toBe(STOREFRONT_LD_MAX_ITEMS);
  });

  it('tên do chủ gian hàng gõ có "</script>": chuỗi script đã thoát không đóng được thẻ', () => {
    const ld = storefrontJsonLd({ ...SF, title: 'Shop </script><script>alert(1)</script>', collections: [{ items: [product('a', 'Tên </script>')] }] });
    const text = jsonLdScript(ld);
    expect(text).not.toContain('</script>');
    expect(text).not.toContain('<');
    expect(JSON.parse(text)['@graph'][0].name).toBe('Shop </script><script>alert(1)</script>');
  });
});
