import { GIFT_ATTACH_MIN_NET_GOODS_VND, LAUNCH_WATCH_WINDOWS, RECYCLE_FUNNEL_STEPS } from '@tubutree/shared-types';
import type { LaunchWatchWebhookReject } from '@tubutree/shared-types';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { LaunchWatchService, ZERO_GIFT_RULES_SINCE } from './launch-watch.service';
import type { WebhookRejectCounterService } from './webhook-reject-counter.service';

const H = 3_600_000;
const D = 24 * H;
const NOW = new Date('2026-11-16T12:00:00.000Z');

type Row = Record<string, unknown>;
interface Plan {
  funnel?: (since: string) => Row[];
  confirmed?: Row;
  unverified?: Row;
  zeroGift?: Row;
  freeShip?: Row;
  secondOrder?: Row;
  /** Giá trị khoá ops.webhook_reject_alert_per_hour; vắng mặt = chưa cấu hình (service nhận mặc định của lời gọi). */
  threshold?: unknown;
  rejects?: LaunchWatchWebhookReject[];
}

const emptyRejects = (alert = false): LaunchWatchWebhookReject[] => [
  { source: 'pancake', lastHour: 0, last24h: 0, peakPerHour: 0, lastAt: null, alert },
  { source: 'gomdon', lastHour: 0, last24h: 0, peakPerHour: 0, lastAt: null, alert: false },
];

/** Bản giả của WebhookRejectCounterService và SystemConfigService: bộ đếm có spec riêng, ở đây chỉ kiểm cách LaunchWatchService dùng chúng. */
function fakeCollaborators(plan: Plan = {}) {
  const summary = jest.fn(async (_now: Date, _threshold: number) => plan.rejects ?? emptyRejects());
  const configGet = jest.fn(async (_key: string, fallback: unknown) => ('threshold' in plan ? plan.threshold : fallback));
  return {
    summary,
    configGet,
    rejects: { summary } as unknown as WebhookRejectCounterService,
    config: { get: configGet } as unknown as SystemConfigService,
  };
}

/**
 * Giả `$queryRaw` theo nội dung câu SQL (không theo thứ tự gọi): mỗi truy vấn có một dấu hiệu riêng. Đo số truy vấn chạy cùng lúc cao nhất.
 * Ghi lại phần chuỗi và tham số để kiểm câu lệnh được tham số hoá và đúng mốc thời gian.
 */
function fakePrisma(plan: Plan = {}) {
  const calls: { sql: string; values: unknown[] }[] = [];
  let inflight = 0;
  const stats = { maxInflight: 0 };
  const queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    calls.push({ sql, values });
    inflight += 1;
    stats.maxInflight = Math.max(stats.maxInflight, inflight);
    await Promise.resolve();
    inflight -= 1;
    if (sql.includes('GROUPING SETS')) return plan.funnel ? plan.funnel(String(values[0])) : [];
    if (sql.includes("'recycle_confirmed'")) return [plan.confirmed ?? { requests: 0n, users: 0n }];
    if (sql.includes('u."phoneVerifiedAt" IS NULL')) return [plan.unverified ?? { totalRequests: 0n, requests: 0n, users: 0n, pointsAwarded: 0n }];
    if (sql.includes('per_order')) return [plan.zeroGift ?? { attached: 0n, accounts: 0n, maxPerAccount: 0, ordersOverOne: 0n, ordersBelowMin: 0n }];
    if (sql.includes('"hasRecyclingPickup"')) return [plan.freeShip ?? { totalOrders: 0n, orders: 0n, users: 0n, withConfirmedWaste: 0n }];
    if (sql.includes('ROW_NUMBER')) return [plan.secondOrder ?? { maturedCustomers: 0n, maturedWithSecond: 0n, pendingCustomers: 0n, pendingWithSecond: 0n }];
    throw new Error(`truy vấn lạ: ${sql}`);
  });
  const collab = fakeCollaborators(plan);
  const service = new LaunchWatchService({ $queryRaw: queryRaw } as unknown as PrismaService, collab.rejects, collab.config);
  return { service, queryRaw, calls, stats, summary: collab.summary, configGet: collab.configGet };
}

const iso = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('LaunchWatchService.getSnapshot', () => {
  it('chạy đúng 16 truy vấn (5 mỗi cửa sổ x 3 + đơn thứ hai), mọi giá trị đi qua tham số chứ không nối chuỗi', async () => {
    const { service, queryRaw, calls } = fakePrisma();
    await service.getSnapshot(NOW);
    expect(queryRaw).toHaveBeenCalledTimes(16);
    for (const c of calls) {
      expect(c.sql).not.toMatch(/2026|T12:00/);
      expect(c.values.length).toBeGreaterThan(0);
    }
  });

  it('mốc since của ba cửa sổ là now - 72 giờ / 7 ngày / 30 ngày (so theo receivedAt/createdAt, ép ::timestamp)', async () => {
    const { service, calls } = fakePrisma();
    await service.getSnapshot(NOW);
    const sinceOf = (marker: string) => calls.filter((c) => c.sql.includes(marker)).map((c) => c.values[0]);
    const expected = [iso(72 * H), iso(7 * D), iso(30 * D)];
    expect(sinceOf('GROUPING SETS').sort()).toEqual([...expected].sort());
    expect(sinceOf("'recycle_confirmed'").sort()).toEqual([...expected].sort());
    expect(sinceOf('u."phoneVerifiedAt" IS NULL').sort()).toEqual([...expected].sort());
    expect(calls.filter((c) => c.sql.includes('::timestamp')).length).toBe(16);
    expect(calls.find((c) => c.sql.includes('GROUPING SETS'))!.sql).toContain('"receivedAt"');
  });

  it('ngưỡng quà 0đ lấy từ GIFT_ATTACH_MIN_NET_GOODS_VND và truyền như tham số', async () => {
    const { service, calls } = fakePrisma();
    await service.getSnapshot(NOW);
    const gift = calls.filter((c) => c.sql.includes('per_order'));
    expect(gift).toHaveLength(3);
    for (const c of gift) expect(c.values).toContain(GIFT_ATTACH_MIN_NET_GOODS_VND);
  });

  it('chạy tuần tự từng truy vấn: không bao giờ có hai truy vấn chạy cùng lúc', async () => {
    const { service, stats } = fakePrisma();
    await service.getSnapshot(NOW);
    expect(stats.maxInflight).toBe(1);
  });

  it('quà 0đ chỉ đếm đơn tạo từ mốc luật W179: cửa sổ trải qua mốc thì lấy mốc, cửa sổ nằm sau mốc thì lấy đầu cửa sổ', async () => {
    const rulesSince = ZERO_GIFT_RULES_SINCE;
    const { service, calls } = fakePrisma();
    const dto = await service.getSnapshot(NOW);
    const gift = calls.filter((c) => c.sql.includes('per_order'));
    expect(gift.map((c) => c.values[0])).toEqual([rulesSince.toISOString(), rulesSince.toISOString(), rulesSince.toISOString()]);
    for (const w of LAUNCH_WATCH_WINDOWS) expect(dto.windows[w].fraud.zeroGift.countedSince).toBe(rulesSince.toISOString());

    const lateRules = new Date(NOW.getTime() - 5 * H);
    const early = new Date(NOW.getTime() - 100 * D);
    const late = fakePrisma();
    const dtoLate = await late.service.getSnapshot(NOW, lateRules);
    expect(dtoLate.windows.h72.fraud.zeroGift.countedSince).toBe(lateRules.toISOString());
    const old = fakePrisma();
    const dtoOld = await old.service.getSnapshot(NOW, early);
    expect(dtoOld.windows.h72.fraud.zeroGift.countedSince).toBe(iso(72 * H));
    expect(dtoOld.windows.d7.fraud.zeroGift.countedSince).toBe(iso(7 * D));
    expect(dtoOld.windows.d30.fraud.zeroGift.countedSince).toBe(iso(30 * D));
  });

  it('một lần thanh toán tách nhiều đơn chỉ là một lần đặt: đếm theo checkoutGroup, chỉ đơn mua lẻ, bỏ đơn huỷ/trả/chờ thanh toán ở đơn thứ hai', async () => {
    const { service, calls } = fakePrisma();
    await service.getSnapshot(NOW);
    const second = calls.find((c) => c.sql.includes('ROW_NUMBER'))!;
    expect(second.sql).toContain('COALESCE(o."checkoutGroup", o.id)');
    expect(second.sql).toContain("o.type = 'RETAIL'");
    expect(second.sql).toContain("NOT IN ('CANCELLED', 'RETURNED', 'PENDING_PAYMENT')");
    const freeShip = calls.filter((c) => c.sql.includes('"hasRecyclingPickup"'));
    expect(freeShip).toHaveLength(3);
    for (const c of freeShip) {
      expect(c.sql).toContain('count(DISTINCT COALESCE(o."checkoutGroup", o.id))');
      expect(c.sql).toContain("o.type = 'RETAIL'");
    }
  });

  it('phễu: đủ mọi bước theo thứ tự, bước thiếu là 0, bước lạ bị bỏ, bigint thành number, dòng platform NULL là tổng', async () => {
    const { service } = fakePrisma({
      funnel: () => [
        { step: 'enter', platform: 'web', actors: 5n },
        { step: 'enter', platform: 'miniapp', actors: 4n },
        { step: 'enter', platform: null, actors: 7n },
        { step: 'submitted', platform: 'miniapp', actors: 2n },
        { step: 'submitted', platform: null, actors: 2n },
        { step: 'khong_co_buoc_nay', platform: 'web', actors: 99n },
        { step: null, platform: null, actors: 1n },
      ],
    });
    const dto = await service.getSnapshot(NOW);
    for (const w of LAUNCH_WATCH_WINDOWS) {
      const rows = dto.windows[w].funnel.rows;
      expect(rows.map((r) => r.step)).toEqual([...RECYCLE_FUNNEL_STEPS]);
      expect(rows[0]).toEqual({ step: 'enter', web: 5, miniapp: 4, total: 7 });
      expect(rows.find((r) => r.step === 'submitted')).toEqual({ step: 'submitted', web: 0, miniapp: 2, total: 2 });
      expect(rows.find((r) => r.step === 'geo_denied')).toEqual({ step: 'geo_denied', web: 0, miniapp: 0, total: 0 });
      expect(typeof rows[0]!.web).toBe('number');
    }
  });

  it('ánh xạ chống gian lận và kho đã nhận rác thật, ép bigint về number (JSON.stringify không được ném lỗi)', async () => {
    const { service } = fakePrisma({
      confirmed: { requests: 6n, users: 4n },
      unverified: { totalRequests: 9n, requests: 3n, users: 2n, pointsAwarded: 120n },
      zeroGift: { attached: 9n, accounts: 4n, maxPerAccount: 3, ordersOverOne: 1n, ordersBelowMin: 2n },
      freeShip: { totalOrders: 8n, orders: 3n, users: 2n, withConfirmedWaste: 1n },
    });
    const dto = await service.getSnapshot(NOW);
    expect(() => JSON.stringify(dto)).not.toThrow();
    const w = dto.windows.h72;
    expect(w.funnel.confirmedRequests).toBe(6);
    expect(w.funnel.confirmedUsers).toBe(4);
    expect(w.fraud.unverifiedPhone).toEqual({ totalRequests: 9, requests: 3, users: 2, pointsAwarded: 120 });
    expect(w.fraud.zeroGift).toEqual({ attached: 9, accounts: 4, maxPerAccount: 3, ordersOverOne: 1, ordersBelowMin: 2, countedSince: ZERO_GIFT_RULES_SINCE.toISOString() });
    expect(w.fraud.freeShipRecycle).toEqual({ orders: 3, users: 2, totalOrders: 8, shareOfOrdersPct: 37.5, withConfirmedWaste: 1 });
  });

  it('shareOfOrdersPct làm tròn 1 chữ số thập phân, null khi cửa sổ chưa có đơn nào', async () => {
    const third = fakePrisma({ freeShip: { totalOrders: 3n, orders: 1n, users: 1n, withConfirmedWaste: 0n } });
    expect((await third.service.getSnapshot(NOW)).windows.d7.fraud.freeShipRecycle.shareOfOrdersPct).toBe(33.3);
    const none = fakePrisma({ freeShip: { totalOrders: 0n, orders: 0n, users: 0n, withConfirmedWaste: 0n } });
    expect((await none.service.getSnapshot(NOW)).windows.d7.fraud.freeShipRecycle.shareOfOrdersPct).toBeNull();
  });

  it('đơn thứ hai: nhóm đã đủ 14 ngày (now-44 đến now-14) và nhóm đang chạy, không theo cửa sổ', async () => {
    const { service, calls } = fakePrisma({ secondOrder: { maturedCustomers: 10n, maturedWithSecond: 3n, pendingCustomers: 4n, pendingWithSecond: 1n } });
    const dto = await service.getSnapshot(NOW);
    expect(dto.secondOrder).toEqual({ windowDays: 14, matured: { customers: 10, withSecond: 3 }, pending: { customers: 4, withSecond: 1 } });
    const q = calls.find((c) => c.sql.includes('ROW_NUMBER'))!;
    expect(q.values).toContain(iso(44 * D));
    expect(q.values).toContain(iso(14 * D));
    expect(q.values).toContain(NOW.toISOString());
  });

  it('generatedAt = now; truy vấn không trả dòng nào thì ra 0 chứ không ném lỗi', async () => {
    const prisma = { $queryRaw: jest.fn(async () => []) } as unknown as PrismaService;
    const { rejects, config } = fakeCollaborators();
    const dto = await new LaunchWatchService(prisma, rejects, config).getSnapshot(NOW);
    expect(dto.generatedAt).toBe(NOW.toISOString());
    expect(dto.windows.h72.fraud.freeShipRecycle).toEqual({ orders: 0, users: 0, totalOrders: 0, shareOfOrdersPct: null, withConfirmedWaste: 0 });
    expect(dto.windows.h72.fraud.unverifiedPhone).toEqual({ totalRequests: 0, requests: 0, users: 0, pointsAwarded: 0 });
    expect(dto.windows.d30.funnel.rows).toHaveLength(RECYCLE_FUNNEL_STEPS.length);
    expect(dto.secondOrder.matured).toEqual({ customers: 0, withSecond: 0 });
  });

  describe('webhook bị từ chối 401 (W184)', () => {
    it('đọc ngưỡng từ ops.webhook_reject_alert_per_hour (mặc định 10) và đưa vào snapshot cùng số đếm theo nguồn', async () => {
      const rejects: LaunchWatchWebhookReject[] = [
        { source: 'pancake', lastHour: 52, last24h: 600, peakPerHour: 60, lastAt: '2026-11-16T11:55:00.000Z', alert: true },
        { source: 'gomdon', lastHour: 0, last24h: 0, peakPerHour: 0, lastAt: null, alert: false },
      ];
      const { service, summary, configGet } = fakePrisma({ rejects });
      const dto = await service.getSnapshot(NOW);
      expect(configGet).toHaveBeenCalledWith('ops.webhook_reject_alert_per_hour', 10);
      expect(summary).toHaveBeenCalledTimes(1);
      expect(summary).toHaveBeenCalledWith(NOW, 10);
      expect(dto.webhookRejects).toEqual({ thresholdPerHour: 10, sources: rejects });
    });

    it('ngưỡng cấu hình hợp lệ được dùng; sai kiểu hoặc ngoài 1 đến 100000 rơi về 10 (cấu hình hỏng không tắt cảnh báo)', async () => {
      for (const [raw, expected] of [[25, 25], [1, 1], [100000, 100000], ['20', 10], [0, 10], [100001, 10], [2.5, 10], [null, 10], [{ n: 1 }, 10]] as const) {
        const { service, summary } = fakePrisma({ threshold: raw });
        const dto = await service.getSnapshot(NOW);
        expect(dto.webhookRejects.thresholdPerHour).toBe(expected);
        expect(summary).toHaveBeenCalledWith(NOW, expected);
      }
    });

    it('không thêm truy vấn SQL nào vào 16 truy vấn có sẵn (bộ đếm tự đọc bảng của nó qua service)', async () => {
      const { service, queryRaw } = fakePrisma();
      await service.getSnapshot(NOW);
      expect(queryRaw).toHaveBeenCalledTimes(16);
    });

    it('nằm trong snapshot được giữ đệm 60 giây: gọi lại trong 60 giây không đọc lại bộ đếm', async () => {
      const { service, summary } = fakePrisma();
      await service.getSnapshot(NOW);
      await service.getSnapshot(new Date(NOW.getTime() + 59_000));
      expect(summary).toHaveBeenCalledTimes(1);
      await service.getSnapshot(new Date(NOW.getTime() + 60_000));
      expect(summary).toHaveBeenCalledTimes(2);
    });
  });

  describe('bộ nhớ đệm 60 giây', () => {
    it('trong 60 giây không chạy lại truy vấn, hết 60 giây tính lại với mốc mới', async () => {
      const { service, queryRaw } = fakePrisma();
      const a = await service.getSnapshot(NOW);
      expect(queryRaw).toHaveBeenCalledTimes(16);
      const b = await service.getSnapshot(new Date(NOW.getTime() + 59_999));
      expect(b).toBe(a);
      expect(queryRaw).toHaveBeenCalledTimes(16);
      const later = new Date(NOW.getTime() + 60_000);
      const c = await service.getSnapshot(later);
      expect(queryRaw).toHaveBeenCalledTimes(32);
      expect(c.generatedAt).toBe(later.toISOString());
    });

    it('hai lần gọi đồng thời dùng chung một lần tính', async () => {
      const { service, queryRaw } = fakePrisma();
      await Promise.all([service.getSnapshot(NOW), service.getSnapshot(NOW)]);
      expect(queryRaw).toHaveBeenCalledTimes(16);
    });

    it('đồng hồ lùi (mốc nhỏ hơn lúc lưu) không dùng kết quả cũ', async () => {
      const { service, queryRaw } = fakePrisma();
      await service.getSnapshot(NOW);
      await service.getSnapshot(new Date(NOW.getTime() - 1_000));
      expect(queryRaw).toHaveBeenCalledTimes(32);
    });

    it('lần tính lỗi không bị giữ trong đệm: lần sau thử lại', async () => {
      let fail = true;
      const queryRaw = jest.fn(async (strings: TemplateStringsArray) => {
        if (fail && strings.join('?').includes('ROW_NUMBER')) throw new Error('db down');
        return [];
      });
      const { rejects, config } = fakeCollaborators();
      const service = new LaunchWatchService({ $queryRaw: queryRaw } as unknown as PrismaService, rejects, config);
      await expect(service.getSnapshot(NOW)).rejects.toThrow('db down');
      fail = false;
      await expect(service.getSnapshot(new Date(NOW.getTime() + 1_000))).resolves.toMatchObject({ generatedAt: new Date(NOW.getTime() + 1_000).toISOString() });
    });
  });
});
