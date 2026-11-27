import { ConflictException } from '@nestjs/common';
import { recipientFingerprint } from './claim-trust-signals';
import { CLAIM_CONFIG_DEFAULTS } from './external-claim.config';
import { NO_PHONE_REVIEW_REASON } from './external-claim.rules';
import type { LockedClaim } from './external-claims-admin.service';
import {
  ExternalClaimsNoPhoneBatchService,
  NO_PHONE_BATCH_AUDIT_ACTION,
  NO_PHONE_BATCH_MAX,
  NO_PHONE_BATCH_NOTE,
  noPhoneOnlyBlock,
} from './external-claims-no-phone-batch.service';

const NOW = new Date('2026-11-27T10:00:00.000Z');
const CTX = { now: NOW, cfg: { ...CLAIM_CONFIG_DEFAULTS, enabled: true, earnPct: 5 } };

type ClaimOver = Partial<Omit<LockedClaim, 'externalOrder'>> & { order?: Partial<LockedClaim['externalOrder']> };
function claim(over: ClaimOver = {}): LockedClaim {
  const { order, ...rest } = over;
  return {
    id: 'c1', externalOrderId: 'o1', userId: 'u1', kind: 'SCAN', state: 'REVIEW', ratePct: 5 as never, multiplier: 1 as never, points: 12_500,
    countsForTier: false, claimedCode: 'LZ123456789', releaseAt: null, holdUntil: null, creditedAt: null, pointsTxId: null, voidReason: null,
    reviewReason: NO_PHONE_REVIEW_REASON, decidedById: null, createdAt: new Date('2026-11-20T00:00:00Z'), orderPhone: null, creatorRef: null, dayKey: '2026-11-20',
    ...rest,
    externalOrder: {
      id: 'o1', pancakeOrderId: 'P1', source: 'MARKETPLACE', channel: 'lazada', sourceKey: 'k', trackingCode: 'LZ123456789', trackingCodes: ['LZ123456789'],
      marketplaceOrderSn: null, phone: null, phoneLast3: null, phoneMask: '***', goodsValue: 250_000, pancakeStatus: 3, status: 'DELIVERED',
      pancakeInsertedAt: null, pancakeUpdatedAt: null, deliveredAt: null, closedAt: null, lastPayload: {}, firstSeenAt: NOW, updatedAt: NOW, chatCheckedAt: null,
      ...order,
    },
  } as unknown as LockedClaim;
}

const MEMBER = { id: 'u1', fullName: 'Nguyễn Thị Lan', phone: '0981234526', phoneVerifiedAt: new Date('2026-11-01T00:00:00Z'), zaloId: 'z1', isBlocked: false, role: 'CUSTOMER', mergedIntoId: null };

function fakeDb(o: { member?: Partial<typeof MEMBER> | null; delivered?: number; credited?: number; monthPoints?: number | null } = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(o.member === null ? null : { ...MEMBER, ...o.member }) },
    order: { count: jest.fn().mockResolvedValue(o.delivered ?? 1) },
    externalPointsClaim: {
      count: jest.fn().mockResolvedValue(o.credited ?? 0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { points: o.monthPoints === undefined ? 0 : o.monthPoints } }),
    },
  };
}
const block = (c: LockedClaim, db: ReturnType<typeof fakeDb> = fakeDb()) => noPhoneOnlyBlock(db as never, c, CTX);

describe('noPhoneOnlyBlock', () => {
  it('đủ điều kiện: Lazada, thành viên đã xác minh, có đơn app đã nhận, không vướng gì', async () => {
    await expect(block(claim())).resolves.toBeNull();
  });

  it('khách quen nhờ claim đơn sàn khác đã cộng và còn đứng (chưa có đơn app) cũng đủ; đếm claim KHÁC chính nó', async () => {
    const db = fakeDb({ delivered: 0, credited: 2 });
    await expect(block(claim(), db)).resolves.toBeNull();
    expect(db.externalPointsClaim.count.mock.calls[0]![0]).toEqual({
      where: { userId: 'u1', kind: 'SCAN', state: 'CREDITED', reviewReason: null, externalOrder: { status: { notIn: ['CANCELLED', 'RETURNED', 'DELETED'] } }, id: { not: 'c1' } },
    });
    expect(db.order.count.mock.calls[0]![0].where).toMatchObject({ userId: 'u1', status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false });
  });

  it.each<[string, ClaimOver, ReturnType<typeof fakeDb> | undefined, RegExp]>([
    ['lý do REVIEW khác', { reviewReason: 'Giá trị đơn vượt ngưỡng tự duyệt' }, undefined, /không còn chờ duyệt vì đơn sàn thiếu SĐT/],
    ['claim chat', { kind: 'PHONE' }, undefined, /không còn chờ duyệt/],
    ['đã duyệt', { state: 'PENDING' }, undefined, /không còn chờ duyệt/],
    ['đơn Shopee', { order: { channel: 'shopee' } }, undefined, /Chỉ duyệt nhanh đơn Lazada/],
    ['chưa có thành viên', { userId: null }, undefined, /chưa gắn thành viên/],
    ['thành viên đã gộp', {}, fakeDb({ member: { mergedIntoId: 'u2' } as never }), /không còn đủ điều kiện/],
    ['thành viên bị khoá', {}, fakeDb({ member: { isBlocked: true } }), /không còn đủ điều kiện/],
    ['chưa xác minh SĐT', {}, fakeDb({ member: { phoneVerifiedAt: null } as never }), /không còn đủ điều kiện/],
    ['tài khoản không còn', {}, fakeDb({ member: null }), /không còn đủ điều kiện/],
    ['nhân viên', {}, fakeDb({ member: { role: 'STAFF' } }), /nhân viên/],
    ['SĐT trên đơn nay đọc được và lệch', { order: { phone: '0911222333' } }, undefined, /khác SĐT thành viên/],
    ['khách mới (chưa đơn app, chưa claim đã cộng)', {}, fakeDb({ delivered: 0, credited: 0 }), /chưa nhận đơn app nào/],
    ['đơn đang hoàn', { order: { status: 'RETURNING' } }, undefined, /Đơn đang hoàn/],
    ['đơn hoàn một phần', { order: { status: 'PARTIAL_RETURN' } }, undefined, /đã hoàn một phần/],
    ['tiền hàng chưa tính được', { order: { goodsValue: null } }, undefined, /chưa tính được tiền hàng/],
    ['vượt ngưỡng tự duyệt', { order: { goodsValue: 2_500_000 } }, undefined, /vượt ngưỡng/],
    ['vượt trần tháng (xét chặt)', {}, fakeDb({ monthPoints: 190_000 }), /Vượt trần điểm tháng/],
  ])('%s: không duyệt nhanh', async (_n, over, db, reason) => {
    await expect(block(claim(over), db)).resolves.toMatch(reason);
  });

  it('SĐT trên đơn khớp hoặc vẫn che: không chặn', async () => {
    await expect(block(claim({ order: { phone: '0981234526' } }))).resolves.toBeNull();
    await expect(block(claim({ order: { phoneMask: '098*****26' } }))).resolves.toBeNull();
  });

  it('tên người nhận khác hẳn tên thành viên thì duyệt tay; gần khớp hay khớp thì không chặn', async () => {
    const payload = (name: string) => ({ tubu_recipient: recipientFingerprint({ shipping_address: { full_name: name } }) });
    await expect(block(claim({ order: { lastPayload: payload('Trần Văn Hùng') } }))).resolves.toMatch(/Tên người nhận/);
    await expect(block(claim({ order: { lastPayload: payload('Lan Nguyễn') } }))).resolves.toBeNull();
    await expect(block(claim({ order: { lastPayload: payload('Nguyễn Thị Lan') } }))).resolves.toBeNull();
  });

  it('đơn còn mở (chưa giao) vẫn duyệt được: điểm chỉ cộng sau khi giao đủ hạn', async () => {
    await expect(block(claim({ order: { status: 'OPEN' } }))).resolves.toBeNull();
  });

  it('trần tháng: đúng bằng trần thì được, chỉ tính claim còn hiệu lực KHÁC trong tháng VN của claim', async () => {
    const db = fakeDb({ monthPoints: 200_000 - 12_500 });
    await expect(block(claim(), db)).resolves.toBeNull();
    expect(db.externalPointsClaim.aggregate.mock.calls[0]![0].where).toMatchObject({ userId: 'u1', kind: 'SCAN', id: { not: 'c1' }, state: { in: ['PENDING', 'REVIEW', 'CREDITED'] } });
  });
});

describe('ExternalClaimsNoPhoneBatchService.run', () => {
  function setup(o: { claims?: LockedClaim[]; approve?: jest.Mock; auditFails?: boolean } = {}) {
    const claims = o.claims ?? [claim(), claim({ id: 'c2', userId: 'u2' })];
    const db = fakeDb();
    const prisma = {
      ...db,
      externalPointsClaim: { ...db.externalPointsClaim, findMany: jest.fn().mockResolvedValue(claims), groupBy: jest.fn().mockResolvedValue([{ userId: 'u1', _count: { _all: 1 } }]) },
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => (where.id === 'staff' ? { id: 'staff', mergedIntoId: null } : { ...MEMBER, id: where.id })),
        findMany: jest.fn().mockResolvedValue([{ id: 'u1', fullName: 'Lan', phone: '0981234526' }, { id: 'u2', fullName: 'Minh', phone: '0911222333' }]),
      },
      order: { ...db.order, groupBy: jest.fn().mockResolvedValue([{ userId: 'u1', _count: { _all: 2 } }]) },
      adminAuditLog: { create: o.auditFails ? jest.fn().mockRejectedValue(new Error('db down')) : jest.fn().mockResolvedValue({ id: 'log1' }) },
    };
    const config = { get: jest.fn(async (_k: string, fallback: unknown) => fallback) };
    const approve = o.approve ?? jest.fn().mockResolvedValue({ id: 'x', state: 'PENDING' });
    const svc = new ExternalClaimsNoPhoneBatchService(prisma as never, config as never, { approve } as never);
    return { svc, prisma, approve };
  }

  it('xem trước: chỉ quét claim SCAN REVIEW thiếu SĐT của đơn Lazada, cũ nhất trước, không duyệt, không ghi sổ', async () => {
    const { svc, prisma, approve } = setup();
    const out = await svc.run('staff', {}, NOW);
    expect(prisma.externalPointsClaim.findMany.mock.calls[0]![0]).toMatchObject({
      where: { kind: 'SCAN', state: 'REVIEW', reviewReason: NO_PHONE_REVIEW_REASON, externalOrder: { channel: 'lazada' } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: NO_PHONE_BATCH_MAX + 1,
    });
    expect(out).toMatchObject({ dryRun: true, total: 2, okCount: 2, failedCount: 0, truncated: false, auditLogId: null });
    expect(out.results[0]).toMatchObject({ id: 'c1', outcome: 'READY', userPhoneMasked: '098****526', deliveredAppOrders: 2, creditedClaims: 1, recipientNameMatch: 'NO_DATA' });
    expect(approve).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('lượt thật: duyệt từng claim qua approve với guard + dấu lượt, ghi admin_audit_logs đủ từng dòng', async () => {
    const { svc, prisma, approve } = setup();
    const out = await svc.run('staff', { dryRun: false, claimIds: ['c1', 'c2'] }, NOW);
    expect(prisma.externalPointsClaim.findMany.mock.calls[0]![0].where).toEqual({ id: { in: ['c1', 'c2'] } });
    expect(approve).toHaveBeenCalledTimes(2);
    expect(approve.mock.calls[0]).toEqual(['c1', 'staff', NOW, undefined, { guard: expect.any(Function), eventNote: NO_PHONE_BATCH_NOTE }]);
    expect(out).toMatchObject({ dryRun: false, okCount: 2, auditLogId: 'log1', auditError: null });
    const log = prisma.adminAuditLog.create.mock.calls[0]![0].data;
    expect(log).toMatchObject({ actorId: 'staff', action: NO_PHONE_BATCH_AUDIT_ACTION, targetType: 'EXTERNAL_POINTS_CLAIM', targetIds: ['c1', 'c2'] });
    expect(log.payload).toMatchObject({ requested: ['c1', 'c2'], approved: ['c1', 'c2'], note: NO_PHONE_BATCH_NOTE, channel: 'lazada' });
    expect(log.payload.rows).toHaveLength(2);
  });

  it('người khác vừa xử lý: SKIPPED; lỗi khác: FAILED kèm lời; sổ chỉ ghi claim đã duyệt', async () => {
    const approve = jest
      .fn()
      .mockRejectedValueOnce(new ConflictException('Claim vừa được xử lý bởi người khác.'))
      .mockRejectedValueOnce(new ConflictException({ code: 'APPROVE_GUARD', message: 'Đơn đang hoàn: duyệt tay.' }));
    const { svc, prisma } = setup({ approve });
    const out = await svc.run('staff', { dryRun: false, claimIds: ['c1', 'c2'] }, NOW);
    expect(out.results.map((r) => [r.outcome, r.reason])).toEqual([
      ['SKIPPED', 'Claim vừa được xử lý bởi người khác.'],
      ['FAILED', 'Đơn đang hoàn: duyệt tay.'],
    ]);
    expect(out).toMatchObject({ okCount: 0, skippedCount: 1, failedCount: 1 });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data.targetIds).toEqual([]);
  });

  it('claim của chính người bấm không duyệt; claim id lạ báo không tìm thấy', async () => {
    const { svc, approve } = setup({ claims: [claim({ userId: 'staff' })] });
    const out = await svc.run('staff', { dryRun: false, claimIds: ['c1', 'nope'] }, NOW);
    expect(out.results.map((r) => r.reason)).toEqual(['Bạn không được xử lý claim của chính mình.', 'Không tìm thấy claim.']);
    expect(approve).not.toHaveBeenCalled();
  });

  it('ghi sổ lỗi: vẫn trả kết quả duyệt kèm auditError', async () => {
    const { svc } = setup({ auditFails: true });
    const out = await svc.run('staff', { dryRun: false, claimIds: ['c1'] }, NOW);
    expect(out.okCount).toBe(1);
    expect(out.auditError).toMatch(/Chưa ghi được sổ thao tác quản trị/);
  });

  it('lượt thật không kèm danh sách hay quá 50 claim: 400', async () => {
    const { svc } = setup();
    await expect(svc.run('staff', { dryRun: false }, NOW)).rejects.toThrow('Duyệt nhanh cần danh sách claim đã xem trước.');
    await expect(svc.run('staff', { claimIds: Array.from({ length: 51 }, (_, i) => `c${i}`) }, NOW)).rejects.toThrow('Mỗi lượt tối đa 50 claim.');
  });

  it('còn hơn 50 claim chờ: cắt ở 50 và báo truncated', async () => {
    const many = Array.from({ length: NO_PHONE_BATCH_MAX + 1 }, (_, i) => claim({ id: `c${i}` }));
    const { svc } = setup({ claims: many });
    const out = await svc.run('staff', {}, NOW);
    expect(out.total).toBe(NO_PHONE_BATCH_MAX);
    expect(out.truncated).toBe(true);
  });
});
