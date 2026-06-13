import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';

const config = {} as unknown as SystemConfigService;
const loyalty = { reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService;
const affiliate = {
  reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
} as unknown as AffiliateService;
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
const mkAdmin = (prisma: PrismaService) => new AdminService(prisma, config, loyalty, affiliate, notifications);

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    dealerApplication: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    dealerTier: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
    user: { findUnique: jest.fn(), update: jest.fn() },
    returnRequest: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    order: { findUniqueOrThrow: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { ...base, ...over } as unknown as PrismaService;
}

describe('AdminService.reviewDealerApplication', () => {
  it('đơn không tồn tại → NotFound', async () => {
    const prisma = makePrisma({ dealerApplication: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(mkAdmin(prisma).reviewDealerApplication('a1', 'x', true, 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('đơn không PENDING → BadRequest', async () => {
    const prisma = makePrisma({
      dealerApplication: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'APPROVED' }) },
    });
    await expect(mkAdmin(prisma).reviewDealerApplication('a1', 'd1', true, 't1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('duyệt nhưng thiếu tierId → BadRequest', async () => {
    const prisma = makePrisma({
      dealerApplication: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }) },
    });
    await expect(mkAdmin(prisma).reviewDealerApplication('a1', 'd1', true)).rejects.toThrow(
      'bậc đại lý',
    );
  });

  it('duyệt với tier không tồn tại → BadRequest', async () => {
    const prisma = makePrisma({
      dealerApplication: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }) },
      dealerTier: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      mkAdmin(prisma).reviewDealerApplication('a1', 'd1', true, 'bad'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('duyệt hợp lệ → MERGE metadata, KHÔNG xoá segments/onboardedAt (regression)', async () => {
    const txnArgs: unknown[] = [];
    const userUpdate = jest.fn((arg) => {
      txnArgs.push(arg);
      return arg;
    });
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
        update: jest.fn((a) => a),
      },
      dealerTier: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
      user: {
        findUnique: jest.fn().mockResolvedValue({ metadata: { segments: ['mom_baby'], onboardedAt: '2026-01-01' } }),
        update: userUpdate,
      },
    });
    await mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', true, 't1');
    // tìm lời gọi user.update trong transaction
    const meta = (txnArgs[0] as { data: { metadata: Record<string, unknown>; role: string } }).data;
    expect(meta.role).toBe('DEALER');
    expect(meta.metadata).toEqual({ segments: ['mom_baby'], onboardedAt: '2026-01-01', dealerTierId: 't1' });
  });

  it('metadata null → vẫn set dealerTierId', async () => {
    const txnArgs: unknown[] = [];
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
        update: jest.fn((a) => a),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ metadata: null }),
        update: jest.fn((arg) => {
          txnArgs.push(arg);
          return arg;
        }),
      },
    });
    await mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', true, 't1');
    expect((txnArgs[0] as { data: { metadata: unknown } }).data.metadata).toEqual({ dealerTierId: 't1' });
  });

  it('từ chối → REJECTED + lý do, không động vào user', async () => {
    const update = jest.fn().mockResolvedValue({});
    const userUpdate = jest.fn();
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
        update,
      },
      user: { findUnique: jest.fn(), update: userUpdate },
    });
    await mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', false, undefined, 'thiếu giấy tờ');
    expect(update.mock.calls[0][0].data.status).toBe('REJECTED');
    expect(update.mock.calls[0][0].data.rejectionReason).toBe('thiếu giấy tờ');
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe('AdminService.reviewReturn (§6.4 đổi/trả)', () => {
  beforeEach(() => {
    (loyalty.reverseOrderPoints as jest.Mock).mockClear();
    (affiliate.reverseCommissionsForOrder as jest.Mock).mockClear();
  });

  it('yêu cầu không tồn tại → NotFound', async () => {
    const prisma = makePrisma({ returnRequest: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    await expect(mkAdmin(prisma).reviewReturn('a1', 'x', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('yêu cầu đã xử lý (không REQUESTED) → BadRequest', async () => {
    const prisma = makePrisma({
      returnRequest: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', status: 'APPROVED' }), update: jest.fn() },
    });
    await expect(mkAdmin(prisma).reviewReturn('a1', 'r1', true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('DUYỆT → hoàn Ví + reverse điểm + reverse commission + đơn RETURNED', async () => {
    const txn = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      returnRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', status: 'REQUESTED', orderId: 'o1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', code: 'TUBU1', userId: 'u1', total: 250000 }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: txn,
    });
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', true);
    // transaction gồm: order→RETURNED, user.walletBalance += total, returnRequest→APPROVED
    expect(txn).toHaveBeenCalledTimes(1);
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
  });

  it('TỪ CHỐI → REJECTED + note, KHÔNG hoàn tiền/reverse', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({
      returnRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', status: 'REQUESTED', orderId: 'o1' }),
        update,
      },
    });
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', false, 'không phải lỗi NSX');
    expect(update.mock.calls[0][0].data.status).toBe('REJECTED');
    expect(update.mock.calls[0][0].data.adminNote).toBe('không phải lỗi NSX');
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
    expect(affiliate.reverseCommissionsForOrder).not.toHaveBeenCalled();
  });
});
