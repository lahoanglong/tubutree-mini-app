import { describe, expect, it } from 'vitest';
import type { DealerTierProgress, PricelistRow } from '@tubutree/app-core/api/dealer';
import type { OrderDTO } from '@tubutree/shared-types';
import {
  basketMargin,
  basketTierLine,
  INVOICE_BATCH_MAX,
  invoiceEligibleOrders,
  invoiceResultNotice,
  invoiceTag,
  marginLine,
  tierProgressLines,
  tierProgressPct,
} from './dealer-tier-tools';

const money = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const CUR = { id: 'DEALER_1', name: 'Đại lý Cấp 1', minOrderVolume: 10_000_000, discountPct: 20 };
const NEXT = { id: 'DEALER_2', name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30 };
const progress = (over: Partial<DealerTierProgress> = {}): DealerTierProgress => ({
  month: '11/2026',
  monthStart: '2026-10-31T17:00:00.000Z',
  monthEnd: '2026-11-30T17:00:00.000Z',
  volume: 12_000_000,
  pendingVolume: 0,
  currentTier: CUR,
  nextTier: { ...NEXT, toGo: 18_000_000 },
  ...over,
});

describe('tierProgressPct / tierProgressLines', () => {
  it('còn thiếu: phần trăm theo mốc bậc kế, câu nói số còn thiếu và chiết khấu bậc kế', () => {
    const p = progress();
    expect(tierProgressPct(p)).toBe(40);
    expect(tierProgressLines(p, money)).toEqual({
      headline: 'Còn 18.000.000đ trong tháng 11/2026 để được xét lên Đại lý Cấp 2 (chiết khấu 30%).',
      pending: null,
    });
  });

  it('đơn chờ chốt hiện riêng, không cộng vào thanh', () => {
    const p = progress({ pendingVolume: 5_000_000 });
    expect(tierProgressPct(p)).toBe(40);
    expect(tierProgressLines(p, money)?.pending).toBe('+ 5.000.000đ đơn chờ thanh toán/đóng gói, chưa tính.');
  });

  it('đủ mốc: thanh đầy, mời liên hệ để được xét (lên bậc không tự động)', () => {
    const p = progress({ volume: 31_000_000, nextTier: { ...NEXT, toGo: 0 } });
    expect(tierProgressPct(p)).toBe(100);
    expect(tierProgressLines(p, money)?.headline).toBe(
      'Tháng 11/2026 đã đủ mốc Đại lý Cấp 2 (chiết khấu 30%). Bạn liên hệ Tubu Tree để được xét nâng bậc.',
    );
  });

  it('bậc cao nhất: không có bậc kế; chưa được gán bậc: không có dòng nào', () => {
    expect(tierProgressLines(progress({ nextTier: null, currentTier: { ...CUR, discountPct: 45 } }), money)?.headline).toBe(
      'Bạn đang ở bậc chiết khấu cao nhất (45%).',
    );
    expect(tierProgressLines(progress({ currentTier: null, nextTier: null }), money)).toBeNull();
  });
});

describe('basketTierLine', () => {
  it('cộng cả đơn chờ chốt và giỏ để nói còn thiếu bao nhiêu', () => {
    expect(basketTierLine(progress({ pendingVolume: 3_000_000 }), 5_000_000, money)).toBe('Cộng đơn này còn thiếu 10.000.000đ tới mốc Đại lý Cấp 2.');
  });

  it('giỏ đủ mốc → nói đủ mốc', () => {
    expect(basketTierLine(progress(), 18_000_000, money)).toBe('Cộng đơn này, tháng 11/2026 đủ mốc Đại lý Cấp 2.');
  });

  it('không có bậc kế, giỏ trống, tháng đã đủ mốc, hay chưa tải → không có dòng', () => {
    expect(basketTierLine(progress({ nextTier: null }), 1_000_000, money)).toBeNull();
    expect(basketTierLine(progress(), 0, money)).toBeNull();
    expect(basketTierLine(progress({ nextTier: { ...NEXT, toGo: 0 } }), 1_000_000, money)).toBeNull();
    expect(basketTierLine(undefined, 1_000_000, money)).toBeNull();
  });
});

describe('basketMargin / marginLine', () => {
  const row = (id: string, retailPrice: number, dealerPrice: number) =>
    ({ variationId: id, sku: id, product: id, brand: 'B', variation: '', retailPrice, dealerPrice, discountPct: 0, stock: 1 }) as PricelistRow;

  it('lãi = tổng giá lẻ − tổng giá sỉ theo số lượng; bỏ dòng không còn trong bảng giá', () => {
    const m = basketMargin([['a', 2], ['b', 1], ['gone', 5]], [row('a', 100_000, 80_000), row('b', 50_000, 35_000)]);
    expect(m).toEqual({ retail: 250_000, cost: 195_000, margin: 55_000, pct: 22 });
    expect(marginLine(m, money)).toBe('Bán đúng giá lẻ lãi 55.000đ (22%)');
  });

  it('không lãi (giá sỉ riêng ≥ giá lẻ) hoặc giỏ trống → không có dòng', () => {
    expect(marginLine(basketMargin([['a', 1]], [row('a', 100_000, 100_000)]), money)).toBeNull();
    expect(marginLine(basketMargin([], []), money)).toBeNull();
  });
});

describe('hoá đơn VAT trên danh sách đơn', () => {
  const NOW = new Date('2026-11-24T04:00:00Z');
  const order = (code: string, over: Partial<OrderDTO> = {}) =>
    ({ code, status: 'DELIVERED', invoiceStatus: 'NOT_REQUESTED', createdAt: '2026-11-20T03:00:00.000Z', ...over }) as OrderDTO;

  it('đơn đủ điều kiện: chưa huỷ/trả, chưa hoàn tiền, chưa có yêu cầu (kể cả cột trống), trong 30 ngày', () => {
    const eligible = invoiceEligibleOrders(
      [
        order('A'),
        order('B', { invoiceStatus: null }),
        order('C', { status: 'CANCELLED' }),
        order('D', { status: 'RETURNED' }),
        order('E', { invoiceStatus: 'REQUESTED' }),
        order('F', { invoiceStatus: 'ISSUED' }),
        order('G', { createdAt: '2026-10-24T03:00:00.000Z' }),
        order('H', { createdAt: '2026-10-25T05:00:00.000Z' }),
        order('I', { paymentStatus: 'REFUNDED' }),
      ],
      NOW,
    );
    expect(eligible.map((o) => o.code)).toEqual(['A', 'B', 'H']);
  });

  it('quá trần một lần gửi của máy chủ: chỉ lấy các đơn đầu danh sách (mới nhất)', () => {
    const many = Array.from({ length: INVOICE_BATCH_MAX + 5 }, (_, i) => order(`N${i}`));
    const eligible = invoiceEligibleOrders(many, NOW);
    expect(INVOICE_BATCH_MAX).toBe(50);
    expect(eligible).toHaveLength(50);
    expect(eligible[0]!.code).toBe('N0');
    expect(eligible[49]!.code).toBe('N49');
  });

  it('ghi chú trên dòng đơn', () => {
    expect(invoiceTag({ invoiceStatus: 'ISSUED' })).toBe('Đã có HĐ VAT');
    expect(invoiceTag({ invoiceStatus: 'REQUESTED' })).toBe('Đã yêu cầu HĐ VAT');
    expect(invoiceTag({ invoiceStatus: 'FAILED' })).toBe('Đã yêu cầu HĐ VAT');
    expect(invoiceTag({ invoiceStatus: 'NOT_REQUESTED' })).toBeNull();
    expect(invoiceTag({ invoiceStatus: null })).toBeNull();
  });

  it('lời báo kết quả: đủ / thiếu vài đơn / không gửi được đơn nào', () => {
    expect(invoiceResultNotice({ requested: ['A', 'B'], skipped: [], profile: null })).toEqual({ text: 'Đã gửi yêu cầu hoá đơn VAT cho 2 đơn.', error: false });
    expect(invoiceResultNotice({ requested: ['A'], skipped: [{ code: 'B', reason: 'Đơn đã huỷ hoặc trả hàng.' }], profile: null })).toEqual({
      text: 'Đã gửi yêu cầu hoá đơn VAT cho 1 đơn. Chưa gửi 1 đơn: #B: Đơn đã huỷ hoặc trả hàng.',
      error: true,
    });
    expect(invoiceResultNotice({ requested: [], skipped: [{ code: 'B', reason: 'Đơn đã có hoá đơn.' }], profile: null })).toEqual({
      text: 'Chưa gửi được yêu cầu hoá đơn. #B: Đơn đã có hoá đơn.',
      error: true,
    });
  });
});
