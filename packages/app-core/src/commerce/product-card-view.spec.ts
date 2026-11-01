import { describe, expect, it } from 'vitest';
import type { ProductCard } from '../api/catalog';
import { cardPricing, type FlashPriceItem } from '../flash-price';
import { pickCardFlash, productCardView, type CardVariant, type ProductCardInput } from './product-card-view';

const NOW = Date.parse('2026-11-01T05:00:00Z');
const H = 3_600_000;
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const product = (over: Partial<ProductCard> = {}): ProductCard => ({
  id: 'p1',
  slug: 'sua-tam',
  brand: 'Tubu',
  name: 'Sữa tắm lá bạc hà',
  thumbnail: null,
  basePrice: 52_000,
  salePrice: null,
  isFeatured: false,
  inStock: true,
  ...over,
});

const flash = (over: Partial<FlashPriceItem> = {}): FlashPriceItem => ({
  productSlug: 'sua-tam',
  variationId: 'v1',
  flashPrice: 39_000,
  endAt: iso(NOW + H),
  ...over,
});

const view = (over: Partial<ProductCardInput> = {}) => productCardView({ product: product(), variant: 'grid', now: NOW, ...over });

describe('giá và Giờ vàng', () => {
  it('Giờ vàng đang chạy thắng: giá Giờ vàng, gạch giá bán, nhãn flash trên ảnh', () => {
    const v = view({ flash: flash() });
    expect(v).toMatchObject({ price: 39_000, compareAt: 52_000, discountPct: 25, isFlash: true, isDeal: true });
    expect(v.imageBadge).toEqual({ kind: 'flash', text: 'Giờ vàng -25%', short: '-25%', spoken: 'Giờ vàng giảm 25%' });
    expect(v.spoken.price).toBe('Giá Giờ vàng 39.000đ, giá gốc 52.000đ');
  });

  it('hết giờ khi khách đang xem (now > endAt) trả về giá thường, không nhãn Giờ vàng', () => {
    const v = view({ flash: flash({ endAt: iso(NOW - 1000) }) });
    expect(v).toMatchObject({ price: 52_000, compareAt: null, discountPct: 0, isFlash: false, isDeal: false });
    expect(v.imageBadge).toBeNull();
    expect(v.spoken.price).toBe('Giá 52.000đ');
  });

  it('đúng giây hết giờ (now === endAt) cũng là giá thường', () => {
    expect(view({ flash: flash({ endAt: iso(NOW) }) }).isFlash).toBe(false);
  });

  it('hết giờ mà sản phẩm đang giảm giá thường thì nhãn là -x%, không phải Giờ vàng', () => {
    const v = view({ product: product({ salePrice: 45_000 }), flash: flash({ endAt: iso(NOW - 1) }) });
    expect(v.isFlash).toBe(false);
    expect(v.price).toBe(45_000);
    expect(v.imageBadge).toEqual({ kind: 'discount', text: '-13%', spoken: 'Giảm 13%' });
  });

  it('Giờ vàng của sản phẩm khác hoặc không rẻ hơn giá bán bị bỏ qua', () => {
    expect(view({ flash: flash({ productSlug: 'khac' }) }).isFlash).toBe(false);
    expect(view({ flash: flash({ flashPrice: 52_000 }) }).isFlash).toBe(false);
    expect(view({ flash: null }).isFlash).toBe(false);
  });

  it('giảm giá thường: gạch giá niêm yết, nhãn -x%', () => {
    const v = view({ product: product({ salePrice: 39_000 }) });
    expect(v).toMatchObject({ price: 39_000, compareAt: 52_000, discountPct: 25, isFlash: false, isDeal: true });
    expect(v.imageBadge).toEqual({ kind: 'discount', text: '-25%', spoken: 'Giảm 25%' });
    expect(v.spoken.price).toBe('Giá 39.000đ, giá gốc 52.000đ');
  });

  it('không giảm: giá thường, không gạch, không nhãn', () => {
    const v = view();
    expect(v).toMatchObject({ price: 52_000, compareAt: null, discountPct: 0, isDeal: false, imageBadge: null });
  });
});

describe('hết hàng', () => {
  it('ẩn mọi nhãn nhưng giữ giá và hạng', () => {
    const v = view({
      product: product({ inStock: false, salePrice: 39_000, isFeatured: true, isLoved: true }),
      flash: flash(),
      inCombo: true,
      rank: 3,
    });
    expect(v.label).toBeNull();
    expect(v.imageBadge).toBeNull();
    expect(v.stock).toBe('out');
    expect(v.stockText).toBe('Tạm hết hàng');
    expect(v.spoken.stock).toBe('Tạm hết hàng');
    expect(v.rank).toBe(3);
    expect(v.price).toBe(39_000);
  });

  it('còn hàng: stock in, không chữ', () => {
    const v = view();
    expect(v.stock).toBe('in');
    expect(v.stockText).toBeNull();
    expect(v.spoken.stock).toBeNull();
  });
});

describe('nhãn đứng đầu tên', () => {
  const tubu = { kind: 'TUBU' as const, name: 'Tubu', shippingFee: null, freeShipFrom: null };
  // Mỗi dòng bật thêm điều kiện của nhãn đứng sau; nhãn đứng đầu danh sách thắng.
  const labelOf = (p: Partial<ProductCard>, extra: Partial<ProductCardInput> = {}) =>
    view({ product: product({ basePrice: 300_000, ...p }), freeShipThreshold: 199_000, ...extra }).label;
  const FREESHIP = { fulfiller: tubu };
  const NEW = { createdAt: iso(NOW - D) };

  it('ưu tiên combo > Tubu chọn > Được yêu thích > Mới > Miễn phí giao hàng', () => {
    expect(labelOf({ isFeatured: true, isLoved: true, ...NEW, ...FREESHIP }, { inCombo: true })).toEqual({ kind: 'combo', text: 'Có combo', spoken: 'Có combo' });
    expect(labelOf({ isFeatured: true, isLoved: true, ...NEW, ...FREESHIP })).toEqual({ kind: 'featured', text: 'Tubu chọn', spoken: 'Tubu chọn' });
    expect(labelOf({ isLoved: true, ...NEW, ...FREESHIP })).toEqual({ kind: 'loved', text: 'Được yêu thích', spoken: 'Được yêu thích' });
    expect(labelOf({ ...NEW, ...FREESHIP })).toEqual({ kind: 'new', text: 'Mới', spoken: 'Mới' });
    expect(labelOf({ ...FREESHIP })).toEqual({ kind: 'freeship', text: 'Miễn phí giao hàng', spoken: 'Miễn phí giao hàng' });
    expect(labelOf({})).toBeNull();
  });

  it('Miễn phí giao hàng chỉ khi Tubu giao và giá hiển thị đạt ngưỡng', () => {
    const free = (p: Partial<ProductCard>, threshold: number | null | undefined) =>
      view({ product: product({ basePrice: 200_000, ...p }), freeShipThreshold: threshold }).label?.kind === 'freeship';
    expect(free({ fulfiller: tubu }, 199_000)).toBe(true);
    expect(free({ fulfiller: tubu }, 200_000)).toBe(true);
    expect(free({ fulfiller: tubu }, 200_001)).toBe(false);
    expect(free({ fulfiller: tubu }, null)).toBe(false);
    expect(free({ fulfiller: tubu }, undefined)).toBe(false);
    expect(free({}, 100_000)).toBe(false);
    expect(free({ fulfiller: { ...tubu, kind: 'MERCHANT' } }, 100_000)).toBe(false);
  });

  it('"Mới" theo 30 ngày, và theo catalog.launch_date khi có', () => {
    expect(view({ product: product({ createdAt: iso(NOW - D) }) }).label?.kind).toBe('new');
    expect(view({ product: product({ createdAt: iso(NOW - 40 * D) }) }).label).toBeNull();
    const created = iso(Date.parse('2026-10-25T00:00:00Z'));
    expect(view({ product: product({ createdAt: created }), launchDate: '2026-10-30' }).label).toBeNull();
    expect(view({ product: product({ createdAt: created }), launchDate: '2026-10-20' }).label?.kind).toBe('new');
  });
});

describe('khe nhãn theo biến thể', () => {
  const rich = (variant: CardVariant, withFlash = true) =>
    view({ product: product({ isFeatured: true }), variant, flash: withFlash ? flash() : null, showBrand: true });

  it('grid và rail-md có nhãn ảnh, nhãn đầu tên và dòng thương hiệu', () => {
    for (const variant of ['grid', 'rail-md'] as const) {
      const v = rich(variant);
      expect(v.imageBadge?.kind, variant).toBe('flash');
      expect(v.label?.kind, variant).toBe('featured');
      expect(v.brandLine, variant).toBe('Tubu');
    }
  });

  it('rail-sm không nhãn, không thương hiệu; giá vẫn là giá Giờ vàng', () => {
    const v = rich('rail-sm');
    expect(v.imageBadge).toBeNull();
    expect(v.label).toBeNull();
    expect(v.brandLine).toBeNull();
    expect(v.isFlash).toBe(true);
  });

  it('flash chỉ có nhãn ảnh và chỉ khi đang Giờ vàng, chữ rút gọn "-x%"', () => {
    expect(rich('flash').imageBadge).toEqual({ kind: 'flash', text: '-25%', spoken: 'Giờ vàng giảm 25%' });
    expect(rich('flash').label).toBeNull();
    expect(view({ product: product({ salePrice: 39_000 }), variant: 'flash' }).imageBadge).toBeNull();
  });

  it('nhãn Giờ vàng ở thẻ có tim (grid, rail-md, rank) kèm bản rút gọn "-x%" để thẻ hẹp không bị tim đè; nhãn giảm giá thì không cần', () => {
    for (const variant of ['grid', 'rail-md', 'rank'] as const) {
      expect(rich(variant).imageBadge, variant).toMatchObject({ kind: 'flash', text: 'Giờ vàng -25%', short: '-25%' });
    }
    expect(view({ product: product({ salePrice: 39_000 }) }).imageBadge).not.toHaveProperty('short');
    expect(rich('flash').imageBadge).not.toHaveProperty('short');
  });

  it('metaCompact (bản gọn cho thẻ hẹp) có ở mọi biến thể, meta và bản đọc giữ nguyên bản đầy đủ', () => {
    for (const variant of ['grid', 'rail-sm', 'rail-md', 'flash', 'rank', 'line'] as const) {
      const v = view({ product: product({ ratingAvg: 4.8, sold: 1234 }), variant });
      expect(v.metaCompact, variant).toBe('Đã bán 1,2k+');
      expect(v.meta, variant).toBe('★ 4,8 · Đã bán 1,2k+');
      expect(v.spoken.meta, variant).toBe('4,8 sao, đã bán hơn 1.200');
    }
    const bare = view({ product: product({ ratingAvg: undefined, sold: undefined }) });
    expect(bare.meta).toBeNull();
    expect(bare.metaCompact).toBeNull();
  });

  it('rank có nhãn ảnh, không nhãn đầu tên; line không nhãn nào', () => {
    expect(rich('rank').imageBadge?.kind).toBe('flash');
    expect(rich('rank').label).toBeNull();
    expect(rich('line').imageBadge).toBeNull();
    expect(rich('line').label).toBeNull();
  });

  it('trang thương hiệu truyền showBrand=false thì không in tên thương hiệu', () => {
    expect(view({ showBrand: false }).brandLine).toBeNull();
  });

  it('ẩn dòng thương hiệu khi tên đã chứa thương hiệu (không dấu, không phân biệt hoa thường), khe vẫn giữ chỗ', () => {
    const named = (name: string, brand: string) => view({ product: product({ name, brand }) });
    const dup = named('Nước rửa chén sinh học Fuwa3e', 'Fuwa3e');
    expect(dup.brandLine).toBeNull();
    expect(dup.brandSlot).toBe(true);
    expect(named('Dầu xả bồ kết Pơ Lang', 'PO LANG').brandLine).toBeNull();
    expect(named('Băng vệ sinh Moc An', 'Mộc An').brandLine).toBeNull();
    expect(named('Nước rửa chén sinh học', 'Fuwa3e').brandLine).toBe('Fuwa3e');
    expect(named('Nước rửa chén sinh học', 'Fuwa3e').brandSlot).toBe(true);
  });

  it('chỉ ẩn khi khớp nguyên từ; thương hiệu có ký tự đặc biệt không làm khớp nổ', () => {
    const named = (name: string, brand: string) => view({ product: product({ name, brand }) }).brandLine;
    expect(named('Tubutree xà phòng', 'Tubu')).toBe('Tubu');
    expect(named('Sữa A+ 900g', 'A+')).toBeNull();
    expect(named('Sữa AA 900g', 'A+')).toBe('A+');
    expect(named("Kem L'Occitane 50ml", "L'Occitane")).toBeNull();
    expect(named('Sữa tắm lá bạc hà', '   ')).toBe('   ');
  });

  it('dữ liệu thiếu thương hiệu hoặc tên (xem trước gian hàng CTV, API cũ) không làm thẻ ném lỗi: dòng thương hiệu giữ nguyên giá trị nhận được', () => {
    const bare = (over: Record<string, unknown>) => view({ product: { ...product(), ...over } as unknown as ProductCard });
    expect(() => bare({ brand: undefined })).not.toThrow();
    expect(bare({ brand: undefined }).brandLine).toBeUndefined();
    expect(bare({ brand: null }).brandLine).toBeNull();
    expect(() => bare({ name: undefined })).not.toThrow();
    expect(bare({ name: undefined }).brandLine).toBe('Tubu');
  });

  it('showBrand=false và biến thể không có khe thì không giữ khe', () => {
    expect(view({ showBrand: false }).brandSlot).toBe(false);
    expect(view({ variant: 'rail-sm' }).brandSlot).toBe(false);
    expect(view({ variant: 'rail-md' }).brandSlot).toBe(true);
  });
});

describe('phần còn lại của view', () => {
  it('chuyển id, slug, tên, hạng và dòng meta', () => {
    const v = view({ product: product({ ratingAvg: 4.8, sold: 1234 }), rank: 2 });
    expect(v).toMatchObject({ id: 'p1', slug: 'sua-tam', name: 'Sữa tắm lá bạc hà', rank: 2, meta: '★ 4,8 · Đã bán 1,2k+' });
    expect(view().rank).toBeNull();
    expect(view().meta).toBeNull();
  });

  it('bản đọc các nhãn nối bằng dấu phẩy theo thứ tự ảnh rồi nhãn; không có thì null', () => {
    expect(view({ product: product({ isFeatured: true }), flash: flash() }).spoken.badges).toBe('Giờ vàng giảm 25%, Tubu chọn');
    expect(view({ product: product({ salePrice: 39_000 }) }).spoken.badges).toBe('Giảm 25%');
    expect(view().spoken.badges).toBeNull();
  });
});

describe('spoken.meta', () => {
  it('bản đọc của dòng ★ và đã bán, null khi không có meta', () => {
    expect(view({ product: product({ ratingAvg: 4.8, sold: 1234 }) }).spoken.meta).toBe('4,8 sao, đã bán hơn 1.200');
    expect(view().spoken.meta).toBeNull();
  });
});

describe('pickCardFlash', () => {
  it('chọn suất rẻ nhất còn hạn của đúng sản phẩm', () => {
    const rep = product();
    const items = [flash({ variationId: 'a', flashPrice: 41_000 }), flash({ variationId: 'b', flashPrice: 39_000 }), flash({ productSlug: 'khac', flashPrice: 1_000 })];
    expect(pickCardFlash(rep, items, NOW)?.variationId).toBe('b');
  });
  it('hết hạn, sai slug, hoặc không rẻ hơn giá bán thì null', () => {
    expect(pickCardFlash(product(), [flash({ endAt: iso(NOW - 1) })], NOW)).toBeNull();
    expect(pickCardFlash(product(), [flash({ productSlug: 'khac' })], NOW)).toBeNull();
    expect(pickCardFlash(product(), [flash({ flashPrice: 60_000 })], NOW)).toBeNull();
    expect(pickCardFlash(product(), [], NOW)).toBeNull();
  });
  it('productCardView với suất đã chọn ra đúng giá của cardPricing', () => {
    const p = product();
    const items = [flash({ variationId: 'a', flashPrice: 41_000 }), flash({ variationId: 'b', flashPrice: 39_000 })];
    const v = view({ product: p, flash: pickCardFlash(p, items, NOW) });
    const expected = cardPricing(p, items, NOW);
    expect(v).toMatchObject({ price: expected.price, compareAt: expected.compareAt, isFlash: expected.isFlash });
  });
  it('món gian hàng ghim phân loại chỉ xét suất của phân loại đó', () => {
    const p = product({ pinnedVariationId: 'a' });
    expect(pickCardFlash(p, [flash({ variationId: 'b', flashPrice: 30_000 })], NOW)).toBeNull();
    expect(pickCardFlash(p, [flash({ variationId: 'a', flashPrice: 41_000 })], NOW)?.variationId).toBe('a');
  });
});

describe('thumbnail', () => {
  it('view mang ảnh của thẻ để ProductTile vẽ được chỉ từ view', () => {
    expect(view({ product: product({ thumbnail: 'https://img.test/a.jpg' }) }).thumbnail).toBe('https://img.test/a.jpg');
    expect(view().thumbnail).toBeNull();
  });
});
