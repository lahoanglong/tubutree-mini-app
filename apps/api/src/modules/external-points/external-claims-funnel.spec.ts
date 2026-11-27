import { BadRequestException } from '@nestjs/common';
import type { ExternalClaimFunnel, ExternalClaimFunnelPeriod } from '@tubutree/shared-types';
import { PHONE_MISMATCH_REVIEW_REASON } from './external-claim.rules';
import { ExternalClaimFunnelCache, FUNNEL_CACHE_TTL_MS, FUNNEL_PERIODS, funnelRange, isFunnelPeriod, loadExternalClaimFunnel } from './external-claims-funnel';

const NOW = new Date('2026-11-27T05:00:00.000Z');
const DAY_MS = 86_400_000;

type Rows = { submissions?: object[]; created?: object[]; credited?: object[]; attempts?: object[] };

/** `$queryRaw` dạng tagged template: nhận diện truy vấn qua bảng nó đọc, trả dòng theo bảng đó. */
function fakePrisma(rows: Rows) {
  const $queryRaw = jest.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('"analytics_events"')) return Promise.resolve(rows.submissions ?? []);
    if (sql.includes('WITH credited AS')) return Promise.resolve(rows.credited ?? []);
    if (sql.includes('"external_points_claims"')) return Promise.resolve(rows.created ?? []);
    if (sql.includes('"external_claim_attempts"')) return Promise.resolve(rows.attempts ?? []);
    return Promise.reject(new Error(`truy vấn lạ: ${sql}`));
  });
  return { $queryRaw } as unknown as { $queryRaw: jest.Mock } & Parameters<typeof loadExternalClaimFunnel>[0];
}

describe('funnelRange', () => {
  it.each([
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
  ] as const)('%s: lùi đúng %i × 24 giờ, mốc cuối là lúc gọi', (period, days) => {
    const { from, to } = funnelRange(period, NOW);
    expect(to).toEqual(NOW);
    expect(NOW.getTime() - from.getTime()).toBe(days * DAY_MS);
  });

  it.each([['1d'], [''], ['30'], [undefined], [null]])('kỳ sai %p: 400', (period) => {
    expect(() => funnelRange(period as unknown as ExternalClaimFunnelPeriod, NOW)).toThrow(BadRequestException);
  });

  it('isFunnelPeriod chỉ nhận đúng 3 kỳ', () => {
    expect(FUNNEL_PERIODS.filter(isFunnelPeriod)).toEqual(['7d', '30d', '90d']);
    expect([7, '7D', 'month', {}].some(isFunnelPeriod)).toBe(false);
  });
});

describe('loadExternalClaimFunnel', () => {
  it('ánh xạ bigint sang số và dựng đúng DTO', async () => {
    const prisma = fakePrisma({
      submissions: [{ total: 12n, scan: 7n, typed: 4n }],
      created: [{ matched: 6n, pending_claims: 3n, pending_points: 4500n, phone_review: 1n }],
      credited: [{ credited_claims: 4n, credited_points: 9000n, credited_users: 3n, conv_users: 2n, conv_orders: 5n, conv_gmv: 3_250_000_000n }],
      attempts: [{ unmatched: 3n, phone_rejected: 2n }],
    });
    const out = await loadExternalClaimFunnel(prisma, '30d', NOW);
    expect(out).toEqual<ExternalClaimFunnel>({
      period: '30d',
      from: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
      to: NOW.toISOString(),
      submissions: { total: 12, scan: 7, typed: 4 },
      matchedOrders: 6,
      phoneMismatch: { rejected: 2, review: 1 },
      unmatched: 3,
      pending: { claims: 3, points: 4500 },
      credited: { claims: 4, points: 9000, users: 3 },
      converted: { users: 2, orders: 5, gmv: 3_250_000_000, rate: 0.6667 },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it('chưa ai được cộng: tỉ lệ 0, không chia cho 0; thiếu dòng hay null đều thành 0', async () => {
    const out = await loadExternalClaimFunnel(
      fakePrisma({ credited: [{ credited_claims: 0n, credited_points: null, credited_users: 0n, conv_users: 0n, conv_orders: 0n, conv_gmv: null }] }),
      '7d',
      NOW,
    );
    expect(out.converted).toEqual({ users: 0, orders: 0, gmv: 0, rate: 0 });
    expect(out.credited).toEqual({ claims: 0, points: 0, users: 0 });
    expect(out.submissions).toEqual({ total: 0, scan: 0, typed: 0 });
    expect(out.unmatched).toBe(0);
    expect(Number.isFinite(out.converted.rate)).toBe(true);
  });

  it('kỳ sai bị từ chối trước khi chạm DB', async () => {
    const prisma = fakePrisma({});
    await expect(loadExternalClaimFunnel(prisma, 'all' as never, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('truy vấn chỉ đọc SCAN, lọc đúng kỳ, dùng câu SĐT lệch của luật và định nghĩa GMV chung', async () => {
    const prisma = fakePrisma({});
    await loadExternalClaimFunnel(prisma, '90d', NOW);
    const calls = prisma.$queryRaw.mock.calls as [TemplateStringsArray, ...unknown[]][];
    const text = calls.map(([strings]) => strings.join('?')).join('\n');
    const values = calls.flatMap(([, ...v]) => v);
    expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(text.match(/c\.kind = 'SCAN'/g)).toHaveLength(2);
    expect(text).toContain("o.type = 'RETAIL'");
    expect(text).toContain("o.platform IN ('miniapp', 'web')");
    expect(text).toContain('"mergedIntoId"');
    expect(text).toContain('"external_claim_events"');
    expect(text).toContain("'REJECTED_PHONE_MISMATCH'");
    expect(values).toContain(PHONE_MISMATCH_REVIEW_REASON);
    expect(values).toContain(new Date(NOW.getTime() - 90 * DAY_MS).toISOString());
    expect(values).toContain(NOW.toISOString());
    // GMV_ORDER_SQL là mảnh Prisma.sql lồng vào: trạng thái GMV và loại đơn thử đã dọn.
    expect(JSON.stringify(values)).toContain("CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'");
  });
});

describe('ExternalClaimFunnelCache', () => {
  const funnel = (period: ExternalClaimFunnelPeriod, n: number) => ({ period, matchedOrders: n }) as unknown as ExternalClaimFunnel;

  it('trong 60 giây dùng lại kết quả của đúng kỳ; kỳ khác tính riêng', async () => {
    const cache = new ExternalClaimFunnelCache();
    let n = 0;
    const compute = jest.fn((p: ExternalClaimFunnelPeriod): Promise<ExternalClaimFunnel> => Promise.resolve(funnel(p, ++n)));
    const a = await cache.get('30d', NOW, () => compute('30d'));
    const b = await cache.get('30d', new Date(NOW.getTime() + FUNNEL_CACHE_TTL_MS - 1), () => compute('30d'));
    const c = await cache.get('7d', NOW, () => compute('7d'));
    expect(b).toBe(a);
    expect(c.period).toBe('7d');
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('hết 60 giây, hoặc đồng hồ lùi về trước lúc lưu, thì tính lại', async () => {
    const cache = new ExternalClaimFunnelCache();
    const compute = jest.fn(() => Promise.resolve(funnel('30d', 1)));
    await cache.get('30d', NOW, compute);
    await cache.get('30d', new Date(NOW.getTime() + FUNNEL_CACHE_TTL_MS), compute);
    await cache.get('30d', new Date(NOW.getTime() - 1), compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it('hai lời gọi cùng lúc chỉ chạy một lượt truy vấn', async () => {
    const cache = new ExternalClaimFunnelCache();
    let release!: (v: ExternalClaimFunnel) => void;
    const compute = jest.fn(() => new Promise<ExternalClaimFunnel>((r) => (release = r)));
    const p1 = cache.get('90d', NOW, compute);
    const p2 = cache.get('90d', NOW, compute);
    release(funnel('90d', 9));
    await expect(Promise.all([p1, p2])).resolves.toEqual([funnel('90d', 9), funnel('90d', 9)]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('lượt lỗi không bị giữ lại: lần sau tính lại', async () => {
    const cache = new ExternalClaimFunnelCache();
    const compute = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(funnel('7d', 2));
    await expect(cache.get('7d', NOW, compute)).rejects.toThrow('db down');
    await expect(cache.get('7d', NOW, compute)).resolves.toEqual(funnel('7d', 2));
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe('ExternalClaimsAdminService.funnel', () => {
  it('đi qua bộ đệm: gọi 2 lần trong 60 giây chỉ chạy 4 truy vấn', async () => {
    const { ExternalClaimsAdminService } = await import('./external-claims-admin.service');
    const prisma = fakePrisma({ credited: [{ credited_users: 1n, conv_users: 1n }] });
    const svc = new ExternalClaimsAdminService(prisma as never, {} as never, {} as never, {} as never);
    const a = await svc.funnel('7d', NOW);
    const b = await svc.funnel('7d', new Date(NOW.getTime() + 1000));
    expect(b).toBe(a);
    expect(a.converted.rate).toBe(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
  });
});
