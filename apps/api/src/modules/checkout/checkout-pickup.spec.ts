import { GIFT_ATTACH_MAX_PER_ORDER, GIFT_ATTACH_MIN_NET_GOODS_VND, type PendingGiftRedemptionDTO } from '@tubutree/shared-types';
import { giftAttachDecision } from './checkout-pickup';

const G1: PendingGiftRedemptionDTO = { id: 'g1', code: 'QG-1', giftName: 'Túi vải Tubu', kind: 'GIFT', pointsCost: 10_000 };
const G2: PendingGiftRedemptionDTO = { id: 'g2', code: 'QG-2', giftName: 'Gói hạt giống cải', kind: 'SEED_PACK', pointsCost: 5_000 };
const G3: PendingGiftRedemptionDTO = { id: 'g3', code: 'QG-3', giftName: 'Ống hút tre', kind: 'GIFT', pointsCost: 8_000 };

describe('W179-C (G2) — giftAttachDecision bảng quyết định thuần', () => {
  it('ghim hằng số chống hạ ngưỡng: sàn 99.000đ, tối đa 1 quà/đơn', () => {
    expect(GIFT_ATTACH_MIN_NET_GOODS_VND).toBe(99_000);
    expect(GIFT_ATTACH_MAX_PER_ORDER).toBe(1);
  });

  it('ma trận {đã/chưa xác minh} × {98.999đ, 99.000đ} × {0, 1, 3 quà chờ} × {có/không quà bị bỏ}', () => {
    for (const phoneVerified of [true, false]) {
      for (const netGoodsVnd of [98_999, 99_000]) {
        for (const pending of [[], [G1], [G1, G2, G3]]) {
          for (const excluded of [[], ['g1']]) {
            const res = giftAttachDecision({
              hasTubuShipment: true,
              phoneVerified,
              netGoodsVnd,
              pending,
              excludedIds: new Set(excluded),
            });
            expect(res.attachIds.length).toBeLessThanOrEqual(1);
            expect(res.shortfallVnd).toBe(netGoodsVnd < 99_000 ? 99_000 - netGoodsVnd : 0);

            if (!phoneVerified || netGoodsVnd < 99_000 || pending.length === 0) {
              expect(res.attachIds).toEqual([]);
              expect(res.lines.every((l) => !l.included)).toBe(true);
              for (const l of res.lines) {
                if (excluded.includes(l.id)) expect(l.blockedReason).toBeNull();
                else if (!phoneVerified) expect(l.blockedReason).toBe('PHONE_NOT_VERIFIED');
                else expect(l.blockedReason).toBe('MIN_ORDER');
              }
            } else {
              const candidates = pending.filter((p) => !excluded.includes(p.id));
              if (candidates.length === 0) {
                expect(res.attachIds).toEqual([]);
              } else {
                const winner = candidates[0]!.id;
                expect(res.attachIds).toEqual([winner]);
                for (const l of res.lines) {
                  if (l.id === winner) expect(l).toMatchObject({ included: true, blockedReason: null });
                  else if (excluded.includes(l.id)) expect(l).toMatchObject({ included: false, blockedReason: null });
                  else expect(l).toMatchObject({ included: false, blockedReason: 'ONE_PER_ORDER' });
                }
              }
            }
          }
        }
      }
    }
  });

  it('giỏ không có kiện Tubu: không gắn quà nào, shortfallVnd = 0, blockedReason = null', () => {
    const res = giftAttachDecision({
      hasTubuShipment: false,
      phoneVerified: true,
      netGoodsVnd: 250_000,
      pending: [G1, G2],
      excludedIds: new Set(),
    });
    expect(res.attachIds).toEqual([]);
    expect(res.shortfallVnd).toBe(0);
    expect(res.lines.map((l) => [l.included, l.blockedReason])).toEqual([
      [false, null],
      [false, null],
    ]);
  });
});
