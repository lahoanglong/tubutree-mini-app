import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import type { PrismaService } from '../../prisma/prisma.service';
import { AffiliateLinkLedgerController, RecomputeLinkStatsDto } from './affiliate-link-ledger.controller';
import { AffiliateLinkLedgerService, LINK_RECOMPUTE_ACTION, LINK_RECOMPUTE_ROWS_MAX } from './affiliate-link-ledger.service';

const INT4 = 2_147_483_647;
type Truth = { id: string; shortCode: string; userId: string; conversions: number; revenue: number; trueConversions: bigint; trueRevenue: bigint };
const truth = (id: string, conversions: number, revenue: number, trueConversions: number, trueRevenue: bigint): Truth => ({
  id,
  shortCode: `code${id}`,
  userId: 'ctv',
  conversions,
  revenue,
  trueConversions: BigInt(trueConversions),
  trueRevenue,
});
const sqlOf = (call: unknown[]) => (call[0] as string[]).join('?');

/** Prisma giả: định tuyến $queryRaw theo nội dung câu SQL. */
function fakePrisma(opts: { locked?: boolean; drift: Truth[]; lockable?: string[]; fresh?: Truth[] }) {
  const lockable = () => opts.lockable ?? opts.drift.map((d) => d.id);
  const queryRaw = jest.fn(async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: opts.locked ?? true }];
    if (sql.includes('FOR UPDATE SKIP LOCKED')) return (vals[0] as string[]).filter((id) => lockable().includes(id)).map((id) => ({ id }));
    if (sql.includes('LEFT JOIN LATERAL')) {
      // Đoạn WHERE theo danh sách link là Prisma.sql lồng (một giá trị của template): có nó là lượt đọc lại sau khi khoá.
      const scope = vals.find((v): v is { strings: string[]; values: unknown[] } => typeof v === 'object' && v !== null && 'strings' in v);
      if (!scope?.strings.join('?').includes('ANY(')) return opts.drift;
      const ids = scope.values[0] as string[];
      return (opts.fresh ?? opts.drift).filter((d) => ids.includes(d.id));
    }
    throw new Error(`SQL lạ: ${sql}`);
  });
  const executeRaw = jest.fn().mockResolvedValue(0);
  const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
  const tx = { $queryRaw: queryRaw, $executeRaw: executeRaw, affiliateLink: { count: jest.fn().mockResolvedValue(10) }, adminAuditLog: { create: auditCreate } };
  const transaction = jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
  const prisma = { ...tx, $transaction: transaction } as unknown as PrismaService;
  return { prisma, queryRaw, executeRaw, auditCreate, transaction };
}

describe('AffiliateLinkLedgerService.recompute: tính lại số đơn/doanh số link CTV', () => {
  it('mặc định chỉ xem trước: không mở transaction, không khoá, không ghi, không sổ thao tác', async () => {
    const f = fakePrisma({ drift: [truth('a', 5, 900_000, 3, 600_000n)] });
    const res = await new AffiliateLinkLedgerService(f.prisma).recompute('admin-1');
    expect(res).toMatchObject({ dryRun: true, scanned: 10, fixed: 1, busy: 0, saturated: 0, auditLogId: null, truncated: false });
    expect(res.rows).toEqual([
      { shortCode: 'codea', userId: 'ctv', conversions: { from: 5, to: 3 }, revenue: { from: 900_000, to: 600_000 }, trueRevenue: 600_000, saturated: false, status: 'WILL_FIX' },
    ]);
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.executeRaw).not.toHaveBeenCalled();
    expect(f.auditCreate).not.toHaveBeenCalled();
    expect(f.queryRaw.mock.calls.some((c) => sqlOf(c).includes('advisory'))).toBe(false);
  });

  it('số đúng = hoa hồng chưa REJECTED của đơn mang mã link, đúng CTV chủ link, nền doanh số sàn 0', async () => {
    const f = fakePrisma({ drift: [] });
    await new AffiliateLinkLedgerService(f.prisma).recompute('admin-1');
    const sql = sqlOf(f.queryRaw.mock.calls[0]!);
    expect(sql).toContain(`c."affiliateUserId" = l."userId"`);
    expect(sql).toContain(`o."affiliateLinkCode" = l."shortCode"`);
    expect(sql).toContain(`c."status" <> 'REJECTED'`);
    expect(sql).toContain(`GREATEST(c."commissionableTotal", 0)`);
  });

  it('áp: khoá advisory trước, khoá dòng SKIP LOCKED, đọc lại sau khoá, ghi số kẹp trần, sổ thao tác cùng tx', async () => {
    const drift = [truth('a', 5, 900_000, 3, 600_000n), truth('b', 0, 0, 2, 3_000_000_000n)];
    const f = fakePrisma({ drift });
    const res = await new AffiliateLinkLedgerService(f.prisma).recompute('admin-1', { dryRun: false });
    const order = f.queryRaw.mock.calls.map((c) => sqlOf(c));
    expect(order[0]).toContain('pg_try_advisory_xact_lock');
    const skipAt = order.findIndex((s) => s.includes('SKIP LOCKED'));
    const freshAt = order.findIndex((s, i) => i > skipAt && s.includes('LEFT JOIN LATERAL'));
    expect(skipAt).toBeGreaterThan(0);
    expect(freshAt).toBeGreaterThan(skipAt);
    expect(f.executeRaw).toHaveBeenCalledTimes(1);
    expect(f.executeRaw.mock.calls[0]!.slice(1)).toEqual([['a', 'b'], [3, 2], [600_000, INT4]]);
    expect(res).toMatchObject({ dryRun: false, fixed: 2, busy: 0, saturated: 1, auditLogId: 'audit-1' });
    expect(res.rows.map((r) => [r.shortCode, r.status, r.saturated])).toEqual([
      ['codea', 'FIXED', false],
      ['codeb', 'FIXED', true],
    ]);
    expect(f.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorId: 'admin-1', action: LINK_RECOMPUTE_ACTION, targetType: 'AFFILIATE_LINK', targetIds: ['codea', 'codeb'] }) }),
    );
  });

  it('lượt khác đang giữ khoá advisory → 409, không đọc, không ghi', async () => {
    const f = fakePrisma({ locked: false, drift: [truth('a', 5, 1, 3, 1n)] });
    await expect(new AffiliateLinkLedgerService(f.prisma).recompute('admin-1', { dryRun: false })).rejects.toBeInstanceOf(ConflictException);
    expect(f.queryRaw).toHaveBeenCalledTimes(1);
    expect(f.executeRaw).not.toHaveBeenCalled();
    expect(f.auditCreate).not.toHaveBeenCalled();
  });

  it('dòng đang bị giao dịch khác giữ (SKIP LOCKED bỏ qua) → BUSY, không ghi dòng đó', async () => {
    const f = fakePrisma({ drift: [truth('a', 5, 900_000, 3, 600_000n), truth('b', 9, 9, 1, 1n)], lockable: ['a'] });
    const res = await new AffiliateLinkLedgerService(f.prisma).recompute('admin-1', { dryRun: false });
    expect(f.executeRaw.mock.calls[0]!.slice(1)).toEqual([['a'], [3], [600_000]]);
    expect(res).toMatchObject({ fixed: 1, busy: 1 });
    expect(res.rows.map((r) => [r.shortCode, r.status])).toEqual([
      ['codea', 'FIXED'],
      ['codeb', 'BUSY'],
    ]);
  });

  it('dòng tự đúng lại giữa lúc đọc và lúc khoá → không ghi; link chạm trần mà cột đã ở trần → AT_CAP, không ghi', async () => {
    const f = fakePrisma({ drift: [truth('a', 5, 900_000, 3, 600_000n), truth('c', 4, INT4, 4, 2_500_000_000n)], fresh: [] });
    const res = await new AffiliateLinkLedgerService(f.prisma).recompute('admin-1', { dryRun: false });
    expect(f.executeRaw).not.toHaveBeenCalled();
    expect(res).toMatchObject({ fixed: 0, busy: 0, saturated: 1 });
    expect(res.rows.map((r) => [r.shortCode, r.status])).toEqual([['codec', 'AT_CAP']]);
  });

  it('không còn lệch: gọi lại không ghi gì (idempotent), vẫn ghi sổ thao tác lượt chạy', async () => {
    const f = fakePrisma({ drift: [] });
    const res = await new AffiliateLinkLedgerService(f.prisma).recompute('admin-1', { dryRun: false });
    expect(res).toMatchObject({ fixed: 0, busy: 0, rows: [] });
    expect(f.executeRaw).not.toHaveBeenCalled();
    expect(f.queryRaw.mock.calls.some((c) => sqlOf(c).includes('SKIP LOCKED'))).toBe(false);
    expect(f.auditCreate).toHaveBeenCalledTimes(1);
  });

  it(`trả tối đa ${LINK_RECOMPUTE_ROWS_MAX} dòng, báo truncated, số đếm vẫn đủ`, async () => {
    const drift = Array.from({ length: LINK_RECOMPUTE_ROWS_MAX + 5 }, (_, i) => truth(`l${String(i).padStart(4, '0')}`, 1, 1, 0, 0n));
    const res = await new AffiliateLinkLedgerService(fakePrisma({ drift }).prisma).recompute('admin-1');
    expect(res.rows).toHaveLength(LINK_RECOMPUTE_ROWS_MAX);
    expect(res).toMatchObject({ fixed: LINK_RECOMPUTE_ROWS_MAX + 5, truncated: true });
  });
});

describe('AffiliateLinkLedgerController', () => {
  const errors = (body: object) => validateSync(plainToInstance(RecomputeLinkStatsDto, body), { whitelist: true, forbidNonWhitelisted: true });

  it('chỉ ADMIN, không mở cho nhóm nhân viên nào', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AffiliateLinkLedgerController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, AffiliateLinkLedgerController)).toBeUndefined();
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, AffiliateLinkLedgerController.prototype.recompute)).toBeUndefined();
  });

  it('DTO: dryRun tuỳ chọn, phải là boolean; trường lạ bị từ chối', () => {
    expect(errors({})).toEqual([]);
    expect(errors({ dryRun: false })).toEqual([]);
    expect(errors({ dryRun: 'false' }).length).toBeGreaterThan(0);
    expect(errors({ dryRun: true, userId: 'x' }).length).toBeGreaterThan(0);
  });

  it('chuyển id admin và dryRun xuống service; thiếu dryRun thì service hiểu là xem trước', async () => {
    const svc = { recompute: jest.fn().mockResolvedValue({}) };
    const ctl = new AffiliateLinkLedgerController(svc as unknown as AffiliateLinkLedgerService);
    await ctl.recompute('admin-1', {});
    await ctl.recompute('admin-1', { dryRun: false });
    expect(svc.recompute.mock.calls).toEqual([
      ['admin-1', { dryRun: undefined }],
      ['admin-1', { dryRun: false }],
    ]);
  });
});
