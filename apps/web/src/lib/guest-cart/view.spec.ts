import { describe, expect, it } from 'vitest';
import type { FlashPriceItem } from '@tubutree/app-core/flash-price';
import type { ProductDetail, VariationDetail } from '../api';
import type { GuestCartLine } from './store';
import { guestCartView } from './view';

type ProductState = Parameters<typeof guestCartView>[1] extends ReadonlyMap<string, infer S> ? S : never;

const variation = (over: Partial<VariationDetail> = {}): VariationDetail => ({
  id: 'v1',
  sku: 'S1',
  name: '250ml',
  retailPrice: 200_000,
  salePrice: 150_000,
  stock: 5,
  ...over,
});
const product = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  id: 'p1',
  slug: 'dau-goi',
  brand: 'Tubu',
  name: 'Dầu gội bồ kết',
  shortDesc: null,
  description: '',
  images: ['anh-0.jpg'],
  thumbnail: 'thumb.jpg',
  basePrice: 200_000,
  salePrice: 150_000,
  certifications: [],
  variations: [variation()],
  ...over,
});
const line = (variationId: string, slug: string, quantity: number): GuestCartLine => ({ variationId, slug, quantity, addedAt: 0 });
const ok = (p: ProductDetail): ProductState => ({ status: 'ok', product: p });
const view = (lines: GuestCartLine[], entries: [string, ProductState][], flash: FlashPriceItem[] = []) =>
  guestCartView(lines, new Map(entries), flash);

describe('guestCartView: trạng thái từng dòng', () => {
  it('chưa có kết quả → loading; lỗi → error; 404 → gone; phân loại đã gỡ → gone kèm tên sản phẩm', () => {
    const v = view(
      [line('v1', 'dang-tai', 1), line('v1', 'loi', 2), line('v1', 'da-go', 1), line('v-cu', 'dau-goi', 1)],
      [
        ['loi', { status: 'error' }],
        ['da-go', { status: 'missing' }],
        ['dau-goi', ok(product())],
      ],
    );
    expect(v.rows.map((r) => r.state)).toEqual(['loading', 'error', 'gone', 'gone']);
    expect(v.rows[1]).toMatchObject({ quantity: 2, unitPrice: null, total: 0, productName: null });
    expect(v.rows[3]).toMatchObject({ productName: 'Dầu gội bồ kết', thumbnail: 'thumb.jpg', unitPrice: null, total: 0 });
    expect(v.subtotal).toBe(0);
    expect(v.settled).toBe(false);
  });

  it('settled khi không còn dòng loading (dòng lỗi cũng là đã có kết quả); giỏ trống cũng settled', () => {
    expect(view([line('v1', 'loi', 1)], [['loi', { status: 'error' }]]).settled).toBe(true);
    expect(view([], []).settled).toBe(true);
  });

  it('dòng mua được: giá đang bán, giá gạch, thành tiền, trần nút + theo tồn thấp; ảnh phân loại thắng ảnh sản phẩm', () => {
    const v = view([line('v1', 'dau-goi', 2)], [['dau-goi', ok(product({ variations: [variation({ imageUrl: 'v1.jpg' })] }))]]);
    expect(v.rows[0]).toMatchObject({
      state: 'ok',
      productName: 'Dầu gội bồ kết',
      variationName: '250ml',
      thumbnail: 'v1.jpg',
      unitPrice: 150_000,
      compareAt: 200_000,
      isFlash: false,
      total: 300_000,
      stock: 5,
      maxQty: 5,
      tubu: true,
      blockedText: null,
    });
    expect(v.subtotal).toBe(300_000);
    expect(v.tubuSubtotal).toBe(300_000);
    expect(v.hasMerchant).toBe(false);
  });

  it('tồn cao: trần nút + là 99, không lộ tồn thật; không có giá gạch khi không giảm', () => {
    const v = view([line('v1', 'dau-goi', 1)], [['dau-goi', ok(product({ variations: [variation({ stock: 500, salePrice: null })] }))]]);
    expect(v.rows[0]).toMatchObject({ maxQty: 99, unitPrice: 200_000, compareAt: null });
  });

  it('hết hàng: soldOut, vẫn hiện giá nhưng không cộng vào tạm tính', () => {
    const p = product({ variations: [variation(), variation({ id: 'v2', name: '500ml', stock: 0, salePrice: null, retailPrice: 300_000 })] });
    const v = view([line('v1', 'dau-goi', 1), line('v2', 'dau-goi', 3)], [['dau-goi', ok(p)]]);
    expect(v.rows.map((r) => r.state)).toEqual(['ok', 'soldOut']);
    expect(v.rows[1]).toMatchObject({ unitPrice: 300_000, total: 0 });
    expect(v.subtotal).toBe(150_000);
  });
});

describe('guestCartView: Giờ vàng', () => {
  const flashItem = (over: Partial<FlashPriceItem> = {}): FlashPriceItem => ({ productSlug: 'dau-goi', variationId: 'v1', flashPrice: 99_000, ...over });

  it('suất đang chạy: đơn giá Giờ vàng, gạch giá đang bán, thành tiền theo giá Giờ vàng', () => {
    const v = view([line('v1', 'dau-goi', 2)], [['dau-goi', ok(product())]], [flashItem()]);
    expect(v.rows[0]).toMatchObject({ state: 'ok', unitPrice: 99_000, compareAt: 150_000, isFlash: true, total: 198_000 });
    expect(v.subtotal).toBe(198_000);
  });

  it('vượt giới hạn mỗi khách: cả dòng tính giá thường như máy chủ, không gắn nhãn Giờ vàng', () => {
    const v = view([line('v1', 'dau-goi', 3)], [['dau-goi', ok(product())]], [flashItem({ perUserLimit: 1 })]);
    expect(v.rows[0]).toMatchObject({ unitPrice: 150_000, isFlash: false, total: 450_000 });
  });

  it('suất của phân loại khác không đổi giá dòng này', () => {
    const v = view([line('v1', 'dau-goi', 1)], [['dau-goi', ok(product())]], [flashItem({ variationId: 'v9' })]);
    expect(v.rows[0]).toMatchObject({ unitPrice: 150_000, isFlash: false });
  });
});

describe('guestCartView: hàng gian hàng và gian hàng tạm nghỉ', () => {
  const merchant = product({
    slug: 'gian-a',
    name: 'Xà phòng gian A',
    fulfiller: { kind: 'MERCHANT', name: 'Gian A', shippingFee: 30_000, freeShipFrom: null },
    variations: [variation({ id: 'm1', salePrice: null, retailPrice: 80_000 })],
  });

  it('dòng gian hàng tự giao: hasMerchant, tạm tính gồm cả hai, tubuSubtotal chỉ phần Tubu', () => {
    const v = view([line('v1', 'dau-goi', 1), line('m1', 'gian-a', 2)], [
      ['dau-goi', ok(product())],
      ['gian-a', ok(merchant)],
    ]);
    expect(v.rows.map((r) => r.tubu)).toEqual([true, false]);
    expect(v.hasMerchant).toBe(true);
    expect(v.subtotal).toBe(150_000 + 160_000);
    expect(v.tubuSubtotal).toBe(150_000);
  });

  it('API cũ chỉ có fulfilment MERCHANT (chưa có fulfiller): vẫn là hàng gian hàng', () => {
    const legacy = product({ slug: 'cu', fulfilment: 'MERCHANT', variations: [variation({ id: 'c1' })] });
    const v = view([line('c1', 'cu', 1)], [['cu', ok(legacy)]]);
    expect(v.rows[0]!.tubu).toBe(false);
    expect(v.hasMerchant).toBe(true);
    expect(v.tubuSubtotal).toBe(0);
  });

  it('gian hàng tạm nghỉ (fulfiller UNAVAILABLE): blocked kèm câu báo, không vào tạm tính, không bật hasMerchant', () => {
    const paused = product({
      slug: 'gian-b',
      fulfiller: { kind: 'UNAVAILABLE', name: 'Gian B', shippingFee: null, freeShipFrom: null, reason: 'STORE_PAUSED' },
      variations: [variation({ id: 'b1' })],
    });
    const v = view([line('v1', 'dau-goi', 1), line('b1', 'gian-b', 2)], [
      ['dau-goi', ok(product())],
      ['gian-b', ok(paused)],
    ]);
    expect(v.rows[1]).toMatchObject({ state: 'blocked', blockedText: 'Gian B đang tạm nghỉ, chưa nhận đơn.', total: 0 });
    expect(v.subtotal).toBe(150_000);
    expect(v.tubuSubtotal).toBe(150_000);
    expect(v.hasMerchant).toBe(false);
  });

  it('dòng gian hàng hết hàng không bật hasMerchant', () => {
    const soldOut = product({ ...merchant, variations: [variation({ id: 'm1', stock: 0 })] });
    const v = view([line('v1', 'dau-goi', 1), line('m1', 'gian-a', 1)], [
      ['dau-goi', ok(product())],
      ['gian-a', ok(soldOut)],
    ]);
    expect(v.rows[1]!.state).toBe('soldOut');
    expect(v.hasMerchant).toBe(false);
  });
});
