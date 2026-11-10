import { BadRequestException } from '@nestjs/common';
import { RaceDb } from '../../../test/fakes/race-db.fake';
import { addUserLockHandlers, delay, range, raceWithSkew, withCreateManyAndReturn } from '../../../test/fakes/w96a-helpers';
import { applyPointsDelta } from '../loyalty/points-ledger';
import { RewardPointsService } from '../wallet/reward-points.service';
import { AffiliateService } from './affiliate.service';
import { revokeLostCtvMilestones } from './ctv-milestone-revoke';

/**
 * Nhận thưởng mốc doanh số CTV chạy đồng thời với chính nó và với lần đảo hoa hồng (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts):
 * hai request nhận cùng mốc cùng tháng chỉ cộng Điểm Xanh một lần, nhận lại sau thu hồi chỉ cộng một lần, nhận chen với đảo hoa hồng không để
 * CTV giữ thưởng của doanh số đã mất, hai lần đảo cùng mốc chỉ trừ một lần, đảo chen với tiêu điểm không trừ quá số dư.
 * Dùng AffiliateService, RewardPointsService và revokeLostCtvMilestones THẬT; chỉ khoá hàng và SQL thô được giả bằng handler.
 */
const NOW = new Date('2026-11-10T03:00:00Z');
const NOV = '2026-11';
const OCT = '2026-10';
const MS_3M = 'milestone-3m';
const MS_10M = 'milestone-10m';
const APPROVED_NOV = new Date('2026-11-05T03:00:00Z');
const APPROVED_OCT = new Date('2026-10-20T03:00:00Z');
const ALREADY = 'Bạn đã nhận thưởng mốc này rồi.';

const heldClaim = (over: Record<string, unknown> = {}) => ({
  id: 'cl1',
  userId: 'ctv',
  milestoneId: MS_3M,
  monthKey: NOV,
  rewardPoints: 50_000,
  revenue: 3_000_000,
  revokedAt: null,
  revokeCount: 0,
  revokeDebt: 0,
  revokeTaken: 0,
  createdAt: new Date('2026-11-06T00:00:00Z'),
  ...over,
});

const commission = (id: string, total: number, approvedAt = APPROVED_NOV) => ({
  id,
  affiliateUserId: 'ctv',
  status: 'APPROVED',
  commissionableTotal: total,
  approvedAt,
});

function setup(opts: { commissions?: ReturnType<typeof commission>[]; balance?: number; claims?: Record<string, unknown>[]; ledger?: Record<string, unknown>[]; locks?: boolean } = {}) {
  const db = new RaceDb({
    user: {},
    commission: {},
    ctvMilestoneClaim: {
      unique: [{ fields: ['userId', 'milestoneId', 'monthKey'] }],
      defaults: { revokedAt: null, revokeCount: 0, revokeDebt: 0, revokeTaken: 0, createdAt: new Date('2026-11-01T00:00:00Z') },
    },
    pointsTransaction: { defaults: { lot: 'STANDARD', createdAt: new Date('2026-11-01T00:00:00Z'), expiresAt: null, refType: null, refId: null } },
    coinTransaction: {},
  });
  db.seed('user', [{ id: 'ctv', role: 'STAFF', affiliateRevokedAt: null, pointsBalance: opts.balance ?? 0, pointsConvertedBalance: 0 }]);
  db.seed('commission', opts.commissions ?? [commission('c1', 3_000_000)]);
  db.seed('ctvMilestoneClaim', opts.claims ?? []);
  db.seed('pointsTransaction', opts.ledger ?? []);
  addUserLockHandlers(db, { locks: opts.locks });

  const client = withCreateManyAndReturn(db.client);
  const config = { get: async (_key: string, fallback: unknown) => fallback };
  const rewards = new RewardPointsService(client, config as never);
  const svc = new AffiliateService(client, config as never, {} as never, {} as never, rewards, { record: jest.fn() } as never);

  const claim = (milestoneId = MS_3M, month?: string) => svc.claimMilestone('ctv', milestoneId, month, NOW);
  const reverse = (commissionId: string) =>
    client.$transaction(async (tx: any) => {
      const c = await tx.commission.update({ where: { id: commissionId }, data: { status: 'REJECTED' } });
      return revokeLostCtvMilestones(tx, 'ctv', c.approvedAt);
    });
  const spend = (points: number, refId: string) =>
    client.$transaction((tx: any) => applyPointsDelta(tx, { userId: 'ctv', delta: -points, lot: 'STANDARD', reason: `SPEND:${refId}`, refType: 'ORDER', refId }));
  const balance = () => db.row('user', 'ctv')!.pointsBalance as number;
  const ledger = () => db.rows('pointsTransaction');
  const ledgerSum = () => ledger().reduce((s, r) => s + (r.delta as number), 0);
  const claims = () => db.rows('ctvMilestoneClaim');
  return { db, claim, reverse, spend, balance, ledger, ledgerSum, claims };
}

const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const rejectedMessage = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason as Error).message : null);
const rejectedType = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason as object).constructor : null);

describe('claimMilestone — nhận cùng một mốc song song', () => {
  it('hai request cùng mốc cùng tháng (quét độ lệch thời điểm): đúng một request nhận, bên thua nhận câu tiếng Việt "đã nhận rồi", điểm cộng một lần', async () => {
    let lockWaits = 0;
    for (const skew of range(-20, 20)) {
      const { db, claim, balance, ledger, claims } = setup();
      const [a, b] = await raceWithSkew(skew, () => claim(), () => claim());
      const winners = [a, b].filter((r) => r.status === 'fulfilled');
      const loser = [a, b].find((r) => r.status === 'rejected');
      is(`skew ${skew}: số request thắng`, winners.length, 1);
      is(`skew ${skew}: loại lỗi của bên thua`, rejectedType(loser!), BadRequestException);
      is(`skew ${skew}: câu của bên thua`, rejectedMessage(loser!), ALREADY);
      is(`skew ${skew}: kết quả bên thắng`, (winners[0] as PromiseFulfilledResult<unknown>).value, {
        success: true,
        message: 'Chúc mừng bạn đã nhận 50.000 Điểm Xanh từ Mốc Khởi Động 3 Triệu!',
        rewardPoints: 50_000,
        monthKey: NOV,
      });
      is(`skew ${skew}: số dòng claim`, claims().length, 1);
      is(`skew ${skew}: dòng điểm`, ledger().map((r) => [r.delta, r.reason, r.refType, r.refId === claims()[0]!.id]), [[50_000, `CTV_MILESTONE:${MS_3M}:${NOV}`, 'AFFILIATE_MILESTONE', true]]);
      is(`skew ${skew}: số dư`, balance(), 50_000);
      lockWaits += db.stats.lockWaits;
    }
    expect(lockWaits).toBeGreaterThan(0); // có độ lệch mà hai request thật sự xếp hàng ở khoá CTV hoặc khoá unique
  });

  it('sáu request cùng lúc: đúng một lần cộng, năm bên thua đều nhận câu "đã nhận rồi" (không lỗi 500, không P2002 lộ ra)', async () => {
    const { db, claim, balance, ledger, claims } = setup();
    const settled = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => delay(i % 3).then(() => claim())));
    is('số thắng', settled.filter((s) => s.status === 'fulfilled').length, 1);
    is('câu của năm bên thua', settled.filter((s) => s.status === 'rejected').map(rejectedMessage), Array(5).fill(ALREADY));
    is('số dòng claim', claims().length, 1);
    is('số dòng điểm', ledger().length, 1);
    is('số dư', balance(), 50_000);
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('nhận lại mốc đã bị thu hồi (còn nợ 20.000) song song: đúng một lần cộng phần đã trừ nợ, đời #1, dòng claim mở lại một lần', async () => {
    for (const skew of range(-12, 12)) {
      const { claim, balance, ledger, claims } = setup({
        claims: [heldClaim({ revokedAt: new Date('2026-11-08T00:00:00Z'), revokeCount: 1, revokeDebt: 20_000, revokeTaken: 30_000 })],
      });
      const [a, b] = await raceWithSkew(skew, () => claim(), () => claim());
      const winners = [a, b].filter((r) => r.status === 'fulfilled');
      is(`skew ${skew}: số thắng`, winners.length, 1);
      is(`skew ${skew}: câu bên thua`, rejectedMessage([a, b].find((r) => r.status === 'rejected')!), ALREADY);
      is(`skew ${skew}: kết quả`, (winners[0] as PromiseFulfilledResult<unknown>).value, {
        success: true,
        message: 'Bạn nhận lại 30.000 Điểm Xanh từ Mốc Khởi Động 3 Triệu (đã trừ 20.000 điểm chưa thu hết lần trước).',
        rewardPoints: 30_000,
        monthKey: NOV,
      });
      is(`skew ${skew}: dòng điểm`, ledger().map((r) => [r.delta, r.reason, r.refId]), [[30_000, `CTV_MILESTONE:${MS_3M}:${NOV}#1`, 'cl1']]);
      is(`skew ${skew}: dòng claim`, claims().map((c) => [c.revokedAt, c.revokeDebt, c.revokeCount]), [[null, 0, 1]]);
      is(`skew ${skew}: số dư`, balance(), 30_000);
    }
  });

  it('hai tháng (này và trước) hoặc hai mốc khác nhau nhận song song: mỗi cái đúng một lần, không cái nào bị khoá nhầm', async () => {
    const { claim, balance, ledger, claims } = setup({
      commissions: [commission('c1', 10_000_000), commission('c0', 3_000_000, APPROVED_OCT)],
    });
    const settled = await Promise.allSettled([claim(MS_3M, NOV), claim(MS_3M, OCT), claim(MS_10M, NOV), claim(MS_3M, NOV), claim(MS_3M, OCT)]);
    is('trạng thái từng request', settled.map((s) => s.status), ['fulfilled', 'fulfilled', 'fulfilled', 'rejected', 'rejected']);
    is('câu hai bên thua', settled.slice(3).map(rejectedMessage), [ALREADY, ALREADY]);
    is('các claim', claims().map((c) => `${c.milestoneId}:${c.monthKey}`).sort(), [`${MS_10M}:${NOV}`, `${MS_3M}:${OCT}`, `${MS_3M}:${NOV}`].sort());
    is('số dòng điểm', ledger().length, 3);
    is('số dư', balance(), 50_000 + 50_000 + 200_000);
  });
});

describe('claimMilestone ‖ đảo hoa hồng — không giữ thưởng của doanh số đã mất', () => {
  it('nhận mốc 3tr chen với đảo hoa hồng duy nhất (quét độ lệch): hoặc bị từ chối vì doanh số 0đ, hoặc nhận xong bị thu hồi sạch; sổ điểm khớp số dư', async () => {
    const outcomes = { denied: 0, claimedThenRevoked: 0 };
    for (const skew of range(-70, 70, 2)) {
      const { claim, reverse, balance, ledger, ledgerSum, claims } = setup();
      const [c, r] = await raceWithSkew(skew, () => claim(), () => reverse('c1'));
      is(`skew ${skew}: lần đảo`, r.status, 'fulfilled');
      if (c.status === 'rejected') {
        is(`skew ${skew}: câu bị từ chối`, rejectedMessage(c), `Doanh số đã chốt tháng ${NOV} (0đ) chưa đạt ngưỡng 3.000.000đ.`);
        is(`skew ${skew}: không dòng nào`, [claims().length, ledger().length, balance()], [0, 0, 0]);
        outcomes.denied += 1;
      } else {
        is(`skew ${skew}: dòng claim bị thu hồi`, claims().map((x) => [x.revokedAt !== null, x.revokeCount, x.revokeDebt, x.revokeTaken]), [[true, 1, 0, 50_000]]);
        is(`skew ${skew}: dòng điểm`, ledger().map((x) => x.delta).sort((p, q) => p - q), [-50_000, 50_000]);
        outcomes.claimedThenRevoked += 1;
      }
      is(`skew ${skew}: không claim nào còn giữ khi doanh số 0đ`, claims().filter((x) => x.revokedAt === null), []);
      is(`skew ${skew}: số dư`, balance(), 0);
      is(`skew ${skew}: số dư = tổng sổ`, balance(), ledgerSum());
    }
    expect(outcomes.denied).toBeGreaterThan(0);
    expect(outcomes.claimedThenRevoked).toBeGreaterThan(0); // quét đủ rộng để cả hai thứ tự khoá đều xảy ra
  });

  it('hai hoa hồng cùng bị đảo song song (cộng lại mới đủ mốc): mốc chỉ bị trừ MỘT lần, claim đóng một lần, số dư về 0', async () => {
    for (const skew of range(-30, 30, 2)) {
      const { reverse, balance, ledger, claims } = setup({
        commissions: [commission('c1', 1_500_000), commission('c2', 1_500_000)],
        balance: 50_000,
        claims: [heldClaim()],
        ledger: [{ id: 'g1', userId: 'ctv', delta: 50_000, reason: `CTV_MILESTONE:${MS_3M}:${NOV}`, refType: 'AFFILIATE_MILESTONE', refId: 'cl1' }],
      });
      const [a, b] = await raceWithSkew(skew, () => reverse('c1'), () => reverse('c2'));
      is(`skew ${skew}: hai lần đảo đều xong`, [a.status, b.status], ['fulfilled', 'fulfilled']);
      is(`skew ${skew}: dòng thu hồi`, ledger().filter((r) => r.delta < 0).map((r) => [r.delta, r.reason, r.refType]), [[-50_000, 'AFFILIATE_MILESTONE_REVOKE:cl1:1', 'AFFILIATE_MILESTONE_REVOKE']]);
      is(`skew ${skew}: claim`, claims().map((c) => [c.revokedAt !== null, c.revokeCount, c.revokeTaken, c.revokeDebt]), [[true, 1, 50_000, 0]]);
      is(`skew ${skew}: số dư`, balance(), 0);
    }
  });

  it('đảo chen với việc CTV tiêu điểm (quét độ lệch): số dư không âm, taken + nợ = đúng điểm mốc, sổ khớp số dư, không lỗi 500', async () => {
    const shapes = new Set<string>();
    for (const skew of range(-40, 40, 2)) {
      const { reverse, spend, balance, ledger, ledgerSum, claims } = setup({
        balance: 50_000,
        claims: [heldClaim()],
        ledger: [{ id: 'g1', userId: 'ctv', delta: 50_000, reason: `CTV_MILESTONE:${MS_3M}:${NOV}`, refType: 'AFFILIATE_MILESTONE', refId: 'cl1' }],
      });
      const [r, s] = await raceWithSkew(skew, () => reverse('c1'), () => spend(40_000, 'order-1'));
      is(`skew ${skew}: lần đảo không lỗi`, r.status, 'fulfilled');
      is(`skew ${skew}: lần tiêu không lỗi (thiếu điểm chỉ báo applied=false)`, s.status, 'fulfilled');
      const spent = (s as PromiseFulfilledResult<{ applied: boolean }>).value.applied ? 40_000 : 0;
      const [claim] = claims();
      is(`skew ${skew}: taken + nợ`, (claim!.revokeTaken as number) + (claim!.revokeDebt as number), 50_000);
      is(`skew ${skew}: taken không vượt số dư lúc đó`, claim!.revokeTaken, 50_000 - spent);
      is(`skew ${skew}: số dư`, balance(), 0);
      is(`skew ${skew}: số dư = tổng sổ`, balance(), ledgerSum());
      is(`skew ${skew}: dòng nợ`, ledger().filter((x) => x.refType === 'REFERRAL_DEBT').map((x) => [x.delta, x.reason]), spent > 0 ? [[0, `AFFILIATE_MILESTONE_DEBT:cl1:1:${spent}`]] : []);
      shapes.add(String(spent));
    }
    expect([...shapes].sort()).toEqual(['0', '40000']); // cả hai thứ tự (tiêu trước / đảo trước) đều xảy ra trong lần quét
  });
});

describe('lớp phòng thủ thứ hai: bỏ khoá dòng CTV thì unique và CAS vẫn giữ', () => {
  it('hai request nhận cùng mốc không có khoá CTV: unique (userId, mốc, tháng) cho đúng một bên, bên thua nhận câu "đã nhận rồi" chứ không phải lỗi P2002', async () => {
    for (const skew of range(-12, 12)) {
      const { claim, balance, ledger, claims } = setup({ locks: false });
      const [a, b] = await raceWithSkew(skew, () => claim(), () => claim());
      const lost = [a, b].find((r) => r.status === 'rejected');
      is(`skew ${skew}: số thắng`, [a, b].filter((r) => r.status === 'fulfilled').length, 1);
      is(`skew ${skew}: loại lỗi bên thua`, rejectedType(lost!), BadRequestException);
      is(`skew ${skew}: câu bên thua`, rejectedMessage(lost!), ALREADY);
      is(`skew ${skew}: dòng claim và dòng điểm`, [claims().length, ledger().length, balance()], [1, 1, 50_000]);
    }
  });

  it('hai request nhận lại mốc đã thu hồi không có khoá CTV: CAS `revokedAt: { not: null }` cho đúng một bên, điểm cộng một lần', async () => {
    for (const skew of range(-12, 12)) {
      const { claim, balance, ledger } = setup({
        locks: false,
        claims: [heldClaim({ revokedAt: new Date('2026-11-08T00:00:00Z'), revokeCount: 1, revokeDebt: 20_000, revokeTaken: 30_000 })],
      });
      const [a, b] = await raceWithSkew(skew, () => claim(), () => claim());
      is(`skew ${skew}: số thắng`, [a, b].filter((r) => r.status === 'fulfilled').length, 1);
      is(`skew ${skew}: câu bên thua`, rejectedMessage([a, b].find((r) => r.status === 'rejected')!), ALREADY);
      is(`skew ${skew}: dòng điểm và số dư`, [ledger().map((r) => r.delta), balance()], [[30_000], 30_000]);
    }
  });

  it('hai lần đảo cùng mốc không có khoá CTV: CAS `revokedAt: null` cho đúng một bên trừ điểm', async () => {
    for (const skew of range(-20, 20, 2)) {
      const { reverse, balance, ledger, claims } = setup({
        locks: false,
        commissions: [commission('c1', 1_500_000), commission('c2', 1_500_000)],
        balance: 50_000,
        claims: [heldClaim()],
        ledger: [{ id: 'g1', userId: 'ctv', delta: 50_000, reason: `CTV_MILESTONE:${MS_3M}:${NOV}`, refType: 'AFFILIATE_MILESTONE', refId: 'cl1' }],
      });
      const [a, b] = await raceWithSkew(skew, () => reverse('c1'), () => reverse('c2'));
      is(`skew ${skew}: hai lần đảo đều xong`, [a.status, b.status], ['fulfilled', 'fulfilled']);
      is(`skew ${skew}: dòng thu hồi`, ledger().filter((r) => r.delta < 0).map((r) => r.delta), [-50_000]);
      is(`skew ${skew}: claim`, claims().map((c) => [c.revokeCount, c.revokeTaken]), [[1, 50_000]]);
      is(`skew ${skew}: số dư`, balance(), 0);
    }
  });
});
