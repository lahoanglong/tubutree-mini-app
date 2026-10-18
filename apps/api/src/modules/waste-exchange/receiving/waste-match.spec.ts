import type { Prisma } from '@prisma/client';
import { WASTE_UNMATCHED_REASON_VALUES } from '@tubutree/shared-types';
import { evaluateMatch, matchReasonText } from './waste-match';

const tx = (found: { id: string } | null, count = 1) =>
  ({
    wasteRequest: { findUnique: jest.fn().mockResolvedValue(found), count: jest.fn().mockResolvedValue(count) },
  }) as unknown as Prisma.TransactionClient;

const R = { id: 'r1', code: 'TR-ABCDE', method: 'MAIL_IN' as const, trackingNorm: 'SPX123', orderId: null };

describe('evaluateMatch', () => {
  it('matches the request own TR code after normalisation without a lookup', async () => {
    const t = tx(null);
    await expect(evaluateMatch(t, R, { parcelCode: ' tr-abcde ' })).resolves.toEqual({ ok: true, basis: 'TR_CODE' });
    expect(t.wasteRequest.findUnique).not.toHaveBeenCalled();
  });

  it('reports a conflict when the parcel code belongs to another request', async () => {
    const t = tx({ id: 'r2' });
    await expect(evaluateMatch(t, R, { parcelCode: 'TR-ZZZZZ' })).resolves.toEqual({
      ok: false,
      reason: 'TR_TRACKING_CONFLICT',
      relatedRequestId: 'r2',
    });
    expect(t.wasteRequest.findUnique).toHaveBeenCalledWith({ where: { code: 'TR-ZZZZZ' }, select: { id: true } });
  });

  it('reports NO_MATCH for an unknown parcel code', async () => {
    await expect(evaluateMatch(tx(null), R, { parcelCode: 'TR-ZZZZZ' })).resolves.toEqual({ ok: false, reason: 'NO_MATCH' });
  });

  it('treats a blank parcelCode as no parcelCode', async () => {
    const t = tx(null);
    await expect(evaluateMatch(t, { ...R, method: 'PICKUP', trackingNorm: null, orderId: 'o1' }, { parcelCode: '   ' })).resolves.toEqual({
      ok: true,
      basis: 'ORDER',
    });
    expect(t.wasteRequest.findUnique).not.toHaveBeenCalled();
  });

  it('matches a PICKUP request by its order, and refuses one without an order', async () => {
    const pickup = { ...R, method: 'PICKUP' as const, trackingNorm: null };
    await expect(evaluateMatch(tx(null), { ...pickup, orderId: 'o1' }, undefined)).resolves.toEqual({ ok: true, basis: 'ORDER' });
    await expect(evaluateMatch(tx(null), { ...pickup, orderId: null }, undefined)).resolves.toEqual({
      ok: false,
      reason: 'NOT_RECEIVABLE',
    });
  });

  it('matches MAIL_IN by tracking plus confirmed phone when exactly one request fits', async () => {
    const t = tx(null, 1);
    await expect(evaluateMatch(t, R, { phoneMatchConfirmed: true })).resolves.toEqual({ ok: true, basis: 'TRACKING_PHONE' });
    expect(t.wasteRequest.count).toHaveBeenCalledWith({
      where: { trackingNorm: 'SPX123', method: 'MAIL_IN', status: { in: ['OPEN', 'IN_TRANSIT', 'RECEIVED'] } },
    });
  });

  it('reports TRACKING_MULTI for several requests and NO_MATCH for none', async () => {
    await expect(evaluateMatch(tx(null, 2), R, { phoneMatchConfirmed: true })).resolves.toEqual({
      ok: false,
      reason: 'TRACKING_MULTI',
    });
    await expect(evaluateMatch(tx(null, 0), R, { phoneMatchConfirmed: true })).resolves.toEqual({ ok: false, reason: 'NO_MATCH' });
  });

  it('reports NO_MATCH for MAIL_IN without a confirmed phone or without tracking, without counting', async () => {
    const t = tx(null);
    await expect(evaluateMatch(t, R, {})).resolves.toEqual({ ok: false, reason: 'NO_MATCH' });
    await expect(evaluateMatch(t, R, { phoneMatchConfirmed: false })).resolves.toEqual({ ok: false, reason: 'NO_MATCH' });
    await expect(evaluateMatch(t, { ...R, trackingNorm: null }, { phoneMatchConfirmed: true })).resolves.toEqual({
      ok: false,
      reason: 'NO_MATCH',
    });
    await expect(evaluateMatch(t, R, undefined)).resolves.toEqual({ ok: false, reason: 'NO_MATCH' });
    expect(t.wasteRequest.count).not.toHaveBeenCalled();
  });

  it('refuses a DROP_OFF request without a parcel code', async () => {
    await expect(evaluateMatch(tx(null), { ...R, method: 'DROP_OFF' as const, trackingNorm: null }, undefined)).resolves.toEqual({
      ok: false,
      reason: 'NOT_RECEIVABLE',
    });
  });
});

describe('matchReasonText', () => {
  it('returns the pinned texts', () => {
    expect(matchReasonText('NO_MATCH')).toBe('kiện không khớp yêu cầu nào');
    expect(matchReasonText('TRACKING_MULTI')).toBe('mã vận đơn khớp nhiều yêu cầu');
    expect(matchReasonText('TR_TRACKING_CONFLICT')).toBe('mã TR- trên kiện là của một yêu cầu khác');
    expect(matchReasonText('EXPIRED_REQUEST')).toBe('yêu cầu đã hết hạn, cần admin mở lại');
    expect(matchReasonText('NOT_RECEIVABLE')).toBe('yêu cầu này không nhận thêm kiện');
    expect(matchReasonText('MANUAL_ENTRY')).toBe('kiện được ghi tay vào hàng không rõ chủ');
  });

  it.each(WASTE_UNMATCHED_REASON_VALUES)('%s text never contains the code', (r) => {
    expect(matchReasonText(r)).not.toContain(r);
  });
});
