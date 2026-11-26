import { DEFAULT_ORDER_SOURCE_MAP } from './external-order.config';
import {
  formatMarketplaceProbeReport,
  marketplaceProbeExitCode,
  phoneShapeOf,
  pickChannelSamples,
  sampleOf,
  summarizeChannel,
  type ProbeSample,
} from './marketplace-phone-probe';

const shopee = (over: Record<string, unknown> = {}) => ({ id: `P${Math.random()}`, marketplace_id: -3, tracking_number: 'SPXVN0123456789', ...over });

describe('marketplace-phone-probe (W42, chỉ GET)', () => {
  it('dạng SĐT: FULL, MASK có đầu số, MASK chỉ đuôi, NONE', () => {
    expect(phoneShapeOf({ bill_phone_number: '0912345678' })).toBe('FULL');
    expect(phoneShapeOf({ bill_phone_number: '091*****78' })).toBe('MASK_LEAD_TAIL');
    expect(phoneShapeOf({ bill_phone_number: '******78' })).toBe('MASK_TAIL_ONLY');
    expect(phoneShapeOf({ bill_phone_number: '*********' })).toBe('NONE');
    expect(phoneShapeOf({})).toBe('NONE');
  });

  it('chỉ lấy đơn sàn đúng kênh, tối đa 5 đơn', () => {
    const orders = [
      ...Array.from({ length: 7 }, () => shopee()),
      { id: 'L1', marketplace_id: -4 },
      { id: 'C1', order_sources: 1 },
    ];
    expect(pickChannelSamples(orders, 'shopee', DEFAULT_ORDER_SOURCE_MAP)).toHaveLength(5);
    expect(pickChannelSamples(orders, 'lazada', DEFAULT_ORDER_SOURCE_MAP).map((o) => o['id'])).toEqual(['L1']);
    expect(pickChannelSamples(orders, 'tiktok', DEFAULT_ORDER_SOURCE_MAP)).toEqual([]);
  });

  it('mẫu đã che: không chữ số SĐT, mã vận đơn chỉ 3 đầu 3 cuối', () => {
    const s = sampleOf(shopee({ id: 'P9', bill_phone_number: '0912345678' }), true);
    expect(s).toEqual({ orderId: 'P9', shape: 'FULL', visibleDigits: 10, maskedCode: 'SPX*********789', searchHit: true });
    const report = formatMarketplaceProbeReport([{ summary: summarizeChannel('shopee', [s]), samples: [s] }]);
    expect(report).not.toMatch(/0912345678|912345678|345678/);
    expect(report).toContain('SPX*********789');
    expect(report).toContain('LOOKUP_READY có');
  });

  it('LOOKUP_READY khi ≥ 80% mẫu tra lại đúng đơn; PHONE_NONE_RATE theo dạng NONE', () => {
    const mk = (hit: boolean | null, shape: ProbeSample['shape'] = 'MASK_TAIL_ONLY'): ProbeSample => ({ orderId: 'x', shape, visibleDigits: 2, maskedCode: hit === null ? null : 'SPX***789', searchHit: hit });
    const ready = summarizeChannel('shopee', [mk(true), mk(true), mk(true), mk(true), mk(false, 'NONE')]);
    expect(ready).toMatchObject({ samples: 5, searchHitRate: 0.8, phoneNoneRate: 0.2, trackingRate: 1, lookupReady: true });
    const notReady = summarizeChannel('lazada', [mk(true), mk(false), mk(null)]);
    expect(notReady).toMatchObject({ searchHitRate: 0.33, trackingRate: 0.67, lookupReady: false });
    expect(marketplaceProbeExitCode([ready])).toBe(0);
    expect(marketplaceProbeExitCode([ready, notReady])).toBe(1);
    expect(marketplaceProbeExitCode([summarizeChannel('tiktok', [])])).toBe(2);
  });
});
