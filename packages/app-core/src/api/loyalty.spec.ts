import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import {
  getCouponHistory,
  getCoupons,
  getDailyCheckInStatus,
  getLoyalty,
  getLoyaltyRewards,
  getMemberCard,
  getMyRedemptions,
  getNewCustomerOffer,
  getPointsTransactions,
  getPointsTransactionsPage,
  nextPointsTxnCursor,
  POINTS_TXN_PAGE_SIZE,
  getReferral,
  postDailyCheckIn,
  redeemLoyaltyReward,
} from './loyalty';

describe('loyalty — hợp đồng gọi API', () => {
  it('đọc hạng, điểm, mã giảm giá, quà, điểm danh, thẻ thành viên', async () => {
    const { http, calls } = fakeHttp();
    await getReferral(http);
    await getLoyalty(http);
    await getPointsTransactions(http);
    await getCoupons(http);
    await getCouponHistory(http);
    await getNewCustomerOffer(http);
    await getLoyaltyRewards(http);
    await getMyRedemptions(http);
    await getDailyCheckInStatus(http);
    await getMemberCard(http);
    expect(calls).toEqual([
      { method: 'get', path: '/me/referral' },
      { method: 'get', path: '/me/loyalty' },
      { method: 'get', path: '/me/points/transactions' },
      { method: 'get', path: '/me/coupons' },
      { method: 'get', path: '/me/coupons/history' },
      { method: 'get', path: '/me/new-customer-offer' },
      { method: 'get', path: '/me/loyalty/rewards' },
      { method: 'get', path: '/me/loyalty/rewards/mine' },
      { method: 'get', path: '/me/daily-check-in' },
      { method: 'get', path: '/me/loyalty/member-card' },
    ]);
  });

  it('điểm danh: POST không body', async () => {
    const { http, calls } = fakeHttp();
    await postDailyCheckIn(http);
    expect(calls).toEqual([{ method: 'post', path: '/me/daily-check-in' }]);
  });

  it('đổi quà: mã quà được encode, không body, Idempotency-Key ở header', async () => {
    const { http, calls } = fakeHttp();
    await redeemLoyaltyReward(http, 'r/1 x', 'key-1');
    expect(calls).toEqual([
      {
        method: 'post',
        path: '/me/loyalty/rewards/r%2F1%20x/redeem',
        opts: { headers: { 'Idempotency-Key': 'key-1' } },
      },
    ]);
  });
});

describe('loyalty — lịch sử điểm phân trang', () => {
  const txn = (id: string, createdAt: string) => ({ id, delta: 1, reason: 'X', refType: null, expiresAt: null, createdAt });

  it('trang đầu chỉ gửi limit; trang kế gửi thêm before + beforeId của dòng cuối trang trước', async () => {
    const { http, calls } = fakeHttp();
    await getPointsTransactionsPage(http);
    await getPointsTransactionsPage(http, { before: '2026-10-20T03:00:00.123Z', beforeId: 'tx9' });
    expect(calls.map((c) => ({ path: c.path, query: c.opts?.query }))).toEqual([
      { path: '/me/points/transactions', query: { limit: POINTS_TXN_PAGE_SIZE, before: undefined, beforeId: undefined } },
      { path: '/me/points/transactions', query: { limit: POINTS_TXN_PAGE_SIZE, before: '2026-10-20T03:00:00.123Z', beforeId: 'tx9' } },
    ]);
    expect(POINTS_TXN_PAGE_SIZE).toBe(20);
  });

  it('nextPointsTxnCursor: trang đầy thì trả mốc dòng cuối, trang thiếu hoặc rỗng là hết', () => {
    const full = Array.from({ length: POINTS_TXN_PAGE_SIZE }, (_, i) => txn(`t${i}`, `2026-10-20T03:00:${String(i).padStart(2, '0')}.000Z`));
    expect(nextPointsTxnCursor(full)).toEqual({ before: full[POINTS_TXN_PAGE_SIZE - 1]!.createdAt, beforeId: `t${POINTS_TXN_PAGE_SIZE - 1}` });
    expect(nextPointsTxnCursor(full.slice(0, 5))).toBeUndefined();
    expect(nextPointsTxnCursor([])).toBeUndefined();
  });
});
