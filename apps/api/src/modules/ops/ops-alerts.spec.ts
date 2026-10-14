import { decideAlert, opsProblems, type OpsThresholds, type ProblemInput } from './ops-alerts';

const T: OpsThresholds = { unsyncedMinutes: 30, stuckOrders: 1, webhookFailed: 1, queueFailed1h: 5, repeatHours: 6 };

const healthy: ProblemInput = {
  pancake: {
    configured: true,
    stuck: 0,
    webhookFailed24h: 0,
    webhookStuck: 0,
    catalog: { lastOkAt: '2026-10-14T01:00:00.000Z', lastErrorAt: null, lastError: null },
  },
  gomdon: { configured: true, webhookFailed24h: 0, credentialsRejected: false },
  queues: { ok: true, items: [{ name: 'pancake-push', failedLastHour: 0 }] },
};

describe('opsProblems (PLATFORM-5)', () => {
  it('mọi thứ bình thường → không có sự cố', () => {
    expect(opsProblems(healthy, T)).toEqual([]);
  });

  it('đơn kẹt, webhook lỗi, hàng đợi lỗi, Redis mất, catalog lỗi, Gomdon từ chối tài khoản → mỗi thứ một sự cố', () => {
    const keys = opsProblems(
      {
        pancake: {
          configured: true,
          stuck: 3,
          webhookFailed24h: 2,
          webhookStuck: 1,
          catalog: { lastOkAt: '2026-10-14T01:00:00.000Z', lastErrorAt: '2026-10-14T02:00:00.000Z', lastError: 'timeout' },
        },
        gomdon: { configured: true, webhookFailed24h: 1, credentialsRejected: true },
        queues: { ok: true, items: [{ name: 'pancake-push', failedLastHour: 5 }, { name: 'notifications', failedLastHour: 4 }] },
      },
      T,
    ).map((p) => p.key);
    expect(keys).toEqual([
      'pancake.stuck',
      'pancake.webhook',
      'pancake.catalog',
      'gomdon.webhook',
      'gomdon.credentials',
      'queue.pancake-push',
    ]);
  });

  it('Redis không phản hồi → một sự cố hàng đợi', () => {
    expect(opsProblems({ ...healthy, queues: { ok: false, error: 'Redis không phản hồi' } }, T)).toEqual([
      expect.objectContaining({ key: 'queues.down' }),
    ]);
  });

  it('Pancake/Gomdon chưa cấu hình (dev) → không báo các sự cố của chúng', () => {
    const p = opsProblems(
      {
        ...healthy,
        pancake: { ...healthy.pancake, configured: false, stuck: 9, webhookFailed24h: 9 },
        gomdon: { configured: false, webhookFailed24h: 9, credentialsRejected: true },
      },
      T,
    );
    expect(p).toEqual([]);
  });

  it('ngưỡng lấy từ cấu hình: dưới ngưỡng thì chưa báo', () => {
    const p = opsProblems({ ...healthy, pancake: { ...healthy.pancake, stuck: 4 } }, { ...T, stuckOrders: 5 });
    expect(p).toEqual([]);
  });
});

describe('decideAlert', () => {
  const now = new Date('2026-10-14T10:00:00.000Z');
  const prob = (key: string) => ({ key, message: key });

  it('sự cố mới → báo; giữ mốc bắt đầu', () => {
    expect(decideAlert(null, [prob('pancake.stuck')], now, 6)).toEqual({
      send: 'ALERT',
      next: { keys: ['pancake.stuck'], alertSince: now, alertedAt: now },
    });
  });

  it('cùng sự cố trong giờ nhắc lại → không báo lặp', () => {
    const prev = { keys: ['pancake.stuck'], alertSince: new Date('2026-10-14T09:00:00Z'), alertedAt: new Date('2026-10-14T09:00:00Z') };
    expect(decideAlert(prev, [prob('pancake.stuck')], now, 6).send).toBeNull();
  });

  it('quá giờ nhắc lại → báo lại, mốc bắt đầu giữ nguyên', () => {
    const since = new Date('2026-10-14T03:00:00Z');
    const prev = { keys: ['pancake.stuck'], alertSince: since, alertedAt: new Date('2026-10-14T03:59:00Z') };
    expect(decideAlert(prev, [prob('pancake.stuck')], now, 6)).toEqual({
      send: 'ALERT',
      next: { keys: ['pancake.stuck'], alertSince: since, alertedAt: now },
    });
  });

  it('thêm loại sự cố mới khi đang báo → báo ngay', () => {
    const prev = { keys: ['pancake.stuck'], alertSince: new Date('2026-10-14T09:00:00Z'), alertedAt: new Date('2026-10-14T09:50:00Z') };
    expect(decideAlert(prev, [prob('pancake.stuck'), prob('queues.down')], now, 6).send).toBe('ALERT');
  });

  it('một phần sự cố hết → không báo, nhưng nhớ danh sách mới để lần quay lại được báo', () => {
    const prev = { keys: ['pancake.stuck', 'queues.down'], alertSince: new Date('2026-10-14T09:00:00Z'), alertedAt: new Date('2026-10-14T09:50:00Z') };
    const d = decideAlert(prev, [prob('pancake.stuck')], now, 6);
    expect(d.send).toBeNull();
    expect(d.next.keys).toEqual(['pancake.stuck']);
  });

  it('hết sự cố → báo đã ổn một lần rồi thôi', () => {
    const prev = { keys: ['pancake.stuck'], alertSince: new Date('2026-10-14T09:00:00Z'), alertedAt: new Date('2026-10-14T09:50:00Z') };
    expect(decideAlert(prev, [], now, 6)).toEqual({ send: 'RECOVERED', next: { keys: [], alertSince: null, alertedAt: null } });
    expect(decideAlert({ keys: [], alertSince: null, alertedAt: null }, [], now, 6).send).toBeNull();
  });
});
