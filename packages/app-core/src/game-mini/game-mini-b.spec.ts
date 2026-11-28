import { describe, expect, it, vi } from 'vitest';
import { CART_BATCH_REJECTED, type MiniMatchCard, type MiniProductCard, type MiniReview, type MiniRoundContent } from '@tubutree/shared-types';
import type { ProductCard } from '../api/catalog';
import type { HttpClient } from '../http';
import { addBasketToCart, BASKET_PENDING_TTL_MS, basketCartLines, basketCartPlan, decodeBasketPending, encodeBasketPending } from './basket-cart';
import { basketFull, basketReady, basketToggle } from './basket-board';
import { GAME_MINI_COPY, GAME_MINI_COPY_MAX, type GameMiniCopyKey } from './copy';
import { miniGameTitle, miniProgressLabel, PLAYABLE_MINI_GAMES } from './format';
import { MATCH_MISMATCH_MS, matchAnswers, matchCardState, matchDone, matchPairNo, matchSettle, matchStart, matchTap, type MatchProgress } from './match-board';
import { originMapSpot } from './origin-map';
import { miniBasketSet, miniMatchProductSlugs, miniProductsKey, miniQuizProduct, miniReviewRows } from './review';
import { ORIGIN_TURN_MS, quizStart, quizTimeLeft, QUIZ_QUESTION_MS } from './boards';

const T0 = 1_000_000;

/** 3 cặp: i1..i3 là nguyên liệu, u1..u3 là công dụng. */
const CARDS: MiniMatchCard[] = [
  { cardId: 'i1', label: 'Bồ hòn', side: 'ingredient' },
  { cardId: 'u1', label: 'Tạo bọt rửa chén', side: 'use' },
  { cardId: 'i2', label: 'Giấm', side: 'ingredient' },
  { cardId: 'u2', label: 'Tẩy cặn vôi', side: 'use' },
  { cardId: 'i3', label: 'Baking soda', side: 'ingredient' },
  { cardId: 'u3', label: 'Khử mùi', side: 'use' },
];

const tap = (p: MatchProgress, id: string, now = T0) => matchTap(p, CARDS, id, now);

describe('Ghép Cặp: matchTap', () => {
  it('nguyên liệu rồi công dụng thành một cặp [nguyên liệu, công dụng], kể cả khi chạm công dụng trước', () => {
    let p = tap(tap(matchStart(), 'i1'), 'u2');
    expect(p.pairs).toEqual([['i1', 'u2']]);
    p = tap(tap(p, 'u1'), 'i2');
    expect(p.pairs).toEqual([
      ['i1', 'u2'],
      ['i2', 'u1'],
    ]);
    expect(matchPairNo(p, 'u1')).toBe(2);
    expect(matchCardState(p, 'i2')).toBe('paired');
  });

  it('chạm lại thẻ đang chọn thì bỏ chọn', () => {
    const p = tap(tap(matchStart(), 'i1'), 'i1');
    expect(p.selected).toBeNull();
    expect(matchCardState(p, 'i1')).toBe('idle');
  });

  it('hai thẻ cùng loại báo không khớp rồi tự trở lại sau MATCH_MISMATCH_MS', () => {
    const p = tap(tap(matchStart(), 'i1'), 'i2', T0);
    expect(p.mismatch).toEqual({ a: 'i1', b: 'i2', until: T0 + MATCH_MISMATCH_MS });
    expect(matchCardState(p, 'i1')).toBe('mismatch');
    expect(matchCardState(p, 'i2')).toBe('mismatch');
    expect(matchSettle(p, T0 + MATCH_MISMATCH_MS - 1)).toBe(p);
    const settled = matchSettle(p, T0 + MATCH_MISMATCH_MS);
    expect(settled.mismatch).toBeNull();
    expect(settled.selected).toBeNull();
  });

  it('đang không khớp mà chạm thẻ thứ ba: hai thẻ kia trở lại ngay và thẻ thứ ba được chọn', () => {
    const p = tap(tap(tap(matchStart(), 'i1'), 'i2'), 'u3');
    expect(p.mismatch).toBeNull();
    expect(p.selected).toBe('u3');
    expect(p.pairs).toEqual([]);
  });

  it('đang không khớp mà chạm lại một trong hai thẻ: chỉ đóng không khớp, không chọn', () => {
    const p = tap(tap(tap(matchStart(), 'i1'), 'i2'), 'i2');
    expect(p.mismatch).toBeNull();
    expect(p.selected).toBeNull();
  });

  it('chạm thẻ lạ: bỏ qua, trả đúng đối tượng cũ', () => {
    const paired = tap(tap(matchStart(), 'i1'), 'u1');
    expect(tap(paired, 'không-có')).toBe(paired);
  });

  it('chạm một thẻ của cặp đã ghép: gỡ cặp đó, hai thẻ về chưa chọn, cặp sau lùi số; thẻ đang chọn dở bỏ chọn', () => {
    const two = tap(tap(tap(tap(matchStart(), 'i1'), 'u2'), 'i2'), 'u1');
    expect(two.pairs).toEqual([
      ['i1', 'u2'],
      ['i2', 'u1'],
    ]);
    const undone = tap(two, 'u2');
    expect(undone.pairs).toEqual([['i2', 'u1']]);
    expect(matchCardState(undone, 'i1')).toBe('idle');
    expect(matchCardState(undone, 'u2')).toBe('idle');
    expect(matchPairNo(undone, 'i2')).toBe(1);
    const fixed = tap(tap(undone, 'i1'), 'u2');
    expect(fixed.pairs).toEqual([
      ['i2', 'u1'],
      ['i1', 'u2'],
    ]);
    const picking = tap(fixed, 'i3');
    const undoWhilePicking = tap(picking, 'i1');
    expect(undoWhilePicking.selected).toBeNull();
    expect(undoWhilePicking.pairs).toEqual([['i2', 'u1']]);
  });

  it('ghép đủ thì xong; chạm thêm bị bỏ qua; đáp án là các cặp đã ghép', () => {
    let p = matchStart();
    const all: [string, string][] = [
      ['i1', 'u1'],
      ['i2', 'u2'],
      ['i3', 'u3'],
    ];
    for (const [a, b] of all) p = tap(tap(p, a), b);
    expect(matchDone(p, CARDS)).toBe(true);
    expect(tap(p, 'i1')).toBe(p);
    expect(matchAnswers(p)).toEqual([
      ['i1', 'u1'],
      ['i2', 'u2'],
      ['i3', 'u3'],
    ]);
  });

  it('hết giờ giữa ván: chỉ nộp các cặp đã ghép, thẻ đang chọn dở không tính', () => {
    const p = tap(tap(tap(matchStart(), 'i1'), 'u1'), 'i2');
    expect(p.selected).toBe('i2');
    expect(matchDone(p, CARDS)).toBe(false);
    expect(matchAnswers(p)).toEqual([['i1', 'u1']]);
  });

  it('không có thẻ thì không bao giờ "xong"', () => {
    expect(matchDone(matchStart(), [])).toBe(false);
  });
});

describe('Giỏ Đúng Việc: basketToggle (chọn 3 trong 6)', () => {
  const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('chọn, bỏ chọn, đổi ý', () => {
    let picked = basketToggle([], 'a', SIX);
    picked = basketToggle(picked, 'b', SIX);
    expect(picked).toEqual(['a', 'b']);
    picked = basketToggle(picked, 'a', SIX);
    expect(picked).toEqual(['b']);
    expect(basketReady(picked)).toBe(false);
  });

  it('đủ 3 thì món thứ tư không vào (trả đúng mảng cũ), bỏ một món rồi chọn được', () => {
    const three = ['a', 'b', 'c'].reduce<readonly string[]>((p, s) => basketToggle(p, s, SIX), []);
    expect(basketReady(three)).toBe(true);
    expect(basketFull(three)).toBe(true);
    expect(basketToggle(three, 'd', SIX)).toBe(three);
    const swapped = basketToggle(basketToggle(three, 'b', SIX), 'd', SIX);
    expect(swapped).toEqual(['a', 'c', 'd']);
  });

  it('slug không thuộc đề thì bỏ qua', () => {
    const picked = ['a'];
    expect(basketToggle(picked, 'zzz', SIX)).toBe(picked);
  });
});

const prod = (slug: string, name: string): MiniProductCard => ({ slug, name, imageUrl: null, price: 50_000, inStock: true });
const card = (slug: string, over: Partial<ProductCard> = {}): ProductCard => ({
  id: `p-${slug}`,
  slug,
  brand: 'Tubu',
  name: slug,
  thumbnail: null,
  basePrice: 50_000,
  salePrice: null,
  repVariationId: `v-${slug}`,
  isFeatured: false,
  inStock: true,
  ...over,
});
const SET = [prod('nuoc-rua-chen', 'Nước rửa chén'), prod('giam-gao', 'Giấm gạo'), prod('khan-lau', 'Khăn lau')];

function fakeHttp(cards: ProductCard[], post: (body: { items: { variationId: string; quantity: number }[] }) => unknown) {
  const http = {
    get: vi.fn(async (path: string) => {
      if (path !== '/products') throw new Error(`GET lạ ${path}`);
      return { data: cards, total: cards.length };
    }),
    post: vi.fn(async (path: string, body: unknown, _opts?: unknown) => {
      if (path !== '/cart/items/batch') throw new Error(`POST lạ ${path}`);
      return post(body as { items: { variationId: string; quantity: number }[] });
    }),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return http as unknown as HttpClient & { get: typeof http.get; post: typeof http.post };
}

const rejected = () => Object.assign(new Error('Sản phẩm đã hết hàng'), { status: 409, code: CART_BATCH_REJECTED });

describe('Giỏ Đúng Việc: bộ chờ khi khách web sang đăng nhập', () => {
  const NOW = 1_800_000_000_000;
  const set: MiniProductCard[] = [
    { slug: 'nuoc-rua-chen', name: 'Nước rửa chén', imageUrl: 'https://cdn.tubutree.com/a.jpg', price: 89_000, inStock: true },
    { slug: 'khan-lau', name: 'Khăn lau', imageUrl: '/api/img?u=x', price: 45_000, inStock: false },
    { slug: 'giam-gao', name: 'Giấm gạo', imageUrl: null, price: 30_000, inStock: true },
  ];

  it('ghi rồi đọc lại đúng bộ trong 30 phút; quá hạn, giờ tương lai, hỏng thì null', () => {
    const raw = encodeBasketPending(set, NOW);
    expect(decodeBasketPending(raw, NOW + 60_000)).toEqual(set);
    expect(decodeBasketPending(raw, NOW + BASKET_PENDING_TTL_MS + 1)).toBeNull();
    expect(decodeBasketPending(raw, NOW - 1)).toBeNull();
    expect(decodeBasketPending(null, NOW)).toBeNull();
    expect(decodeBasketPending('{không phải json', NOW)).toBeNull();
    expect(decodeBasketPending(JSON.stringify({ at: NOW, products: [] }), NOW)).toBeNull();
  });

  it('không tin dữ liệu trình duyệt: slug lạ, ảnh javascript:, giá âm, thiếu trường, quá 6 món thì null', () => {
    const bad = (p: Record<string, unknown>) => decodeBasketPending(JSON.stringify({ at: NOW, products: [{ ...set[0], ...p }] }), NOW);
    expect(bad({ slug: '../x' })).toBeNull();
    expect(bad({ imageUrl: 'javascript:alert(1)' })).toBeNull();
    expect(bad({ price: -1 })).toBeNull();
    expect(bad({ inStock: 'yes' })).toBeNull();
    expect(bad({ name: '' })).toBeNull();
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...set[0], slug: `sp-${i}` }));
    expect(decodeBasketPending(JSON.stringify({ at: NOW, products: seven }), NOW)).toBeNull();
  });
});

describe('Giỏ Đúng Việc: thêm bộ đúng vào giỏ', () => {
  it('basketCartPlan: món hết hàng, thiếu phân loại hay không về từ danh mục thì bỏ qua theo tên', () => {
    const plan = basketCartPlan(
      [...SET, prod('an-di', 'Món đã ẩn')],
      [card('nuoc-rua-chen'), card('giam-gao', { inStock: false }), card('khan-lau', { repVariationId: undefined })],
    );
    expect(plan.lines).toEqual([{ slug: 'nuoc-rua-chen', name: 'Nước rửa chén', variationId: 'v-nuoc-rua-chen' }]);
    expect(plan.skipped).toEqual(['Giấm gạo', 'Khăn lau', 'Món đã ẩn']);
  });

  it('một món hết hàng: một lệnh batch với hai món còn hàng, mỗi món 1, không gửi addSource, không gọi API game nào', async () => {
    const http = fakeHttp([card('nuoc-rua-chen'), card('giam-gao', { inStock: false }), card('khan-lau')], () => ({ ok: true }));
    const r = await addBasketToCart(http, SET, 'gian-hang-a');
    expect(r).toEqual({ added: ['Nước rửa chén', 'Khăn lau'], skipped: ['Giấm gạo'], unsent: [] });
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      '/cart/items/batch',
      {
        items: [
          { variationId: 'v-nuoc-rua-chen', quantity: 1 },
          { variationId: 'v-khan-lau', quantity: 1 },
        ],
      },
      { query: { storefrontSlug: 'gian-hang-a' } },
    );
    const paths = [...http.get.mock.calls.map((c) => c[0]), ...http.post.mock.calls.map((c) => c[0])];
    expect(paths.some((p) => String(p).includes('/game'))).toBe(false);
    expect(basketCartLines(r)).toEqual(['Đã thêm 2 món vào giỏ.', 'Chưa thêm được (hết hàng hoặc ngừng bán): Giấm gạo.']);
  });

  it('danh mục còn hàng nhưng máy chủ từ chối cả lô: thêm lại từng món, món hỏng nêu tên, món còn lại vào giỏ', async () => {
    const http = fakeHttp(SET.map((p) => card(p.slug)), (body) => {
      if (body.items.length > 1 || body.items[0]!.variationId === 'v-giam-gao') throw rejected();
      return { ok: true };
    });
    const r = await addBasketToCart(http, SET);
    expect(r).toEqual({ added: ['Nước rửa chén', 'Khăn lau'], skipped: ['Giấm gạo'], unsent: [] });
    expect(http.post).toHaveBeenCalledTimes(4);
    expect(http.post.mock.calls[0]![2]).toBeUndefined();
  });

  it('cả bộ hết hàng: không gửi lệnh nào, câu báo "hết hàng" nêu tên', async () => {
    const http = fakeHttp(SET.map((p) => card(p.slug, { inStock: false })), () => ({ ok: true }));
    const r = await addBasketToCart(http, SET);
    expect(http.post).not.toHaveBeenCalled();
    expect(r.added).toEqual([]);
    expect(basketCartLines(r)).toEqual(['Chưa thêm được món nào (hết hàng hoặc ngừng bán): Nước rửa chén, Giấm gạo, Khăn lau.']);
  });

  it('lỗi mạng ở lệnh đầu: ném lỗi (chưa món nào vào giỏ) để nơi gọi cho thử lại', async () => {
    const http = fakeHttp(SET.map((p) => card(p.slug)), () => {
      throw Object.assign(new Error('Network'), { status: 0 });
    });
    await expect(addBasketToCart(http, SET)).rejects.toThrow('Network');
  });

  it('lỗi mạng giữa lúc thêm từng món: trả món đã vào và món chưa gửi, không gửi lại cả bộ', async () => {
    let n = 0;
    const http = fakeHttp(SET.map((p) => card(p.slug)), () => {
      n += 1;
      if (n === 1) throw rejected();
      if (n === 2) return { ok: true };
      throw Object.assign(new Error('Network'), { status: 0 });
    });
    const r = await addBasketToCart(http, SET);
    expect(r).toEqual({ added: ['Nước rửa chén'], skipped: [], unsent: ['Giấm gạo', 'Khăn lau'] });
    expect(http.post).toHaveBeenCalledTimes(3);
    expect(basketCartLines(r)).toEqual(['Đã thêm 1 món vào giỏ.', 'Mạng chậm nên chưa thêm: Giấm gạo, Khăn lau. Bạn thêm ở trang sản phẩm nhé.']);
  });
});

describe('Màn kết quả đợt B', () => {
  const matchContent: MiniRoundContent = { game: 'match', cards: CARDS };
  const matchReview: MiniReview = {
    game: 'match',
    items: [
      { contentId: 'm1', correct: true, explanation: 'Saponin tạo bọt.', sourceUrl: 'https://a.vn/1', ingredient: 'Bồ hòn', use: 'Tạo bọt rửa chén', productSlug: 'bo-hon' },
      { contentId: 'm2', correct: false, explanation: 'Axit axetic hoà tan cặn.', sourceUrl: '', ingredient: 'Giấm', use: 'Tẩy cặn vôi', productSlug: 'giam-gao' },
      { contentId: 'm3', correct: false, explanation: 'Trung hoà axit gây mùi.', sourceUrl: '', ingredient: 'Baking soda', use: 'Khử mùi', productSlug: 'bo-hon' },
    ],
  };

  it('Ghép Cặp: dòng "Vì sao" theo cặp, công dụng khách đã ghép, cặp chưa ghép là bỏ qua', () => {
    const rows = miniReviewRows(matchReview, matchContent, [
      ['i1', 'u1'],
      ['i2', 'u3'],
    ]);
    expect(rows.map((r) => [r.title, r.state, r.given])).toEqual([
      ['Bồ hòn: Tạo bọt rửa chén', 'correct', 'Tạo bọt rửa chén'],
      ['Giấm: Tẩy cặn vôi', 'wrong', 'Khử mùi'],
      ['Baking soda: Khử mùi', 'skipped', null],
    ]);
  });

  it('Ghép Cặp: tối đa 2 sản phẩm, cặp đúng trước, không trùng', () => {
    expect(miniMatchProductSlugs(matchReview)).toEqual(['bo-hon', 'giam-gao']);
    expect(miniMatchProductSlugs(matchReview, 1)).toEqual(['bo-hon']);
    expect(miniProductsKey(['bo-hon'])[0]).not.toBe('game');
  });

  const basketContent: MiniRoundContent = {
    game: 'basket',
    task: { id: 't1', task: 'Rửa chén bát cho cả nhà', products: [...SET, prod('nuoc-hoa', 'Nước hoa'), prod('son', 'Sơn tường'), prod('xa-phong', 'Xà phòng')] },
  };
  const basketReview: MiniReview = {
    game: 'basket',
    items: [
      {
        contentId: 'b1',
        correct: false,
        explanation: 'Rửa chén cần chất tẩy dịu và dụng cụ lau.',
        sourceUrl: 'https://a.vn/2',
        correctSlugs: ['nuoc-rua-chen', 'giam-gao', 'khan-lau'],
        picks: [
          { slug: 'nuoc-rua-chen', correct: true, reason: null },
          { slug: 'giam-gao', correct: true, reason: null },
          { slug: 'son', correct: false, reason: 'Sơn tường không dùng cho bát đĩa.' },
        ],
      },
    ],
  };

  it('Giỏ Đúng Việc: một dòng cho đề với bộ đúng, mỗi món chọn sai một dòng lý do', () => {
    const rows = miniReviewRows(basketReview, basketContent);
    expect(rows.map((r) => [r.title, r.state, r.expected, r.explanation])).toEqual([
      ['Rửa chén bát cho cả nhà', 'wrong', 'Nước rửa chén, Giấm gạo, Khăn lau', 'Rửa chén cần chất tẩy dịu và dụng cụ lau.'],
      ['Sơn tường', 'wrong', '', 'Sơn tường không dùng cho bát đĩa.'],
    ]);
  });

  it('Giỏ Đúng Việc: bộ đúng lấy từ nội dung ván', () => {
    expect(miniBasketSet(basketReview, basketContent).map((p) => p.slug)).toEqual(['nuoc-rua-chen', 'giam-gao', 'khan-lau']);
    expect(miniBasketSet(matchReview, basketContent)).toEqual([]);
  });

  it('Đoán Xuất Xứ: sản phẩm ở lượt cuối có gắn sản phẩm', () => {
    const p = prod('mat-ong', 'Mật ong');
    const content: MiniRoundContent = {
      game: 'origin',
      items: [
        { id: 'o1', prompt: 'Chè Shan tuyết', options: ['Hà Giang', 'Lâm Đồng', 'Huế', 'Cà Mau'], product: null },
        { id: 'o2', prompt: 'Mật ong bạc hà', options: ['Mèo Vạc', 'Bến Tre', 'Huế', 'Đà Lạt'], product: p },
      ],
    };
    expect(miniQuizProduct(content)).toEqual(p);
  });
});

describe('Đoán Xuất Xứ: đồng hồ lượt và bản đồ', () => {
  it('mỗi lượt 12 giây, Đố Xanh giữ 20 giây', () => {
    const p = quizStart(5, T0);
    expect(quizTimeLeft(p, T0 + 1_000, ORIGIN_TURN_MS)).toBe(ORIGIN_TURN_MS - 1_000);
    expect(quizTimeLeft(p, T0 + ORIGIN_TURN_MS + 5, ORIGIN_TURN_MS)).toBe(0);
    expect(quizTimeLeft(p, T0)).toBe(QUIZ_QUESTION_MS);
  });

  it('tên vùng ra vùng sơ đồ hoặc đảo; dấu kiểu cũ và hoa thường không ảnh hưởng; năm hay tên lạ thì không tô', () => {
    expect(originMapSpot('Hà Giang')).toEqual({ kind: 'region', id: 'dong-bac' });
    expect(originMapSpot('Đà Lạt')).toEqual({ kind: 'region', id: 'lam-dong' });
    expect(originMapSpot('khánh hoà')).toEqual({ kind: 'region', id: 'khanh-hoa' });
    expect(originMapSpot('Hoà Bình')).toEqual({ kind: 'region', id: 'son-la' });
    expect(originMapSpot('Phú Quốc')).toEqual({ kind: 'island', id: 'phu-quoc' });
    expect(originMapSpot('Hoàng Sa')).toEqual({ kind: 'island', id: 'hoang-sa' });
    expect(originMapSpot('Trường Sa')).toEqual({ kind: 'island', id: 'truong-sa' });
    expect(originMapSpot('1975')).toBeNull();
    expect(originMapSpot('Paris')).toBeNull();
    expect(originMapSpot(null)).toBeNull();
  });
});

describe('Chữ đợt B', () => {
  it('đủ 8 game có tên, thứ tự cố định (Đố Xanh trước, hai game mới ngay sau)', () => {
    expect(PLAYABLE_MINI_GAMES).toEqual(['daily_quiz', 'eco_merge', 'green_conveyor', 'sort', 'match', 'origin', 'basket', 'kitchen_swap']);
    expect(PLAYABLE_MINI_GAMES.map(miniGameTitle)).toEqual([
      'Đố Xanh Mỗi Ngày',
      'Ghép Mầm Xanh',
      'Băng Chuyền Xanh',
      'Đúng Thùng',
      'Ghép Cặp',
      'Đoán Xuất Xứ',
      'Giỏ Đúng Việc',
      'Căn Bếp Xanh',
    ]);
  });

  it('thanh tiến độ theo từng game', () => {
    expect(miniProgressLabel('origin', 0, 5)).toBe('Lượt 1/5');
    expect(miniProgressLabel('origin', 5, 5)).toBe('Lượt 5/5');
    expect(miniProgressLabel('match', 2, 6)).toBe('2/6 cặp');
    expect(miniProgressLabel('basket', 3, 3)).toBe('Đã chọn 3/3');
  });

  it('chữ ngắn nằm trong ngân sách độ dài', () => {
    for (const [key, max] of Object.entries(GAME_MINI_COPY_MAX)) {
      expect(GAME_MINI_COPY[key as GameMiniCopyKey].length, key).toBeLessThanOrEqual(max as number);
    }
  });
});
