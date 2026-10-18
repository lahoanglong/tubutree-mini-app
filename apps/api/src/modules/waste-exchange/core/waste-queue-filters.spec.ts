import * as F from './waste-queue-filters';

describe('waste queue filters (single source for M3.8, M4.3, M4.6, M4.8)', () => {
  const now = new Date('2026-10-17T03:00:00.000Z');
  it('static filters', () => {
    expect(F.WASTE_TO_COUNT_WHERE).toEqual({ method: { in: ['MAIL_IN', 'PICKUP'] }, status: 'RECEIVED' });
    expect(F.WASTE_EXPIRED_WHERE).toEqual({ status: 'EXPIRED' });
    expect(F.WASTE_UNMATCHED_OPEN_WHERE).toEqual({ status: 'OPEN' });
    expect(F.WASTE_POINTS_PENDING_WHERE).toEqual({ status: 'PENDING' });
    expect(F.WASTE_PERKS_PENDING_WHERE).toEqual({ AND: [{ perkPendingText: { not: null } }, { perkPendingText: { not: '' } }] });
  });
  it('customer blocked: open statuses and users.isBlocked or waste blockedAt', () => {
    expect(F.wasteCustomerBlockedWhere()).toEqual({
      status: { in: ['OPEN', 'IN_TRANSIT', 'RECEIVED'] },
      user: { OR: [{ isBlocked: true }, { wasteFlags: { is: { blockedAt: { not: null } } } }] },
    });
  });
  it('order not delivered: attached OPEN PICKUP whose order is not DELIVERED, RETURNED or CANCELLED', () => {
    expect(F.wasteOrderNotDeliveredWhere()).toEqual({
      method: 'PICKUP', orderId: { not: null }, status: 'OPEN',
      order: { is: { status: { notIn: ['DELIVERED', 'RETURNED', 'CANCELLED'] } } },
    });
  });
  it('transit overdue: MAIL_IN IN_TRANSIT older than reviewDays', () => {
    expect(F.wasteTransitOverdueWhere(now, 30)).toEqual({ method: 'MAIL_IN', status: 'IN_TRANSIT', inTransitAt: { lt: new Date('2026-09-17T03:00:00.000Z') } });
  });
  it('order mismatch: cancelled order with live request, or delivered/returned order with cancelled request', () => {
    expect(F.wasteOrderMismatchWhere()).toEqual({
      OR: [
        { status: { not: 'CANCELLED' }, order: { is: { status: 'CANCELLED' } } },
        { status: 'CANCELLED', order: { is: { status: { in: ['DELIVERED', 'RETURNED'] } } } },
      ],
    });
  });
  it('gift overdue: READY past claimExpiresAt', () => {
    expect(F.wasteGiftOverdueWhere(now)).toEqual({ status: 'READY', claimExpiresAt: { lt: now } });
  });
});
