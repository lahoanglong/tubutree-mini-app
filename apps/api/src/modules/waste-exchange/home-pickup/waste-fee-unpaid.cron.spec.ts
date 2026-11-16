import { runExclusive } from '../../../common/cron-leader/run-exclusive';
import { holdsLease } from '../../../common/cron-leader/run-exclusive.fixtures';
import { closeHomePickupRequest } from './waste-home-pickup-ledger';
import { WasteFeeUnpaidCron } from './waste-fee-unpaid.cron';

jest.mock('../../../common/cron-leader/run-exclusive');
jest.mock('./waste-home-pickup-ledger', () => ({ closeHomePickupRequest: jest.fn() }));

const NOW = new Date('2026-11-16T12:00:00.000Z');
const EXPIRES = new Date('2027-11-16T00:00:00.000Z');

function setup(rows: Array<{ id: string; code: string; userId: string; pointId: string; shipFeePointsUsed: number }>, lease = true) {
  (runExclusive as jest.Mock).mockImplementation(holdsLease(lease));
  const findMany = jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]);
  const prisma = {
    wasteRequest: { findMany },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ tx: true })),
  };
  const config = { pointExpiresAt: jest.fn().mockResolvedValue(EXPIRES) };
  const notifier = { requestExpired: jest.fn().mockResolvedValue(undefined) };
  const cron = new WasteFeeUnpaidCron(prisma as never, config as never, notifier as never);
  return { cron, findMany, notifier };
}

beforeEach(() => {
  jest.clearAllMocks();
  (closeHomePickupRequest as jest.Mock).mockResolvedValue({ closed: true, refunded: 8000, refundedCashVnd: 0 });
});

describe('WasteFeeUnpaidCron', () => {
  it('chỉ tìm phiếu HOME_PICKUP OPEN chọn BANK_TRANSFER mà shipFeeCashPaidAt = null và expiresAt < now, đóng với FEE_UNPAID', async () => {
    const { cron, findMany, notifier } = setup([{ id: 'r1', code: 'TR-A2C4E', userId: 'u1', pointId: 'wh', shipFeePointsUsed: 8000 }]);
    await expect(cron.run(NOW)).resolves.toEqual({ expired: 1 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          method: 'HOME_PICKUP',
          status: 'OPEN',
          shipFeeCashMethod: 'BANK_TRANSFER',
          shipFeeCashPaidAt: null,
          expiresAt: { lt: NOW },
        },
      }),
    );
    expect(closeHomePickupRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: 'EXPIRED',
        closeReason: 'FEE_UNPAID',
        refundExpiresAt: EXPIRES,
        where: { shipFeeCashMethod: 'BANK_TRANSFER', shipFeeCashPaidAt: null, expiresAt: { lt: NOW } },
      }),
    );
    expect(notifier.requestExpired).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-A2C4E', method: 'HOME_PICKUP' }, 'FEE_UNPAID', NOW);
  });

  it('không giành được lease cron hoặc CAS đóng thua (vừa được xác nhận thanh toán): không báo khách', async () => {
    const locked = setup([{ id: 'r1', code: 'TR-A2C4E', userId: 'u1', pointId: 'wh', shipFeePointsUsed: 8000 }], false);
    await expect(locked.cron.run(NOW)).resolves.toEqual({ expired: 0 });

    (closeHomePickupRequest as jest.Mock).mockResolvedValueOnce({ closed: false, refunded: 0, refundedCashVnd: 0 });
    const lost = setup([{ id: 'r1', code: 'TR-A2C4E', userId: 'u1', pointId: 'wh', shipFeePointsUsed: 8000 }]);
    await expect(lost.cron.run(NOW)).resolves.toEqual({ expired: 0 });
    expect(lost.notifier.requestExpired).not.toHaveBeenCalled();
  });
});
