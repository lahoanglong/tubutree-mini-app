import { closeHomePickupRequest, refundShipFeePoints, wastePickupFeeRefundReason, wastePickupFeeReason, WASTE_PICKUP_FEE_REF_TYPE } from './waste-home-pickup-ledger';

const mockApply = jest.fn();
jest.mock('../../loyalty/points-ledger', () => ({ applyPointsDelta: (...a: unknown[]) => mockApply(...a) }));
const mockEvent = jest.fn();
jest.mock('../core/waste-events', () => ({ writeWasteEvent: (...a: unknown[]) => mockEvent(...a) }));

const EXPIRES = new Date('2027-11-15T00:00:00Z');
const req = { id: 'r1', userId: 'u1', code: 'TR-AAAAA', shipFeePointsUsed: 1500 };

function fakeTx(over: { claim?: number; entries?: Array<{ delta: number; lot: 'STANDARD' | 'CONVERTED' }>; closed?: number } = {}) {
  const updateMany = jest.fn(async (args: { where: Record<string, unknown> }) => ({
    count: 'shipFeePointsRefunded' in args.where ? (over.claim ?? 1) : (over.closed ?? 1),
  }));
  const findMany = jest.fn().mockResolvedValue(over.entries ?? [{ delta: -1000, lot: 'STANDARD' }, { delta: -500, lot: 'CONVERTED' }]);
  return { tx: { wasteRequest: { updateMany }, pointsTransaction: { findMany } } as never, updateMany, findMany };
}

beforeEach(() => {
  mockApply.mockReset().mockResolvedValue({ applied: true, entryId: 'e' });
  mockEvent.mockReset().mockResolvedValue({ id: 'ev' });
});

describe('reason của sổ điểm phí shipper', () => {
  it('mang mã phiếu để tra và để hoàn đúng lô', () => {
    expect(wastePickupFeeReason('TR-AAAAA')).toBe('WASTE_PICKUP_FEE:TR-AAAAA');
    expect(wastePickupFeeRefundReason('TR-AAAAA')).toBe('WASTE_PICKUP_FEE_REFUND:TR-AAAAA');
    expect(WASTE_PICKUP_FEE_REF_TYPE).toBe('WASTE_REQUEST');
  });
});

describe('refundShipFeePoints (đúng một lần)', () => {
  it('hoàn từng lô đúng số đã trừ: lô thường có hạn, lô quy đổi không hạn', async () => {
    const { tx, updateMany } = fakeTx();
    await expect(refundShipFeePoints(tx, req, EXPIRES)).resolves.toBe(1500);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'r1', shipFeePointsRefunded: null }, data: { shipFeePointsRefunded: 1500 } });
    expect(mockApply).toHaveBeenCalledTimes(2);
    expect(mockApply).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: 'u1', delta: 1000, lot: 'STANDARD', reason: 'WASTE_PICKUP_FEE_REFUND:TR-AAAAA', refType: 'WASTE_REQUEST', refId: 'r1', expiresAt: EXPIRES }));
    expect(mockApply).toHaveBeenCalledWith(tx, expect.objectContaining({ delta: 500, lot: 'CONVERTED', expiresAt: null }));
  });

  it('lần thứ hai (cột shipFeePointsRefunded đã có) không hoàn thêm điểm nào', async () => {
    const { tx } = fakeTx({ claim: 0 });
    await expect(refundShipFeePoints(tx, req, EXPIRES)).resolves.toBe(0);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('phiếu không dùng điểm: chốt cột nhưng không ghi sổ', async () => {
    const { tx, findMany } = fakeTx();
    await expect(refundShipFeePoints(tx, { ...req, shipFeePointsUsed: 0 }, EXPIRES)).resolves.toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('sổ điểm lệch số trên phiếu: hoàn đúng số trên phiếu vào lô thường, khách không mất điểm', async () => {
    const { tx } = fakeTx({ entries: [{ delta: -700, lot: 'STANDARD' }] });
    await refundShipFeePoints(tx, req, EXPIRES);
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(mockApply).toHaveBeenCalledWith(tx, expect.objectContaining({ delta: 1500, lot: 'STANDARD', expiresAt: EXPIRES }));
  });
});

describe('closeHomePickupRequest', () => {
  const args = (over: Partial<Parameters<typeof closeHomePickupRequest>[1]> = {}): Parameters<typeof closeHomePickupRequest>[1] => ({
    req: { ...req, pointId: 'wh' },
    from: ['OPEN'],
    to: 'CANCELLED',
    closeReason: null,
    now: new Date('2026-11-15T01:00:00Z'),
    refundExpiresAt: EXPIRES,
    event: { kind: 'REQUEST_CANCELLED', actorUserId: 'u1', actorRole: 'CUSTOMER', meta: { cause: 'test' } },
    ...over,
  });

  it('đóng phiếu, hoàn điểm và ghi sự kiện trong cùng transaction', async () => {
    const { tx, updateMany } = fakeTx();
    await expect(closeHomePickupRequest(tx, args({ where: { gomdonStatus: '1' } }))).resolves.toEqual({ closed: true, refunded: 1500 });
    expect(updateMany.mock.calls[0]![0]).toEqual({
      where: { id: 'r1', method: 'HOME_PICKUP', status: { in: ['OPEN'] }, gomdonStatus: '1' },
      data: expect.objectContaining({ status: 'CANCELLED', closeReason: null }),
    });
    expect(mockEvent).toHaveBeenCalledTimes(1);
    expect(mockEvent.mock.calls[0]![1]).toMatchObject({ kind: 'REQUEST_CANCELLED', requestId: 'r1', pointId: 'wh', meta: { cause: 'test', shipFeePointsRefunded: 1500 } });
  });

  it('bên khác đóng trước (updateMany count 0): không hoàn điểm, không ghi sự kiện', async () => {
    const { tx } = fakeTx({ closed: 0 });
    await expect(closeHomePickupRequest(tx, args())).resolves.toEqual({ closed: false, refunded: 0 });
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockEvent).not.toHaveBeenCalled();
  });

  it('đóng hai lần: lần hai thắng được dòng phiếu nhưng cột hoàn đã chốt thì không hoàn lại', async () => {
    const { tx } = fakeTx({ claim: 0 });
    await expect(closeHomePickupRequest(tx, args())).resolves.toEqual({ closed: true, refunded: 0 });
    expect(mockApply).not.toHaveBeenCalled();
  });
});
