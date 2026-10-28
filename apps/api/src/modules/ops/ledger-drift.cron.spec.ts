import { Logger } from '@nestjs/common';
import { CronAwareLogger } from '../../common/cron-run/cron-aware-logger';
import { setCronRunSink, type CronRunReport } from '../../common/cron-run/track-cron';
import { findPointsLotDrift, type LotBalanceRow } from '../loyalty/points-reconcile';
import { findWalletLedgerDrift } from '../wallet/wallet-reconcile';
import { LedgerDriftCron } from './ledger-drift.cron';
import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

jest.mock('../loyalty/points-reconcile', () => ({
  ...jest.requireActual('../loyalty/points-reconcile'),
  findPointsLotDrift: jest.fn(),
}));
jest.mock('../wallet/wallet-reconcile', () => ({
  ...jest.requireActual('../wallet/wallet-reconcile'),
  findWalletLedgerDrift: jest.fn(),
}));

const pointsDrift = findPointsLotDrift as jest.MockedFunction<typeof findPointsLotDrift>;
const walletDrift = findWalletLedgerDrift as jest.MockedFunction<typeof findWalletLedgerDrift>;

const NO_WALLET_DRIFT = { drifts: [], affectedCount: 0, totalDrift: 0, totalAbsDrift: 0 };
const row = (userId: string, lot: LotBalanceRow['lot'], balance: number, ledgerSum: number): LotBalanceRow => ({ userId, lot, balance, ledgerSum });

function build() {
  const notify = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    $queryRaw: jest.fn(),
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]) },
    pointsTransaction: { create: jest.fn() },
    walletTransaction: { create: jest.fn() },
  };
  const cron = new LedgerDriftCron(prisma as unknown as PrismaService, { notify } as unknown as NotificationsService);
  return { cron, prisma, notify };
}

beforeEach(() => {
  pointsDrift.mockReset().mockResolvedValue([]);
  walletDrift.mockReset().mockResolvedValue(NO_WALLET_DRIFT);
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
    expect(notify).toHaveBeenCalledTimes(1);
    const [adminId, template, data] = notify.mock.calls[0] as [string, string, { title: string; summary: string }];
    expect(adminId).toBe('admin-1');
    expect(template).toBe('OPS_HEALTH_ALERT');
    expect(data.title).toEqual(expect.any(String));
    expect(data.summary).toContain('reconcile:points');
    expect(data.summary).not.toMatch(/u1|u2/);
    error.mockRestore();
  });

  it('lệch Ví: log error và báo admin một lần, nhắc lệnh tra nguyên nhân (Ví không tự sửa)', async () => {
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
    expect(notify).toHaveBeenCalledTimes(1);
    expect((notify.mock.calls[0] as unknown[])[2]).toMatchObject({ summary: expect.stringContaining('reconcile:wallet') });
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
    expect(summary).toContain('reconcile:points');
    expect(summary).toContain('reconcile:wallet');
    error.mockRestore();
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
