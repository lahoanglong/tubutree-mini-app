import { BridgeHealthCron } from './bridge-health.cron';

const NOW = new Date('2026-10-23T05:00:00Z');
const min = (n: number) => new Date(NOW.getTime() - n * 60_000);
const health = (o: Record<string, unknown> = {}) => ({ state: 'CONNECTED', zaloUid: 'z', displayName: 'CSKH', avatar: null, since: min(30).toISOString(), lastError: null, queueSize: 0, outboxSize: 0, groupId: 'G1', ...o });

function setup(o: { health?: any; prev?: any; groupCfg?: string; convs?: any[]; schedule?: jest.Mock; count?: number; configured?: boolean; enabled?: boolean } = {}) {
  const prisma: any = {
    supportBridgeStatus: { findUnique: jest.fn().mockResolvedValue(o.prev ?? null), upsert: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    supportConversation: { findMany: jest.fn().mockResolvedValue(o.convs ?? []), count: jest.fn().mockResolvedValue(o.count ?? 0) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'adm1' }]) },
  };
  const bridge: any = { isConfigured: jest.fn().mockReturnValue(o.configured ?? true), health: jest.fn().mockResolvedValue('health' in o ? o.health : health()), setGroup: jest.fn().mockResolvedValue({ ok: true, data: {} }) };
  const config: any = { get: jest.fn().mockImplementation((k: string) => Promise.resolve(k === 'chat.enabled' ? (o.enabled ?? true) : (o.groupCfg ?? 'G1'))) };
  const chat: any = { scheduleForward: o.schedule ?? jest.fn().mockResolvedValue(undefined) };
  const notifications: any = { notify: jest.fn().mockResolvedValue(undefined) };
  const cron = new BridgeHealthCron(prisma, bridge, config, chat, notifications);
  return { cron, prisma, bridge, chat, notifications };
}

const saved = (prisma: any) => prisma.supportBridgeStatus.upsert.mock.calls[0][0];

describe('BridgeHealthCron', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it('health() null → UNREACHABLE, since giữ nguyên khi đã UNREACHABLE từ trước', async () => {
    const a = setup({ health: null });
    await a.cron.everyMinute();
    expect(saved(a.prisma).update).toMatchObject({ state: 'UNREACHABLE', since: NOW });
    const b = setup({ health: null, prev: { state: 'UNREACHABLE', since: min(5), downAlertedAt: null } });
    await b.cron.everyMinute();
    expect(saved(b.prisma).update.since).toEqual(min(5));
  });

  it('lưu trạng thái cầu nối báo về', async () => {
    const { cron, prisma } = setup();
    await cron.everyMinute();
    expect(saved(prisma).update).toMatchObject({ state: 'CONNECTED', displayName: 'CSKH', zaloUid: 'z' });
  });

  it('cầu nối có groupId khác cấu hình (không rỗng) → setGroup(giá trị cấu hình)', async () => {
    const { cron, bridge } = setup({ health: health({ groupId: 'OLD' }), groupCfg: 'G1' });
    await cron.everyMinute();
    expect(bridge.setGroup).toHaveBeenCalledWith('G1');
  });

  it('cấu hình rỗng hoặc trùng thì không gọi setGroup', async () => {
    const a = setup({ health: health({ groupId: 'OLD' }), groupCfg: '' });
    await a.cron.everyMinute();
    expect(a.bridge.setGroup).not.toHaveBeenCalled();
    const b = setup();
    await b.cron.everyMinute();
    expect(b.bridge.setGroup).not.toHaveBeenCalled();
  });

  it('không CONNECTED quá 10 phút, chưa báo → báo admin một lần và đặt downAlertedAt', async () => {
    const { cron, notifications, prisma } = setup({ health: health({ state: 'NEED_QR', since: min(11).toISOString() }), prev: { state: 'NEED_QR', since: min(11), downAlertedAt: null } });
    await cron.everyMinute();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith('adm1', 'OPS_ZALO_BRIDGE_DOWN', expect.objectContaining({ state: 'NEED_QR', since: expect.any(String) }));
    expect(prisma.supportBridgeStatus.update).toHaveBeenCalledWith({ where: { id: 'main' }, data: { downAlertedAt: NOW } });
  });

  it('đã báo cách chưa tới 1 giờ thì không báo lại; quá 1 giờ thì báo lại', async () => {
    const mk = (alerted: Date) => setup({ health: health({ state: 'ERROR', since: min(30).toISOString() }), prev: { state: 'ERROR', since: min(30), downAlertedAt: alerted } });
    const recent = mk(min(30));
    await recent.cron.everyMinute();
    expect(recent.notifications.notify).not.toHaveBeenCalled();
    const old = mk(min(61));
    await old.cron.everyMinute();
    expect(old.notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('mới mất kết nối dưới 10 phút thì chưa báo', async () => {
    const { cron, notifications } = setup({ health: health({ state: 'CONNECTING', since: min(3).toISOString() }), prev: { state: 'CONNECTING', since: min(3), downAlertedAt: null } });
    await cron.everyMinute();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('CONNECTED lại thì xoá downAlertedAt để lần sự cố sau báo ngay', async () => {
    const { cron, prisma } = setup({ prev: { state: 'ERROR', since: min(60), downAlertedAt: min(10) } });
    await cron.everyMinute();
    expect(saved(prisma).update.downAlertedAt).toBeNull();
  });

  describe('quét tin khách chưa chuyển', () => {
    it('tìm hội thoại chưa chặn có tin khách forwardId null quá 2 phút và đặt lịch một lần mỗi hội thoại', async () => {
      const schedule = jest.fn().mockResolvedValue(undefined);
      const { cron, prisma } = setup({ convs: [{ id: 'c1' }, { id: 'c2' }], schedule });
      await cron.everyMinute();
      expect(prisma.supportConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            blockedAt: null,
            OR: [
              { messages: { some: { sender: 'CUSTOMER', forwardId: null, createdAt: { lt: min(2) } } } },
              { forwards: { some: { status: 'PENDING', zaloMsgId: null, updatedAt: { lt: min(10), gte: new Date(NOW.getTime() - 20 * 3_600_000) } } } },
            ],
          },
          take: 100,
        }),
      );
      expect(schedule.mock.calls).toEqual([['c1'], ['c2']]);
    });

    it('forward PENDING bỏ dở: chỉ nhặt khi quá 10 phút và chưa quá 20 giờ (điều kiện where, quá 20 giờ để admin gửi lại tay)', async () => {
      const { cron, prisma } = setup({ convs: [{ id: 'c1' }] });
      await cron.everyMinute();
      const w = prisma.supportConversation.findMany.mock.calls[0][0].where.OR[1].forwards.some.updatedAt;
      expect(w.lt).toEqual(min(10));
      expect(w.gte).toEqual(new Date(NOW.getTime() - 20 * 3_600_000));
    });

    it('một hội thoại lỗi không chặn các hội thoại sau', async () => {
      const schedule = jest.fn().mockRejectedValueOnce(new Error('redis')).mockResolvedValue(undefined);
      const { cron } = setup({ convs: [{ id: 'c1' }, { id: 'c2' }], schedule });
      await cron.everyMinute();
      expect(schedule).toHaveBeenCalledTimes(2);
    });

    it('đủ 100 hội thoại thì ghi log số còn lại', async () => {
      const convs = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}` }));
      const { cron, prisma } = setup({ convs, count: 130 });
      const warn = jest.spyOn((cron as any).logger, 'warn').mockImplementation(() => undefined);
      await cron.everyMinute();
      expect(prisma.supportConversation.count).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('30'));
    });
  });

  it('lỗi ở bước đầu không ném ra khỏi cron và không chặn bước quét', async () => {
    const { cron, bridge, prisma } = setup({ convs: [{ id: 'c1' }] });
    bridge.health.mockRejectedValue(new Error('x'));
    await expect(cron.everyMinute()).resolves.toBeUndefined();
    expect(prisma.supportConversation.findMany).toHaveBeenCalled();
  });

  it('không chạy chồng', async () => {
    const { cron, bridge } = setup();
    let release!: () => void;
    bridge.health.mockImplementation(() => new Promise((r) => { release = () => r(health()); }));
    const first = cron.everyMinute();
    await cron.everyMinute();
    expect(bridge.health).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  describe('theo cấu hình cầu nối và cờ chat.enabled', () => {
    const down = { health: health({ state: 'NEED_QR', groupId: 'OLD', since: min(30).toISOString() }), prev: { state: 'NEED_QR', since: min(30), downAlertedAt: null }, convs: [{ id: 'c1' }] };

    it('chưa cấu hình cầu nối: không làm gì cả', async () => {
      const { cron, bridge, prisma, chat, notifications } = setup({ ...down, configured: false });
      await cron.everyMinute();
      expect(bridge.health).not.toHaveBeenCalled();
      expect(bridge.setGroup).not.toHaveBeenCalled();
      expect(prisma.supportBridgeStatus.upsert).not.toHaveBeenCalled();
      expect(prisma.supportConversation.findMany).not.toHaveBeenCalled();
      expect(chat.scheduleForward).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('đã cấu hình, chat tắt: vẫn kiểm, ghi trạng thái, đồng bộ nhóm và quét, nhưng không báo admin', async () => {
      const { cron, bridge, prisma, chat, notifications } = setup({ ...down, enabled: false });
      await cron.everyMinute();
      expect(prisma.supportBridgeStatus.upsert).toHaveBeenCalled();
      expect(bridge.setGroup).toHaveBeenCalledWith('G1');
      expect(chat.scheduleForward).toHaveBeenCalledWith('c1');
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('đã cấu hình, chat bật: báo admin', async () => {
      const { cron, notifications } = setup({ ...down, enabled: true });
      await cron.everyMinute();
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    });
  });
});
