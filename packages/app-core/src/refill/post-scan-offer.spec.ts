import { describe, expect, it } from 'vitest';
import type { RefillOfferDTO } from './refill-api';
import type { RefillLandingDTO, RefillLandingPairDTO } from './refill-landing';
import {
  POST_SCAN_COPY,
  POST_SCAN_COPY_MAX,
  POST_SCAN_OFFERS_MAX,
  POST_SCAN_VND_PER_POINT,
  postScanCopy,
  postScanValueVnd,
  postScanView,
  type PostScanCopyKey,
} from './post-scan-offer';

const money = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

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

const pair = (bottle: { id: string; slug: string; name: string; price: number }, refill: Partial<RefillOfferDTO> = {}): RefillLandingPairDTO => ({
  bottle: { productId: bottle.id, slug: bottle.slug, name: bottle.name, thumbnail: null, price: bottle.price, compareAt: null, sizeLabel: null, inStock: true },
  refill: offer(refill),
  savingPct: null,
});

const DISH = { id: 'b-500', slug: 'nuoc-rua-chen-500ml', name: 'Nước rửa chén Fuwa3e 500ml', price: 68_000 };
const SOAP = { id: 'b-soap', slug: 'sua-tam-1l', name: 'Sữa tắm 1L', price: 150_000 };
const SOAP_REFILL = { productId: 'p-soap', slug: 'refill-sua-tam-2l', name: 'Refill Sữa tắm 2L', sizeLabel: '2L', price: 200_000, variationId: 'v-soap' };
const LAUNDRY = { id: 'b-laundry', slug: 'nuoc-giat-1l', name: 'Nước giặt 1L', price: 160_000 };
const LAUNDRY_REFILL = { productId: 'p-laundry', slug: 'refill-nuoc-giat-3l', name: 'Refill Nước giặt 3L', sizeLabel: '3L', price: 300_000, variationId: 'v-laundry' };

describe('postScanValueVnd (1 Điểm Xanh = 1đ, vnd_per_point_redeem = 1)', () => {
  it('đơn 199.000đ và 299.000đ tích 0,2%: số đồng bằng đúng số điểm', () => {
    // Điểm máy chủ = floor(tiền hàng × tỉ lệ%): 199.000 × 0,2% = 398, 299.000 × 0,2% = 598.
    const points = (goods: number, pct: number) => Math.floor((goods * pct) / 100);
    expect(postScanValueVnd(points(199_000, 0.2), 1)).toBe(398);
    expect(postScanValueVnd(points(299_000, 0.2), 1)).toBe(598);
  });

  it('100 điểm là 100đ; cấu hình chưa về thì mặc định 1đ/điểm', () => {
    expect(postScanValueVnd(100, 1)).toBe(100);
    expect(postScanValueVnd(100)).toBe(100);
    expect(postScanValueVnd(100, null)).toBe(100);
    expect(POST_SCAN_VND_PER_POINT).toBe(1);
  });

  it('tỉ lệ đổi khác 1 (cấu hình) thì nhân đúng và làm tròn xuống', () => {
    expect(postScanValueVnd(100, 0.2)).toBe(20);
    expect(postScanValueVnd(7, 0.5)).toBe(3);
    expect(postScanValueVnd(100, 1000)).toBe(100_000);
  });

  it('chưa có điểm, số hỏng hay quy ra 0đ thì không có giá trị (không hứa 0đ)', () => {
    for (const bad of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(postScanValueVnd(bad, 1)).toBeNull();
    expect(postScanValueVnd(1, 0.2)).toBeNull();
  });

  it('tỉ lệ hỏng (0, âm, NaN) lùi về 1đ/điểm chứ không ra 0đ', () => {
    for (const bad of [0, -1, Number.NaN]) expect(postScanValueVnd(250, bad)).toBe(250);
  });
});

describe('postScanView', () => {
  const landing: RefillLandingDTO = { enabled: true, pairs: [pair(DISH), pair(SOAP, SOAP_REFILL), pair(LAUNDRY, LAUNDRY_REFILL)] };

  it('dòng giá trị điểm + tối đa hai gói Refill theo thứ tự máy chủ (ba dòng)', () => {
    const v = postScanView({ points: 398, vndPerPointRedeem: 1, landing }, money);
    expect(v.valueText).toBe('≈ 398đ giảm cho lần mua sau');
    expect(v.offers).toHaveLength(POST_SCAN_OFFERS_MAX);
    expect(v.offers.map((o) => o.variationId)).toEqual(['v-refill', 'v-soap']);
    expect(v.offers[0]).toEqual({
      variationId: 'v-refill',
      slug: 'refill-nuoc-rua-chen-fuwa3e-10l',
      name: 'Refill Nước rửa chén Fuwa3e 10L',
      priceLabel: money(890_000),
      addAria: 'Thêm Refill Nước rửa chén Fuwa3e 10L vào giỏ',
    });
  });

  it('số nghìn có dấu chấm theo kiểu Việt Nam', () => {
    expect(postScanView({ points: 1990, landing: null }, money).valueText).toBe('≈ 1.990đ giảm cho lần mua sau');
  });

  it('dự phòng: cờ Refill tắt, chưa tải, rỗng hay hỏng thì không có dòng gợi ý nhưng vẫn có giá trị điểm', () => {
    for (const bad of [null, undefined, { enabled: false, pairs: [pair(DISH)] }, { enabled: true, pairs: [] }, { enabled: true, pairs: null } as unknown as RefillLandingDTO]) {
      const v = postScanView({ points: 398, landing: bad }, money);
      expect(v.offers).toEqual([]);
      expect(v.valueText).toBe('≈ 398đ giảm cho lần mua sau');
    }
  });

  it('chỉ một gói bán được thì chỉ một dòng', () => {
    const dto: RefillLandingDTO = { enabled: true, pairs: [pair(SOAP, SOAP_REFILL)] };
    const v = postScanView({ points: 100, landing: dto }, money);
    expect(v.offers.map((o) => o.variationId)).toEqual(['v-soap']);
  });

  it('REVIEW chưa có điểm: không có dòng giá trị, vẫn có gói gợi ý', () => {
    const v = postScanView({ points: null, landing }, money);
    expect(v.valueText).toBeNull();
    expect(v.offers).toHaveLength(2);
  });
});

describe('chữ của thẻ', () => {
  it('mọi chữ vừa ngân sách độ dài ở trường hợp xấu nhất', () => {
    const worst: Record<PostScanCopyKey, string> = {
      region: postScanCopy('region'),
      value: postScanCopy('value', { vnd: '999.999.999' }),
      add: postScanCopy('add'),
      added: postScanCopy('added'),
      addAria: postScanCopy('addAria', { name: 'x' }),
    };
    for (const key of Object.keys(POST_SCAN_COPY) as PostScanCopyKey[]) {
      const max = POST_SCAN_COPY_MAX[key];
      if (max !== null) expect(worst[key].length, key).toBeLessThanOrEqual(max);
    }
  });

  it('không dùng thuật ngữ cấm và không nói "đã cộng" (điểm đơn sàn còn chờ)', () => {
    const all = Object.values(POST_SCAN_COPY).join(' | ');
    expect(all).not.toMatch(/Vui lòng|Freeship|Flash sale|Kho voucher|Nhãn hàng/i);
    expect(all).not.toMatch(/đã cộng|đang chờ/i);
  });
});
