import { HttpException } from '@nestjs/common';
import { RaceDb, tick } from '../../../test/fakes/race-db.fake';
import { CustomerRefundsService } from './customer-refunds.service';

/**
 * Khoản hoàn tiền chờ chuyển khoản (MANUAL_TRANSFER, PENDING) bị hai bên giành: khách bấm nhận về Ví (hai lần, hoặc vừa lúc admin bấm "Bắt đầu chuyển khoản").
 * Ví Tubu chỉ được cộng khi khoản đóng bằng đường Ví, và không bao giờ vừa cộng Ví vừa để admin chuyển ngân hàng (xem test/fakes/race-db.fake.ts).
 * Dùng CustomerRefundsService THẬT.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const is = (label: string, actual: unknown, expected: unknown) => expect({ label, actual }).toEqual({ label, actual: expected });
const httpStatus = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' && r.reason instanceof HttpException ? r.reason.getStatus() : null);

const AMOUNT = 120_000;

function setup() {
  const db = new RaceDb({
    user: {},
    orderCustomerRefund: { unique: [{ fields: ['orderId', 'kind', 'refKey'] }] },
    walletTransaction: { unique: [{ fields: ['userId', 'type', 'refId'] }] },
  });
  db.seed('user', [{ id: 'u1', walletBalance: 0 }]);
  db.seed('orderCustomerRefund', [
    {
      id: 'r1',
      orderId: 'o1',
      orderCode: 'TUBU1',
      kind: 'CANCEL',
      refKey: 'k1',
      reason: 'CANCELLED',
      userId: 'u1',
      phone: null,
      endCustomerKey: null,
      amount: AMOUNT,
      method: 'MANUAL_TRANSFER',
      status: 'PENDING',
      bankName: 'VCB',
      bankAccountNo: '0123456789',
      bankAccountName: 'AN',
      claimedBy: null,
    },
  ]);
  db.handlers.push({
    match: /SELECT "walletBalance" FROM "users"/,
    run: async (c) => {
      if (c.locking) await c.lockRow('user', c.params[0] as string);
      return [{ walletBalance: c.rows('user').find((r) => r.id === c.params[0])?.walletBalance }];
    },
  });
  const notifications = { notifySafe: jest.fn().mockResolvedValue(true), notify: jest.fn().mockResolvedValue(undefined) };
  const svc = new CustomerRefundsService(db.client, notifications as never);
  const wallet = () => db.row('user', 'u1')!.walletBalance as number;
  const ledger = () => db.rows('walletTransaction');
  const refund = () => db.row('orderCustomerRefund', 'r1')!;
  return { db, svc, wallet, ledger, refund, notifications };
}

describe('CustomerRefundsService — race', () => {
  it('khách bấm nhận về Ví nhiều lần cùng lúc: Ví được cộng đúng MỘT lần, khoản COMPLETED bằng Ví, hai lần thua nhận 400 "vừa được xử lý"', async () => {
    const { db, svc, wallet, ledger, refund, notifications } = setup();
    const settled = await Promise.allSettled([
      svc.chooseDestination('u1', 'r1', { refundMethod: 'WALLET' }),
      svc.chooseDestination('u1', 'r1', { refundMethod: 'WALLET' }),
      svc.chooseDestination('u1', 'r1', { refundMethod: 'WALLET' }),
    ]);
    const won = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    const lost = settled.filter((s) => s.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(2);
    expect(won[0]).toMatchObject({ id: 'r1', status: 'COMPLETED', method: 'WALLET' });
    for (const s of lost) {
      expect(httpStatus(s)).toBe(400);
      expect(((s as PromiseRejectedResult).reason as Error).message).toBe('Khoản hoàn này vừa được xử lý — bạn tải lại nhé.');
    }
    expect(db.rows('orderCustomerRefund')).toHaveLength(1);
    expect(refund()).toMatchObject({ method: 'WALLET', status: 'COMPLETED' });
    expect(wallet()).toBe(AMOUNT);
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({ type: 'ORDER_REFUND', delta: AMOUNT, refId: 'r1' });
    expect(notifications.notifySafe).toHaveBeenCalledTimes(1);
  });

  it('hai admin cùng bấm "Bắt đầu chuyển khoản": đúng một người giữ khoản (claimedBy là người thắng), người kia nhận 400 và không chuyển trùng', async () => {
    const { svc, refund } = setup();
    const settled = await Promise.allSettled([svc.claim('a1', 'r1'), svc.claim('a2', 'r1')]);
    const won = settled.findIndex((s) => s.status === 'fulfilled');
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(httpStatus(settled[1 - won]!)).toBe(400);
    expect(refund()).toMatchObject({ status: 'PROCESSING', claimedBy: won === 0 ? 'a1' : 'a2' });
  });

  it('khách chọn Ví chen với admin bấm "Bắt đầu chuyển khoản" (quét thời điểm): hoặc Ví cộng một lần và khoản đóng, hoặc admin giữ khoản và Ví không đổi', async () => {
    const seen = new Set<string>();
    for (let skew = -30; skew <= 30; skew++) {
      const { svc, wallet, ledger, refund } = setup();
      const customer = async () => (await delay(Math.max(skew, 0)), svc.chooseDestination('u1', 'r1', { refundMethod: 'WALLET' }));
      const admin = async () => (await delay(Math.max(-skew, 0)), svc.claim('a1', 'r1'));
      const [picked, claimed] = await Promise.allSettled([customer(), admin()]);
      const label = `skew ${skew}`;
      is(label, [picked.status, claimed.status].filter((s) => s === 'fulfilled').length, 1);
      if (picked.status === 'fulfilled') {
        is(label, refund().status, 'COMPLETED');
        is(label, refund().method, 'WALLET');
        is(label, wallet(), AMOUNT);
        is(label, ledger().length, 1);
        is(label, httpStatus(claimed), 400);
        seen.add('wallet');
      } else {
        is(label, refund().status, 'PROCESSING');
        is(label, refund().claimedBy, 'a1');
        is(label, wallet(), 0);
        is(label, ledger().length, 0);
        is(label, httpStatus(picked), 400);
        seen.add('claimed');
      }
    }
    expect(seen).toEqual(new Set(['wallet', 'claimed']));
  });
});
