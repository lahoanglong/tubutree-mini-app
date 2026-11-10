import { InternalServerErrorException } from '@nestjs/common';
import { RaceDb } from '../../../test/fakes/race-db.fake';
import { addReferralRewardedOrdersHandler, addUserLockHandlers, delay, range, raceWithSkew, withCreateManyAndReturn } from '../../../test/fakes/w96a-helpers';
import { applyPointsDelta } from '../loyalty/points-ledger';
import { countReferralSuccesses, revokeReferralRewardForOrder, revokeReferralRewardForReferee, revokeReferralRewardPartially } from './referral-reward';
import { RewardPointsService } from './reward-points.service';

/**
 * Thưởng giới thiệu (người mời nhận điểm khi người được mời có đơn thứ hai giao xong) và mốc thưởng thêm chạy đồng thời (Postgres READ COMMITTED,
 * xem test/fakes/race-db.fake.ts): cấp thưởng trùng cho cùng người được mời, cấp chen với trả đơn, cấp mốc chen với thu hồi, thu hồi trùng,
 * thu hồi chen với việc người mời tiêu điểm, cấp chen với gộp tài khoản khách và với việc cắt liên kết tự mời.
 * Dùng RewardPointsService và các hàm thu hồi trong referral-reward.ts THẬT; chỉ khoá hàng và SQL thô được giả bằng handler, còn lần "trả đơn" và "gộp khách"
 * được dựng lại đúng phần ghi liên quan (lật trạng thái rồi gọi hàm thu hồi; khoá khách và đích, chuyển đơn, đặt mergedIntoId) — các luồng đầy đủ đã có ở
 * test/integration-race (referral-order2, referral-merge-return, referral-guest-referrer) chạy trên Postgres thật.
 */
const REWARD = 100;
const BONUS = 50;
const DAY = 864e5;
const T0 = new Date('2026-11-01T00:00:00Z').getTime();
const REFERRAL_UNIQUE = { fields: ['reason'], when: (r: Record<string, any>) => r.refType === 'REFERRAL' };

const order = (id: string, userId: string, day: number) => ({
  id,
  userId,
  status: 'DELIVERED',
  type: 'RETAIL',
  placedForCustomer: false,
  total: 300_000,
  createdAt: new Date(T0 + day * DAY),
});
const user = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  role: 'CUSTOMER',
  metadata: null,
  fullName: 'Nguyễn Văn An',
  referredById: null,
  mergedIntoId: null,
  pointsBalance: 0,
  pointsConvertedBalance: 0,
  ...over,
});
const rewardRow = (refereeId: string, orderIds: string, over: Record<string, unknown> = {}) => ({
  userId: 'R',
  delta: REWARD,
  lot: 'STANDARD',
  reason: `REFERRAL_ORDER2:${refereeId}`,
  refType: 'REFERRAL',
  refId: orderIds,
  ...over,
});

interface Options {
  users?: Record<string, unknown>[];
  orders?: Record<string, unknown>[];
  ledger?: Record<string, unknown>[];
  balance?: number;
  milestones?: { count: number; bonusPoints: number }[];
  locks?: boolean;
  reward?: number;
}

function setup(opts: Options = {}) {
  const defaults = { lot: 'STANDARD', createdAt: new Date('2026-11-04T00:00:00Z'), expiresAt: null, refType: null, refId: null };
  const db = new RaceDb({
    user: {},
    order: {},
    returnRequest: {},
    pointsTransaction: { unique: [REFERRAL_UNIQUE], defaults },
    coinTransaction: { unique: [REFERRAL_UNIQUE], defaults },
  });
  db.seed('user', opts.users ?? [user('R', { pointsBalance: opts.balance ?? 0 }), user('E', { referredById: 'R' })]);
  db.seed('order', opts.orders ?? [order('O1', 'E', 0), order('O2', 'E', 2)]);
  db.seed('pointsTransaction', opts.ledger ?? []);
  addUserLockHandlers(db, { locks: opts.locks });
  addReferralRewardedOrdersHandler(db);

  const client = withCreateManyAndReturn(db.client);
  const settings: Record<string, unknown> = {
    'referral.referrer_reward_points': opts.reward ?? REWARD,
    'referral.window_days': 30,
    'referral.min_order_amount': 200_000,
    'referral.milestones_points': opts.milestones ?? [],
  };
  const config = { get: async (key: string, fallback: unknown) => (key in settings ? settings[key] : fallback) };
  const notify = jest.fn().mockResolvedValue(undefined);
  const svc = new RewardPointsService(client, config as never, { notify } as never);

  const grant = (refereeId = 'E') => svc.grantReferralOrderReward(refereeId);
  /** Trả cả đơn như order-reversal: lật DELIVERED → RETURNED rồi thu hồi trong cùng tx, theo ảnh chụp đơn lúc đọc. */
  const returnOrder = (orderId: string, userId = 'E') =>
    client.$transaction(async (tx: any) => {
      const flipped = await tx.order.updateMany({ where: { id: orderId, status: 'DELIVERED' }, data: { status: 'RETURNED' } });
      return flipped.count === 1 ? revokeReferralRewardForOrder(tx, { id: orderId, userId }) : null;
    });
  /** Duyệt yêu cầu trả MỘT PHẦN: tiền hàng đã trả luỹ kế `returnedGoods` trên tổng 300.000đ của đơn. */
  const partialReturn = (orderId: string, requestId: string, returnedGoods: number) =>
    client.$transaction((tx: any) => revokeReferralRewardPartially(tx, { id: orderId, userId: 'E' }, { requestId, returnedGoods, orderGoods: 300_000 }));
  const revokeOnly = (orderId: string, userId = 'E') => client.$transaction((tx: any) => revokeReferralRewardForOrder(tx, { id: orderId, userId }));
  const spend = (points: number, refId: string) =>
    client.$transaction((tx: any) => applyPointsDelta(tx, { userId: 'R', delta: -points, lot: 'STANDARD', reason: `SPEND:${refId}`, refType: 'ORDER', refId }));
  /** Lần gộp khách vào đích: khoá khách rồi đích, chuyển đơn, đánh dấu đã gộp (đúng thứ tự khoá của AuthService). */
  const mergeGuest = (guestId: string, targetId: string) =>
    client.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${guestId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${targetId} FOR UPDATE`;
      await tx.order.updateMany({ where: { userId: guestId }, data: { userId: targetId } });
      await tx.user.update({ where: { id: guestId }, data: { mergedIntoId: targetId } });
    });
  /** Gộp khách cắt liên kết tự mời: bỏ referredById rồi thu thưởng đã cấp cho liên kết đó. */
  const cutLink = (refereeId: string) =>
    client.$transaction(async (tx: any) => {
      await tx.user.update({ where: { id: refereeId }, data: { referredById: null } });
      return revokeReferralRewardForReferee(tx, refereeId, `MERGE:${refereeId}`);
    });

  const balance = (id = 'R') => db.row('user', id)!.pointsBalance as number;
  const ledger = () => db.rows('pointsTransaction');
  const ledgerSum = (id = 'R') => ledger().filter((r) => r.userId === id).reduce((s, r) => s + (r.delta as number), 0);
  const reasons = (prefix: string) => ledger().filter((r) => String(r.reason).startsWith(prefix));
  const successes = () => countReferralSuccesses(client, 'R');
  return { db, grant, returnOrder, partialReturn, revokeOnly, spend, mergeGuest, cutLink, balance, ledger, ledgerSum, reasons, successes, notify };
}

const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const value = <T>(r: PromiseSettledResult<T>): T => {
  if (r.status === 'rejected') throw r.reason;
  return r.value;
};

describe('cấp thưởng giới thiệu song song', () => {
  it('sáu lần xét thưởng cho cùng người được mời cùng lúc: người mời nhận đúng MỘT lần, đúng một tin "đã nhận thưởng", sổ khớp số dư', async () => {
    const { db, grant, balance, ledger, reasons, ledgerSum, successes, notify } = setup();
    const settled = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => delay(i % 4).then(() => grant())));
    is('không lần nào lỗi', settled.map((s) => s.status), Array(6).fill('fulfilled'));
    is('số lần trả true', settled.filter((s) => value(s) === true).length, 1);
    is('dòng thưởng', reasons('REFERRAL_ORDER2:').map((r) => [r.userId, r.delta, r.reason, r.refId]), [['R', REWARD, 'REFERRAL_ORDER2:E', 'O1:O2']]);
    is('số dòng sổ', ledger().length, 1);
    is('số dư người mời', balance(), REWARD);
    is('số dư = tổng sổ', balance(), ledgerSum());
    is('người được mời không nhận gì', balance('E'), 0);
    is('số lượt giới thiệu', await successes(), 1);
    is('tin báo gửi', notify.mock.calls.map((c) => [c[0], c[1]]), [['R', 'REFERRAL_REWARD_PAID']]);
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('hai người được mời của cùng người mời giao đơn thứ hai cùng lúc, mốc 2 lượt: hai thưởng + ĐÚNG MỘT mốc thưởng thêm, sổ khớp số dư', async () => {
    for (const skew of range(-25, 25, 2)) {
      const { grant, balance, ledger, reasons, ledgerSum, successes, notify } = setup({
        users: [user('R'), user('E1', { referredById: 'R' }), user('E2', { referredById: 'R' })],
        orders: [order('A1', 'E1', 0), order('A2', 'E1', 1), order('B1', 'E2', 0), order('B2', 'E2', 1)],
        milestones: [{ count: 2, bonusPoints: BONUS }],
      });
      const settled = await raceWithSkew(skew, () => grant('E1'), () => grant('E2'));
      is(`skew ${skew}: không lần nào lỗi`, settled.map((s) => s.status), ['fulfilled', 'fulfilled']);
      is(`skew ${skew}: số thưởng`, reasons('REFERRAL_ORDER2:').map((r) => r.reason).sort(), ['REFERRAL_ORDER2:E1', 'REFERRAL_ORDER2:E2']);
      is(`skew ${skew}: số mốc`, reasons('REFERRAL_MILESTONE:').map((r) => [r.reason, r.delta]), [[`REFERRAL_MILESTONE:R:2`, BONUS]]);
      is(`skew ${skew}: số dư`, balance(), REWARD * 2 + BONUS);
      is(`skew ${skew}: số dư = tổng sổ`, balance(), ledgerSum());
      is(`skew ${skew}: số lượt`, await successes(), 2);
      is(`skew ${skew}: tin báo mốc`, notify.mock.calls.filter((c) => c[1] === 'REFERRAL_MILESTONE_PAID').length, 1);
      is(`skew ${skew}: tổng dòng sổ`, ledger().length, 3);
    }
  });
});

describe('cấp thưởng ‖ trả đơn', () => {
  it('cấp thưởng chen với trả đơn thứ hai (quét độ lệch): người mời không bao giờ giữ thưởng của đơn đã trả; thu hồi đúng một lần', async () => {
    const outcomes = { neverGranted: 0, grantedThenRevoked: 0 };
    for (const skew of range(-70, 70, 2)) {
      const { grant, returnOrder, balance, ledger, reasons, ledgerSum, successes } = setup();
      const [g, r] = await raceWithSkew(skew, () => grant(), () => returnOrder('O2'));
      is(`skew ${skew}: cấp thưởng không lỗi`, g.status, 'fulfilled');
      is(`skew ${skew}: trả đơn không lỗi`, r.status, 'fulfilled');
      const granted = reasons('REFERRAL_ORDER2:').filter((x) => x.delta > 0).length;
      if (granted === 0) {
        is(`skew ${skew}: không cấp thì không dòng nào`, ledger().length, 0);
        outcomes.neverGranted += 1;
      } else {
        is(`skew ${skew}: cấp rồi thì có đúng một dòng thu hồi`, reasons('REFERRAL_ORDER2_REVOKE:').map((x) => [x.delta, x.reason, x.refId]), [[-REWARD, 'REFERRAL_ORDER2_REVOKE:E', 'O2']]);
        outcomes.grantedThenRevoked += 1;
      }
      is(`skew ${skew}: số dư`, balance(), 0);
      is(`skew ${skew}: số dư = tổng sổ`, balance(), ledgerSum());
      is(`skew ${skew}: số lượt còn hiệu lực`, await successes(), 0);
    }
    expect(outcomes.neverGranted).toBeGreaterThan(0);
    expect(outcomes.grantedThenRevoked).toBeGreaterThan(0);
  });

  it('cấp mốc thưởng thêm chen với trả đơn (quét độ lệch): hết lượt thì không ai giữ mốc; số dư về 0, sổ khớp', async () => {
    const outcomes = { milestoneNeverGranted: 0, milestoneGrantedThenRevoked: 0 };
    for (const skew of range(-80, 80, 2)) {
      const { grant, returnOrder, balance, reasons, ledgerSum, successes } = setup({
        balance: REWARD,
        ledger: [rewardRow('E', 'O1:O2')],
        milestones: [{ count: 1, bonusPoints: BONUS }],
      });
      // Lần cấp trước đã commit thưởng nhưng chưa tới bước mốc: lần xét lại (ALREADY) là cơ hội cấp bù mốc.
      const [g, r] = await raceWithSkew(skew, () => grant(), () => returnOrder('O2'));
      is(`skew ${skew}: cấp bù không lỗi`, g.status, 'fulfilled');
      is(`skew ${skew}: trả đơn không lỗi`, r.status, 'fulfilled');
      const milestoneRows = reasons('REFERRAL_MILESTONE');
      if (milestoneRows.length === 0) outcomes.milestoneNeverGranted += 1;
      else {
        is(`skew ${skew}: mốc đã cấp thì phải bị thu hồi`, milestoneRows.map((x) => [x.reason, x.delta]).sort(), [[`REFERRAL_MILESTONE:R:1`, BONUS], [`REFERRAL_MILESTONE_REVOKE:R:1#0`, -BONUS]].sort());
        outcomes.milestoneGrantedThenRevoked += 1;
      }
      is(`skew ${skew}: số lượt`, await successes(), 0);
      is(`skew ${skew}: số dư`, balance(), 0);
      is(`skew ${skew}: số dư = tổng sổ`, balance(), ledgerSum());
    }
    expect(outcomes.milestoneNeverGranted).toBeGreaterThan(0);
    expect(outcomes.milestoneGrantedThenRevoked).toBeGreaterThan(0);
  });
});

describe('thu hồi thưởng giới thiệu song song', () => {
  it('năm lần thu hồi cùng một lần thưởng cùng lúc (cả hai đơn của cặp), có mốc đang giữ: đúng một dòng thu hồi, một dòng thu mốc, số dư về 0', async () => {
    for (const skew of range(-16, 16, 2)) {
      const { revokeOnly, balance, ledger, reasons, ledgerSum, successes } = setup({
        balance: REWARD + BONUS,
        ledger: [rewardRow('E', 'O1:O2'), { userId: 'R', delta: BONUS, lot: 'STANDARD', reason: 'REFERRAL_MILESTONE:R:1', refType: 'REFERRAL', refId: 'R' }],
      });
      const orders = ['O1', 'O2', 'O2', 'O1', 'O2'];
      const settled = await Promise.allSettled(orders.map((id, i) => delay((i * Math.abs(skew)) % 7).then(() => revokeOnly(id))));
      is(`skew ${skew}: không lần nào lỗi`, settled.map((s) => s.status), Array(5).fill('fulfilled'));
      is(`skew ${skew}: dòng thu hồi thưởng`, reasons('REFERRAL_ORDER2_REVOKE:').map((r) => [r.delta, r.reason]), [[-REWARD, 'REFERRAL_ORDER2_REVOKE:E']]);
      is(`skew ${skew}: dòng thu hồi mốc`, reasons('REFERRAL_MILESTONE_REVOKE:').map((r) => [r.delta, r.reason]), [[-BONUS, 'REFERRAL_MILESTONE_REVOKE:R:1#0']]);
      is(`skew ${skew}: không nợ`, ledger().filter((r) => r.refType === 'REFERRAL_DEBT'), []);
      is(`skew ${skew}: số dư`, balance(), 0);
      is(`skew ${skew}: số dư = tổng sổ`, balance(), ledgerSum());
      is(`skew ${skew}: số lượt`, await successes(), 0);
      is(`skew ${skew}: đúng một lần thu hồi có kết quả`, settled.filter((s) => value(s) !== null).length, 1);
    }
  });

  it('người mời đã tiêu bớt điểm: hai lần thu hồi song song chỉ ghi MỘT khoản nợ đúng số thiếu, số dư không âm', async () => {
    const { revokeOnly, balance, ledger, reasons, ledgerSum } = setup({
      balance: 30,
      ledger: [rewardRow('E', 'O1:O2'), { userId: 'R', delta: -70, lot: 'STANDARD', reason: 'SPEND:old', refType: 'ORDER', refId: 'old' }],
    });
    const settled = await Promise.allSettled([revokeOnly('O1'), revokeOnly('O2')]);
    is('không lần nào lỗi', settled.map((s) => s.status), ['fulfilled', 'fulfilled']);
    is('kết quả của bên thu được', settled.map(value).filter((v) => v !== null).map((w) => [w!.revoked, w!.shortfall]), [[30, 70]]);
    is('dòng thu hồi', reasons('REFERRAL_ORDER2_REVOKE:').map((r) => [r.delta, r.reason]), [[-30, 'REFERRAL_ORDER2_REVOKE:E']]);
    is('dòng nợ', ledger().filter((r) => r.refType === 'REFERRAL_DEBT').map((r) => [r.delta, r.reason]), [[0, 'REFERRAL_ORDER2_DEBT:E:70']]);
    is('số dư', balance(), 0);
    is('số dư = tổng sổ', balance(), ledgerSum());
  });

  it('thu hồi chen với việc người mời tiêu điểm (quét độ lệch): không lỗi, số dư không âm, thu + nợ = đúng thưởng, sổ khớp số dư', async () => {
    const shapes = new Set<number>();
    for (const skew of range(-40, 40, 2)) {
      const { revokeOnly, spend, balance, ledger, reasons, ledgerSum } = setup({ balance: REWARD, ledger: [rewardRow('E', 'O1:O2')] });
      const [r, s] = await raceWithSkew(skew, () => revokeOnly('O2'), () => spend(60, 'order-9'));
      is(`skew ${skew}: thu hồi không lỗi (không "số dư đổi giữa chừng")`, r.status, 'fulfilled');
      is(`skew ${skew}: tiêu điểm không lỗi`, s.status, 'fulfilled');
      const spent = value(s as PromiseSettledResult<{ applied: boolean }>).applied ? 60 : 0;
      const revoke = reasons('REFERRAL_ORDER2_REVOKE:')[0]!;
      is(`skew ${skew}: thu = số dư lúc đó`, -(revoke.delta as number), REWARD - spent);
      const debt = ledger().filter((x) => x.refType === 'REFERRAL_DEBT');
      is(`skew ${skew}: nợ = phần thiếu`, debt.map((x) => x.reason), spent > 0 ? [`REFERRAL_ORDER2_DEBT:E:${spent}`] : []);
      is(`skew ${skew}: số dư`, balance(), 0);
      is(`skew ${skew}: số dư = tổng sổ`, balance(), ledgerSum());
      shapes.add(spent);
    }
    expect([...shapes].sort()).toEqual([0, 60]);
  });
});

describe('thu hồi theo tỷ lệ khi trả một phần song song', () => {
  const seeded = (over: Options = {}) =>
    setup({
      balance: REWARD + BONUS,
      ledger: [rewardRow('E', 'O1:O2'), { userId: 'R', delta: BONUS, lot: 'STANDARD', reason: 'REFERRAL_MILESTONE:R:1', refType: 'REFERRAL', refId: 'R' }],
      ...over,
    });

  it('ba lần duyệt cùng một yêu cầu trả (cùng requestId) cùng lúc: chỉ thu MỘT lần theo tỷ lệ, không đóng lượt giới thiệu', async () => {
    for (const skew of range(0, 6)) {
      const { partialReturn, balance, reasons, ledgerSum, successes } = seeded();
      const settled = await Promise.allSettled([0, 1, 2].map((i) => delay((i * skew) % 4).then(() => partialReturn('O2', 'req-1', 100_000))));
      is(`skew ${skew}: không lần nào lỗi`, settled.map((s) => s.status), Array(3).fill('fulfilled'));
      is(`skew ${skew}: dòng thu từng phần`, reasons('REFERRAL_ORDER2_PARTIAL_REVOKE:').map((r) => [r.delta, r.reason, r.refId]), [[-33, 'REFERRAL_ORDER2_PARTIAL_REVOKE:E:req-1', 'O2']]);
      is(`skew ${skew}: chưa đóng lượt`, [reasons('REFERRAL_ORDER2_REVOKE:').length, reasons('REFERRAL_MILESTONE_REVOKE:').length, await successes()], [0, 0, 1]);
      is(`skew ${skew}: số dư`, [balance(), ledgerSum()], [REWARD + BONUS - 33, REWARD + BONUS - 33]);
    }
  });

  it('hai yêu cầu trả khác nhau của cùng một đơn cùng lúc (1/3 rồi luỹ kế 2/3): tổng thu đúng mục tiêu luỹ kế 66, không cộng dồn hai lần', async () => {
    for (const skew of range(-12, 12, 2)) {
      const { partialReturn, balance, reasons, ledgerSum } = seeded();
      const [a, b] = await raceWithSkew(skew, () => partialReturn('O2', 'req-1', 100_000), () => partialReturn('O2', 'req-2', 200_000));
      is(`skew ${skew}: không lần nào lỗi`, [a.status, b.status], ['fulfilled', 'fulfilled']);
      is(`skew ${skew}: tổng thu`, -reasons('REFERRAL_ORDER2_PARTIAL_REVOKE:').reduce((sum, r) => sum + (r.delta as number), 0), 66);
      is(`skew ${skew}: số dư`, [balance(), ledgerSum()], [REWARD + BONUS - 66, REWARD + BONUS - 66]);
    }
  });

  it('trả 2/3 cả hai đơn song song: tổng thu đúng bằng thưởng (không vượt), đóng lượt một lần và thu mốc thưởng thêm một lần, số dư về 0', async () => {
    const shapes = new Set<string>();
    for (const skew of range(-16, 16, 2)) {
      const { partialReturn, balance, ledger, reasons, ledgerSum, successes } = seeded();
      const [a, b] = await raceWithSkew(skew, () => partialReturn('O1', 'req-1', 200_000), () => partialReturn('O2', 'req-2', 200_000));
      is(`skew ${skew}: không lần nào lỗi`, [a.status, b.status], ['fulfilled', 'fulfilled']);
      const taken = reasons('REFERRAL_ORDER2_PARTIAL_REVOKE:');
      is(`skew ${skew}: tổng thu từng phần`, -taken.reduce((sum, r) => sum + (r.delta as number), 0), REWARD);
      is(`skew ${skew}: đóng lượt một lần`, reasons('REFERRAL_ORDER2_REVOKE:').map((r) => [r.delta, r.reason]), [[0, 'REFERRAL_ORDER2_REVOKE:E']]);
      is(`skew ${skew}: thu mốc một lần`, reasons('REFERRAL_MILESTONE_REVOKE:').map((r) => [r.delta, r.reason]), [[-BONUS, 'REFERRAL_MILESTONE_REVOKE:R:1#0']]);
      is(`skew ${skew}: không nợ`, ledger().filter((r) => r.refType === 'REFERRAL_DEBT'), []);
      is(`skew ${skew}: số dư`, [balance(), ledgerSum(), await successes()], [0, 0, 0]);
      shapes.add(taken.map((r) => r.refId).join(','));
    }
    expect(shapes.size).toBe(2); // cả hai thứ tự (đơn đầu trước / đơn hai trước) đều xảy ra
  });
});

describe('gộp tài khoản khách và cắt liên kết giới thiệu', () => {
  const guestSetup = () =>
    setup({
      users: [user('R'), user('G', { referredById: 'R', fullName: 'Khách' }), user('T', { referredById: 'R' })],
      orders: [order('O1', 'G', 0), order('O2', 'G', 2)],
    });

  it('cấp thưởng cho khách chen với lần gộp khách vào tài khoản đích (quét độ lệch): đúng MỘT thưởng cho cặp đơn, kể cả khi đích được xét lại sau đó', async () => {
    const owners = new Set<string>();
    for (const skew of range(-60, 60, 2)) {
      const { grant, mergeGuest, balance, reasons, ledgerSum } = guestSetup();
      const [g, m] = await raceWithSkew(skew, () => grant('G'), () => mergeGuest('G', 'T'));
      is(`skew ${skew}: cấp thưởng không lỗi`, g.status, 'fulfilled');
      is(`skew ${skew}: gộp không lỗi`, m.status, 'fulfilled');
      const rows = reasons('REFERRAL_ORDER2:');
      is(`skew ${skew}: ngay sau cuộc đua đã có đúng một thưởng (không đợi lần xét lại)`, rows.length, 1);
      is(`skew ${skew}: thưởng cho cặp đơn đã dùng`, rows.map((r) => [r.delta, r.refId]), [[REWARD, 'O1:O2']]);
      owners.add(String(rows[0]!.reason));
      // Lần xét lại cho đích (cron chạy lại việc sau giao): không thưởng lần hai cho cùng cặp đơn.
      is(`skew ${skew}: xét lại cho đích không thưởng thêm`, await grant('T'), false);
      is(`skew ${skew}: xét lại cho khách đã gộp không thưởng thêm`, await grant('G'), false);
      is(`skew ${skew}: số dòng thưởng cuối`, reasons('REFERRAL_ORDER2:').length, 1);
      is(`skew ${skew}: số dư`, balance(), REWARD);
      is(`skew ${skew}: số dư = tổng sổ`, balance(), ledgerSum());
    }
    expect([...owners].sort()).toEqual(['REFERRAL_ORDER2:G', 'REFERRAL_ORDER2:T']); // thưởng ghi theo khách khi cấp trước gộp, theo đích khi gộp trước
  });

  it('khách đã được thưởng rồi gộp vào đích, đích giao thêm hai đơn mới (cùng người mời): không thưởng lần hai cho cùng một người', async () => {
    const { grant, mergeGuest, balance, reasons, ledgerSum } = setup({
      users: [user('R', { pointsBalance: REWARD }), user('G', { referredById: 'R', fullName: 'Khách' }), user('T', { referredById: 'R' })],
      orders: [order('O1', 'G', 0), order('O2', 'G', 2), order('O3', 'T', 5), order('O4', 'T', 6)],
      ledger: [rewardRow('G', 'O1:O2')],
    });
    await mergeGuest('G', 'T');
    const settled = await Promise.allSettled([grant('T'), grant('G'), grant('T')]);
    is('không lần nào lỗi', settled.map((s) => s.status), Array(3).fill('fulfilled'));
    is('không lần nào thưởng', settled.map(value), [false, false, false]);
    is('dòng thưởng', reasons('REFERRAL_ORDER2:').map((r) => r.reason), ['REFERRAL_ORDER2:G']);
    is('số dư', [balance(), ledgerSum()], [REWARD, REWARD]);
  });

  it('bốn lần xét thưởng cùng lúc cho cả khách đã gộp lẫn đích: người mời nhận đúng một lần dưới một mã người được mời', async () => {
    const { grant, mergeGuest, balance, reasons, ledgerSum } = guestSetup();
    await mergeGuest('G', 'T');
    const settled = await Promise.allSettled([grant('G'), grant('T'), grant('G'), grant('T')]);
    is('không lần nào lỗi', settled.map((s) => s.status), Array(4).fill('fulfilled'));
    is('dòng thưởng', reasons('REFERRAL_ORDER2:').map((r) => r.reason), ['REFERRAL_ORDER2:T']);
    is('số dư', balance(), REWARD);
    is('số dư = tổng sổ', balance(), ledgerSum());
  });

  it('cấp thưởng chen với việc gộp cắt liên kết tự mời (quét độ lệch): không để lại thưởng của liên kết đã cắt', async () => {
    const outcomes = { neverGranted: 0, grantedThenRevoked: 0 };
    for (const skew of range(-60, 60, 2)) {
      const { grant, cutLink, balance, ledger, reasons, ledgerSum, successes } = setup();
      const [g, c] = await raceWithSkew(skew, () => grant(), () => cutLink('E'));
      is(`skew ${skew}: cấp thưởng không lỗi`, g.status, 'fulfilled');
      is(`skew ${skew}: cắt liên kết không lỗi`, c.status, 'fulfilled');
      if (reasons('REFERRAL_ORDER2:').filter((r) => r.delta > 0).length === 0) {
        is(`skew ${skew}: không cấp thì không dòng nào`, ledger().length, 0);
        outcomes.neverGranted += 1;
      } else {
        is(`skew ${skew}: cấp rồi thì bị thu đúng một lần`, reasons('REFERRAL_ORDER2_REVOKE:').map((r) => [r.delta, r.reason, r.refId]), [[-REWARD, 'REFERRAL_ORDER2_REVOKE:E', 'MERGE:E']]);
        outcomes.grantedThenRevoked += 1;
      }
      is(`skew ${skew}: số dư`, balance(), 0);
      is(`skew ${skew}: số dư = tổng sổ`, balance(), ledgerSum());
      is(`skew ${skew}: số lượt`, await successes(), 0);
    }
    expect(outcomes.neverGranted).toBeGreaterThan(0);
    expect(outcomes.grantedThenRevoked).toBeGreaterThan(0);
  });
});

describe('lớp phòng thủ thứ hai: bỏ khoá dòng users thì unique index và ON CONFLICT DO NOTHING vẫn giữ', () => {
  it('sáu lần xét thưởng cho cùng người được mời không có khoá: partial unique theo reason cho đúng một bên, không lần nào lỗi, số dư khớp sổ', async () => {
    for (const skew of range(0, 6)) {
      const { grant, balance, reasons, ledger, ledgerSum } = setup({ locks: false });
      const settled = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => delay((i * skew) % 5).then(() => grant())));
      is(`skew ${skew}: không lần nào lỗi`, settled.map((s) => s.status), Array(6).fill('fulfilled'));
      is(`skew ${skew}: dòng thưởng`, reasons('REFERRAL_ORDER2:').map((r) => r.reason), ['REFERRAL_ORDER2:E']);
      is(`skew ${skew}: số dòng sổ và số dư`, [ledger().length, balance(), ledgerSum()], [1, REWARD, REWARD]);
    }
  });

  it('năm lần thu hồi cùng một lần thưởng không có khoá: reason duy nhất cho đúng một dòng thu hồi và một dòng thu mốc, không lần nào lỗi', async () => {
    for (const skew of range(1, 7)) {
      const { revokeOnly, balance, reasons, ledgerSum } = setup({
        locks: false,
        balance: REWARD + BONUS,
        ledger: [rewardRow('E', 'O1:O2'), { userId: 'R', delta: BONUS, lot: 'STANDARD', reason: 'REFERRAL_MILESTONE:R:1', refType: 'REFERRAL', refId: 'R' }],
      });
      const orders = ['O1', 'O2', 'O2', 'O1', 'O2'];
      const settled = await Promise.allSettled(orders.map((id, i) => delay((i * skew) % 5).then(() => revokeOnly(id))));
      is(`skew ${skew}: không lần nào lỗi`, settled.map((s) => s.status), Array(5).fill('fulfilled'));
      is(`skew ${skew}: dòng thu hồi thưởng`, reasons('REFERRAL_ORDER2_REVOKE:').map((r) => r.delta), [-REWARD]);
      is(`skew ${skew}: dòng thu hồi mốc`, reasons('REFERRAL_MILESTONE_REVOKE:').map((r) => r.delta), [-BONUS]);
      is(`skew ${skew}: số dư`, [balance(), ledgerSum()], [0, 0]);
    }
  });
});

describe('lỗi hiển thị cho khách và quản trị', () => {
  it('khoá thưởng còn giá trị tính bằng xu (5.000.000): lỗi 500 bằng tiếng Việt, tx cấp thưởng rollback, người mời không được cộng gì', async () => {
    const { grant, balance, ledger } = setup({ reward: 5_000_000 });
    const err = await grant().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect((err as Error).message).toBe('Thưởng Điểm Xanh không hợp lệ, đã báo quản trị viên.');
    is('sổ và số dư', [ledger().length, balance()], [0, 0]);
  });
});
