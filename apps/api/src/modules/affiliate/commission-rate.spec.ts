import { Prisma } from '@prisma/client';
import { loadDefaultRate, maxResolvedRate, resolveVariationRate, sanitizeDefaultRate } from './commission-rate';

const base = { explicit: null, blocked: false, partnerProduct: false, ownConsignment: false, defaultPct: 8 };

describe('resolveVariationRate', () => {
  it('chưa đặt (null) → mức mặc định', () => {
    expect(resolveVariationRate(base)).toBe(8);
    expect(resolveVariationRate({ ...base, defaultPct: 0 })).toBe(0);
  });
  it('mức tường minh 0 thắng mặc định', () => {
    expect(resolveVariationRate({ ...base, explicit: new Prisma.Decimal(0) })).toBe(0);
  });
  it('mức tường minh 12 thắng mặc định', () => {
    expect(resolveVariationRate({ ...base, explicit: new Prisma.Decimal(12) })).toBe(12);
  });
  it('sản phẩm bị chặn → 0 dù có mức tường minh', () => {
    expect(resolveVariationRate({ ...base, blocked: true })).toBe(0);
    expect(resolveVariationRate({ ...base, blocked: true, explicit: new Prisma.Decimal(12) })).toBe(0);
  });
  it('hàng đối tác: 0 khi chưa đặt, theo mức khi admin đặt riêng', () => {
    expect(resolveVariationRate({ ...base, partnerProduct: true })).toBe(0);
    expect(resolveVariationRate({ ...base, partnerProduct: true, explicit: new Prisma.Decimal(5) })).toBe(5);
  });
  it('hàng ký gửi của chính người giới thiệu → 0', () => {
    expect(resolveVariationRate({ ...base, ownConsignment: true, explicit: new Prisma.Decimal(10) })).toBe(0);
  });
});

describe('sanitizeDefaultRate', () => {
  it('giữ số nguyên 0–50', () => {
    expect([0, 8, 50].map(sanitizeDefaultRate)).toEqual([0, 8, 50]);
  });
  it('giá trị hỏng → 8', () => {
    for (const v of [-1, 51, 7.5, '8', null, undefined, NaN]) expect(sanitizeDefaultRate(v)).toBe(8);
  });
});

const cfg = (values: Record<string, unknown>) => ({ get: async <T>(k: string, fb?: T) => (k in values ? values[k] : fb) as T });

describe('loadDefaultRate', () => {
  it('mặc định 8, không vượt trần max_rate_pct', async () => {
    expect(await loadDefaultRate(cfg({}) as never)).toBe(8);
    expect(await loadDefaultRate(cfg({ 'affiliate.default_rate_pct': 20, 'affiliate.max_rate_pct': 12 }) as never)).toBe(12);
    expect(await loadDefaultRate(cfg({ 'affiliate.default_rate_pct': 5, 'affiliate.max_rate_pct': 12 }) as never)).toBe(5);
  });
});

describe('maxResolvedRate (huy hiệu "+X% hoa hồng")', () => {
  it('NULL hàng Tubu → mặc định; NULL hàng đối tác → 0; có đặt riêng thì theo mức đó; bị chặn → 0', () => {
    expect(maxResolvedRate([{ affiliateRate: null }, { affiliateRate: 5 }], { storefrontId: null }, 8)).toBe(8);
    expect(maxResolvedRate([{ affiliateRate: null }], { storefrontId: 'sf' }, 8)).toBe(0);
    expect(maxResolvedRate([{ affiliateRate: null }, { affiliateRate: 5 }], { storefrontId: 'sf' }, 8)).toBe(5);
    expect(maxResolvedRate([{ affiliateRate: null }], { affiliateBlocked: true }, 8)).toBe(0);
    expect(maxResolvedRate([{ affiliateRate: 3 }], {}, 8)).toBe(3);
  });
});
