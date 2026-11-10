import { HttpException } from '@nestjs/common';
import { RaceDb, tick } from '../../../test/fakes/race-db.fake';
import { AffiliateService } from './affiliate.service';

/**
 * Hoa hồng và lệnh rút chạy đồng thời (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts): hai lệnh chuyển hoa hồng vào Ví của cùng CTV,
 * lệnh chuyển chen với lần thu hồi hoa hồng của đơn bị trả, hai lần thu hồi cùng đơn, hai lần từ chối / duyệt-và-từ-chối cùng một lệnh rút.
 * Ví chỉ được cộng/trừ đúng một lần cho mỗi sự kiện; bên thua nhận lỗi 4xx có sẵn của lần gọi tuần tự thứ hai, không bao giờ lỗi 500 hay hiệu ứng thứ hai.
 * Dùng AffiliateService THẬT; chỉ khoá hàng và SQL thô được giả bằng handler.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};

const commission = (id: string, orderId: string, amount: number, over: Record<string, unknown> = {}) => ({
  id,
  orderId,
  affiliateUserId: 'ctv',
  amount,
  commissionableTotal: amount * 10,
  status: 'APPROVED',
  payoutBatchId: null,
  walletPayoutId: null,
  paidAt: null,
  approvedAt: new Date('2026-11-05T03:00:00Z'),
  ...over,
});

function setup(opts: { commissions?: Record<string, unknown>[]; wallet?: number; payouts?: Record<string, unknown>[] } = {}) {
  const db = new RaceDb({
    user: {},
    order: {},
    commission: { relations: { order: { table: 'order', fk: 'orderId' } } },
    payout: { unique: [{ fields: ['idempotencyKey'] }], defaults: { taxWithheld: 0, taxRefunded: 0, fee: 0, grossAmount: null } },
    walletTransaction: { unique: [{ fields: ['userId', 'type', 'refId'] }] },
    ctvMilestoneClaim: {},
    pointsTransaction: {},
  });
  db.seed('user', [
    { id: 'ctv', role: 'STAFF', walletBalance: opts.wallet ?? 0, pointsBalance: 0, metadata: null, affiliateRevokedAt: null, personalTaxId: null },
    { id: 'buyer', role: 'CUSTOMER', walletBalance: 0, pointsBalance: 0, metadata: null, affiliateRevokedAt: null },
  ]);
  db.seed('order', [
    { id: 'o1', code: 'TUBU1', userId: 'buyer', referrerUserId: 'ctv', status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false },
    { id: 'o2', code: 'TUBU2', userId: 'buyer', referrerUserId: 'ctv', status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false },
  ]);
  db.seed('commission', opts.commissions ?? [commission('c1', 'o1', 100_000), commission('c2', 'o2', 200_000)]);
  db.seed('payout', opts.payouts ?? []);

  const lockUser = async (c: { locking: boolean; params: unknown[]; lockRow: (t: string, id: string) => Promise<void> }) => {
    if (c.locking) await c.lockRow('user', c.params[0] as string);
  };
  const user = (c: { rows: (t: string) => Record<string, any>[]; params: unknown[] }) => c.rows('user').find((r) => r.id === c.params[0]);
  db.handlers.push(
    { match: /SELECT "walletBalance" FROM "users"/, run: async (c) => (await lockUser(c), [{ walletBalance: user(c)?.walletBalance }]) },
    { match: /SELECT "metadata", "walletBalance" FROM "users"/, run: async (c) => (await lockUser(c), [{ metadata: user(c)?.metadata ?? null, walletBalance: user(c)?.walletBalance }]) },
    { match: /SELECT "pointsBalance" FROM "users"/, run: async (c) => (await lockUser(c), [{ pointsBalance: user(c)?.pointsBalance ?? 0 }]) },
    { match: /SELECT 1 FROM "users" WHERE "id"/, run: async (c) => (await lockUser(c), [{ '?column?': 1 }]) },
    { match: /pg_advisory_xact_lock/, run: (c) => c.lockKey(c.params.map(String).join('|')).then(() => 1) },
    {
      // requestPayout: khoá dòng hoa hồng khi đọc; tới lượt khoá thì xét lại WHERE trên bản mới nhất (EvalPlanQual của Postgres).
      match: /FROM "commissions" c\s+JOIN "orders" o/,
      run: async (c) => {
        const fits = (r: Record<string, any>) =>
          r.affiliateUserId === c.params[0] &&
          r.status === 'APPROVED' &&
          r.payoutBatchId == null &&
          c.rows('order').find((o) => o.id === r.orderId)?.status === 'DELIVERED';
        const out: Record<string, any>[] = [];
        for (const cand of c.rows('commission').filter(fits).sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
          if (c.locking) await c.lockRow('commission', cand.id);
          const fresh = c.rows('commission').find((r) => r.id === cand.id);
          if (fresh && fits(fresh)) out.push({ id: fresh.id, amount: fresh.amount });
        }
        return out;
      },
    },
    {
      match: /FROM "commissions" WHERE "id" = \?/,
      run: async (c) => {
        if (c.locking) await c.lockRow('commission', c.params[0] as string);
        const r = c.rows('commission').find((x) => x.id === c.params[0]);
        return r ? [r] : [];
      },
    },
    {
      match: /SELECT "id" FROM "commissions" WHERE "id" IN/,
      run: async (c) => {
        if (c.locking) for (const id of [...c.params].map(String).sort()) await c.lockRow('commission', id);
        return c.params.map((id) => ({ id }));
      },
    },
  );
  const config = { get: async (_key: string, fallback: unknown) => fallback };
  const analytics = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new AffiliateService(db.client, config as never, {} as never, {} as never, {} as never, analytics as never);
  const wallet = () => db.row('user', 'ctv')!.walletBalance as number;
  const ledger = (type?: string) => db.rows('walletTransaction').filter((t) => !type || t.type === type);
  const status = (id: string) => db.row('commission', id)!.status as string;
  return { db, svc, wallet, ledger, status };
}

const pay = (svc: AffiliateService, key: string, amount = 300_000) => svc.requestPayout('ctv', amount, 'WALLET_BALANCE', undefined, key);
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const httpStatus = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' && r.reason instanceof HttpException ? r.reason.getStatus() : null);

describe('AffiliateService — race', () => {
  it('hai lệnh chuyển hoa hồng vào Ví khác key cùng lúc: Ví cộng đúng MỘT lần, một lệnh PAID, bên thua nhận lỗi 4xx', async () => {
    const { db, svc, wallet, ledger, status } = setup();
    const settled = await Promise.allSettled([pay(svc, 'k1'), pay(svc, 'k2')]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const lost = settled.find((s) => s.status === 'rejected')!;
    expect(httpStatus(lost)).toBeGreaterThanOrEqual(400);
    expect(httpStatus(lost)).toBeLessThan(500);
    expect(db.rows('payout')).toHaveLength(1);
    expect(db.rows('payout')[0]).toMatchObject({ amount: 300_000, grossAmount: 300_000, status: 'PAID' });
    expect(wallet()).toBe(300_000);
    expect(ledger('COMMISSION_PAYOUT')).toHaveLength(1);
    expect(['c1', 'c2'].map(status)).toEqual(['PAID', 'PAID']);
    expect(db.rows('commission').every((c) => c.walletPayoutId === db.rows('payout')[0]!.id)).toBe(true);
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  it('hai lệnh chuyển cùng Idempotency-Key cùng lúc: một lệnh, Ví cộng một lần, bên thua nhận kết quả của lệnh thắng hoặc lỗi 4xx', async () => {
    const { db, svc, wallet, ledger } = setup();
    const settled = await Promise.allSettled([pay(svc, 'same'), pay(svc, 'same'), pay(svc, 'same')]);
    expect(settled.filter((s) => s.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    for (const s of settled) {
      if (s.status === 'rejected') expect(httpStatus(s)).toBeLessThan(500);
    }
    expect(db.rows('payout')).toHaveLength(1);
    expect(wallet()).toBe(300_000);
    expect(ledger('COMMISSION_PAYOUT')).toHaveLength(1);
  });

  it('lệnh chuyển chen với lần thu hồi hoa hồng của đơn vừa bị trả (quét thời điểm): Ví luôn khớp hoa hồng PAID còn lại, hoa hồng đơn bị trả luôn REJECTED, không 500', async () => {
    const seen = new Set<string>();
    for (let returnAt = 0; returnAt <= 60; returnAt += 2) {
      const { db, svc, wallet, ledger, status } = setup();
      const returner = async () => {
        await delay(returnAt);
        await db.client.order.update({ where: { id: 'o1' }, data: { status: 'RETURNED' } });
        await svc.reverseCommissionsForOrder('o1');
      };
      const [paid, reversed] = await Promise.allSettled([pay(svc, 'k1'), returner()]);
      const label = `offset ${returnAt}`;
      is(label, reversed.status, 'fulfilled');
      if (paid.status === 'rejected') is(label, (httpStatus(paid) ?? 500) < 500, true);
      is(label, status('c1'), 'REJECTED');
      is(label, status('c2'), paid.status === 'fulfilled' ? 'PAID' : 'APPROVED');
      is(label, wallet(), paid.status === 'fulfilled' ? 200_000 : 0);
      const sumPaid = db.rows('commission').filter((c) => c.status === 'PAID').reduce((s, c) => s + c.amount, 0);
      is(label, wallet(), sumPaid);
      is(label, ledger().reduce((sum, t) => sum + t.delta, 0), wallet());
      is(label, ledger('COMMISSION_PAYOUT').length <= 1, true);
      is(label, ledger('COMMISSION_REVERSAL').length <= 1, true);
      seen.add(paid.status === 'fulfilled' ? (ledger('COMMISSION_REVERSAL').length ? 'paid-then-reversed' : 'paid-without-c1') : `rejected-${httpStatus(paid)}`);
    }
    expect(seen.has('paid-then-reversed')).toBe(true);
    expect([...seen].some((s) => s.startsWith('rejected-'))).toBe(true);
  });

  it('hai lần thu hồi cùng một đơn khi hoa hồng đã vào Ví: Ví bị trừ đúng MỘT lần, hoa hồng REJECTED, đúng một dòng COMMISSION_REVERSAL', async () => {
    const { db, svc, wallet, ledger, status } = setup({
      wallet: 100_000,
      commissions: [commission('c1', 'o1', 100_000, { status: 'PAID', walletPayoutId: 'p1', paidAt: new Date('2026-11-06T03:00:00Z') })],
      payouts: [{ id: 'p1', userId: 'ctv', amount: 100_000, grossAmount: 100_000, taxWithheld: 0, taxRefunded: 0, method: 'WALLET_BALANCE', status: 'PAID', requestedAt: new Date('2026-11-06T03:00:00Z'), paidAt: new Date('2026-11-06T03:00:00Z') }],
    });
    db.seed('order', [{ id: 'o1', code: 'TUBU1', userId: 'buyer', referrerUserId: 'ctv', status: 'RETURNED', type: 'RETAIL', placedForCustomer: false }]);
    await Promise.all([svc.reverseCommissionsForOrder('o1'), svc.reverseCommissionsForOrder('o1'), svc.reverseCommissionsForOrder('o1')]);
    expect(status('c1')).toBe('REJECTED');
    expect(wallet()).toBe(0);
    expect(ledger('COMMISSION_REVERSAL')).toHaveLength(1);
    expect(ledger('COMMISSION_REVERSAL')[0]).toMatchObject({ delta: -100_000, refId: 'c1' });
    expect(db.stats.lockWaits).toBeGreaterThan(0);
  });

  describe('lệnh rút cũ (REQUESTED) từ Ví', () => {
    const legacy = () => ({ id: 'w1', userId: 'ctv', amount: 95_000, fee: 5_000, grossAmount: null, method: 'BANK', status: 'REQUESTED', requestedAt: new Date('2026-11-06T03:00:00Z') });

    it('hai admin từ chối cùng một lệnh: Ví được hoàn gross đúng MỘT lần, bên thua nhận 400 "đã được xử lý"', async () => {
      const { db, svc, wallet, ledger } = setup({ commissions: [], payouts: [legacy()] });
      const settled = await Promise.allSettled([svc.rejectPayout('a1', 'w1', 'Sai thông tin'), svc.rejectPayout('a2', 'w1', 'Sai thông tin')]);
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      const lost = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult;
      expect(httpStatus(lost)).toBe(400);
      expect((lost.reason as Error).message).toMatch(/vừa được xử lý bởi người khác/);
      expect(db.row('payout', 'w1')).toMatchObject({ status: 'REJECTED' });
      expect(wallet()).toBe(100_000);
      expect(ledger('WITHDRAW_REFUND')).toHaveLength(1);
    });

    it('duyệt và từ chối cùng lúc (quét thời điểm): đúng một bên thắng, lệnh APPROVED thì Ví không đổi, REJECTED thì hoàn đúng một lần', async () => {
      const wins = new Set<string>();
      for (let skew = -12; skew <= 12; skew++) {
        const { db, svc, wallet, ledger } = setup({ commissions: [], payouts: [legacy()] });
        const approve = async () => (await delay(Math.max(skew, 0)), svc.approvePayout('a1', 'w1'));
        const reject = async () => (await delay(Math.max(-skew, 0)), svc.rejectPayout('a2', 'w1', 'Sai thông tin'));
        const [approved, rejected] = await Promise.allSettled([approve(), reject()]);
        const label = `offset ${skew}`;
        is(label, [approved.status, rejected.status].filter((st) => st === 'fulfilled').length, 1);
        const final = db.row('payout', 'w1')!;
        if (approved.status === 'fulfilled') {
          is(label, final.status, 'APPROVED');
          is(label, wallet(), 0);
          is(label, ledger().length, 0);
          is(label, httpStatus(rejected), 400);
        } else {
          is(label, final.status, 'REJECTED');
          is(label, wallet(), 100_000);
          is(label, ledger('WITHDRAW_REFUND').length, 1);
          is(label, httpStatus(approved), 400);
        }
        wins.add(final.status as string);
      }
      expect(wins).toEqual(new Set(['APPROVED', 'REJECTED']));
    });
  });
});
