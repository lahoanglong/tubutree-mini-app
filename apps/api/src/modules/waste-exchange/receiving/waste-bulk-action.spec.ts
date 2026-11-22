import { BULK_TEXT, closeLostDecision, receiveDecision, transitOverdue, uniqueRequestIds, type WasteBulkRow } from './waste-bulk-action';

const DAY = 86_400_000;
const NOW = new Date('2026-11-22T03:00:00.000Z');

const row = (over: Partial<WasteBulkRow> = {}): WasteBulkRow => ({
  code: 'TR-ABCDE',
  method: 'MAIL_IN',
  status: 'IN_TRANSIT',
  orderId: null,
  orderStatus: null,
  trackingNorm: 'SPX123',
  trackingConflict: false,
  inTransitAt: new Date(NOW.getTime() - 30 * DAY),
  closeReason: null,
  customerBlocked: false,
  ...over,
});

const confirmed = { phoneMatchConfirmed: true, dryRun: false };

describe('receiveDecision', () => {
  it('skips a request already received', () => {
    expect(receiveDecision(row({ status: 'RECEIVED' }), confirmed)).toEqual({ kind: 'SKIP', reason: BULK_TEXT.ALREADY_RECEIVED });
  });

  it.each([
    ['DROP_OFF', row({ method: 'DROP_OFF', status: 'OPEN' }), BULK_TEXT.DROP_OFF],
    ['EXPIRED', row({ status: 'EXPIRED' }), BULK_TEXT.EXPIRED],
    ['COMPLETED', row({ status: 'COMPLETED' }), BULK_TEXT.NOT_RECEIVABLE],
    ['customer blocked', row({ customerBlocked: true }), BULK_TEXT.CUSTOMER_BLOCKED],
    ['PICKUP without order', row({ method: 'PICKUP', trackingNorm: null }), BULK_TEXT.ORDER_MISSING],
    ['PICKUP order RETURNED', row({ method: 'PICKUP', orderId: 'o1', orderStatus: 'RETURNED' }), BULK_TEXT.ORDER_RETURNED],
    ['PICKUP order SHIPPING', row({ method: 'PICKUP', orderId: 'o1', orderStatus: 'SHIPPING' }), BULK_TEXT.ORDER_NOT_DELIVERED],
    ['MAIL_IN without tracking', row({ trackingNorm: null }), BULK_TEXT.NO_TRACKING],
    ['MAIL_IN tracking conflict', row({ trackingConflict: true }), BULK_TEXT.TRACKING_CONFLICT],
  ])('fails %s', (_label, r, reason) => {
    expect(receiveDecision(r, confirmed)).toEqual({ kind: 'FAIL', reason });
  });

  it('accepts a PICKUP bag whose order is DELIVERED without a phone tick', () => {
    expect(receiveDecision(row({ method: 'PICKUP', orderId: 'o1', orderStatus: 'DELIVERED', trackingNorm: null }), { phoneMatchConfirmed: false, dryRun: false })).toEqual({
      kind: 'OK',
      needsPhoneConfirm: false,
    });
  });

  it('previews a MAIL_IN parcel as needing the phone tick, and refuses the real run without it', () => {
    expect(receiveDecision(row(), { phoneMatchConfirmed: false, dryRun: true })).toEqual({ kind: 'OK', needsPhoneConfirm: true });
    expect(receiveDecision(row(), { phoneMatchConfirmed: false, dryRun: false })).toEqual({ kind: 'FAIL', reason: BULK_TEXT.PHONE_NOT_CONFIRMED });
    expect(receiveDecision(row({ method: 'HOME_PICKUP', status: 'OPEN' }), confirmed)).toEqual({ kind: 'OK', needsPhoneConfirm: true });
  });
});

describe('closeLostDecision', () => {
  const ctx = { now: NOW, reviewDays: 21 };

  it('closes a MAIL_IN / HOME_PICKUP parcel in transit past the review window', () => {
    expect(closeLostDecision(row(), ctx)).toEqual({ kind: 'OK', needsPhoneConfirm: false });
    expect(closeLostDecision(row({ method: 'HOME_PICKUP' }), ctx)).toEqual({ kind: 'OK', needsPhoneConfirm: false });
  });

  it('skips a request already closed as lost', () => {
    expect(closeLostDecision(row({ status: 'EXPIRED', closeReason: 'LOST' }), ctx)).toEqual({ kind: 'SKIP', reason: BULK_TEXT.ALREADY_LOST });
  });

  it.each([
    ['PICKUP', row({ method: 'PICKUP' })],
    ['OPEN', row({ status: 'OPEN' })],
    ['RECEIVED', row({ status: 'RECEIVED' })],
    ['EXPIRED for another reason', row({ status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' })],
  ])('refuses %s', (_label, r) => {
    expect(closeLostDecision(r, ctx)).toEqual({ kind: 'FAIL', reason: BULK_TEXT.NOT_TRANSIT });
  });

  it('refuses a parcel not yet past the review window, or with no in-transit time', () => {
    expect(closeLostDecision(row({ inTransitAt: new Date(NOW.getTime() - 20 * DAY) }), ctx)).toMatchObject({ kind: 'FAIL', reason: expect.stringContaining('21 ngày') });
    expect(closeLostDecision(row({ inTransitAt: null }), ctx)).toMatchObject({ kind: 'FAIL' });
  });
});

describe('transitOverdue', () => {
  it('is strict at the boundary', () => {
    expect(transitOverdue(new Date(NOW.getTime() - 21 * DAY), NOW, 21)).toBe(false);
    expect(transitOverdue(new Date(NOW.getTime() - 21 * DAY - 1), NOW, 21)).toBe(true);
    expect(transitOverdue(null, NOW, 21)).toBe(false);
  });
});

describe('uniqueRequestIds', () => {
  it('trims, drops blanks and duplicates, keeps order', () => {
    expect(uniqueRequestIds([' a ', 'b', '', 'a', '  ', 'c'])).toEqual(['a', 'b', 'c']);
  });
});
