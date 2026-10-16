import { alertWebhookBody, decideAlert, opsProblems, type OpsThresholds, type ProblemInput } from './ops-alerts';

const T: OpsThresholds = { unsyncedMinutes: 30, stuckOrders: 1, webhookFailed: 1, queueFailed1h: 5, repeatHours: 6, gomdonBacklogMinutes: 15 };

const healthy: ProblemInput = {
  pancake: {
    configured: true,
    stuck: 0,
    stuckRefs: [],
    webhookFailedOpen: 0,
    webhookStuck: 0,
    webhookRefs: [],
    attention: 0,
    attentionRefs: [],
    catalog: { lastOkAt: '2026-10-14T01:00:00.000Z', lastErrorAt: null, lastError: null },
  },
  gomdon: {
    configured: true,
    webhookFailedOpen: 0,
    webhookRefs: [],
    credentialsRejected: false,
    backlog: 0,
    backlogRefs: [],
    attention: 0,
    attentionRefs: [],
  },
  queues: { ok: true, items: [{ name: 'pancake-push', failedLastHour: 0 }] },
  orders: { deliveredEffectsPending: 0, deliveredEffectsRefs: [], graceMinutes: 10 },
};

describe('opsProblems (PLATFORM-5)', () => {
  it('mọi thứ bình thường → không có sự cố', () => {
    expect(opsProblems(healthy, T)).toEqual([]);
  });

  it('đơn kẹt, webhook lỗi, hàng đợi lỗi, Redis mất, catalog lỗi, Gomdon từ chối tài khoản → mỗi thứ một sự cố', () => {
    const keys = opsProblems(
      {
        pancake: {
          ...healthy.pancake,
          stuck: 3,
          webhookFailedOpen: 2,
          webhookStuck: 1,
          attention: 1,
          catalog: { lastOkAt: '2026-10-14T01:00:00.000Z', lastErrorAt: '2026-10-14T02:00:00.000Z', lastError: 'timeout' },
        },
        gomdon: { ...healthy.gomdon, webhookFailedOpen: 1, credentialsRejected: true, backlog: 2, attention: 1 },
        queues: { ok: true, items: [{ name: 'pancake-push', failedLastHour: 5 }, { name: 'notifications', failedLastHour: 4 }] },
        orders: healthy.orders,
      },
      T,
    ).map((p) => p.key);
    expect(keys).toEqual([
      'pancake.stuck',
      'pancake.webhook',
      'pancake.attention',
      'pancake.catalog',
      'gomdon.webhook',
      'gomdon.credentials',
      'gomdon.backlog',
      'gomdon.attention',
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
        pancake: { ...healthy.pancake, configured: false, stuck: 9, webhookFailedOpen: 9, attention: 3 },
        gomdon: { ...healthy.gomdon, configured: false, webhookFailedOpen: 9, credentialsRejected: true, backlog: 4, attention: 2 },
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

describe('lời báo động nêu việc cụ thể (R2-PLATFORM-1, R2-GOMDON-4)', () => {
  it('webhook lỗi, đơn kẹt, đơn cần xử lý Pancake, đơn thu gom chờ vận đơn → kèm mã đơn, tối đa 5 mã', () => {
    const p = opsProblems(
      {
        ...healthy,
        pancake: {
          ...healthy.pancake,
          stuck: 7,
          stuckRefs: ['TUBU1', 'TUBU2', 'TUBU3', 'TUBU4', 'TUBU5', 'TUBU6'],
          webhookFailedOpen: 1,
          webhookRefs: ['TUBU9 (order.status_updated)'],
          attention: 1,
          attentionRefs: ['TUBU8'],
        },
        gomdon: { ...healthy.gomdon, backlog: 1, backlogRefs: ['TUBU7'] },
      },
      T,
    );
    const msg = Object.fromEntries(p.map((x) => [x.key, x.message]));
    expect(msg['pancake.stuck']).toBe('7 đơn quá 30 phút chưa lên Pancake: TUBU1, TUBU2, TUBU3, TUBU4, TUBU5 và 2 việc khác');
    expect(msg['pancake.webhook']).toContain('TUBU9 (order.status_updated)');
    expect(msg['pancake.attention']).toContain('TUBU8');
    expect(msg['gomdon.backlog']).toBe('1 đơn thu gom quá 15 phút chưa tạo được vận đơn Gomdon: TUBU7');
  });

  it('đơn thu gom cần xử lý tay (NEEDS_MANUAL_CHECK, báo động Gomdon đang mở...) → sự cố gomdon.attention kèm mã đơn (R4-SYNC-3a)', () => {
    const p = opsProblems({ ...healthy, gomdon: { ...healthy.gomdon, attention: 2, attentionRefs: ['TUBU2026101409209', 'TUBU5'] } }, T);
    expect(p).toEqual([
      {
        key: 'gomdon.attention',
        message: '2 đơn thu gom cần xử lý tay (tra vận đơn trên Gomdon, tạo vận đơn tay, báo động chưa đóng): TUBU2026101409209, TUBU5',
        items: { count: 2, refs: ['TUBU2026101409209', 'TUBU5'] },
      },
    ]);
  });

  it('đơn cần xử lý Pancake mang số việc và mã đơn để báo động biết khi có việc mới (R4-SYNC-3b)', () => {
    const [p] = opsProblems({ ...healthy, pancake: { ...healthy.pancake, attention: 3, attentionRefs: ['TUBU1', 'TUBU2', 'TUBU3'] } }, T);
    expect(p).toMatchObject({ key: 'pancake.attention', items: { count: 3, refs: ['TUBU1', 'TUBU2', 'TUBU3'] } });
  });

  it('đơn đã giao chưa xong việc sau giao → một sự cố kèm mã đơn, kể cả khi Pancake/Gomdon chưa cấu hình; không phải hàng việc (không báo lại mỗi đơn mới)', () => {
    const problems = opsProblems(
      {
        ...healthy,
        pancake: { ...healthy.pancake, configured: false },
        gomdon: { ...healthy.gomdon, configured: false },
        orders: { deliveredEffectsPending: 2, deliveredEffectsRefs: ['TUBU7', 'TUBU8'], graceMinutes: 10 },
      },
      T,
    );
    expect(problems).toHaveLength(1);
    const [p] = problems;
    expect(p?.key).toBe('orders.delivered_effects');
    expect(p?.message).toContain('2 đơn đã giao chưa xong việc sau giao');
    expect(p?.message).toContain('quá 10 phút: TUBU7, TUBU8');
    expect(p?.items).toBeUndefined();
  });
});

describe('alertWebhookBody (R2-PLATFORM-2)', () => {
  const m = {
    status: 'ALERT' as const,
    title: '⚠️ Sự cố vận hành',
    summary: 'a; b',
    problems: [
      { key: 'pancake.stuck', message: '2 đơn kẹt: TUBU1, TUBU2' },
      { key: 'queues.down', message: 'Hàng đợi không phản hồi' },
    ],
    generatedAt: '2026-10-14T10:00:00.000Z',
  };

  it('Slack và Google Chat chỉ nhận {text}, mỗi sự cố một dòng', () => {
    for (const url of ['https://hooks.slack.com/services/T0/B0/X', 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t']) {
      expect(alertWebhookBody(url, m)).toEqual({ text: '*⚠️ Sự cố vận hành*\n• 2 đơn kẹt: TUBU1, TUBU2\n• Hàng đợi không phản hồi' });
    }
  });

  it('hook khác (n8n...) nhận đủ trường máy đọc kèm text', () => {
    const body = alertWebhookBody('https://n8n.example.test/webhook/ops', m);
    expect(body).toMatchObject({ status: 'ALERT', problems: m.problems, text: expect.stringContaining('TUBU1') });
  });

  it('báo đã ổn: text là câu tóm tắt', () => {
    const body = alertWebhookBody('https://hooks.slack.com/x', { ...m, status: 'RECOVERED', title: '✅ Vận hành đã ổn trở lại', problems: [], summary: 'Hết sự cố.' });
    expect(body).toEqual({ text: '*✅ Vận hành đã ổn trở lại*\nHết sự cố.' });
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

  describe('hàng việc cho người (cần xử lý Pancake / thu gom): việc mới trong giờ nhắc lại cũng báo (R4-SYNC-3b)', () => {
    const since = new Date('2026-10-14T09:00:00Z');
    const work = (count: number, refs: string[]) => ({ key: 'pancake.attention', message: `${count} đơn`, items: { count, refs } });
    const prevWith = (count: number, refs: string[]) => ({
      keys: ['pancake.attention'],
      alertSince: since,
      alertedAt: new Date('2026-10-14T09:45:00Z'),
      tracked: { 'pancake.attention': { count, refs } },
    });

    it('số việc tăng (1 → 3) → báo ngay, nhớ số mới', () => {
      const d = decideAlert(prevWith(1, ['TUBU1']), [work(3, ['TUBU1', 'TUBU2', 'TUBU3'])], now, 6);
      expect(d.send).toBe('ALERT');
      expect(d.next).toMatchObject({ alertSince: since, alertedAt: now, tracked: { 'pancake.attention': { count: 3, refs: ['TUBU1', 'TUBU2', 'TUBU3'] } } });
    });

    it('một việc xong, một việc mới (số giữ nguyên, có mã mới) → báo', () => {
      expect(decideAlert(prevWith(2, ['TUBU1', 'TUBU2']), [work(2, ['TUBU2', 'TUBU9'])], now, 6).send).toBe('ALERT');
    });

    it('bớt việc, không việc mới → không báo, nhớ số mới (việc mới sau đó vẫn được báo)', () => {
      const d = decideAlert(prevWith(3, ['TUBU1', 'TUBU2', 'TUBU3']), [work(2, ['TUBU2', 'TUBU3'])], now, 6);
      expect(d.send).toBeNull();
      expect(d.next.tracked).toEqual({ 'pancake.attention': { count: 2, refs: ['TUBU2', 'TUBU3'] } });
      expect(d.next.alertedAt).toEqual(new Date('2026-10-14T09:45:00Z'));
    });

    it('cùng việc → không báo lặp', () => {
      expect(decideAlert(prevWith(2, ['TUBU1', 'TUBU2']), [work(2, ['TUBU1', 'TUBU2'])], now, 6).send).toBeNull();
    });

    it('trí nhớ cũ chưa có số việc (trước bản này) → không báo dồn lúc deploy', () => {
      const prev = { keys: ['pancake.attention'], alertSince: since, alertedAt: new Date('2026-10-14T09:45:00Z') };
      expect(decideAlert(prev, [work(4, ['TUBU1'])], now, 6).send).toBeNull();
    });
  });

  it('hết sự cố → báo đã ổn một lần rồi thôi', () => {
    const prev = { keys: ['pancake.stuck'], alertSince: new Date('2026-10-14T09:00:00Z'), alertedAt: new Date('2026-10-14T09:50:00Z') };
    expect(decideAlert(prev, [], now, 6)).toEqual({ send: 'RECOVERED', next: { keys: [], alertSince: null, alertedAt: null } });
    expect(decideAlert({ keys: [], alertSince: null, alertedAt: null }, [], now, 6).send).toBeNull();
  });
});
