import { PancakeSyncService } from '../../modules/integrations/pancake/pancake-sync.service';
import { WasteExpiryCron } from '../../modules/waste-exchange/pickup/waste-expiry.cron';
import { WastePickupSweepCron } from '../../modules/waste-exchange/pickup/waste-pickup-sweep.cron';
import { CronRunService } from '../../modules/ops/cron-run.service';
import { setCronRunSink, type CronRunReport } from './track-cron';

const lockedByOther = { $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: async () => [{ locked: false }] }) };

describe('thoát vì bận không được tính là thành công', () => {
  const reports: CronRunReport[] = [];
  beforeEach(() => setCronRunSink({ record: (r) => void reports.push(r) }));
  afterEach(() => {
    setCronRunSink(undefined);
    reports.length = 0;
  });

  it('WasteExpiryCron: khoá advisory đang do replica khác giữ', async () => {
    const cron = new WasteExpiryCron(lockedByOther as never, { snapshot: async () => ({ shortfallLockPct: 1, shortfallLockStreak: 1 }) } as never, {} as never, {} as never);
    await cron.handleCron();
    expect(reports[0]).toMatchObject({ outcome: 'SKIPPED' });
  });

  it('WastePickupSweepCron: khoá advisory đang do replica khác giữ', async () => {
    const cron = new WastePickupSweepCron(lockedByOther as never, {} as never);
    await cron.handleCron();
    expect(reports[0]).toMatchObject({ outcome: 'SKIPPED' });
  });

  it('PancakeSyncService.scheduledSync: lượt đồng bộ khác đang chạy', async () => {
    const svc = new PancakeSyncService({} as never, { isConfigured: () => true } as never, {} as never);
    (svc as unknown as { running: boolean }).running = true;
    await svc.scheduledSync();
    expect(reports[0]).toMatchObject({ outcome: 'SKIPPED' });
  });

  it('chuỗi lỗi, mốc báo và lần thành công cuối còn nguyên sau lần bỏ qua vì bận', async () => {
    const row = { job: 'WasteExpiryCron.handleCron', consecutiveFailures: 3, lastAlertedAt: new Date('2026-10-24T01:00:00Z'), lastSuccessAt: new Date('2026-10-23T00:00:00Z') };
    const upsert = jest.fn(async ({ update }: { update: Record<string, unknown> }) => Object.assign(row, update));
    const svc = new CronRunService({ cronRun: { upsert } } as never);
    setCronRunSink(svc);
    const cron = new WasteExpiryCron(lockedByOther as never, { snapshot: async () => ({ shortfallLockPct: 1, shortfallLockStreak: 1 }) } as never, {} as never, {} as never);
    await cron.handleCron();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(Object.keys(upsert.mock.calls[0]![0].update).sort()).toEqual(['lastFinishedAt', 'lastOutcome']);
    expect(row).toMatchObject({ consecutiveFailures: 3, lastSuccessAt: new Date('2026-10-23T00:00:00Z') });
    expect(row.lastAlertedAt).toEqual(new Date('2026-10-24T01:00:00Z'));
  });
});
