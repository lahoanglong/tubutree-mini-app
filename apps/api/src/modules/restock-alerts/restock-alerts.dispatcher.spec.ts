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
  const dispatchOnce = jest.spyOn(d, 'dispatchOnce');
  return { d, dispatchOnce };
}

const at = (iso: string) => new Date(iso);

beforeEach(() => {
  runExclusive.mockReset();
  runExclusive.mockImplementation(async (_p: unknown, _k: string, fn: () => Promise<number>) => ({ acquired: true, value: await fn() }));
});

describe('RestockAlertsDispatcher.kick (lượt sớm khi MSS đẩy tồn về hàng)', () => {
  it('cờ báo hàng về tắt: không chạy gì', async () => {
    const { d, dispatchOnce } = setup(false);
    expect(await d.kick()).toBe(0);
    expect(runExclusive).not.toHaveBeenCalled();
    expect(dispatchOnce).not.toHaveBeenCalled();
  });

  it('cùng khoá restock-alerts với cron, trả số tin đã gửi', async () => {
    const { d, dispatchOnce } = setup();
    dispatchOnce.mockResolvedValueOnce(7);
    expect(await d.kick(at('2026-11-18T09:00:10Z'))).toBe(7);
    expect(runExclusive.mock.calls[0]![1]).toBe('restock-alerts');
    expect(dispatchOnce).toHaveBeenCalledWith(at('2026-11-18T09:00:10Z'), RESTOCK_SENDS_PER_TICK);
  });

  it('ngân sách tin của phút đồng hồ dùng chung giữa các lượt: giãn tin vẫn ≤ trần mỗi phút; sang phút mới thì đủ lại', async () => {
    const { d, dispatchOnce } = setup();
    dispatchOnce.mockResolvedValueOnce(60).mockResolvedValueOnce(40).mockResolvedValueOnce(5);
    await d.kick(at('2026-11-18T09:00:05Z'));
    await d.kick(at('2026-11-18T09:00:20Z'));
    expect(dispatchOnce.mock.calls[1]![1]).toBe(RESTOCK_SENDS_PER_TICK - 60);
    expect(await d.kick(at('2026-11-18T09:00:40Z'))).toBe(0);
    expect(dispatchOnce).toHaveBeenCalledTimes(2);
    await d.kick(at('2026-11-18T09:01:00Z'));
    expect(dispatchOnce.mock.calls.at(-1)![1]).toBe(RESTOCK_SENDS_PER_TICK);
  });

  it('lượt khác đang giữ khoá: không chạy chồng, trả 0, không trừ ngân sách', async () => {
    const { d, dispatchOnce } = setup();
    runExclusive.mockResolvedValueOnce({ acquired: false });
    expect(await d.kick(at('2026-11-18T09:00:05Z'))).toBe(0);
    expect(dispatchOnce).not.toHaveBeenCalled();
    dispatchOnce.mockResolvedValueOnce(1);
    await d.kick(at('2026-11-18T09:00:06Z'));
    expect(dispatchOnce).toHaveBeenCalledWith(at('2026-11-18T09:00:06Z'), RESTOCK_SENDS_PER_TICK);
  });
});
