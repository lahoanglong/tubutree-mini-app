import { computePointExpiry, LoyaltyExpiryService, type PointExpiryTxn } from './loyalty-expiry.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

const DAY = 864e5;
const NOW = new Date('2026-07-05T00:00:00.000Z');

// Helper để dựng PointsTransaction tối giản cho helper thuần.
const tx = (
  id: string,
  delta: number,
  createdAt: string,
  expiresAt: string | null = null,
): PointExpiryTxn => ({
  id,
  delta,
  createdAt: new Date(createdAt),
  expiresAt: expiresAt ? new Date(expiresAt) : null,
});

describe('computePointExpiry (pure FIFO helper)', () => {
  const WINDOW = 7 * DAY;

  it('1 lô đã hết hạn, chưa tiêu → expiredNow = toàn bộ lô', () => {
    const r = computePointExpiry([tx('a', 100, '2025-01-01', '2026-01-01')], NOW, WINDOW);
    expect(r.expiredNow).toBe(100);
    expect(r.expiringSoon).toEqual({ amount: 0, earliestExpiresAt: null });
  });

  it('lô hết hạn đã bị tiêu 1 phần (FIFO) → expiredNow = phần còn lại', () => {
    const r = computePointExpiry(
      [tx('a', 100, '2025-01-01', '2026-01-01'), tx('b', -30, '2025-06-01')],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(70);
  });

  it('tiêu ăn LÔ CŨ trước lô mới chưa hết hạn (FIFO) → lô mới sống sót', () => {
    // a: cũ + đã hết hạn; b: mới + còn hạn (trong cửa sổ nhắc); c: tiêu 100.
    // FIFO tiêu a trước → a=0 (không còn hết hạn), b còn nguyên.
    // Nếu tiêu NGƯỢC (mới trước) thì b bị ăn còn a hết hạn → expiredNow=100 (sai).
    const r = computePointExpiry(
      [
        tx('a', 100, '2025-01-01', '2026-01-01'),
        tx('b', 50, '2026-06-01', new Date(NOW.getTime() + 3 * DAY).toISOString()),
        tx('c', -100, '2026-06-15'),
      ],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(0);
    expect(r.expiringSoon.amount).toBe(50); // lô mới sống sót, đang trong cửa sổ nhắc
  });

  it('POINTS_EXPIRED âm trước đó đã tiêu hết lô hết hạn → expiredNow = 0 (idempotent)', () => {
    const r = computePointExpiry(
      [
        tx('a', 100, '2025-01-01', '2026-01-01'),
        // cron lần trước tạo âm -100 (không expiresAt) → replay FIFO tiêu lại lô a.
        tx('e', -100, '2026-07-05'),
      ],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(0);
  });

  it('lô không hết hạn (expiresAt null) không bao giờ tính là hết hạn', () => {
    const r = computePointExpiry([tx('a', 100, '2020-01-01', null)], NOW, WINDOW);
    expect(r.expiredNow).toBe(0);
    expect(r.expiringSoon.amount).toBe(0);
  });

  it('cửa sổ sắp hết hạn: chỉ tính lô trong (now, now+window]; lấy earliest', () => {
    const soonEarly = new Date(NOW.getTime() + 3 * DAY).toISOString();
    const soonLate = new Date(NOW.getTime() + 5 * DAY).toISOString();
    const outside = new Date(NOW.getTime() + 10 * DAY).toISOString();
    const expired = '2026-01-01';
    const r = computePointExpiry(
      [
        tx('a', 20, '2025-07-01', expired), // đã hết hạn
        tx('b', 40, '2025-08-01', soonLate), // sắp hết hạn (5 ngày)
        tx('c', 60, '2025-09-01', soonEarly), // sắp hết hạn (3 ngày) — earliest
        tx('d', 80, '2025-10-01', outside), // ngoài cửa sổ
      ],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(20);
    expect(r.expiringSoon.amount).toBe(100); // 40 + 60
    expect(r.expiringSoon.earliestExpiresAt?.toISOString()).toBe(soonEarly);
  });

  it('không có gì hết hạn → {0, {0, null}}', () => {
    const future = new Date(NOW.getTime() + 100 * DAY).toISOString();
    const r = computePointExpiry([tx('a', 100, '2026-06-01', future)], NOW, WINDOW);
    expect(r).toEqual({ expiredNow: 0, expiringSoon: { amount: 0, earliestExpiresAt: null } });
  });

  it('không có giao dịch → {0, {0, null}}', () => {
    expect(computePointExpiry([], NOW, WINDOW)).toEqual({
      expiredNow: 0,
      expiringSoon: { amount: 0, earliestExpiresAt: null },
    });
  });

  it('deterministic: sort theo createdAt asc, tiebreak id asc dù input xáo trộn', () => {
    // a & b cùng createdAt; a (id nhỏ hơn) là lô CÒN HẠN, b là lô HẾT HẠN.
    // FIFO + tiebreak id asc → tiêu a trước. expiredNow phải = 100 (b hết hạn nguyên vẹn).
    // Nếu tiebreak sai (b trước) → tiêu b, còn a → expiredNow=50 (sai).
    const soon = new Date(NOW.getTime() + 4 * DAY).toISOString();
    const r = computePointExpiry(
      [
        tx('c', -50, '2025-02-01'),
        tx('b', 100, '2025-01-01T00:00:00.000Z', '2026-01-01'),
        tx('a', 50, '2025-01-01T00:00:00.000Z', soon),
      ],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(100);
    expect(r.expiringSoon.amount).toBe(0); // a (còn hạn) đã bị tiêu hết
  });

  it('tiêu vượt số lô còn lại (bất biến vỡ) → bỏ qua phần dư, không âm', () => {
    const r = computePointExpiry(
      [tx('a', 50, '2025-01-01', '2026-01-01'), tx('b', -80, '2025-06-01')],
      NOW,
      WINDOW,
    );
    expect(r.expiredNow).toBe(0);
  });
});

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

describe('LoyaltyExpiryService.expirePoints (cron)', () => {
  function setup(opts: {
    candidates: { userId: string }[];
    userTxns: PointExpiryTxn[];
    updateCount: number;
  }) {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(opts.candidates) // ứng viên (distinct userId)
      .mockResolvedValueOnce(opts.userTxns); // toàn bộ txn của user đó
    const txUpdateMany = jest.fn().mockResolvedValue({ count: opts.updateCount });
    const txCreate = jest.fn().mockResolvedValue({});
    const txObj = {
      user: { updateMany: txUpdateMany },
      pointsTransaction: { create: txCreate },
    };
    const $transaction = jest.fn(async (cb: (t: typeof txObj) => Promise<unknown>) => cb(txObj));
    const prisma = {
      pointsTransaction: { findMany },
      $transaction,
    } as unknown as PrismaService;
    const notifications = { notify: jest.fn() } as unknown as NotificationsService;
    const svc = new LoyaltyExpiryService(prisma, config, notifications);
    return { svc, findMany, txUpdateMany, txCreate, $transaction };
  }

  it('user có expiredNow>0 → decrement có guard gte + tạo POINTS_EXPIRED txn (cặp atomic)', async () => {
    const { svc, txUpdateMany, txCreate } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 100, '2025-01-01', '2026-01-01')], // expiredNow=100
      updateCount: 1,
    });
    await svc.expirePoints();

    expect(txUpdateMany).toHaveBeenCalledTimes(1);
    const upd = txUpdateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'u1', pointsBalance: { gte: 100 } });
    expect(upd.data).toEqual({ pointsBalance: { decrement: 100 } });

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(txCreate.mock.calls[0][0].data).toMatchObject({
      userId: 'u1',
      delta: -100,
      reason: 'POINTS_EXPIRED',
      refType: 'EXPIRE',
    });
  });

  it('balance-guard count=0 (số dư < expiredNow) → KHÔNG tạo txn (bỏ qua, không âm)', async () => {
    const { svc, txUpdateMany, txCreate } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 100, '2025-01-01', '2026-01-01')],
      updateCount: 0, // guard chặn: không có dòng nào bị decrement
    });
    await svc.expirePoints();

    expect(txUpdateMany).toHaveBeenCalledTimes(1);
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('expiredNow=0 → không mở transaction', async () => {
    const { svc, $transaction } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 100, '2020-01-01', null)], // null = không hết hạn
      updateCount: 1,
    });
    await svc.expirePoints();
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('LoyaltyExpiryService.remindExpiringPoints (cron)', () => {
  function setup(opts: {
    candidates: { userId: string }[];
    userTxns: PointExpiryTxn[];
    recentLog: unknown;
  }) {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(opts.candidates)
      .mockResolvedValueOnce(opts.userTxns);
    const notifFindFirst = jest.fn().mockResolvedValue(opts.recentLog);
    const notify = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      pointsTransaction: { findMany },
      notificationLog: { findFirst: notifFindFirst },
    } as unknown as PrismaService;
    const notifications = { notify } as unknown as NotificationsService;
    const svc = new LoyaltyExpiryService(prisma, config, notifications);
    return { svc, findMany, notifFindFirst, notify };
  }

  it('user có điểm sắp hết hạn + chưa nhắc gần đây → notify POINTS_EXPIRING', async () => {
    const soon = new Date(Date.now() + 3 * DAY);
    const { svc, notify } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 40, '2025-08-01', soon.toISOString())],
      recentLog: null,
    });
    await svc.remindExpiringPoints();
    expect(notify).toHaveBeenCalledTimes(1);
    const [uid, code, vars] = notify.mock.calls[0];
    expect(uid).toBe('u1');
    expect(code).toBe('POINTS_EXPIRING');
    expect(vars.points).toBe('40');
    expect(typeof vars.date).toBe('string');
  });

  it('đã nhắc trong kỳ (NotificationLog gần đây) → bỏ qua, KHÔNG notify (dedup)', async () => {
    const soon = new Date(Date.now() + 3 * DAY);
    const { svc, notify } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 40, '2025-08-01', soon.toISOString())],
      recentLog: { id: 'log-1' },
    });
    await svc.remindExpiringPoints();
    expect(notify).not.toHaveBeenCalled();
  });

  it('không có điểm nào trong cửa sổ (amount=0) → không notify', async () => {
    const { svc, notify } = setup({
      candidates: [{ userId: 'u1' }],
      userTxns: [tx('a', 40, '2020-01-01', '2026-01-01')], // đã hết hạn, không "sắp"
      recentLog: null,
    });
    await svc.remindExpiringPoints();
    expect(notify).not.toHaveBeenCalled();
  });
});
