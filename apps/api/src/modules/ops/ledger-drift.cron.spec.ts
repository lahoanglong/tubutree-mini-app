import { Logger } from '@nestjs/common';
import { CronAwareLogger } from '../../common/cron-run/cron-aware-logger';
import { setCronRunSink, type CronRunReport } from '../../common/cron-run/track-cron';
import { findPointsLotDrift, type LotBalanceRow } from '../loyalty/points-reconcile';
import { findWalletLedgerDrift } from '../wallet/wallet-reconcile';
import { findLinkStatsDrift, type LinkStatsDrift } from '../affiliate/affiliate-link-ledger.service';
import { LedgerDriftCron } from './ledger-drift.cron';
import { OPS_NOTICE_MAX } from './ops-alert-line';
import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SystemConfigService } from '../system-config/system-config.service';

jest.mock('../loyalty/points-reconcile', () => ({
  ...jest.requireActual('../loyalty/points-reconcile'),
  findPointsLotDrift: jest.fn(),
}));
jest.mock('../wallet/wallet-reconcile', () => ({
  ...jest.requireActual('../wallet/wallet-reconcile'),
  findWalletLedgerDrift: jest.fn(),
}));
jest.mock('../affiliate/affiliate-link-ledger.service', () => ({
  ...jest.requireActual('../affiliate/affiliate-link-ledger.service'),
  findLinkStatsDrift: jest.fn(),
}));

const pointsDrift = findPointsLotDrift as jest.MockedFunction<typeof findPointsLotDrift>;
const walletDrift = findWalletLedgerDrift as jest.MockedFunction<typeof findWalletLedgerDrift>;
const linkDrift = findLinkStatsDrift as jest.MockedFunction<typeof findLinkStatsDrift>;
const drift = (shortCode: string, changed: boolean, saturated: boolean): LinkStatsDrift => ({
  id: `id-${shortCode}`,
  shortCode,
  userId: 'ctv-1',
  conversions: { from: 3, to: changed ? 2 : 3 },
  revenue: { from: 2_147_483_647, to: 2_147_483_647 },
  trueRevenue: saturated ? 2_500_000_000 : 2_000_000,
  saturated,
  changed,
});

const NO_WALLET_DRIFT = { drifts: [], affectedCount: 0, totalDrift: 0, totalAbsDrift: 0 };
const row = (userId: string, lot: LotBalanceRow['lot'], balance: number, ledgerSum: number): LotBalanceRow => ({ userId, lot, balance, ledgerSum });

function build(cfg: Record<string, number> = {}) {
  const notify = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    $queryRaw: jest.fn(),
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]) },
    pointsTransaction: { create: jest.fn() },
    walletTransaction: { create: jest.fn() },
    commission: { count: jest.fn().mockResolvedValue(0), update: jest.fn(), updateMany: jest.fn() },
  };
  const config = { get: jest.fn(async (key: string, fallback?: unknown) => (key in cfg ? cfg[key] : fallback)) };
  const cron = new LedgerDriftCron(
    prisma as unknown as PrismaService,
    { notify } as unknown as NotificationsService,
    config as unknown as SystemConfigService,
  );
  return { cron, prisma, notify };
}

beforeEach(() => {
  pointsDrift.mockReset().mockResolvedValue([]);
  walletDrift.mockReset().mockResolvedValue(NO_WALLET_DRIFT);
  linkDrift.mockReset().mockResolvedValue([]);
});

describe('LedgerDriftCron: kiểm lệch sổ điểm/Ví mỗi đêm', () => {
  it('chạy 04:30 giờ VN', () => {
    const meta = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', LedgerDriftCron.prototype.handleCron) as { cronTime: string; timeZone: string };
    expect(meta).toMatchObject({ cronTime: '0 30 4 * * *', timeZone: 'Asia/Ho_Chi_Minh' });
  });

  it('không lệch: không log error, không báo admin', async () => {
    const { cron, notify, prisma } = build();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await cron.handleCron();
    expect(error).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('lệch điểm: log error có số khách và báo admin đúng một lần bằng OPS_HEALTH_ALERT', async () => {
    pointsDrift.mockResolvedValue([row('u1', 'STANDARD', 100, 70), row('u2', 'CONVERTED', 0, 40), row('u1', 'CONVERTED', 5, 5)]);
    const { cron, notify } = build();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await cron.handleCron();
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]![0]);
    expect(line).toContain('Điểm Xanh');
    expect(line).toContain('2');
    expect(line).not.toMatch(/u1|u2/);
    expect(line).toContain('reconcile:points');
    expect(notify).toHaveBeenCalledTimes(1);
    const [adminId, template, data] = notify.mock.calls[0] as [string, string, { title: string; summary: string }];
    expect(adminId).toBe('admin-1');
    expect(template).toBe('OPS_HEALTH_ALERT');
    expect(data.title).toEqual(expect.any(String));
    expect(data.summary).toContain('Điểm Xanh 2 khách');
    expect(`${data.title}: ${data.summary}`.length).toBeLessThanOrEqual(OPS_NOTICE_MAX);
    expect(data.summary).toContain('đội kỹ thuật');
    expect(data.summary).not.toMatch(/pnpm|reconcile/);
    expect(data.summary).not.toMatch(/u1|u2/);
    error.mockRestore();
  });

  it('lệch Ví: log error nhắc lệnh tra nguyên nhân, báo admin một lần bằng câu không kỹ thuật (Ví không tự sửa)', async () => {
    walletDrift.mockResolvedValue({
      drifts: [{ userId: 'w1', walletBalance: 5000, ledgerSum: 3000, entries: 2, drift: 2000 }],
      affectedCount: 1,
      totalDrift: 2000,
      totalAbsDrift: 2000,
    });
    const { cron, notify } = build();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await cron.handleCron();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('Ví');
    expect(String(error.mock.calls[0]![0])).not.toContain('w1');
    expect(String(error.mock.calls[0]![0])).toContain('reconcile:wallet');
    expect(notify).toHaveBeenCalledTimes(1);
    const summary = ((notify.mock.calls[0] as unknown[])[2] as { summary: string }).summary;
    expect(summary).toContain('Ví không tự sửa');
    expect(summary).not.toMatch(/pnpm|reconcile/);
    error.mockRestore();
  });

  it('lệch cả điểm lẫn Ví: vẫn chỉ một tin cho mỗi admin', async () => {
    pointsDrift.mockResolvedValue([row('u1', 'STANDARD', 10, 0)]);
    walletDrift.mockResolvedValue({
      drifts: [{ userId: 'w1', walletBalance: 1, ledgerSum: 0, entries: 0, drift: 1 }],
      affectedCount: 1,
      totalDrift: 1,
      totalAbsDrift: 1,
    });
    const { cron, notify } = build();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await cron.handleCron();
    expect(notify).toHaveBeenCalledTimes(1);
    const summary = ((notify.mock.calls[0] as unknown[])[2] as { summary: string }).summary;
    expect(summary).toContain('Điểm Xanh');
    expect(summary).toContain('Ví Tubu');
    expect(summary).not.toMatch(/pnpm|reconcile/);
    error.mockRestore();
  });

  it('link CTV lệch hoặc chạm trần int4: log warn nhắc lệnh tính lại, một tin admin không kỹ thuật, không log error', async () => {
    linkDrift.mockResolvedValue([drift('abcdA1', true, false), drift('abcdB2', false, true)]);
    const { cron, notify } = build();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await cron.handleCron();
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain('1 link lệch số đơn/doanh số, 1 link chạm trần int4');
    expect(line).toContain('POST /admin/affiliate-links/recompute');
    expect(notify).toHaveBeenCalledTimes(1);
    const data = (notify.mock.calls[0] as unknown[])[2] as { title: string; summary: string };
    expect(data.title).toBe('Đối soát CTV');
    expect(data.summary).toContain('Số liệu CTV cần đối soát');
    expect(data.summary).toContain('Link CTV 1 link lệch số đơn/doanh số');
    expect(data.summary).toContain('đội kỹ thuật');
    expect(data.summary).not.toMatch(/affiliate-links|abcd|ctv-1/);
    expect(`${data.title}: ${data.summary}`.length).toBeLessThanOrEqual(OPS_NOTICE_MAX);
    error.mockRestore();
    warn.mockRestore();
  });

  it('lệch điểm kèm link CTV lệch: vẫn một tin, tên tin theo sổ điểm/Ví', async () => {
    pointsDrift.mockResolvedValue([row('u1', 'STANDARD', 10, 0)]);
    linkDrift.mockResolvedValue([drift('abcdA1', true, false)]);
    const { cron, notify } = build();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await cron.handleCron();
    expect(notify).toHaveBeenCalledTimes(1);
    const data = (notify.mock.calls[0] as unknown[])[2] as { title: string; summary: string };
    expect(data.title).toBe('Sổ cái lệch số dư');
    expect(data.summary).toContain('Sổ điểm/Ví lệch số dư');
    expect(data.summary).toContain('Link CTV 1 link');
    error.mockRestore();
    warn.mockRestore();
  });

  it('đọc số link CTV lỗi: chỉ log warn, vẫn báo lệch sổ điểm như thường', async () => {
    pointsDrift.mockResolvedValue([row('u1', 'STANDARD', 10, 0)]);
    linkDrift.mockRejectedValue(new Error('link query down'));
    const { cron, notify } = build();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await cron.handleCron();
    expect(warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes('link query down'))).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(((notify.mock.calls[0] as unknown[])[2] as { summary: string }).summary).toContain('Điểm Xanh');
    error.mockRestore();
    warn.mockRestore();
  });

  it('hoa hồng đơn khách đã giao quá hạn giữ mà chưa thu tiền: đếm theo hold thực, log warn, một tin "Đối soát CTV" chỉ có số khoản', async () => {
    const { cron, prisma, notify } = build({ 'affiliate.hold_days': 10, 'returns.window_days': 14 });
    prisma.commission.count.mockResolvedValue(3);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const before = Date.now();
    await cron.handleCron();
    const where = prisma.commission.count.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      status: 'LOCKED',
      order: { status: 'DELIVERED', guestPhone: { not: null }, NOT: { OR: [{ paymentStatus: 'PAID' }, { paymentMethod: 'COD', paymentStatus: 'UNPAID' }] } },
    });
    const cutoff = (where.lockedAt.lte as Date).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 14 * 864e5 - 5);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 14 * 864e5);
    expect(error).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes('3 khoản') && m.includes('14 ngày'))).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    const data = (notify.mock.calls[0] as unknown[])[2] as { title: string; summary: string };
    expect(data.title).toBe('Đối soát CTV');
    expect(data.summary).toContain('Hoa hồng CTV 3 khoản đơn khách đã giao mà chưa thu tiền');
    expect(`${data.title}: ${data.summary}`.length).toBeLessThanOrEqual(OPS_NOTICE_MAX);
    expect(prisma.commission.update).not.toHaveBeenCalled();
    expect(prisma.commission.updateMany).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });

  it('đếm hoa hồng đơn khách lỗi: chỉ log warn, vẫn báo lệch sổ điểm như thường', async () => {
    pointsDrift.mockResolvedValue([row('u1', 'STANDARD', 10, 0)]);
    const { cron, prisma, notify } = build();
    prisma.commission.count.mockRejectedValue(new Error('count down'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await cron.handleCron();
    expect(warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes('count down'))).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(((notify.mock.calls[0] as unknown[])[2] as { summary: string }).summary).toContain('Điểm Xanh');
    error.mockRestore();
    warn.mockRestore();
  });

  it('chỉ đọc: không ghi sổ điểm, sổ ví hay số dư', async () => {
    pointsDrift.mockResolvedValue([row('u1', 'STANDARD', 10, 0)]);
    const { cron, prisma } = build();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await cron.handleCron();
    expect(prisma.pointsTransaction.create).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    expect((prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('truy vấn đối soát lỗi: log error (không ném ra ngoài @Cron)', async () => {
    pointsDrift.mockRejectedValue(new Error('db down'));
    const { cron, notify } = build();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(cron.handleCron()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('db down');
    expect(notify).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('báo admin lỗi thì vẫn log error về lệch sổ (lệch không bị nuốt vì tin hỏng)', async () => {
    pointsDrift.mockResolvedValue([row('u1', 'STANDARD', 10, 0)]);
    const { cron, notify } = build();
    notify.mockRejectedValue(new Error('zns down'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(cron.handleCron()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });

  describe('kết quả ghi vào cron_run', () => {
    const reports: CronRunReport[] = [];
    beforeEach(() => {
      reports.length = 0;
      setCronRunSink({ record: (r) => void reports.push(r) });
    });
    afterEach(() => setCronRunSink(undefined));

    async function runWithAwareLogger(cron: LedgerDriftCron) {
      const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      Logger.overrideLogger(new CronAwareLogger());
      try {
        await cron.handleCron();
      } finally {
        Logger.overrideLogger(['error']);
        write.mockRestore();
      }
    }

    it('có lệch: outcome ERRORS để màn Sức khoẻ vận hành thấy', async () => {
      pointsDrift.mockResolvedValue([row('u1', 'STANDARD', 10, 0)]);
      const { cron } = build();
      await runWithAwareLogger(cron);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ outcome: 'ERRORS', errorLine: expect.stringContaining('Điểm Xanh') });
    });

    it('không lệch: outcome OK', async () => {
      const { cron } = build();
      await runWithAwareLogger(cron);
      expect(reports[0]).toMatchObject({ outcome: 'OK', errorCount: 0 });
    });
  });
});
