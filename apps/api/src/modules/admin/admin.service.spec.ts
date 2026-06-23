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

// Helper riêng cho reviewReturn — callback $transaction + updateMany (B3 atomic) + variation.update (B5 restock).
type Order = {
  id: string;
  code: string;
  userId: string;
  total: number;
  paymentMethod: 'COD' | 'WALLET' | 'ZALOPAY';
  paymentStatus: 'PAID' | 'UNPAID';
  items: Array<{ variationId: string; quantity: number }>;
};
type ReturnReq = { id: string; orderId: string; status: 'REQUESTED' | 'APPROVED' | 'REJECTED' } | null;

function makeReturnPrisma(opts: {
  returnReq?: ReturnReq;
  order?: Order;
  returnUpdateManyCount?: number; // count trả về cho returnRequest.updateMany trong tx
} = {}) {
  const returnReq: ReturnReq =
    opts.returnReq === undefined ? { id: 'r1', orderId: 'o1', status: 'REQUESTED' } : opts.returnReq;
  const order: Order = opts.order ?? {
    id: 'o1',
    code: 'TUBU1',
    userId: 'u1',
    total: 250000,
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    items: [{ variationId: 'v1', quantity: 1 }],
  };
  const returnUpdateMany = jest.fn().mockResolvedValue({ count: opts.returnUpdateManyCount ?? 1 });
  // reviewReturn giờ dùng order.updateMany (guard status=DELIVERED) + tx.order.findUniqueOrThrow.
  // orderUpdate giữ tên cũ để các test cũ vẫn dùng được như spy duy nhất cho order.update*.
  const orderUpdate = jest.fn().mockResolvedValue({ count: 1 });
  const userUpdate = jest.fn().mockResolvedValue({});
  const variationUpdate = jest.fn().mockResolvedValue({});
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      returnRequest: { updateMany: returnUpdateMany },
      order: {
        // findUniqueOrThrow đọc order trong tx (nhất quán với guard ngay sau đó).
        findUniqueOrThrow: jest.fn().mockResolvedValue(order),
        // updateMany guard status='DELIVERED' — mặc định flip 1 row.
        updateMany: orderUpdate,
      },
      user: { update: userUpdate },
      variation: { update: variationUpdate },
    }),
  );
  const prisma = {
    returnRequest: { findUnique: jest.fn().mockResolvedValue(returnReq), updateMany: returnUpdateMany },
    order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
    $transaction,
  } as unknown as PrismaService;
  return { prisma, returnUpdateMany, orderUpdate, userUpdate, variationUpdate, $transaction };
}

describe('AdminService.reviewReturn (B3 refund-channel + atomic + B5 restock)', () => {
  beforeEach(() => {
    (loyalty.reverseOrderPoints as jest.Mock).mockClear();
    (affiliate.reverseCommissionsForOrder as jest.Mock).mockClear();
  });

  it('yêu cầu không tồn tại → NotFound', async () => {
    const { prisma } = makeReturnPrisma({ returnReq: null });
    await expect(mkAdmin(prisma).reviewReturn('a1', 'x', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('APPROVE với COD UNPAID → đơn RETURNED, KHÔNG hoàn walletBalance, restock đủ', async () => {
    const { prisma, returnUpdateMany, orderUpdate, userUpdate, variationUpdate } = makeReturnPrisma({
      order: {
        id: 'o1',
        code: 'TUBU1',
        userId: 'u1',
        total: 300000,
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        items: [
          { variationId: 'v1', quantity: 2 },
          { variationId: 'v2', quantity: 3 },
        ],
      },
    });
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', true, 'ok');
    expect(returnUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1', status: 'REQUESTED' },
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
    // order.updateMany với guard status='DELIVERED' — chặn đè CANCELLED/RETURNED khác.
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'o1', status: 'DELIVERED' },
      data: { status: 'RETURNED' },
    });
    // COD UNPAID — khách chưa trả → KHÔNG hoàn ví.
    expect(userUpdate).not.toHaveBeenCalled();
    // Restock cả 2 item.
    expect(variationUpdate).toHaveBeenCalledTimes(2);
    expect(variationUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'v1' },
      data: { stock: { increment: 2 } },
    });
    expect(variationUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'v2' },
      data: { stock: { increment: 3 } },
    });
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
  });

  it('APPROVE với WALLET PAID → hoàn walletBalance + restock', async () => {
    const { prisma, userUpdate, variationUpdate } = makeReturnPrisma({
      order: {
        id: 'o1',
        code: 'TUBU1',
        userId: 'u1',
        total: 500000,
        paymentMethod: 'WALLET',
        paymentStatus: 'PAID',
        items: [{ variationId: 'v1', quantity: 1 }],
      },
    });
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', true);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { walletBalance: { increment: 500000 } },
    });
    expect(variationUpdate).toHaveBeenCalledTimes(1);
  });

  it('APPROVE với ZALOPAY PAID → hoàn walletBalance', async () => {
    const { prisma, userUpdate } = makeReturnPrisma({
      order: {
        id: 'o1',
        code: 'TUBU1',
        userId: 'u1',
        total: 200000,
        paymentMethod: 'ZALOPAY',
        paymentStatus: 'PAID',
        items: [{ variationId: 'v1', quantity: 1 }],
      },
    });
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', true);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { walletBalance: { increment: 200000 } },
    });
  });

  it('race 2 admin approve cùng request → bên thua (updateMany count=0) throw, không hoàn ví/restock', async () => {
    const { prisma, userUpdate, variationUpdate } = makeReturnPrisma({ returnUpdateManyCount: 0 });
    await expect(mkAdmin(prisma).reviewReturn('admin2', 'r1', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(userUpdate).not.toHaveBeenCalled();
    expect(variationUpdate).not.toHaveBeenCalled();
    // Reverse loyalty/affiliate cũng KHÔNG được gọi vì throw trước khi tới đoạn ngoài tx.
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
    expect(affiliate.reverseCommissionsForOrder).not.toHaveBeenCalled();
  });

  it('REJECT → update REJECTED + note, KHÔNG hoàn ví, KHÔNG restock, KHÔNG reverse', async () => {
    const { prisma, returnUpdateMany, userUpdate, variationUpdate } = makeReturnPrisma();
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', false, 'không phải lỗi NSX');
    expect(returnUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1', status: 'REQUESTED' },
        data: expect.objectContaining({ status: 'REJECTED', adminNote: 'không phải lỗi NSX' }),
      }),
    );
    expect(userUpdate).not.toHaveBeenCalled();
    expect(variationUpdate).not.toHaveBeenCalled();
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
    expect(affiliate.reverseCommissionsForOrder).not.toHaveBeenCalled();
  });

  it('REJECT race (updateMany count=0) → BadRequest', async () => {
    const { prisma } = makeReturnPrisma({ returnUpdateManyCount: 0 });
    await expect(mkAdmin(prisma).reviewReturn('admin2', 'r1', false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
