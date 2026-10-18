import { NotFoundException } from '@nestjs/common';
import { loadAdminRequestDetail, toAdminRequestDetail, type WasteAdminDetailRow } from './waste-admin-detail.mapper';

const D = (s: string) => new Date(s);
const row = (o: Record<string, unknown> = {}) =>
  ({
    id: 'r1', code: 'TR-A2C4E', userId: 'u1', method: 'MAIL_IN', status: 'COMPLETED', pointId: 'wh', orderId: null,
    carrier: 'GHTK', trackingCode: 'S123', trackingNorm: 'S123', trackingConflict: true, estimatedPoints: 10_000, estimatedDrops: 20,
    capDayKey: '2026-10-17', capMonthKey: '2026-10', expiresAt: null, inTransitAt: null, receivedAt: D('2026-10-20T01:00:00Z'),
    completedAt: D('2026-10-20T02:00:00Z'), closedAt: D('2026-10-20T02:00:00Z'), closeReason: null, confirmedByUserId: 's1', pointsAwarded: 8_000, dropsAwarded: 16,
    receivedWeightGrams: 2500, carrierCostVnd: 30000, rejectionReason: null, rejectionNote: null, reversedAt: D('2026-10-21T02:00:00Z'), reversedByUserId: 'a1',
    reversalReason: 'x', reversalShortfallPoints: 100, idempotencyKey: 'key-12345678', consentAt: D('2026-10-17T03:00:00Z'), consentVersion: '2026-10-17.1',
    createdAt: D('2026-10-17T03:00:00Z'), updatedAt: D('2026-10-20T02:00:00Z'),
    point: { id: 'wh', kind: 'WAREHOUSE', name: 'Kho Tubu', addressLine: '12 A', communeName: 'B', provinceName: 'TP.HCM', phone: null, openingHours: {} },
    order: null,
    lines: [],
    user: { id: 'u1', fullName: 'Nguyễn Văn An', phone: '0901234567' },
    ...o,
  }) as unknown as WasteAdminDetailRow;

const events = [{ id: 'e1', createdAt: '2026-10-20T02:00:00.000Z', kind: 'REQUEST_CONFIRMED', actorUserId: 's1', actorRole: 'STAFF' as const, requestId: 'r1', pointId: 'wh', giftRedemptionId: null, meta: null }];

describe('toAdminRequestDetail', () => {
  it('a STAFF view masks the customer and has no userId and no events', () => {
    const dto = toAdminRequestDetail(row(), false, true, events);
    expect(dto.customerName).toBe('An***');
    expect(dto.customerPhone).toBe('090****567');
    expect(dto).not.toHaveProperty('userId');
    expect(dto).not.toHaveProperty('events');
    expect(JSON.stringify(dto)).not.toMatch(/Nguyễn|0901234567/);
  });

  it('an ADMIN view shows the customer, the userId and the events', () => {
    const dto = toAdminRequestDetail(row(), true, true, events);
    expect(dto).toMatchObject({ customerName: 'Nguyễn Văn An', customerPhone: '0901234567', userId: 'u1', events });
  });

  it('carries the admin fields and ISO dates', () => {
    const dto = toAdminRequestDetail(row(), true, false, undefined);
    expect(dto).toMatchObject({
      trackingConflict: true, confirmedByUserId: 's1', receivedWeightGrams: 2500, carrierCostVnd: 30000,
      reversedAt: '2026-10-21T02:00:00.000Z', reversedByUserId: 'a1', reversalShortfallPoints: 100,
      capDayKey: '2026-10-17', capMonthKey: '2026-10', consentAt: '2026-10-17T03:00:00.000Z', consentVersion: '2026-10-17.1', pointAvailable: false,
    });
    expect(dto).not.toHaveProperty('events');
    expect(toAdminRequestDetail(row({ reversedAt: null }), true, true).reversedAt).toBeNull();
  });
});

describe('loadAdminRequestDetail', () => {
  const dbOf = (r: unknown) => ({
    wasteRequest: { findUnique: jest.fn(async () => r) },
    wasteEvent: {
      findMany: jest.fn(async () => [{ id: 'e1', createdAt: D('2026-10-20T02:00:00Z'), kind: 'REQUEST_CONFIRMED', actorUserId: 's1', actorRole: 'STAFF', requestId: 'r1', pointId: 'wh', giftRedemptionId: null, meta: null }]),
    },
  });
  const access = { availablePointIds: jest.fn(async () => new Set(['wh'])) };

  it('404 when the request is missing', async () => {
    await expect(loadAdminRequestDetail(dbOf(null) as never, access as never, 'r1', true)).rejects.toThrow(new NotFoundException('Không tìm thấy mã'));
  });

  it('reads the events in order for an admin only', async () => {
    const adminDb = dbOf(row());
    const admin = await loadAdminRequestDetail(adminDb as never, access as never, 'r1', true);
    expect(admin.events).toEqual(events);
    expect(adminDb.wasteEvent.findMany).toHaveBeenCalledWith({ where: { requestId: 'r1' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(admin.pointAvailable).toBe(true);

    const staffDb = dbOf(row());
    const staff = await loadAdminRequestDetail(staffDb as never, access as never, 'r1', false);
    expect(staff).not.toHaveProperty('events');
    expect(staffDb.wasteEvent.findMany).not.toHaveBeenCalled();
  });
});
