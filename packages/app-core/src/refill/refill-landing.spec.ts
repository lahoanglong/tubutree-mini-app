import { describe, expect, it, vi } from 'vitest';
import type { RefillOfferDTO } from './refill-api';
import {
  REFILL_LANDING_COPY,
  REFILL_LANDING_COPY_MAX,
  REFILL_LANDING_PATH,
  fetchRefillLanding,
  refillLandingBestPct,
  refillLandingBottleCaption,
  refillLandingCopy,
  refillLandingFaq,
  refillLandingIntro,
  refillLandingItems,
  refillLandingQuery,
  refillLandingRows,
  refillOrderShortcut,
  type RefillLandingCopyKey,
  type RefillLandingDTO,
  type RefillLandingPairDTO,
} from './refill-landing';
import { pdpRefillOffer } from './refill-saving';
import routeMap from '../route-map.json';

const offer = (over: Partial<RefillOfferDTO> = {}): RefillOfferDTO => ({
  productId: 'p-refill',
  slug: 'refill-nuoc-rua-chen-fuwa3e-10l',
  name: 'Refill Nước rửa chén Fuwa3e 10L',
  thumbnail: null,
  variationId: 'v-refill',
  price: 890_000,
  compareAt: null,
  sizeLabel: '10L',
  inStock: true,
  tubu: true,
  ...over,
});

const pair = (bottle: { id: string; slug: string; name: string; price: number }, refill: Partial<RefillOfferDTO> = {}, savingPct: number | null = null): RefillLandingPairDTO => ({
  bottle: { productId: bottle.id, slug: bottle.slug, name: bottle.name, thumbnail: null, price: bottle.price, compareAt: null, sizeLabel: null, inStock: true },
  refill: offer(refill),
  savingPct,
});

const SMALL = { id: 'b-500', slug: 'nuoc-rua-chen-500ml', name: 'Nước rửa chén Fuwa3e 500ml', price: 68_000 };
const BIG = { id: 'b-38', slug: 'nuoc-rua-chen-3-8l', name: 'Nước rửa chén Fuwa3e 3,8L', price: 129_000 };
const MID = { id: 'b-1l', slug: 'nuoc-rua-chen-1l', name: 'Nước rửa chén Fuwa3e 1L', price: 120_000 };
const SOAP = { id: 'b-soap', slug: 'sua-tam-1l', name: 'Sữa tắm 1L', price: 150_000 };
const SOAP_REFILL = { productId: 'p-soap', slug: 'refill-sua-tam-2l', name: 'Refill Sữa tắm 2L', sizeLabel: '2L', price: 200_000, variationId: 'v-soap' };

describe('refillLandingRows (trang Tiết kiệm với Refill)', () => {
  it('mỗi cặp một hàng, thẻ cùng số với trang chi tiết chai (pdpRefillOffer), giữ thứ tự máy chủ', () => {
    const dto: RefillLandingDTO = { enabled: true, pairs: [pair(SMALL, {}, 34), pair(SOAP, SOAP_REFILL, 33)] };
    const rows = refillLandingRows(dto);
    expect(rows.map((r) => r.key)).toEqual(['b-500:p-refill', 'b-soap:p-soap']);
    expect(rows[0]).toEqual({ key: 'b-500:p-refill', bottle: { slug: SMALL.slug, name: SMALL.name }, bottles: [{ slug: SMALL.slug, name: SMALL.name }], view: pdpRefillOffer(SMALL, offer()) });
    expect(rows[0]!.view.title).toBe('Chọn túi Refill 10L tiết kiệm 470.000đ (~34%)');
    expect(rows[1]!.view.variationId).toBe('v-soap');
  });

  it('trang chỉ liệt kê gói có số rẻ hơn: gói đắt hơn hay không so được thì không có hàng (trang nói "rẻ hơn")', () => {
    // 3,8L 129.000đ: 10L bằng chai là 339.473đ, gói 890.000đ đắt hơn → thẻ không có số, không lên trang.
    expect(refillLandingRows({ enabled: true, pairs: [pair(BIG)] })).toEqual([]);
    expect(refillLandingRows({ enabled: true, pairs: [pair(SOAP, { ...SOAP_REFILL, name: 'Refill Sữa tắm', sizeLabel: null })] })).toEqual([]);
    expect(refillLandingRows({ enabled: true, pairs: [pair(BIG), pair(SMALL)] }).map((r) => r.key)).toEqual(['b-500:p-refill']);
  });

  it('một gói thay nhiều chai: một hàng, một nút "+ Thêm"; chú thích nêu mọi chai, số theo chai đầu (máy chủ xếp); cặp trùng thì một lần', () => {
    const rows = refillLandingRows({ enabled: true, pairs: [pair(SMALL), pair(MID), pair(SMALL), pair(BIG)] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe('b-500:p-refill');
    expect(rows[0]!.bottles).toEqual([
      { slug: SMALL.slug, name: SMALL.name },
      { slug: MID.slug, name: MID.name },
    ]);
    expect(rows[0]!.view).toEqual(pdpRefillOffer(SMALL, offer()));
    expect(refillLandingBottleCaption(rows[0]!)).toBe('Thay cho Nước rửa chén Fuwa3e 500ml, Nước rửa chén Fuwa3e 1L');
  });

  it('gói hết hàng không có hàng; cờ tắt, chưa tải, dữ liệu hỏng: rỗng', () => {
    expect(refillLandingRows({ enabled: true, pairs: [pair(SMALL, { inStock: false })] })).toEqual([]);
    expect(refillLandingRows({ enabled: false, pairs: [pair(SMALL)] })).toEqual([]);
    expect(refillLandingRows(undefined)).toEqual([]);
    expect(refillLandingRows(null)).toEqual([]);
    expect(refillLandingRows({ enabled: true, pairs: 'x' } as never)).toEqual([]);
    expect(refillLandingRows({ enabled: true, pairs: [null, { bottle: null }] } as never)).toEqual([]);
  });
});

describe('câu mở đầu, ItemList, FAQ', () => {
  it('"tới X%" lấy mức cao nhất khách đọc trên thẻ; không thẻ nào so được thì câu không số', () => {
    const rows = refillLandingRows({ enabled: true, pairs: [pair(BIG), pair(SMALL)] });
    expect(refillLandingBestPct(rows)).toBe(34);
    expect(refillLandingIntro(rows)).toBe('Đã có chai? Túi, can Refill rẻ hơn mua chai mới cùng lượng tới 34% và bớt một vỏ nhựa.');
    expect(refillLandingIntro(refillLandingRows({ enabled: true, pairs: [pair(BIG)] }))).toBe(REFILL_LANDING_COPY.intro);
    expect(refillLandingBestPct([])).toBeNull();
  });

  it('ItemList: mỗi gói Refill một lần dù thay nhiều chai', () => {
    const rows = refillLandingRows({ enabled: true, pairs: [pair(SMALL), pair(BIG)] });
    expect(refillLandingItems(rows)).toEqual([{ slug: 'refill-nuoc-rua-chen-fuwa3e-10l', name: 'Refill Nước rửa chén Fuwa3e 10L' }]);
  });

  it('FAQ: ba câu hỏi kết thúc bằng dấu hỏi, mỗi câu có trả lời', () => {
    const faq = refillLandingFaq();
    expect(faq).toHaveLength(3);
    for (const f of faq) {
      expect(f.q).toMatch(/\?$/);
      expect(f.a.length).toBeGreaterThan(20);
    }
  });
});

describe('refillOrderShortcut (thẻ Refill ở chi tiết đơn đã giao)', () => {
  const dto: RefillLandingDTO = { enabled: true, pairs: [pair(SMALL), pair(MID), pair(BIG), pair(SOAP, SOAP_REFILL)] };

  it('cặp đầu tiên (thứ tự trang) mà chai có trong đơn, số so với ĐÚNG chai đó', () => {
    expect(refillOrderShortcut(dto, ['sua-tam-1l', null])?.key).toBe('b-soap:p-soap');
    expect(refillOrderShortcut(dto, ['sua-tam-1l', 'nuoc-rua-chen-500ml'])?.key).toBe('b-500:p-refill');
    const mid = refillOrderShortcut(dto, ['nuoc-rua-chen-1l']);
    expect(mid?.key).toBe('b-1l:p-refill');
    expect(mid?.view).toEqual(pdpRefillOffer(MID, offer()));
    expect(mid?.view.comparison?.savedPct).toBe(25);
  });

  it('gói không rẻ hơn chai trong đơn, gói đã có trong đơn, đơn không có chai ghép cặp hay dòng thiếu slug, cờ tắt: không có thẻ', () => {
    expect(refillOrderShortcut(dto, ['nuoc-rua-chen-3-8l'])).toBeNull();
    expect(refillOrderShortcut(dto, ['nuoc-rua-chen-500ml', 'refill-nuoc-rua-chen-fuwa3e-10l'])).toBeNull();
    expect(refillOrderShortcut(dto, ['khac'])).toBeNull();
    expect(refillOrderShortcut(dto, [null, undefined, ''])).toBeNull();
    expect(refillOrderShortcut({ enabled: false, pairs: dto.pairs }, ['nuoc-rua-chen-500ml'])).toBeNull();
    expect(refillOrderShortcut(undefined, ['nuoc-rua-chen-500ml'])).toBeNull();
  });
});

describe('truy vấn và đường dẫn', () => {
  it('GET /catalog/refill-pairs/landing ẩn danh (cache công khai), khoá chung', async () => {
    const get = vi.fn().mockResolvedValue({ enabled: false, pairs: [] });
    await fetchRefillLanding({ get } as never);
    expect(get).toHaveBeenCalledWith('/catalog/refill-pairs/landing', { anonymous: true });
    expect(refillLandingQuery({ get } as never).queryKey).toEqual(['refill-pairs', 'landing']);
  });

  it('đường dẫn trang khớp dòng route-map (Mini /refill-deals ↔ web /tiet-kiem-refill, công khai)', () => {
    const items = (routeMap as { routes: { items: { miniapp: string; web?: string; private?: boolean }[] }[] }).routes.flatMap((l) => l.items);
    expect(items.find((i) => i.miniapp === REFILL_LANDING_PATH.miniapp)).toEqual({ miniapp: '/refill-deals', web: '/tiet-kiem-refill', private: false });
  });
});

describe('chữ', () => {
  it('trần độ dài sau khi điền số xấu nhất', () => {
    const vars = { pct: 99, n: 99, name: 'x' };
    for (const key of Object.keys(REFILL_LANDING_COPY) as RefillLandingCopyKey[]) {
      const max = REFILL_LANDING_COPY_MAX[key];
      if (max !== null) expect(refillLandingCopy(key, vars).length, key).toBeLessThanOrEqual(max);
    }
  });
});
