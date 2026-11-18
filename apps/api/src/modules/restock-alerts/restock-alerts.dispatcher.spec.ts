import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { RESTOCK_SENDS_PER_TICK, RestockAlertsDispatcher } from './restock-alerts.dispatcher';
import type { RestockAlertsService } from './restock-alerts.service';

const runExclusive = jest.fn();
jest.mock('../../common/cron-leader/run-exclusive', () => ({
  runExclusive: (...args: unknown[]) => runExclusive(...args),
}));

function setup(enabled = true) {
  const restock = { enabled: jest.fn(async () => enabled) } as unknown as RestockAlertsService;
  const d = new RestockAlertsDispatcher({} as PrismaService, restock, {} as NotificationsService);
  const dispatchRun = jest.spyOn(d, 'dispatchRun');
  return { d, dispatchRun };
}

const at = (iso: string) => new Date(iso);
const spent = (n: number, sent = n) => ({ sent, attempted: n });

beforeEach(() => {
  runExclusive.mockReset();
  runExclusive.mockImplementation(async (_p: unknown, _k: string, fn: () => Promise<number>) => ({ acquired: true, value: await fn() }));
});

describe('RestockAlertsDispatcher.kick (lượt sớm khi MSS đẩy tồn về hàng)', () => {
  it('cờ báo hàng về tắt: không chạy gì', async () => {
    const { d, dispatchRun } = setup(false);
    expect(await d.kick()).toBe(0);
    expect(runExclusive).not.toHaveBeenCalled();
    expect(dispatchRun).not.toHaveBeenCalled();
  });

  it('cùng khoá restock-alerts với cron, trả số tin đã gửi', async () => {
    const { d, dispatchRun } = setup();
    dispatchRun.mockResolvedValueOnce(spent(7));
    expect(await d.kick(at('2026-11-18T09:00:10Z'))).toBe(7);
    expect(runExclusive.mock.calls[0]![1]).toBe('restock-alerts');
    expect(dispatchRun).toHaveBeenCalledWith(at('2026-11-18T09:00:10Z'), RESTOCK_SENDS_PER_TICK);
  });

  it('ngân sách chung cho 60 giây gần nhất, không đặt lại ở ranh phút: mọi cửa sổ 60 giây ≤ trần', async () => {
    const { d, dispatchRun } = setup();
    dispatchRun.mockResolvedValueOnce(spent(60)).mockResolvedValueOnce(spent(40)).mockResolvedValueOnce(spent(5));
    await d.kick(at('2026-11-18T09:00:05Z'));
    await d.kick(at('2026-11-18T09:00:20Z'));
    expect(dispatchRun.mock.calls[1]![1]).toBe(RESTOCK_SENDS_PER_TICK - 60);
    expect(await d.kick(at('2026-11-18T09:00:40Z'))).toBe(0);
    expect(await d.kick(at('2026-11-18T09:01:00Z'))).toBe(0);
    expect(dispatchRun).toHaveBeenCalledTimes(2);
    await d.kick(at('2026-11-18T09:01:10Z'));
    expect(dispatchRun.mock.calls.at(-1)![1]).toBe(RESTOCK_SENDS_PER_TICK - 40);
  });

  it('ngân sách trừ theo số dòng đã thử gửi, kể cả lần gửi lỗi', async () => {
    const { d, dispatchRun } = setup();
    dispatchRun.mockResolvedValueOnce(spent(30, 0)).mockResolvedValueOnce(spent(1));
    expect(await d.kick(at('2026-11-18T09:00:05Z'))).toBe(0);
    await d.kick(at('2026-11-18T09:00:06Z'));
    expect(dispatchRun.mock.calls[1]![1]).toBe(RESTOCK_SENDS_PER_TICK - 30);
  });

  it('lượt khác đang giữ khoá: không chạy chồng, trả 0, không trừ ngân sách', async () => {
    const { d, dispatchRun } = setup();
    runExclusive.mockResolvedValueOnce({ acquired: false });
    expect(await d.kick(at('2026-11-18T09:00:05Z'))).toBe(0);
    expect(dispatchRun).not.toHaveBeenCalled();
    dispatchRun.mockResolvedValueOnce(spent(1));
    await d.kick(at('2026-11-18T09:00:06Z'));
    expect(dispatchRun).toHaveBeenCalledWith(at('2026-11-18T09:00:06Z'), RESTOCK_SENDS_PER_TICK);
  });
});
