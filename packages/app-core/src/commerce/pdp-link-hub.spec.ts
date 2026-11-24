import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from '../shop-copy';
import type { CategoryNode } from '../browse/category-tree';
import { claimsIn } from './copy-claims-guard';
import {
  PDP_CATEGORY_LINKS_MAX,
  PDP_FAQ_INGREDIENTS_MAX,
  PDP_LINK_HUB_COPY,
  PDP_LINK_HUB_COPY_MAX,
  pdpCategoryLinks,
  pdpCategoryTrail,
  pdpGeneratedFaq,
  pdpLinkHubCopy,
  pdpRefillLinkText,
  type PdpLinkHubCopyKey,
} from './pdp-link-hub';

const NAME = 'Nước giặt Fuwa3e 3,8L';
const CMP = { savedVnd: 120000, savedPct: 34, bottlesReplaced: 3 };

describe('pdpGeneratedFaq', () => {
  it('thành phần → cách dùng → Refill, câu hỏi nêu tên sản phẩm, câu trả lời đúng dữ liệu trang', () => {
    const faq = pdpGeneratedFaq({
      name: ` ${NAME} `,
      ingredients: [{ name: 'Bồ kết', percentage: '5%' }, { name: ' Gừng ', percentage: null }, { name: 'bồ kết' }],
      usage: ['Pha 1 nắp với 10L nước.', '  ', 'Giặt tay hoặc giặt máy.'],
      refill: { name: 'Túi Refill Fuwa3e 10L', comparison: CMP },
    });
    expect(faq.map((f) => f.key)).toEqual(['ingredients', 'usage', 'refill']);
    expect(faq[0]).toEqual({
      key: 'ingredients',
      q: `${NAME} có thành phần gì?`,
      a: 'Thành phần: Bồ kết (5%), Gừng.',
      lines: ['Thành phần: Bồ kết (5%), Gừng.'],
    });
    expect(faq[1]).toEqual({
      key: 'usage',
      q: `Dùng ${NAME} thế nào?`,
      a: 'Pha 1 nắp với 10L nước.\nGiặt tay hoặc giặt máy.',
      lines: ['Pha 1 nắp với 10L nước.', 'Giặt tay hoặc giặt máy.'],
    });
    expect(faq[2]!.q).toBe(`${NAME} có bản Refill không?`);
    expect(faq[2]!.a).toBe('Có: Túi Refill Fuwa3e 10L, tiết kiệm 120.000đ so với mua chai cùng lượng.');
  });

  it('gói Refill không so được với chai (thiếu lượng, chai đang Giờ vàng): chỉ nêu tên gói, không hứa số tiền', () => {
    const faq = pdpGeneratedFaq({ name: NAME, refill: { name: 'Can Refill 5L', comparison: null } });
    expect(faq).toEqual([{ key: 'refill', q: `${NAME} có bản Refill không?`, a: 'Có: Can Refill 5L.', lines: ['Có: Can Refill 5L.'] }]);
  });

  it('không có dữ liệu thì không có câu hỏi: thiếu thành phần, cách dùng, gói Refill, hay tên rỗng', () => {
    expect(pdpGeneratedFaq({ name: NAME })).toEqual([]);
    expect(pdpGeneratedFaq({ name: NAME, ingredients: [{ name: '  ' }], usage: [' '], refill: { name: ' ', comparison: null } })).toEqual([]);
    expect(pdpGeneratedFaq({ name: '  ', ingredients: [{ name: 'Bồ kết' }] })).toEqual([]);
    expect(pdpGeneratedFaq({ name: NAME, ingredients: null, usage: null, refill: null })).toEqual([]);
  });

  it(`bảng thành phần dài: câu trả lời dừng ở ${PDP_FAQ_INGREDIENTS_MAX} chất`, () => {
    const ingredients = Array.from({ length: PDP_FAQ_INGREDIENTS_MAX + 5 }, (_, i) => ({ name: `Chất ${i + 1}` }));
    const [faq] = pdpGeneratedFaq({ name: NAME, ingredients });
    expect(faq!.a.split(', ')).toHaveLength(PDP_FAQ_INGREDIENTS_MAX);
    expect(faq!.a.endsWith(`Chất ${PDP_FAQ_INGREDIENTS_MAX}.`)).toBe(true);
  });
});

const node = (id: string, children: CategoryNode[] = []): CategoryNode => ({ id, parentId: null, name: `Tên ${id}`, slug: id, image: null, children });
const TREE: CategoryNode[] = [node('nha', [node('giat', [node('giat-long')]), node('rua')]), node('an')];

describe('pdpCategoryTrail', () => {
  it('lấy danh mục sâu nhất có trong cây; bằng sâu thì danh mục đứng trước', () => {
    expect(pdpCategoryTrail(TREE, ['nha', 'giat-long', 'rua']).map((n) => n.id)).toEqual(['nha', 'giat', 'giat-long']);
    expect(pdpCategoryTrail(TREE, ['rua', 'giat']).map((n) => n.id)).toEqual(['nha', 'rua']);
  });

  it('id không còn trong cây thì bỏ qua; không còn danh mục nào (hay cây/danh sách trống) thì rỗng', () => {
    expect(pdpCategoryTrail(TREE, ['da-xoa', 'an']).map((n) => n.id)).toEqual(['an']);
    expect(pdpCategoryTrail(TREE, ['da-xoa'])).toEqual([]);
    expect(pdpCategoryTrail(undefined, ['nha'])).toEqual([]);
    expect(pdpCategoryTrail(TREE, undefined)).toEqual([]);
  });
});

describe('pdpCategoryLinks', () => {
  const p = (id: string, name = `SP ${id}`) => ({ id, slug: `sp-${id}`, name });
  it('bỏ món đang xem, món đã ở dải Cùng thương hiệu, món trùng và món thiếu slug/tên; giữ thứ tự nguồn', () => {
    const links = pdpCategoryLinks([p('cur'), p('a'), p('brand'), p('a'), { id: 'x', slug: '', name: 'X' }, p('y', ' '), p('b')], {
      currentId: 'cur',
      exclude: [{ id: 'brand' }],
    });
    expect(links).toEqual([{ slug: 'sp-a', name: 'SP a' }, { slug: 'sp-b', name: 'SP b' }]);
  });

  it(`tối đa ${PDP_CATEGORY_LINKS_MAX} món; nguồn trống thì rỗng`, () => {
    const many = Array.from({ length: PDP_CATEGORY_LINKS_MAX + 4 }, (_, i) => p(String(i)));
    expect(pdpCategoryLinks(many, { currentId: 'none' })).toHaveLength(PDP_CATEGORY_LINKS_MAX);
    expect(pdpCategoryLinks(undefined, { currentId: 'none' })).toEqual([]);
  });
});

describe('pdpRefillLinkText', () => {
  it('kèm số tiền tiết kiệm khi so được, không thì chỉ tên gói', () => {
    expect(pdpRefillLinkText({ name: 'Túi Refill 10L', comparison: CMP })).toBe('Túi Refill 10L · tiết kiệm 120.000đ');
    expect(pdpRefillLinkText({ name: ' Túi Refill 10L ', comparison: null })).toBe('Túi Refill 10L');
  });
});

describe('PDP_LINK_HUB_COPY', () => {
  it('không thuật ngữ cấm, không tuyên bố, phần chữ cố định không vượt ngân sách', () => {
    for (const key of Object.keys(PDP_LINK_HUB_COPY) as PdpLinkHubCopyKey[]) {
      const text = pdpLinkHubCopy(key, { name: '', list: '', pack: '', amount: '999.999đ' });
      for (const { pattern, use } of FORBIDDEN_TERMS) expect(text, `${key}: dùng "${use}"`).not.toMatch(pattern);
      expect(claimsIn(text), key).toEqual([]);
      expect(text.length, key).toBeLessThanOrEqual(PDP_LINK_HUB_COPY_MAX[key]);
    }
  });
});
