import { PROD_REFILL_CATALOG_2026_11_18 as PROD } from '../../../../../../packages/app-core/src/commerce/prod-refill.fixture';
import { SystemConfigService } from '../../system-config/system-config.service';
import {
  REFILL_PAIRS_BLOCK_KEY,
  REFILL_PAIRS_OVERRIDE_KEY,
  applyRefillOverrideOps,
  checkRefillOverrides,
  isRefillProduct,
  refillBlockProblem,
  refillOverridesProblem,
  pairRefills,
  parseRefillBlock,
  parseRefillIds,
  parseRefillOverrides,
  refillAutoSizeOk,
  refillFormulaKey,
  refillPairRows,
  refillSizeLabel,
  REFILL_PAIRS_IDS_MAX,
  type RefillCatalogRow,
} from './refill-pairs';

const rows: RefillCatalogRow[] = PROD.map((p) => ({ id: p.slug, slug: p.slug, name: p.name, brand: p.brand }));
const nameOf = new Map(PROD.map((p) => [p.slug, p.name]));
const table = (pairs: Map<string, string>) =>
  [...pairs].map(([b, r]) => `${nameOf.get(b) ?? b} -> ${nameOf.get(r) ?? r}`).sort((a, b) => a.localeCompare(b, 'vi'));

/**
 * Bảng cặp trên ảnh chụp PROD 18/11/2026, đã rà tay 100% (cùng thương hiệu Fuwa3e, cùng công thức). Chỉ chai 3,8L tự ghép với can 10L
 * (2,6 lần); chai 100ml–2L lệch 5–100 lần nên chờ admin ghép tay (tubu-w6-01 P1-a). Đổi bảng này phải rà lại tay và chép sang báo cáo wave.
 */
const EXPECTED = [
  'Nước ngâm rửa thực phẩm Fuwa3e 3,8L -> Refill Nước ngâm rửa thực phẩm Fuwa3e 10L',
  'Nước rửa chén Fuwa3e 3,8L -> Refill Nước rửa chén Fuwa3e 10L',
  'Nước rửa tay dạng Bọt Fuwa3e 3,8L -> Refill Nước rửa tay dạng Bọt Fuwa3e 10L',
  'Nước rửa tay dạng Gel Fuwa3e 3,8L -> Refill Nước rửa tay dạng Gel Fuwa3e 10L',
].sort((a, b) => a.localeCompare(b, 'vi'));

/** Cùng công thức nhưng can 10L gấp hơn 3 lần chai: admin thấy trong bảng, trạng thái `size`, không tự đổi cho khách. */
const EXPECTED_SIZE = [
  'Gel rửa chén cho máy Fuwa3e 100ml -> Refill Gel rửa chén cho máy Fuwa3e 10L',
  'Gel rửa chén cho máy Fuwa3e 2000ml -> Refill Gel rửa chén cho máy Fuwa3e 10L',
  'Gel rửa chén cho máy Fuwa3e 500ml -> Refill Gel rửa chén cho máy Fuwa3e 10L',
  'Lau đa năng Fuwa3e 2L -> Refill Lau đa năng Fuwa3e 10L',
  'Nước lau sàn Sả chanh Fuwa3e 100ml -> Refill Nước lau sàn Sả chanh Fuwa3e 10L',
  'Nước lau sàn Sả chanh Fuwa3e 1L -> Refill Nước lau sàn Sả chanh Fuwa3e 10L',
  'Nước ngâm rửa thực phẩm Fuwa3e 100ml -> Refill Nước ngâm rửa thực phẩm Fuwa3e 10L',
  'Nước ngâm rửa thực phẩm Fuwa3e 1L -> Refill Nước ngâm rửa thực phẩm Fuwa3e 10L',
  'Nước rửa chén Fuwa3e 100ml -> Refill Nước rửa chén Fuwa3e 10L',
  'Nước rửa chén Fuwa3e 500ml -> Refill Nước rửa chén Fuwa3e 10L',
  'Nước rửa tay dạng Bọt Fuwa3e 300ml -> Refill Nước rửa tay dạng Bọt Fuwa3e 10L',
  'Nước rửa tay dạng Gel Fuwa3e 300ml -> Refill Nước rửa tay dạng Gel Fuwa3e 10L',
].sort((a, b) => a.localeCompare(b, 'vi'));

describe('pairRefills trên catalog PROD 18/11/2026', () => {
  it('đủ 111 dòng, 11 gói Refill', () => {
    expect(rows).toHaveLength(111);
    expect(rows.filter(isRefillProduct)).toHaveLength(11);
  });

  it('ra đúng bảng cặp đã rà tay, không cặp sai nào; không chai 100ml–2L nào tự ghép với can 10L', () => {
    expect(table(pairRefills(rows))).toEqual(EXPECTED);
  });

  it('bảng admin: chai lệch lượng hiện trạng thái size (chờ ghép tay), tự ghép hiện auto', () => {
    const all = refillPairRows(rows);
    const by = (status: string) => table(new Map(all.filter((r) => r.status === status).map((r) => [r.bottle.id, r.refill!.id])));
    expect(by('auto')).toEqual(EXPECTED);
    expect(by('size')).toEqual(EXPECTED_SIZE);
    expect(all.every((r) => ['auto', 'size', 'near'].includes(r.status))).toBe(true);
  });

  it('admin ghép tay chai 1L với can 10L thì khách mới thấy cặp đó', () => {
    const slug = PROD.find((p) => p.name === 'Nước rửa chén Fuwa3e 500ml')!.slug;
    const refill = PROD.find((p) => p.name === 'Refill Nước rửa chén Fuwa3e 10L')!.slug;
    expect(pairRefills(rows).has(slug)).toBe(false);
    expect(pairRefills(rows, { overrides: [{ bottleSlug: slug, refillSlug: refill }] }).get(slug)).toBe(refill);
  });

  it('mọi cặp: cùng thương hiệu, cùng tên công thức, chai không phải refill, gói kia là refill', () => {
    const brand = new Map(PROD.map((p) => [p.slug, p.brand]));
    for (const [b, r] of pairRefills(rows)) {
      expect(brand.get(b)).toBe(brand.get(r));
      expect(refillFormulaKey(nameOf.get(b)!)).toBe(refillFormulaKey(nameOf.get(r)!));
      expect(isRefillProduct({ slug: b, name: nameOf.get(b)! })).toBe(false);
      expect(isRefillProduct({ slug: r, name: nameOf.get(r)! })).toBe(true);
    }
  });

  it('tên lệch một chữ thì KHÔNG ghép (chờ admin ghép tay): "Nước giặt hương Bạc hà" khác "Refill nước giặt Bạc hà", "Nước lau đa năng" khác "Refill Lau đa năng"', () => {
    const pairs = pairRefills(rows);
    expect(pairs.has('nuoc-giat-huong-bac-ha-fuwa3e-500ml-751754')).toBe(false);
    expect(pairs.has('nuoc-giat-huong-cam-fuwa3e-3-5l-a0090c')).toBe(false);
    expect(pairs.has('nuoc-lau-da-nang-fuwa3e-500ml-cbb309')).toBe(false);
    expect(pairs.has('ve-sinh-nha-tam-va-toilet-fuwa3e-2l-4e8488')).toBe(false);
  });

  it('bảng admin: 7 chai chỉ lệch chữ "nước"/"hương" hiện trạng thái near kèm gói gợi ý (chờ ghép tay, không vào bảng khách); "Vệ sinh nhà tắm" không có gợi ý', () => {
    const near = refillPairRows(rows).filter((r) => r.status === 'near');
    expect(table(new Map(near.map((r) => [r.bottle.id, r.refill!.id])))).toEqual(
      [
        'Nước giặt hương Bạc hà Fuwa3e 100ml -> Refill nước giặt Bạc hà Fuwa3e 10L',
        'Nước giặt hương Bạc hà Fuwa3e 3,5L -> Refill nước giặt Bạc hà Fuwa3e 10L',
        'Nước giặt hương Bạc hà Fuwa3e 500ml -> Refill nước giặt Bạc hà Fuwa3e 10L',
        'Nước giặt hương Cam Fuwa3e 100ml -> Refill nước giặt Cam Fuwa3e 10L',
        'Nước giặt hương Cam Fuwa3e 3,5L -> Refill nước giặt Cam Fuwa3e 10L',
        'Nước giặt hương Cam Fuwa3e 500ml -> Refill nước giặt Cam Fuwa3e 10L',
        'Nước lau đa năng FUWA3E 500ml -> Refill Lau đa năng Fuwa3e 10L',
      ].sort((a, b) => a.localeCompare(b, 'vi')),
    );
    expect(near.every((r) => r.candidates === 0)).toBe(true);
    expect(refillPairRows(rows).some((r) => r.bottle.slug.startsWith('ve-sinh-nha-tam'))).toBe(false);
    for (const r of near) expect(pairRefills(rows).has(r.bottle.id)).toBe(false);
  });
});

describe('pairRefills: bẫy', () => {
  const r = (id: string, name: string, brand = 'Fuwa3e', extra: Partial<RefillCatalogRow> = {}): RefillCatalogRow => ({ id, slug: id, name, brand, ...extra });

  it('hai cỡ refill cùng công thức: không ghép (không đoán cỡ nào)', () => {
    const pairs = pairRefills([r('b', 'Nước rửa chén Fuwa3e 500ml'), r('refill-5', 'Refill Nước rửa chén Fuwa3e 5L'), r('refill-10', 'Refill Nước rửa chén Fuwa3e 10L')]);
    expect(pairs.size).toBe(0);
  });

  it('tên gần giống khác công thức: không ghép chéo', () => {
    const pairs = pairRefills([r('b', 'Nước lau sàn Sả chanh Fuwa3e 1L'), r('refill-que', 'Refill Nước lau sàn Quế Fuwa3e 10L')]);
    expect(pairs.size).toBe(0);
  });

  it('khác thương hiệu: không ghép', () => {
    expect(pairRefills([r('b', 'Nước rửa chén 500ml', 'Pineboo'), r('refill-x', 'Refill Nước rửa chén 10L', 'Fuwa3e')]).size).toBe(0);
  });

  it('chai đã ngừng bán không có trong danh mục công khai thì không có cặp', () => {
    expect(pairRefills([r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')]).size).toBe(0);
  });

  it('"chai" không nhỏ hơn gói refill, khác loại đơn vị, gói lớn quá 3 lần hay một bên không ghi lượng: không tự ghép', () => {
    expect(pairRefills([r('b', 'Nước rửa chén Fuwa3e 10L'), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')]).size).toBe(0);
    expect(pairRefills([r('b', 'Nước rửa chén Fuwa3e 2kg'), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')]).size).toBe(0);
    expect(pairRefills([r('b', 'Nước rửa chén Fuwa3e 1L'), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')]).size).toBe(0);
    expect(pairRefills([r('b', 'Nước rửa chén Fuwa3e'), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')]).size).toBe(0);
    expect(pairRefills([r('b', 'Nước rửa chén Fuwa3e 1L'), r('refill-x', 'Refill Nước rửa chén Fuwa3e')]).size).toBe(0);
  });

  it('luật lượng: lớn hơn chai và tối đa 3 lần (biên 3 lần vẫn ghép)', () => {
    expect(refillAutoSizeOk('Nước rửa chén 1L', 'Refill Nước rửa chén 3L')).toBe(true);
    expect(refillAutoSizeOk('Nước rửa chén 1L', 'Refill Nước rửa chén 3,1L')).toBe(false);
    expect(refillAutoSizeOk('Nước rửa chén 3,8L', 'Refill Nước rửa chén 10L')).toBe(true);
    expect(refillAutoSizeOk('Sữa tắm 500ml', 'Refill Sữa tắm 1L')).toBe(true);
    expect(refillAutoSizeOk('Nước rửa chén 100ml', 'Refill Nước rửa chén 10L')).toBe(false);
  });

  it('chữ bao bì (chai, bình, can, túi) không làm lệch tên công thức', () => {
    expect(pairRefills([r('b', 'Chai nước rửa chén Fuwa3e 3,8L'), r('refill-x', 'Refill Nước rửa chén Fuwa3e can 10L')]).get('b')).toBe('refill-x');
  });

  it('bảng admin: nhiều gói cùng công thức là ambiguous; chai bị chặn vẫn hiện (để bật lại), không vào bảng khách', () => {
    const amb = refillPairRows([r('b', 'Nước rửa chén Fuwa3e 3,8L'), r('refill-5', 'Refill Nước rửa chén Fuwa3e 5L'), r('refill-10', 'Refill Nước rửa chén Fuwa3e 10L')]);
    expect(amb).toEqual([expect.objectContaining({ status: 'ambiguous', refill: null, candidates: 2 })]);
    const base = [r('b', 'Nước rửa chén Fuwa3e 3,8L'), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')];
    const blocked = refillPairRows(base, { block: new Set(['b']) });
    expect(blocked).toEqual([expect.objectContaining({ status: 'blocked', refill: expect.objectContaining({ id: 'refill-x' }) })]);
    expect(pairRefills(base, { block: new Set(['b']) }).size).toBe(0);
  });

  it('combo không bao giờ là chai', () => {
    expect(pairRefills([r('b', 'Nước rửa chén Fuwa3e 500ml', 'Fuwa3e', { isCombo: true }), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')]).size).toBe(0);
  });

  it('ghi đè thắng luật tên; chặn bỏ cặp; ghi đè lấy refill làm chai hay slug không có thì bỏ qua', () => {
    const base = [
      r('b1', 'Nước giặt hương Bạc hà Fuwa3e 500ml'),
      r('refill-bh', 'Refill nước giặt Bạc hà Fuwa3e 10L'),
      r('b2', 'Nước rửa chén Fuwa3e 500ml'),
      r('refill-rc', 'Refill Nước rửa chén Fuwa3e 10L'),
    ];
    const pairs = pairRefills(base, {
      overrides: [
        { bottleSlug: 'b1', refillSlug: 'refill-bh' },
        { bottleSlug: 'refill-rc', refillSlug: 'refill-bh' },
        { bottleSlug: 'missing', refillSlug: 'refill-bh' },
      ],
      block: new Set(['refill-rc']),
    });
    expect([...pairs]).toEqual([['b1', 'refill-bh']]);
  });

  it('ghép tay vòng (A → B, B → A) hay chai → chai (đích không phải gói Refill): bỏ, không cặp nào', () => {
    const base = [r('a', 'Nước rửa chén Fuwa3e 500ml'), r('b', 'Nước rửa chén Fuwa3e 3,8L'), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')];
    const cyclic = { overrides: [{ bottleSlug: 'a', refillSlug: 'b' }, { bottleSlug: 'b', refillSlug: 'a' }] };
    expect(pairRefills(base, cyclic).get('a')).toBeUndefined();
    expect(pairRefills(base, cyclic).get('b')).toBe('refill-x');
    expect(refillPairRows(base, cyclic).some((row) => row.status === 'manual')).toBe(false);
  });

  it('ghép tay tự ghép chính nó (cùng slug) bị bỏ ở lúc đọc cấu hình', () => {
    const base = [r('a', 'Nước rửa chén Fuwa3e 500ml'), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L')];
    expect(pairRefills(base, { overrides: parseRefillOverrides([{ bottleSlug: 'a', refillSlug: 'a' }]) }).size).toBe(0);
  });

  it('near: chỉ một gói gợi ý; hai gói cùng họ tên thì không gợi ý; khác thương hiệu không gợi ý; đã ghép tay thì là manual', () => {
    const bottle = r('b', 'Nước giặt hương Bạc hà Fuwa3e 500ml');
    expect(refillPairRows([bottle, r('refill-bh', 'Refill nước giặt Bạc hà Fuwa3e 10L')])).toEqual([
      expect.objectContaining({ status: 'near', refill: expect.objectContaining({ id: 'refill-bh' }), candidates: 0 }),
    ]);
    expect(refillPairRows([bottle, r('refill-bh', 'Refill nước giặt Bạc hà Fuwa3e 10L'), r('refill-bh5', 'Refill giặt hương Bạc hà Fuwa3e 5L')])).toEqual([]);
    expect(refillPairRows([bottle, r('refill-bh', 'Refill nước giặt Bạc hà 10L', 'Pineboo')])).toEqual([]);
    const manual = refillPairRows([bottle, r('refill-bh', 'Refill nước giặt Bạc hà Fuwa3e 10L')], { overrides: [{ bottleSlug: 'b', refillSlug: 'refill-bh' }] });
    expect(manual).toEqual([expect.objectContaining({ status: 'manual' })]);
    expect(refillPairRows([bottle, r('refill-bh', 'Refill nước giặt Bạc hà Fuwa3e 10L')], { block: new Set(['refill-bh']) })).toEqual([]);
  });
});

describe('checkRefillOverrides (lưu ghép tay)', () => {
  const r = (id: string, name: string): RefillCatalogRow => ({ id, slug: id, name, brand: 'Fuwa3e' });
  const bySlug = new Map(
    [r('a', 'Nước rửa chén Fuwa3e 500ml'), r('b', 'Nước rửa chén Fuwa3e 3,8L'), r('refill-x', 'Refill Nước rửa chén Fuwa3e 10L'), r('refill-y', 'Refill Lau đa năng Fuwa3e 10L')].map((p) => [p.slug, p]),
  );

  it('hợp lệ: cắt khoảng trắng, giữ thứ tự', () => {
    expect(checkRefillOverrides([{ bottleSlug: ' a ', refillSlug: 'refill-x' }, { bottleSlug: 'b', refillSlug: 'refill-x' }], bySlug)).toEqual({
      ok: [
        { bottleSlug: 'a', refillSlug: 'refill-x' },
        { bottleSlug: 'b', refillSlug: 'refill-x' },
      ],
    });
  });

  it('tự ghép chính nó: báo hai sản phẩm phải khác nhau', () => {
    expect(checkRefillOverrides([{ bottleSlug: 'refill-x', refillSlug: ' refill-x' }], bySlug)).toEqual({ error: 'Chai và gói Refill phải là hai sản phẩm khác nhau.' });
    expect(checkRefillOverrides([{ bottleSlug: 'a', refillSlug: 'a' }], bySlug)).toEqual({ error: 'Chai và gói Refill phải là hai sản phẩm khác nhau.' });
  });

  it('vòng hay chuỗi: chai làm đích của cặp khác, gói Refill làm chai, chai → chai', () => {
    expect(checkRefillOverrides([{ bottleSlug: 'a', refillSlug: 'b' }, { bottleSlug: 'b', refillSlug: 'a' }], bySlug)).toEqual({
      error: '"Nước rửa chén Fuwa3e 3,8L" không phải gói Refill (tên hay slug phải bắt đầu bằng Refill).',
    });
    expect(checkRefillOverrides([{ bottleSlug: 'refill-x', refillSlug: 'refill-y' }], bySlug)).toEqual({ error: '"Refill Nước rửa chén Fuwa3e 10L" là gói Refill, không làm chai được.' });
  });

  it('slug không đang bán, một chai hai cặp', () => {
    expect(checkRefillOverrides([{ bottleSlug: 'khong-co', refillSlug: 'refill-x' }], bySlug)).toEqual({ error: 'Không có sản phẩm đang bán "khong-co".' });
    expect(checkRefillOverrides([{ bottleSlug: 'a', refillSlug: 'refill-x' }, { bottleSlug: 'a', refillSlug: 'refill-y' }], bySlug)).toEqual({
      error: '"Nước rửa chén Fuwa3e 500ml" đang có hai cặp ghép tay, giữ một.',
    });
  });

  it('cặp mới khác thương hiệu hay có slug đang chặn: báo lỗi (cùng luật với migration ghép 12 cặp)', () => {
    const pine = new Map([...bySlug, ['refill-pine', { id: 'refill-pine', slug: 'refill-pine', name: 'Refill Nước rửa chén Pineboo 5L', brand: 'Pineboo' }]]);
    expect(checkRefillOverrides([{ bottleSlug: 'a', refillSlug: 'refill-pine' }], pine)).toEqual({
      error: '"Nước rửa chén Fuwa3e 500ml" và "Refill Nước rửa chén Pineboo 5L" khác thương hiệu, không ghép được.',
    });
    expect(checkRefillOverrides([{ bottleSlug: 'a', refillSlug: 'refill-x' }], bySlug, { block: new Set(['refill-x']) })).toEqual({
      error: '"Refill Nước rửa chén Fuwa3e 10L" đang tắt ở thẻ Cặp Refill: bật lại trước khi ghép.',
    });
    expect(checkRefillOverrides([{ bottleSlug: 'a', refillSlug: 'refill-x' }], bySlug, { block: new Set(['a']) })).toEqual({
      error: '"Nước rửa chén Fuwa3e 500ml" đang tắt ở thẻ Cặp Refill: bật lại trước khi ghép.',
    });
  });

  it('cặp đã lưu mà sản phẩm nay ngừng bán hay đang chặn: giữ nguyên, không khoá lần lưu cặp mới', () => {
    const kept = [{ bottleSlug: 'chai-da-tat', refillSlug: 'refill-da-tat' }, { bottleSlug: 'b', refillSlug: 'refill-x' }];
    const next = [...kept, { bottleSlug: 'a', refillSlug: 'refill-x' }];
    expect(checkRefillOverrides(next, bySlug, { kept, block: new Set(['b']) })).toEqual({ ok: next });
    expect(checkRefillOverrides([{ bottleSlug: 'chai-da-tat', refillSlug: 'refill-y' }], bySlug, { kept })).toEqual({ error: 'Không có sản phẩm đang bán "chai-da-tat".' });
    expect(checkRefillOverrides([...kept, { bottleSlug: 'chai-da-tat', refillSlug: 'refill-da-tat' }], bySlug, { kept })).toEqual({
      error: '"chai-da-tat" đang có hai cặp ghép tay, giữ một.',
    });
  });
});

describe('applyRefillOverrideOps (thao tác ghép tay trên danh sách đang lưu)', () => {
  const stored = [
    { bottleSlug: 'x', refillSlug: 'refill-x' },
    { bottleSlug: 'a', refillSlug: 'refill-old' },
  ];
  it('add thay cặp cũ của cùng chai và nằm cuối; giữ mọi cặp khác', () => {
    expect(applyRefillOverrideOps(stored, { add: { bottleSlug: ' a ', refillSlug: ' refill-new ' } })).toEqual([
      { bottleSlug: 'x', refillSlug: 'refill-x' },
      { bottleSlug: 'a', refillSlug: 'refill-new' },
    ]);
    expect(applyRefillOverrideOps(stored, { add: { bottleSlug: 'b', refillSlug: 'refill-b' } })).toHaveLength(3);
  });
  it('remove chỉ bỏ cặp của chai đó; không có thao tác thì giữ nguyên', () => {
    expect(applyRefillOverrideOps(stored, { remove: 'a' })).toEqual([{ bottleSlug: 'x', refillSlug: 'refill-x' }]);
    expect(applyRefillOverrideOps(stored, { remove: 'khong-co' })).toEqual(stored);
    expect(applyRefillOverrideOps(stored, {})).toEqual(stored);
  });
});

describe('cấu hình và tham số', () => {
  it('parseRefillOverrides bỏ phần tử sai dạng, giữ phần tử đúng', () => {
    expect(parseRefillOverrides([{ bottleSlug: ' a ', refillSlug: 'b' }, { bottleSlug: 'a' }, 'x', null, { bottleSlug: 'c', refillSlug: 'c' }])).toEqual([
      { bottleSlug: 'a', refillSlug: 'b' },
    ]);
    expect(parseRefillOverrides('[]')).toEqual([]);
  });

  it('parseRefillBlock chỉ nhận mảng chuỗi', () => {
    expect([...parseRefillBlock(['a', ' b ', 1, ''])]).toEqual(['a', 'b']);
    expect(parseRefillBlock({}).size).toBe(0);
  });

  it('parseRefillIds bỏ rỗng, bỏ trùng, cắt ở trần', () => {
    expect(parseRefillIds(' a,,b,a ')).toEqual(['a', 'b']);
    expect(parseRefillIds(undefined)).toEqual([]);
    expect(parseRefillIds(Array.from({ length: 80 }, (_, i) => `id${i}`).join(','))).toHaveLength(REFILL_PAIRS_IDS_MAX);
  });

  it('refillSizeLabel đọc lượng từ tên', () => {
    expect(refillSizeLabel('Refill Nước rửa chén Fuwa3e 10L')).toBe('10L');
    expect(refillSizeLabel('Refill Nước rửa chén Fuwa3e')).toBeNull();
  });
});

describe('luật ghi cấu hình thô (tab Cấu hình) cho catalog.refill_pairs_*', () => {
  it('ghép tay: mảng đúng dạng thì nhận; sai dạng, tự ghép, một chai hai cặp, vòng/chuỗi thì báo', () => {
    expect(refillOverridesProblem([])).toBeNull();
    expect(refillOverridesProblem([{ bottleSlug: 'a', refillSlug: 'refill-x' }, { bottleSlug: 'b', refillSlug: 'refill-x' }])).toBeNull();
    expect(refillOverridesProblem({})).toBe('phải là mảng [{"bottleSlug":"<slug chai>","refillSlug":"<slug gói Refill>"}]');
    expect(refillOverridesProblem([{ bottleSlug: 'a' }])).toBe('mỗi phần tử cần bottleSlug và refillSlug là chuỗi khác rỗng');
    expect(refillOverridesProblem([{ bottleSlug: 'a', refillSlug: ' a ' }])).toBe('chai và gói Refill phải là hai sản phẩm khác nhau ("a")');
    expect(refillOverridesProblem([{ bottleSlug: 'a', refillSlug: 'refill-x' }, { bottleSlug: 'a', refillSlug: 'refill-y' }])).toBe('"a" có hai cặp, giữ một');
    expect(refillOverridesProblem([{ bottleSlug: 'a', refillSlug: 'b' }, { bottleSlug: 'b', refillSlug: 'a' }])).toBe('"a" vừa là chai vừa là gói Refill: không ghép vòng hay nối chuỗi');
    expect(refillOverridesProblem(Array.from({ length: 501 }, (_, i) => ({ bottleSlug: `b${i}`, refillSlug: `refill-${i}` })))).toBe('tối đa 500 cặp');
  });

  it('danh sách chặn: mảng chuỗi khác rỗng', () => {
    expect(refillBlockProblem([])).toBeNull();
    expect(refillBlockProblem(['a', 'b'])).toBeNull();
    expect(refillBlockProblem('a')).toBe('phải là mảng slug ["<slug>"]');
    expect(refillBlockProblem(['a', ''])).toBe('mỗi phần tử phải là slug (chuỗi khác rỗng)');
  });

  it('hai khoá có luật ghi ở SystemConfig', () => {
    expect(SystemConfigService.hasWriteRule(REFILL_PAIRS_OVERRIDE_KEY)).toBe(true);
    expect(SystemConfigService.hasWriteRule(REFILL_PAIRS_BLOCK_KEY)).toBe(true);
  });
});
