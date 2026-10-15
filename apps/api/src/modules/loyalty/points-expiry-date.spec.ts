import { LoyaltyService } from './loyalty.service';
import { RewardPointsService } from '../wallet/reward-points.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Hạn của điểm Xanh thường mới cộng phải cùng một công thức ở mọi nguồn: điểm đơn giao (creditOrderPoints), thưởng
 * giới thiệu/cộng đồng/nhiệm vụ (RewardPointsService.grant) và điểm danh/POS/điểm hoàn/game/đánh giá
 * (LoyaltyService.pointsExpiresAt). Trước đây creditOrderPoints và RewardPointsService tự tính `setMonth` riêng;
 * creditOrderPoints không rơi về 12 tháng khi loyalty.point_expire_months là 0, âm hay không phải số.
 */
const NOW = new Date('2026-10-11T03:00:00.000Z');
const TWELVE_MONTHS = new Date('2027-10-11T03:00:00.000Z');

const configWith = (months: unknown) =>
  ({ get: async <T>(k: string, fb?: T): Promise<T> => (k === 'loyalty.point_expire_months' ? (months as T) : (fb as T)) }) as unknown as SystemConfigService;

/** Điểm đơn giao: expiresAt của dòng ORDER_DELIVERED mà creditOrderPoints ghi. */
async function orderCreditExpiry(months: unknown): Promise<Date> {
  const create = jest.fn().mockReturnValue({});
  const prisma = {
    order: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', code: 'C1', userId: 'u1', pointsEarned: 50 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { total: 0 } }),
    },
    returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
    pointsTransaction: { findFirst: jest.fn().mockResolvedValue(null), create, findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _sum: { delta: 0 } }) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', pointsBalance: 0, tierId: null }), update: jest.fn().mockReturnValue({}) },
    membershipTier: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockResolvedValue([]),
  } as unknown as PrismaService;
  await new LoyaltyService(prisma, configWith(months)).creditOrderPoints('o1');
  return create.mock.calls[0][0].data.expiresAt;
}

/** Thưởng giới thiệu/cộng đồng/nhiệm vụ: expiresAt của dòng sổ mà RewardPointsService.grant ghi. */
async function rewardGrantExpiry(months: unknown): Promise<Date> {
  const createManyAndReturn = jest.fn().mockResolvedValue([{ id: 'ptx1' }]);
  const prisma = {
    coinTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
    pointsTransaction: { createManyAndReturn },
    user: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma)),
  } as unknown as PrismaService;
  await new RewardPointsService(prisma, configWith(months)).grant('u1', 5, 'COMMUNITY_POST:p1', 'COMMUNITY', 'p1');
  return createManyAndReturn.mock.calls[0][0].data[0].expiresAt;
}

/** Điểm danh, POS, điểm hoàn, game, đánh giá: kết quả của helper công khai. */
async function helperExpiry(months: unknown): Promise<Date> {
  return new LoyaltyService({} as PrismaService, configWith(months)).pointsExpiresAt(new Date());
}

const SOURCES: [string, (months: unknown) => Promise<Date>][] = [
  ['điểm đơn giao (creditOrderPoints)', orderCreditExpiry],
  ['thưởng giới thiệu/cộng đồng/nhiệm vụ (RewardPointsService.grant)', rewardGrantExpiry],
  ['pointsExpiresAt (điểm danh, POS, điểm hoàn, game, đánh giá)', helperExpiry],
];

describe('hạn điểm Xanh thường: một công thức cho mọi nguồn cộng', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  describe.each(SOURCES)('%s', (_name, expiryOf) => {
    it.each([
      [1, '2026-11-11T03:00:00.000Z'],
      [6, '2027-04-11T03:00:00.000Z'],
      [12, '2027-10-11T03:00:00.000Z'],
      [24, '2028-10-11T03:00:00.000Z'],
      [1.9, '2026-11-11T03:00:00.000Z'],
    ])('loyalty.point_expire_months = %p → bây giờ + số tháng nguyên (cấu hình hợp lệ không đổi)', async (months, expected) => {
      expect(await expiryOf(months)).toEqual(new Date(expected));
    });

    it.each([[0], [-3], [Number.NaN], [Number.POSITIVE_INFINITY], ['abc'], ['6'], [null]])(
      'cấu hình hỏng (%p) → quay về 12 tháng, không bao giờ hết hạn ngay hay trong quá khứ',
      async (bad) => {
        expect(await expiryOf(bad)).toEqual(TWELVE_MONTHS);
      },
    );
  });
});
