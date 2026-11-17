import { describe, expect, it, vi } from 'vitest';
import type { ProductCard } from '../api/catalog';
import { claimsIn } from '../commerce/copy-claims-guard';
import { productCardView } from '../commerce/product-card-view';
import { FORBIDDEN_TERMS, SHOP_COPY } from '../shop-copy';
import { SHOP_COPY_MAX } from '../shop-copy-budget';
import { ECO_COPY, fillEcoCopy, type EcoCopyKey } from './copy';
import { ecoCardBadge, ecoFactLines, ecoFactsFor, ecoGrams, readEcoFacts, type PublicEcoFact } from './facts';
import { getEcoPassport, parseEcoPassport, passportShareText, passportView, type EcoPassport } from './passport';
import { PASSPORT_COPY, PASSPORT_COPY_MAX, passportCopy, type PassportCopyKey } from './passport-copy';
import { ECO_WEB_COPY, ECO_WEB_COPY_MAX, ecoCompareCard, ecoCountCell, fillEcoWebCopy, hasEcoCounts, type EcoWebCopyKey } from './web-copy';

const fact = (over: Partial<PublicEcoFact> = {}): PublicEcoFact => ({
  kind: 'REFILL_PACK',
  variationId: null,
  valueGrams: null,
  label: null,
  baselineText: null,
  co2Grams: null,
  sourceUrl: 'https://www.pannature.org/bao-cao',
  ...over,
});

describe('ecoGrams: làm tròn 10 g, từ 1.000 g ra kg một chữ số', () => {
  it('gam', () => {
    expect(ecoGrams(124)).toBe('120 g');
    expect(ecoGrams(125)).toBe('130 g');
    expect(ecoGrams(3)).toBe('3 g');
    expect(ecoGrams(994)).toBe('990 g');
    expect(ecoGrams(124, true)).toBe('120g');
  });
  it('kg', () => {
    expect(ecoGrams(995)).toBe('990 g');
    expect(ecoGrams(999, true)).toBe('990g');
    expect(ecoGrams(1000)).toBe('1,0 kg');
    expect(ecoGrams(1240)).toBe('1,2 kg');
    expect(ecoGrams(12_340, true)).toBe('12,3kg');
  });
  it('không có số dương thì null', () => {
    for (const v of [0, -5, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(ecoGrams(v as number)).toBeNull();
  });
});

describe('ecoCardBadge: tối đa một nhãn, thứ tự Can refill > Giảm nhựa > Trả vỏ > giấy tờ', () => {
  it('ưu tiên theo loại, không theo thứ tự API gửi', () => {
    const all = [
      fact({ kind: 'CERTIFICATION', label: 'Ecocert' }),
      fact({ kind: 'RETURNABLE_PACKAGING' }),
      fact({ kind: 'PLASTIC_AVOIDED', valueGrams: 240 }),
      fact({ kind: 'REFILL_PACK' }),
    ];
    expect(ecoCardBadge(all)?.text).toBe('Can refill');
    expect(ecoCardBadge(all.slice(0, 3))?.text).toBe('Giảm ~240g nhựa');
    expect(ecoCardBadge(all.slice(0, 2))?.text).toBe('Trả vỏ đổi điểm');
    expect(ecoCardBadge(all.slice(0, 1))?.text).toBe('Ecocert');
  });
  it('Giảm nhựa không có số gam thì nhường nhãn sau; chữ đọc nói "khoảng" và "ước tính"', () => {
    expect(ecoCardBadge([fact({ kind: 'PLASTIC_AVOIDED', valueGrams: null }), fact({ kind: 'RETURNABLE_PACKAGING' })])?.text).toBe('Trả vỏ đổi điểm');
    expect(ecoCardBadge([fact({ kind: 'PLASTIC_AVOIDED', valueGrams: 1240 })])).toEqual({ text: 'Giảm ~1,2kg nhựa', spoken: 'Giảm khoảng 1,2 kg nhựa, ước tính' });
  });
  it('giấy tờ chữ dài hay vùng nguyên liệu không lên thẻ', () => {
    expect(ecoCardBadge([fact({ kind: 'CERTIFICATION', label: 'Chứng nhận của châu Âu' })])).toBeNull();
    expect(ecoCardBadge([fact({ kind: 'INGREDIENT_ORIGIN', label: 'Đà Lạt' })])).toBeNull();
  });
  it('dữ liệu lạ hay vắng (cờ tắt) thì không có nhãn', () => {
    for (const raw of [undefined, null, 'x', {}, [null, 1, { kind: 'OTHER' }]]) expect(ecoCardBadge(raw)).toBeNull();
    expect(readEcoFacts([{ kind: 'x' }, fact()])).toHaveLength(1);
  });
});

describe('productCardView: nhãn xanh dùng khe nhãn đầu tên, sau "Mới"', () => {
  const NOW = Date.parse('2026-11-18T05:00:00Z');
  const card = (over: Record<string, unknown> = {}): ProductCard =>
    ({ id: 'p1', slug: 'nuoc-giat-refill', brand: 'Fuwa3e', name: 'Nước giặt Refill 10L', thumbnail: null, basePrice: 450_000, salePrice: null, isFeatured: false, inStock: true, ...over }) as unknown as ProductCard;
  const view = (p: ProductCard) => productCardView({ product: p, variant: 'grid', now: NOW });
  const ECO = [{ kind: 'REFILL_PACK', valueGrams: null, label: null }];

  it('có sự thật thì nhãn eco, chữ đọc nằm trong phần đọc nhãn', () => {
    const v = view(card({ ecoFacts: ECO }));
    expect(v.label).toMatchObject({ kind: 'eco', text: 'Can refill' });
    expect(v.spoken.badges).toContain('Can refill');
  });
  it('"Mới" và nổi bật thắng nhãn xanh (một nhãn duy nhất)', () => {
    expect(view(card({ ecoFacts: ECO, createdAt: new Date(NOW - 86_400_000).toISOString() })).label?.kind).toBe('new');
    expect(view(card({ ecoFacts: ECO, isFeatured: true })).label?.kind).toBe('featured');
  });
  it('không có trường ecoFacts (cờ tắt) thì thẻ như cũ', () => {
    expect(view(card()).label).toBeNull();
  });
  it('hết hàng ẩn cả nhãn xanh', () => {
    expect(view(card({ inStock: false, ecoFacts: ECO })).label).toBeNull();
  });
});

describe('ecoFactLines: khối "Điểm cộng xanh"', () => {
  it('sự thật gắn phân loại chỉ áp cho đúng phân loại; cùng loại thì dòng phân loại thắng dòng cả sản phẩm', () => {
    const facts = [
      fact({ kind: 'PLASTIC_AVOIDED', valueGrams: 100, variationId: null }),
      fact({ kind: 'PLASTIC_AVOIDED', valueGrams: 1200, variationId: 'v10l', baselineText: 'so với 20 chai 500ml cùng loại' }),
      fact({ kind: 'REFILL_PACK', variationId: 'v10l' }),
    ];
    expect(ecoFactsFor(facts, 'v500').map((f) => f.valueGrams)).toEqual([100]);
    const lines = ecoFactLines(facts, 'v10l');
    expect(lines.map((l) => l.kind)).toEqual(['REFILL_PACK', 'PLASTIC_AVOIDED']);
    expect(lines[1]!.text).toBe('Giảm khoảng 1,2 kg nhựa mỗi món, so với 20 chai 500ml cùng loại (ước tính)');
    expect(ecoFactLines(facts, null).map((l) => l.kind)).toEqual(['PLASTIC_AVOIDED']);
  });
  it('tên miền nguồn bỏ www; nguồn không https hay thiếu chữ thì bỏ dòng; tối đa 4 dòng', () => {
    const lines = ecoFactLines(
      [
        fact({ kind: 'REFILL_PACK' }),
        fact({ kind: 'PLASTIC_AVOIDED', valueGrams: 50, sourceUrl: 'http://x.vn/a' }),
        fact({ kind: 'RETURNABLE_PACKAGING', sourceUrl: 'javascript:alert(1)' }),
        fact({ kind: 'CERTIFICATION', label: '  ' }),
        fact({ kind: 'INGREDIENT_ORIGIN', label: 'Bồ hòn Đà Lạt' }),
      ],
      null,
    );
    expect(lines.map((l) => [l.kind, l.sourceHost])).toEqual([
      ['REFILL_PACK', 'pannature.org'],
      ['INGREDIENT_ORIGIN', 'pannature.org'],
    ]);
    const five = (['REFILL_PACK', 'PLASTIC_AVOIDED', 'RETURNABLE_PACKAGING', 'CERTIFICATION', 'INGREDIENT_ORIGIN'] as const).map((kind) =>
      fact({ kind, valueGrams: 30, label: 'Ecocert' }),
    );
    expect(ecoFactLines(five, null)).toHaveLength(4);
  });
  it('không có sự thật (cờ tắt) thì rỗng: trang ẩn cả khối', () => {
    expect(ecoFactLines(undefined, 'v1')).toEqual([]);
  });
});

describe('thẻ so sánh và hàng bảng so sánh (web)', () => {
  it('cần Giảm nhựa có số gam và mốc; số chai lấy từ mốc', () => {
    const f = [fact({ kind: 'PLASTIC_AVOIDED', valueGrams: 1180, baselineText: 'so với 20 chai 500ml cùng loại' })];
    expect(ecoCompareCard(f, null)).toEqual({ saved: 'Bớt ~1,2 kg nhựa (ước tính)', baseline: 'So với 20 chai 500ml cùng loại', bottles: '≈ 20 chai' });
    expect(ecoCompareCard([fact({ kind: 'PLASTIC_AVOIDED', valueGrams: 300, baselineText: 'so với túi 1L' })], null)?.bottles).toBeNull();
    expect(ecoCompareCard([fact({ kind: 'PLASTIC_AVOIDED', valueGrams: 300 })], null)).toBeNull();
    expect(ecoCompareCard([fact({ kind: 'PLASTIC_AVOIDED', baselineText: 'so với 20 chai' })], null)).toBeNull();
  });
  it('ô đếm: số nguyên dương mới có chữ; hàng chỉ khi máy chủ gửi số đếm', () => {
    expect(ecoCountCell(2)).toBe('2 điểm cộng');
    for (const v of [0, -1, 1.5, '2', undefined]) expect(ecoCountCell(v)).toBeNull();
    expect(hasEcoCounts([{ ecoFactCount: 0 }, {}])).toBe(true);
    expect(hasEcoCounts([{}, null])).toBe(false);
  });
});

const PASSPORT: EcoPassport = {
  firstOrderAt: '2026-06-30T18:00:00.000Z',
  plasticAvoidedGrams: 2410,
  refillPacks: 3,
  wasteReturned: { requests: 2, grams: 4500, unitsWithoutWeight: 1 },
  trees: { pledged: 1, planted: 0 },
  co2Grams: null,
  monthly: [
    { month: '2026-06', actions: 0 },
    { month: '2026-07', actions: 2 },
    { month: '2026-08', actions: 0 },
    { month: '2026-09', actions: 4 },
    { month: '2026-10', actions: 1 },
    { month: '2026-11', actions: 0 },
  ],
  stamps: [
    { id: 'first_order', reached: true },
    { id: 'plastic_1kg', reached: true },
    { id: 'refill_5', reached: false },
    { id: 'waste_3', reached: false },
    { id: 'tree_1', reached: true },
  ],
};

describe('Hộ chiếu Xanh', () => {
  it('parse giữ đúng số, sắp mốc theo thứ tự cố định, body lạ thì ném', () => {
    const p = parseEcoPassport({ ...PASSPORT, stamps: [...PASSPORT.stamps].reverse(), extra: 1 });
    expect(p.stamps.map((s) => s.id)).toEqual(['first_order', 'plastic_1kg', 'refill_5', 'waste_3', 'tree_1']);
    expect(p.stamps.map((s) => s.reached)).toEqual([true, true, false, false, true]);
    expect(p).not.toHaveProperty('extra');
    for (const bad of [null, {}, { ...PASSPORT, refillPacks: -1 }, { ...PASSPORT, monthly: [{ month: '2026/11', actions: 1 }] }, { ...PASSPORT, co2Grams: 'x' }]) {
      expect(() => parseEcoPassport(bad)).toThrow();
    }
  });

  it('getEcoPassport gọi đúng đường', async () => {
    const http = { get: vi.fn().mockResolvedValue(PASSPORT) };
    await expect(getEcoPassport(http as never)).resolves.toMatchObject({ refillPacks: 3 });
    expect(http.get).toHaveBeenCalledWith('/me/eco-passport');
  });

  it('màn: ngày bắt đầu theo giờ VN, ô số chỉ cho số khác 0, CO₂ null thì không có ô', () => {
    const v = passportView(PASSPORT);
    expect(v.empty).toBe(false);
    expect(v.since).toBe('Bắt đầu từ 01/07/2026');
    expect(v.tiles.map((t) => [t.metric, t.value])).toEqual([
      ['plastic', '2,4 kg'],
      ['refill', '3'],
      ['waste', '2'],
      ['trees', '1'],
    ]);
    expect(v.tiles.find((t) => t.metric === 'waste')?.sub).toBe('4,5 kg rác đã nhận');
    expect(v.tiles.find((t) => t.metric === 'trees')?.sub).toBeNull();
    expect(v.none).toBeNull();
    expect(v.bars?.map((b) => [b.label, b.pct])).toEqual([
      ['T6', 0],
      ['T7', 50],
      ['T8', 0],
      ['T9', 100],
      ['T10', 25],
      ['T11', 0],
    ]);
    expect(v.how.at(-1)).toBe(passportCopy('how.note'));
    expect(v.how.some((h) => h.startsWith('CO₂'))).toBe(false);
  });

  it('CO₂ có số (kèm nguồn riêng) thì có ô và dòng cách tính', () => {
    const v = passportView({ ...PASSPORT, co2Grams: 800 });
    expect(v.tiles.at(-1)).toMatchObject({ metric: 'co2', value: '800 g' });
    expect(v.how.some((h) => h.startsWith('CO₂'))).toBe(true);
  });

  it('chỉ có một số: các chỉ số còn lại gộp "Chưa có"', () => {
    const v = passportView({ ...PASSPORT, plasticAvoidedGrams: 0, refillPacks: 0, wasteReturned: { requests: 0, grams: 0, unitsWithoutWeight: 0 }, trees: { pledged: 1, planted: 1 } });
    expect(v.tiles.map((t) => t.metric)).toEqual(['trees']);
    expect(v.tiles[0]!.sub).toBe('Đã trồng 1');
    expect(v.none).toBe('Chưa có: nhựa giảm, can refill, Đổi rác');
  });

  it('khách chưa có đơn giao và chưa có số: rỗng; 6 tháng đều 0 thì không vẽ biểu đồ', () => {
    const empty: EcoPassport = {
      ...PASSPORT,
      firstOrderAt: null,
      plasticAvoidedGrams: 0,
      refillPacks: 0,
      wasteReturned: { requests: 0, grams: 0, unitsWithoutWeight: 0 },
      trees: { pledged: 0, planted: 0 },
      monthly: PASSPORT.monthly.map((m) => ({ ...m, actions: 0 })),
    };
    const v = passportView(empty);
    expect(v.empty).toBe(true);
    expect(v.bars).toBeNull();
    expect(v.none).toBeNull();
    expect(passportShareText(empty)).toBeNull();
  });

  it('câu chia sẻ chỉ từ số thật, không tên hay số điện thoại', () => {
    expect(passportShareText(PASSPORT)).toBe('Hộ chiếu Xanh của mình: 2,4 kg nhựa giảm (ước tính), 3 can refill, 2 lần Đổi rác, 1 cây đã cam kết.');
  });
});

describe('chữ xanh: thuật ngữ cấm, bộ chặn tuyên bố, ngân sách độ dài', () => {
  // Giá trị xấu nhất: số gam lớn nhất `ecoGrams` có thể in cho một khách, ngày 2 chữ số, đếm 4 chữ số.
  const worst: Record<string, string> = {
    g: '1000,0 kg',
    base: 'so với 20 chai 500ml cùng loại',
    host: 'pannature.org',
    n: '9999',
    w: '1000,0 kg',
    d: '30/12/2026',
    m: '12',
    list: 'nhựa giảm, can refill, Đổi rác, cây',
    parts: '1,2 kg nhựa giảm (ước tính)',
  };
  const tables: [string, Record<string, string>, (k: string) => string, Record<string, number | null>][] = [
    // Ngân sách của ECO_COPY nằm ở `shop-copy.spec.ts` (`SHOP_COPY_MAX`, giá trị xấu nhất theo khoá), nên ở đây chỉ chạy luật chữ.
    ['ECO_COPY', ECO_COPY, (k) => fillEcoCopy(k as EcoCopyKey, worst), {}],
    ['PASSPORT_COPY', PASSPORT_COPY, (k) => passportCopy(k as PassportCopyKey, worst), PASSPORT_COPY_MAX],
    ['ECO_WEB_COPY', ECO_WEB_COPY, (k) => fillEcoWebCopy(k as EcoWebCopyKey, worst), ECO_WEB_COPY_MAX],
  ];

  for (const [name, table, fill, max] of tables) {
    it(`${name}: không thuật ngữ cấm, không tuyên bố y tế/tự nhiên/chứng nhận, không nhắc tre, không vượt ngân sách`, () => {
      for (const key of Object.keys(table)) {
        const text = fill(key);
        for (const { pattern, use } of FORBIDDEN_TERMS) expect(text, `${key}: dùng "${use}"`).not.toMatch(pattern);
        expect(claimsIn(text), key).toEqual([]);
        expect(text.toLowerCase(), key).not.toMatch(/(^|[^\p{L}])tre([^\p{L}]|$)|bamboo/u);
        const cap = max[key];
        if (cap) expect(text.length, key).toBeLessThanOrEqual(cap);
      }
    });
  }

  it('ECO_COPY nằm trong SHOP_COPY và mọi khoá có dòng ngân sách', () => {
    for (const key of Object.keys(ECO_COPY)) {
      expect((SHOP_COPY as Record<string, string>)[key]).toBe(ECO_COPY[key as EcoCopyKey]);
      expect(key in SHOP_COPY_MAX, key).toBe(true);
    }
  });

  it('câu có số luôn kèm "~", "khoảng" hay "ước tính"', () => {
    for (const key of ['eco.badgePlastic', 'eco.badgePlasticSpoken', 'eco.plastic', 'eco.plasticVs'] as const) expect(ECO_COPY[key]).toMatch(/~|khoảng|ước tính/);
    for (const key of ['tile.plastic', 'tile.co2', 'part.plastic'] as const) expect(PASSPORT_COPY[key]).toContain('ước tính');
    expect(ECO_WEB_COPY.cmpSaved).toContain('ước tính');
  });
});
