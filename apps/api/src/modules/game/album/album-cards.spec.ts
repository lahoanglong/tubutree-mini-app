import type { MiniProductCard } from '@tubutree/shared-types';
import { GAME_MINI_COPY } from '../../../../../../packages/app-core/src/game-mini/copy';
import { buildQuestion, cardText, relatedProduct, sortBinsFor, type AlbumContent, type AlbumItem } from './album-cards';
import { ALBUM_BIN_LABEL } from './album-notice';

const item = (over: Partial<AlbumItem> & Pick<AlbumItem, 'id' | 'game' | 'payload'>): AlbumItem => ({
  explanation: 'Vì nguồn nói vậy.',
  sourceUrl: 'https://example.gov.vn/a.pdf',
  productSlug: null,
  active: true,
  ...over,
});

const product = (slug: string, inStock = true): MiniProductCard => ({ slug, name: `Tên ${slug}`, imageUrl: null, price: 50_000, inStock });

function contentOf(items: AlbumItem[], products: MiniProductCard[] = []): AlbumContent {
  return { items: new Map(items.map((i) => [i.id, i])), products: new Map(products.map((p) => [p.slug, p])), sortBins: sortBinsFor(items) };
}

/** rng cố định: xáo giữ nguyên thứ tự (j = i). */
const keep = () => 0.999999;

const sortItem = (id: string, bin: string, active = true) => item({ id, game: 'sort', payload: { label: `Món ${id}`, bin, emoji: null }, active });
const matchItem = (id: string, ingredient: string, use: string, active = true) => item({ id, game: 'match', payload: { ingredient, use }, active });

describe('chữ thẻ Sổ tay Xanh', () => {
  it('tên thùng trùng bảng chữ game mini (sort.bin.*)', () => {
    for (const [bin, label] of Object.entries(ALBUM_BIN_LABEL)) expect(GAME_MINI_COPY[`sort.bin.${bin}` as keyof typeof GAME_MINI_COPY]).toBe(label);
  });

  it('mỗi game ra tiêu đề và đáp án đúng; payload hỏng thì null', () => {
    const products = new Map([['refill-a', product('refill-a')]]);
    expect(cardText(item({ id: 's', game: 'sort', payload: { label: 'Pin cũ', bin: 'hazardous', emoji: '🔋' } }), products)).toEqual({ title: '🔋 Pin cũ', answer: 'Nguy hại' });
    expect(cardText(item({ id: 'q', game: 'daily_quiz', payload: { prompt: 'Câu?', options: ['A', 'B'], answer: 1 } }), products)).toEqual({ title: 'Câu?', answer: 'B' });
    expect(cardText(matchItem('m', 'Bồ hòn', 'Tạo bọt'), products)).toEqual({ title: 'Bồ hòn', answer: 'Tạo bọt' });
    const kitchen = item({
      id: 'k',
      game: 'kitchen_swap',
      payload: { corner: 'kitchen', item: 'Chai rửa chén', hidden: 'Vỏ nhựa', options: [{ slug: 'refill-a', fact: 'x' }, { slug: 'refill-b', fact: 'y' }, { slug: 'refill-c', fact: 'z' }], answer: 'refill-a' },
    });
    expect(cardText(kitchen, products)).toEqual({ title: 'Chai rửa chén', answer: 'Tên refill-a' });
    expect(cardText(kitchen, new Map())).toEqual({ title: 'Chai rửa chén', answer: null });
    expect(cardText(item({ id: 'x', game: 'origin', payload: { prompt: '' } }), products)).toBeNull();
  });

  it('sản phẩm liên quan chỉ khi đang bán VÀ còn hàng', () => {
    const q = item({ id: 'q', game: 'daily_quiz', payload: { prompt: 'Câu?', options: ['A', 'B'], answer: 0 }, productSlug: 'p1' });
    expect(relatedProduct(q, new Map([['p1', product('p1')]]))?.slug).toBe('p1');
    expect(relatedProduct(q, new Map([['p1', product('p1', false)]]))).toBeNull();
    expect(relatedProduct(q, new Map())).toBeNull();
  });
});

describe('câu ôn trắc nghiệm', () => {
  it('Đúng Thùng: đủ bộ thùng của kho; kho có vật nguy hại đang bật thì có thùng Nguy hại cho mọi câu', () => {
    const plain = contentOf([sortItem('a', 'recycle'), sortItem('b', 'food')]);
    expect(buildQuestion(plain.items.get('a')!, plain, keep)).toMatchObject({ options: ['Tái chế', 'Thực phẩm', 'Còn lại'], answer: 0 });
    const withHazard = contentOf([sortItem('a', 'recycle'), sortItem('h', 'hazardous')]);
    expect(buildQuestion(withHazard.items.get('a')!, withHazard, keep)?.options).toEqual(['Tái chế', 'Thực phẩm', 'Còn lại', 'Nguy hại']);
    // Vật nguy hại đã tắt không mở thùng thứ tư cho câu khác (số thùng không lộ đáp án).
    const retiredHazard = contentOf([sortItem('a', 'recycle'), sortItem('h', 'hazardous', false)]);
    expect(buildQuestion(retiredHazard.items.get('a')!, retiredHazard, keep)?.options).toHaveLength(3);
  });

  it('Ghép Cặp: công dụng đúng + 2 công dụng của cặp khác đang bật, bỏ cặp có nguyên liệu lồng nhau và công dụng trùng', () => {
    const c = contentOf([
      matchItem('m1', 'Baking soda', 'Làm bánh nở'),
      matchItem('m2', 'Baking soda trộn giấm', 'Sủi bọt khí'),
      matchItem('m3', 'Giấm ăn', 'Làm bánh nở'),
      matchItem('m4', 'Quế', 'Tạo mùi thơm'),
      matchItem('m5', 'Bạc hà', 'Cảm giác mát', false),
      matchItem('m6', 'Bồ hòn', 'Tạo bọt'),
    ]);
    for (let i = 0; i < 20; i++) {
      const q = buildQuestion(c.items.get('m1')!, c, Math.random)!;
      expect(q.prompt).toBe('Baking soda dùng để làm gì?');
      expect(q.options).toHaveLength(3);
      expect(q.options[q.answer]).toBe('Làm bánh nở');
      expect([...q.options].sort()).toEqual(['Làm bánh nở', 'Tạo bọt', 'Tạo mùi thơm'].sort());
    }
    const tooFew = contentOf([matchItem('m1', 'Quế', 'Thơm'), matchItem('m2', 'Hồi', 'Cay')]);
    expect(buildQuestion(tooFew.items.get('m1')!, tooFew, keep)).toBeNull();
  });

  it('Căn Bếp Xanh: tên 3 sản phẩm, đáp án là sản phẩm đúng; thiếu một sản phẩm đang bán thì không dựng câu', () => {
    const k = item({
      id: 'k',
      game: 'kitchen_swap',
      payload: { corner: 'kitchen', item: 'Chai rửa chén', hidden: 'Vỏ nhựa', options: [{ slug: 'a', fact: 'x' }, { slug: 'b', fact: 'y' }, { slug: 'c', fact: 'z' }], answer: 'b' },
    });
    const full = contentOf([k], [product('a'), product('b', false), product('c')]);
    const q = buildQuestion(k, full, Math.random)!;
    expect(q.options[q.answer]).toBe('Tên b');
    expect(q.productSlug).toBe('b');
    expect(buildQuestion(k, contentOf([k], [product('a'), product('b')]), keep)).toBeNull();
  });

  it('Đố Xanh và Đoán Xuất Xứ giữ đúng câu và lựa chọn', () => {
    const o = item({ id: 'o', game: 'origin', payload: { prompt: 'Vùng nào?', options: ['A', 'B', 'C', 'D'], answer: 2 } });
    expect(buildQuestion(o, contentOf([o]), keep)).toMatchObject({ prompt: 'Vùng nào?', options: ['A', 'B', 'C', 'D'], answer: 2 });
  });
});
