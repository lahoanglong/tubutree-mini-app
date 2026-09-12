import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { OrderReversalService } from '../orders/order-reversal.service';
import { OrderStatusService } from '../orders/order-status.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { FlashSaleService } from '../flash-sale/flash-sale.service';
import type { CouponsService } from '../coupons/coupons.service';
import type { RbacService } from '../staff/rbac/rbac.service';

const config = {} as unknown as SystemConfigService;
const loyalty = {
  creditOrderPoints: jest.fn().mockResolvedValue(undefined),
  reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
} as unknown as LoyaltyService;
const affiliate = {
  lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
  grantReferralReward: jest.fn().mockResolvedValue(undefined),
  reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
} as unknown as AffiliateService;
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
const flash = { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService;
const coupons = { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService;
const rbac = { revokeGrantsAbove: jest.fn().mockResolvedValue(0) } as unknown as RbacService;
// AdminService không còn tự viết khối restock/refund — ủy quyền cho OrderReversalService
// (reviewReturn) và OrderStatusService (updateOrderStatus). Dựng instance THẬT (không mock)
// của cả hai để test vẫn xác minh được hành vi thật qua các spy ở tầng tx bên dưới.
const mkAdmin = (prisma: PrismaService) => {
  const reversal = new OrderReversalService(flash, coupons);
  const orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal);
  return new AdminService(prisma, config, loyalty, affiliate, notifications, reversal, orderStatus, rbac);
};

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    dealerApplication: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    dealerTier: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
    user: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(3), findMany: jest.fn().mockResolvedValue([]) },
    returnRequest: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    order: { findUniqueOrThrow: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { ...base, ...over } as unknown as PrismaService;
}

/** $transaction interactive (callback) cho reviewDealerApplication approve path. */
function makeApproveTx(opts: {
  dealerAppUpdateMany?: jest.Mock;
  userUpdate?: jest.Mock;
}) {
  const dealerAppUpdateMany = opts.dealerAppUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const userUpdate = opts.userUpdate ?? jest.fn().mockResolvedValue({});
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      dealerApplication: { updateMany: dealerAppUpdateMany },
      user: { update: userUpdate },
    }),
  );
  return { $transaction, dealerAppUpdateMany, userUpdate };
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
    const { $transaction, dealerAppUpdateMany, userUpdate } = makeApproveTx({});
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
      },
      dealerTier: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
      user: {
        findUnique: jest.fn().mockResolvedValue({ metadata: { segments: ['mom_baby'], onboardedAt: '2026-01-01' } }),
      },
      $transaction,
    });
    await mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', true, 't1');
    // Guard atomic status='PENDING' TRONG transaction (chống race 2 admin duyệt cùng đơn).
    expect(dealerAppUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'd1', status: 'PENDING' }, data: expect.objectContaining({ status: 'APPROVED' }) }),
    );
    const meta = (userUpdate.mock.calls[0][0] as { data: { metadata: Record<string, unknown>; role: string } }).data;
    expect(meta.role).toBe('DEALER');
    expect(meta.metadata).toEqual({ segments: ['mom_baby'], onboardedAt: '2026-01-01', dealerTierId: 't1' });
  });

  it('metadata null → vẫn set dealerTierId', async () => {
    const { $transaction, userUpdate } = makeApproveTx({});
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ metadata: null }) },
      $transaction,
    });
    await mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', true, 't1');
    expect((userUpdate.mock.calls[0][0] as { data: { metadata: unknown } }).data.metadata).toEqual({ dealerTierId: 't1' });
  });

  it('race 2 admin duyệt cùng đơn → bên thua (updateMany count=0) throw, KHÔNG đổi role user', async () => {
    const { $transaction, userUpdate } = makeApproveTx({
      dealerAppUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ metadata: null }) },
      $transaction,
    });
    await expect(mkAdmin(prisma).reviewDealerApplication('admin2', 'd1', true, 't1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('từ chối → REJECTED + lý do, không động vào user', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const userUpdate = jest.fn();
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
        updateMany,
      },
      user: { findUnique: jest.fn(), update: userUpdate },
    });
    await mkAdmin(prisma).reviewDealerApplication('admin1', 'd1', false, undefined, 'thiếu giấy tờ');
    expect(updateMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: { id: 'd1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'thiếu giấy tờ' }),
      }),
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('từ chối race (updateMany count=0) → BadRequest', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = makePrisma({
      dealerApplication: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'PENDING', userId: 'u1' }),
        updateMany,
      },
    });
    await expect(mkAdmin(prisma).reviewDealerApplication('admin2', 'd1', false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

// Helper riêng cho reviewReturn — callback $transaction + updateMany (B3 atomic) + variation.update (B5 restock).
type Order = {
  id: string;
  code: string;
  userId: string;
  total: number;
  paymentMethod: 'COD' | 'WALLET' | 'ZALOPAY' | 'XU';
  paymentStatus: 'PAID' | 'UNPAID';
  items: Array<{ variationId: string; quantity: number; flashSaleItemId?: string | null; backorderedQty?: number }>;
};
type ReturnReq = { id: string; orderId: string; status: 'REQUESTED' | 'APPROVED' | 'REJECTED' } | null;

function makeReturnPrisma(opts: {
  returnReq?: ReturnReq;
  order?: Order;
  returnUpdateManyCount?: number; // count trả về cho returnRequest.updateMany trong tx
} = {}) {
  const returnReq: ReturnReq =
    opts.returnReq === undefined ? { id: 'r1', orderId: 'o1', status: 'REQUESTED' } : opts.returnReq;
  const rawOrder: Order = opts.order ?? {
    id: 'o1',
    code: 'TUBU1',
    userId: 'u1',
    total: 250000,
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    items: [{ variationId: 'v1', quantity: 1 }],
  };
  // Đơn thường luôn backorderedQty=0 (OrderReversalService đọc field này để chỉ hoàn đúng phần
  // đã giữ) — fixture cũ không khai báo field mới này, chuẩn hoá 1 chỗ thay vì sửa từng literal.
  const order: Order = { ...rawOrder, items: rawOrder.items.map((i) => ({ backorderedQty: 0, ...i })) };
  const returnUpdateMany = jest.fn().mockResolvedValue({ count: opts.returnUpdateManyCount ?? 1 });
  // reviewReturn giờ dùng order.updateMany (guard status=DELIVERED) + tx.order.findUniqueOrThrow.
  // orderUpdate giữ tên cũ để các test cũ vẫn dùng được như spy duy nhất cho order.update*.
  const orderUpdate = jest.fn().mockResolvedValue({ count: 1 });
  const userUpdate = jest.fn().mockResolvedValue({});
  /** Hoàn kho đi bằng SQL thô — xem catalog/variation-stock.ts. */
  const stockExecuteRaw = jest.fn().mockResolvedValue(1);
  const coinCreate = jest.fn().mockResolvedValue({});
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
      $executeRaw: stockExecuteRaw,
      coinTransaction: { create: coinCreate },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    }),
  );
  const prisma = {
    returnRequest: { findUnique: jest.fn().mockResolvedValue(returnReq), updateMany: returnUpdateMany },
    // findMany/user.findMany: withReturnContext nạp đơn + khách để portal admin thấy mã đơn,
    // tổng tiền và SĐT thay vì một dãy cuid.
    order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order), findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction,
  } as unknown as PrismaService;
  return { prisma, returnUpdateMany, orderUpdate, userUpdate, stockExecuteRaw, coinCreate, $transaction };
}

describe('AdminService.reviewReturn (B3 refund-channel + atomic + B5 restock)', () => {
  beforeEach(() => {
    (loyalty.reverseOrderPoints as jest.Mock).mockClear();
    (affiliate.reverseCommissionsForOrder as jest.Mock).mockClear();
    (flash.restore as jest.Mock).mockClear();
  });

  it('yêu cầu không tồn tại → NotFound', async () => {
    const { prisma } = makeReturnPrisma({ returnReq: null });
    await expect(mkAdmin(prisma).reviewReturn('a1', 'x', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('APPROVE với COD UNPAID → đơn RETURNED, KHÔNG hoàn walletBalance, restock đủ', async () => {
    const { prisma, returnUpdateMany, orderUpdate, userUpdate, stockExecuteRaw } = makeReturnPrisma({
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
    expect(stockExecuteRaw).toHaveBeenCalledTimes(2);
    // Tham số câu UPDATE hoàn kho: (số lượng, số lượng, variationId).
    expect(stockExecuteRaw.mock.calls[0]!.slice(1)).toEqual([2, 2, 'v1']);
    expect(stockExecuteRaw.mock.calls[1]!.slice(1)).toEqual([3, 3, 'v2']);
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o1');
  });

  it('APPROVE với item có flashSaleItemId → gọi flash.restore(tx, itemId, order.userId, qty)', async () => {
    const { prisma } = makeReturnPrisma({
      order: {
        id: 'o1',
        code: 'TUBU1',
        userId: 'u1',
        total: 300000,
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        items: [{ variationId: 'v1', quantity: 3, flashSaleItemId: 'fi1' }],
      },
    });
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', true);
    expect(flash.restore).toHaveBeenCalledTimes(1);
    expect(flash.restore).toHaveBeenCalledWith(expect.anything(), 'fi1', 'u1', 3);
  });

  it('APPROVE với item KHÔNG có flashSaleItemId → KHÔNG gọi flash.restore', async () => {
    const { prisma } = makeReturnPrisma({
      order: {
        id: 'o1',
        code: 'TUBU1',
        userId: 'u1',
        total: 300000,
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        items: [{ variationId: 'v1', quantity: 3 }],
      },
    });
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', true);
    expect(flash.restore).not.toHaveBeenCalled();
  });

  it('APPROVE với WALLET PAID → hoàn walletBalance + restock', async () => {
    const { prisma, userUpdate, stockExecuteRaw } = makeReturnPrisma({
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
    expect(stockExecuteRaw).toHaveBeenCalledTimes(1);
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

  it('APPROVE với XU PAID → hoàn coinsBalance + CoinTransaction, KHÔNG hoàn ví', async () => {
    const { prisma, userUpdate, coinCreate } = makeReturnPrisma({
      order: {
        id: 'o1',
        code: 'TUBU1',
        userId: 'u1',
        total: 120000,
        paymentMethod: 'XU',
        paymentStatus: 'PAID',
        items: [{ variationId: 'v1', quantity: 1 }],
      },
    });
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', true);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { coinsBalance: { increment: 120000 } },
    });
    expect(userUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { walletBalance: { increment: 120000 } } }),
    );
    expect(coinCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', delta: 120000, reason: 'ORDER_REFUND:TUBU1', refType: 'ORDER' }),
      }),
    );
  });

  it('hoàn tiền flip paymentStatus PAID→REFUNDED (nhất quán cancel, không để RETURNED còn PAID)', async () => {
    const { prisma, orderUpdate } = makeReturnPrisma({
      order: { id: 'o1', code: 'TUBU1', userId: 'u1', total: 120000, paymentMethod: 'XU', paymentStatus: 'PAID', items: [{ variationId: 'v1', quantity: 1 }] },
    });
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', true);
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', paymentStatus: 'PAID' }, data: { paymentStatus: 'REFUNDED' } }),
    );
  });

  it('paymentStatus flip THUA race (count=0, đã refund nơi khác) → KHÔNG hoàn xu lần 2', async () => {
    const { prisma, orderUpdate, userUpdate, coinCreate } = makeReturnPrisma({
      order: { id: 'o1', code: 'TUBU1', userId: 'u1', total: 120000, paymentMethod: 'XU', paymentStatus: 'PAID', items: [{ variationId: 'v1', quantity: 1 }] },
    });
    // status flip count=1 (thắng), paymentStatus flip count=0 (đã REFUNDED bởi path khác).
    orderUpdate.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', true);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(coinCreate).not.toHaveBeenCalled();
  });

  it('race 2 admin approve cùng request → bên thua (updateMany count=0) throw, không hoàn ví/restock', async () => {
    const { prisma, userUpdate, stockExecuteRaw } = makeReturnPrisma({ returnUpdateManyCount: 0 });
    await expect(mkAdmin(prisma).reviewReturn('admin2', 'r1', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(userUpdate).not.toHaveBeenCalled();
    expect(stockExecuteRaw).not.toHaveBeenCalled();
    // Reverse loyalty/affiliate cũng KHÔNG được gọi vì throw trước khi tới đoạn ngoài tx.
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalled();
    expect(affiliate.reverseCommissionsForOrder).not.toHaveBeenCalled();
  });

  it('REJECT → update REJECTED + note, KHÔNG hoàn ví, KHÔNG restock, KHÔNG reverse', async () => {
    const { prisma, returnUpdateMany, userUpdate, stockExecuteRaw } = makeReturnPrisma();
    await mkAdmin(prisma).reviewReturn('admin1', 'r1', false, 'không phải lỗi NSX');
    expect(returnUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1', status: 'REQUESTED' },
        data: expect.objectContaining({ status: 'REJECTED', adminNote: 'không phải lỗi NSX' }),
      }),
    );
    expect(userUpdate).not.toHaveBeenCalled();
    expect(stockExecuteRaw).not.toHaveBeenCalled();
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

describe('AdminService.importDealerPrices (import bảng giá đại lý theo bậc)', () => {
  function importPrisma(over: Record<string, unknown> = {}) {
    const base = {
      dealerTier: { findUnique: jest.fn().mockResolvedValue({ id: 't1', name: 'Bạc' }) },
      variation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', sku: 'SKU-1', dealerPrices: { t0: 99000 } }),
        update: jest.fn().mockResolvedValue({}),
      },
      dealerPriceHistory: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    return { ...base, ...over } as unknown as PrismaService;
  }

  it('bậc đại lý không tồn tại → BadRequest', async () => {
    const prisma = importPrisma({ dealerTier: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(mkAdmin(prisma).importDealerPrices('admin1', 'bad', [{ sku: 'SKU-1', price: 100000 }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('import hợp lệ → MERGE giá vào dealerPrices[tierId] + ghi DealerPriceHistory (old→new)', async () => {
    const prisma = importPrisma();
    const r = await mkAdmin(prisma).importDealerPrices('admin1', 't1', [{ sku: 'SKU-1', price: 180000 }]);
    expect(r).toMatchObject({ tierId: 't1', updated: 1, notFound: [] });
    const upd = (prisma.variation.update as jest.Mock).mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'v1' });
    expect(upd.data.dealerPrices).toEqual({ t0: 99000, t1: 180000 }); // merge, không mất bậc khác
    const hist = (prisma.dealerPriceHistory.create as jest.Mock).mock.calls[0][0].data;
    expect(hist).toMatchObject({ variationId: 'v1', tierId: 't1', oldPrice: null, newPrice: 180000, changedBy: 'admin1' });
  });

  it('SKU không tồn tại → vào notFound, không update', async () => {
    const prisma = importPrisma({
      variation: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    });
    const r = await mkAdmin(prisma).importDealerPrices('admin1', 't1', [{ sku: 'SKU-X', price: 100000 }]);
    expect(r.updated).toBe(0);
    expect(r.notFound).toEqual(['SKU-X']);
    expect(prisma.variation.update).not.toHaveBeenCalled();
  });

  it('giá không đổi → bỏ qua (không update/không ghi history thừa)', async () => {
    const prisma = importPrisma({
      variation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', sku: 'SKU-1', dealerPrices: { t1: 150000 } }),
        update: jest.fn(),
      },
    });
    const r = await mkAdmin(prisma).importDealerPrices('admin1', 't1', [{ sku: 'SKU-1', price: 150000 }]);
    expect(r.updated).toBe(0);
    expect(prisma.variation.update).not.toHaveBeenCalled();
    expect(prisma.dealerPriceHistory.create).not.toHaveBeenCalled();
  });

  it('giá <= 0 hoặc sku rỗng → bỏ dòng lỗi (không update)', async () => {
    const prisma = importPrisma();
    const r = await mkAdmin(prisma).importDealerPrices('admin1', 't1', [
      { sku: '', price: 100000 },
      { sku: 'SKU-1', price: 0 },
    ]);
    expect(r.updated).toBe(0);
    expect(prisma.variation.update).not.toHaveBeenCalled();
  });
});

describe('AdminService.setUserRole', () => {
  it('SĐT không tồn tại → NotFound (không tự tạo user như script SSH cũ)', async () => {
    const prisma = makePrisma({ user: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0900000000', 'ADMIN')).rejects.toBeInstanceOf(NotFoundException);
    expect((prisma as unknown as { user: { update: jest.Mock } }).user.update).not.toHaveBeenCalled();
  });

  it('cấp role: update đúng user + trả previousRole (audit ai đổi)', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'ADMIN', fullName: 'X' });
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'CUSTOMER' }), update },
    });
    const out = await mkAdmin(prisma).setUserRole('admin1', ' 0899625240 ', 'ADMIN');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'ADMIN' },
      select: { id: true, phone: true, fullName: true, role: true },
    });
    expect(out.previousRole).toBe('CUSTOMER');
    expect(out.role).toBe('ADMIN');
  });

  // P0-3 (docs/2026-09-08-review-progress.md): hạ role qua đường này trước đây KHÔNG đụng
  // RoleGrant — applyGrants (chỉ nâng, gọi mỗi lần refresh token) đọc thấy grant ADMIN còn
  // hiệu lực rồi tự phục hồi ngay sau khi admin vừa thu hồi quyền. Phải gọi revokeGrantsAbove.
  it('hạ role → gọi rbac.revokeGrantsAbove(phone, role mới) để chặn applyGrants tự phục hồi', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'CUSTOMER', fullName: 'X' });
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(3) },
    });
    await mkAdmin(prisma).setUserRole('admin1', '0899625240', 'CUSTOMER');
    expect(rbac.revokeGrantsAbove).toHaveBeenCalledWith('0899625240', 'CUSTOMER');
  });

  // Một cú chạm nhầm không được phép khoá cả tổ chức ra ngoài: khôi phục chỉ còn cách vào
  // thẳng DB bằng SQL.
  it('admin tự hạ quyền CHÍNH MÌNH → từ chối, không đụng tới role', async () => {
    const update = jest.fn();
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'admin1', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(5) },
    });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'CUSTOMER')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('admin tự đổi role chính mình THÀNH ADMIN (không hạ) → vẫn cho qua', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'admin1', phone: '0899625240', role: 'ADMIN', fullName: 'X' });
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'admin1', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(1) },
    });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'ADMIN')).resolves.toMatchObject({ ok: true });
  });

  it('hạ ADMIN CUỐI CÙNG → từ chối (không còn ai cấp lại quyền cho ai)', async () => {
    const update = jest.fn();
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u2', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(1) },
    });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'STAFF')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('hạ một ADMIN khi còn admin khác → cho qua', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'u2', phone: '0899625240', role: 'STAFF', fullName: 'X' });
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u2', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(2) },
    });
    await expect(mkAdmin(prisma).setUserRole('admin1', '0899625240', 'STAFF')).resolves.toMatchObject({ ok: true });
  });

  it('rbac.revokeGrantsAbove lỗi → vẫn trả kết quả đổi role thành công (best-effort, không rollback role)', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'CUSTOMER', fullName: 'X' });
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0899625240', role: 'ADMIN' }), update, count: jest.fn().mockResolvedValue(3) },
    });
    (rbac.revokeGrantsAbove as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const out = await mkAdmin(prisma).setUserRole('admin1', '0899625240', 'CUSTOMER');
    expect(out.role).toBe('CUSTOMER');
  });
});

// Việc 9 (audit round 2): createCoupon() trước đây KHÔNG ghi scopeMeta → coupon scope TIER/
// USER_GROUP tạo ra fail-closed ở MỌI user (isCouponEligible luôn false), KHÔNG AI DÙNG ĐƯỢC.
// DTO (RequiredScopeMeta) đã bắt buộc đúng field trước khi tới service — test này chỉ xác nhận
// service GHI ĐÚNG scopeMeta vào prisma.coupon.create.
describe('AdminService.createCoupon — ghi scopeMeta (Việc 9)', () => {
  const couponBase = {
    code: 'SALE10',
    type: 'PERCENT' as const,
    value: 10,
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-12-31T00:00:00.000Z',
  };

  it('scope=TIER + scopeMeta.tierId → ghi scopeMeta vào coupon.create', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'c1' });
    const prisma = makePrisma({ coupon: { create } });
    await mkAdmin(prisma).createCoupon({ ...couponBase, scope: 'TIER', scopeMeta: { tierId: 'GOLD' } });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'TIER', scopeMeta: { tierId: 'GOLD' } }) }),
    );
  });

  it('scope=USER_GROUP + scopeMeta.userId → ghi scopeMeta vào coupon.create', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'c2' });
    const prisma = makePrisma({ coupon: { create } });
    await mkAdmin(prisma).createCoupon({ ...couponBase, scope: 'USER_GROUP', scopeMeta: { userId: 'u1' } });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'USER_GROUP', scopeMeta: { userId: 'u1' } }) }),
    );
  });

  it('scope=PUBLIC, không truyền scopeMeta → coupon.create nhận scopeMeta=undefined (không lỗi)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'c3' });
    const prisma = makePrisma({ coupon: { create } });
    await mkAdmin(prisma).createCoupon({ ...couponBase, scope: 'PUBLIC' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'PUBLIC', scopeMeta: undefined }) }),
    );
  });
});

describe('AdminService.getDashboardStats', () => {
  it('tổng hợp đúng số lượng đơn, doanh thu và cây trồng', async () => {
    const prisma = makePrisma({
      order: {
        count: jest.fn().mockResolvedValue(15),
        aggregate: jest.fn().mockResolvedValue({ _sum: { total: 1500000 } }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'o1', code: 'TB1', total: 100000, status: 'DELIVERED', paymentMethod: 'COD', createdAt: new Date() },
        ]),
      },
      user: {
        count: jest.fn().mockResolvedValue(50),
      },
      product: {
        count: jest.fn().mockResolvedValue(20),
      },
      plantedTree: {
        count: jest.fn().mockResolvedValue(8),
      },
    });

    const stats = await mkAdmin(prisma).getDashboardStats();
    expect(stats.totalRevenue).toBe(1500000);
    expect(stats.totalOrders).toBe(15);
    expect(stats.totalUsers).toBe(50);
    expect(stats.plantedTreesCount).toBe(8);
    expect(stats.recentOrders).toHaveLength(1);
  });
});

// updateOrderStatus giờ ủy quyền toàn bộ cho OrderStatusService (assertTransition + atomic
// flip qua $transaction interactive) — cần mock $transaction thật sự GỌI callback với 1 tx
// giả lập order.updateMany, khác với `makePrisma` mặc định (chỉ resolve [] không gọi callback).
function makeStatusPrisma(order: Record<string, unknown>, finalOrder: Record<string, unknown>, flipCount = 1) {
  const txUpdateMany = jest.fn().mockResolvedValue({ count: flipCount });
  const $transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb({ order: { updateMany: txUpdateMany }, orderStatusHistory: { create: jest.fn().mockResolvedValue({}) } }));
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      findUniqueOrThrow: jest.fn().mockResolvedValue(finalOrder),
    },
    $transaction,
  } as unknown as PrismaService;
  return { prisma, txUpdateMany };
}

describe('AdminService.updateOrderStatus', () => {
  it('chuyển DELIVERED → credit điểm và lock hoa hồng', async () => {
    const order = { id: 'o1', code: 'TB-100', userId: 'u1', status: 'SHIPPING', total: 200000, note: null, items: [] };
    const { prisma } = makeStatusPrisma(order, { ...order, status: 'DELIVERED' });

    const res = await mkAdmin(prisma).updateOrderStatus('admin-1', 'o1', 'DELIVERED', 'Giao thành công');
    expect(res.status).toBe('DELIVERED');
    expect(loyalty.creditOrderPoints).toHaveBeenCalledWith('o1');
    expect(affiliate.lockCommissionsForOrder).toHaveBeenCalledWith('o1');
  });

  it('chuyển CANCELLED → reverse điểm và reverse hoa hồng (kèm reversal restock — items rỗng)', async () => {
    const order = { id: 'o2', code: 'TB-101', userId: 'u2', status: 'CONFIRMED', total: 300000, note: null, items: [], paymentMethod: 'COD', paymentStatus: 'UNPAID' };
    const { prisma } = makeStatusPrisma(order, { ...order, status: 'CANCELLED' });

    const res = await mkAdmin(prisma).updateOrderStatus('admin-1', 'o2', 'CANCELLED', 'Khách đổi ý');
    expect(res.status).toBe('CANCELLED');
    expect(loyalty.reverseOrderPoints).toHaveBeenCalledWith('o2');
    expect(affiliate.reverseCommissionsForOrder).toHaveBeenCalledWith('o2');
  });

  it('chuyển DELIVERED → CONFIRMED (regression) → BadRequest, không chạy side-effect', async () => {
    const order = { id: 'o3', code: 'TB-102', userId: 'u3', status: 'DELIVERED', total: 100000, note: null, items: [] };
    const { prisma } = makeStatusPrisma(order, order);

    await expect(mkAdmin(prisma).updateOrderStatus('admin-1', 'o3', 'CONFIRMED')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(loyalty.reverseOrderPoints).not.toHaveBeenCalledWith('o3');
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalledWith('o3');
  });

  it('đơn không tồn tại → throw NotFoundException', async () => {
    const prisma = makePrisma({
      order: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(mkAdmin(prisma).updateOrderStatus('admin-1', 'non-existent', 'CANCELLED')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('AdminService.listOrders with search', () => {
  it('tìm kiếm theo mã đơn hoặc SĐT truyền OR filter vào Prisma', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = makePrisma({
      order: { findMany, count },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    });

    await mkAdmin(prisma).listOrders(1, 20, undefined, '0901234567');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ code: { contains: '0901234567', mode: 'insensitive' } }),
            expect.objectContaining({ user: { phone: { contains: '0901234567' } } }),
          ]),
        }),
      }),
    );
  });
});

describe('AdminService.listPendingMerchantProducts & reviewMerchantProduct', () => {
  it('listPendingMerchantProducts chỉ lấy sản phẩm có approvalStatus=PENDING_REVIEW', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'p1', name: 'Nước giặt sinh học', approvalStatus: 'PENDING_REVIEW' },
    ]);
    const prisma = makePrisma({ product: { findMany } });
    const res = await mkAdmin(prisma).listPendingMerchantProducts();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { approvalStatus: 'PENDING_REVIEW' },
      }),
    );
    expect(res).toHaveLength(1);
  });

  it('reviewMerchantProduct duyệt APPROVED', async () => {
    const product = { id: 'p1', name: 'Nước giặt', approvalStatus: 'PENDING_REVIEW' };
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...product, approvalStatus: 'APPROVED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const res = await mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', true);
    expect(res.approvalStatus).toBe('APPROVED');
  });

  it('reviewMerchantProduct từ chối REJECTED kèm lý do', async () => {
    const product = { id: 'p1', name: 'Kem chống nắng', approvalStatus: 'PENDING_REVIEW' };
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...product, approvalStatus: 'REJECTED', rejectReason: 'Chưa đủ chứng nhận' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const res = await mkAdmin(prisma).reviewMerchantProduct('admin-1', 'p1', false, 'Chưa đủ chứng nhận');
    expect(res.approvalStatus).toBe('REJECTED');
    expect(res.rejectReason).toBe('Chưa đủ chứng nhận');
  });

  /**
   * Hai admin cùng mở danh sách chờ duyệt: A bấm Duyệt, B bấm Từ chối hai giây sau. Không có CAS
   * thì B ghi đè kết quả của A mà A không hề biết, và không có bản ghi nào cho biết ai làm gì.
   */
  it('sản phẩm vừa được người khác xử lý (CAS count 0) → BadRequest thay vì lặng lẽ ghi đè', async () => {
    const product = { id: 'p1', name: 'Nước giặt', approvalStatus: 'PENDING_REVIEW' };
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    await expect(mkAdmin(prisma).reviewMerchantProduct('admin-2', 'p1', false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});


/**
 * Portal web render `r.order?.code`, `r.user?.fullName`, tổng đơn và phương thức thanh toán,
 * nhưng ReturnRequest chỉ lưu orderId/userId dạng chuỗi (schema không khai quan hệ) nên truy vấn
 * cũ không trả gì. Admin chỉ thấy một dãy cuid và chữ "Khách hàng", rồi bấm Duyệt để hoàn nguyên
 * tổng đơn về ví mà KHÔNG nhìn thấy số tiền mình đang hoàn.
 */
describe('AdminService.listReturnRequests — kèm đơn và khách', () => {
  it('ghép order + user vào từng yêu cầu, chỉ 2 truy vấn phụ cho cả trang', async () => {
    const orderFindMany = jest.fn().mockResolvedValue([
      { id: 'o1', code: 'TUBU1', total: 250000, status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'PAID' },
    ]);
    const userFindMany = jest.fn().mockResolvedValue([{ id: 'u1', fullName: 'Lã Hoàng Long', phone: '0899625240' }]);
    const prisma = makePrisma({
      returnRequest: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', orderId: 'o1', userId: 'u1', status: 'REQUESTED' },
          { id: 'r2', orderId: 'o1', userId: 'u1', status: 'REQUESTED' },
        ]),
      },
      order: { findMany: orderFindMany },
      user: { findMany: userFindMany },
    });

    const rows = (await mkAdmin(prisma).listReturnRequests()) as {
      order: { code: string; total: number } | null;
      user: { phone: string } | null;
    }[];

    expect(rows).toHaveLength(2);
    expect(rows[0]!.order).toMatchObject({ code: 'TUBU1', total: 250000 });
    expect(rows[0]!.user).toMatchObject({ phone: '0899625240' });
    expect(orderFindMany).toHaveBeenCalledTimes(1);
    expect(userFindMany).toHaveBeenCalledTimes(1);
    // id trùng nhau chỉ hỏi 1 lần
    expect(orderFindMany.mock.calls[0][0].where.id.in).toEqual(['o1']);
  });

  it('không có yêu cầu nào → mảng rỗng, không truy vấn thừa', async () => {
    const orderFindMany = jest.fn();
    const prisma = makePrisma({
      returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
      order: { findMany: orderFindMany },
      user: { findMany: jest.fn() },
    });

    await expect(mkAdmin(prisma).listReturnRequests()).resolves.toEqual([]);
    expect(orderFindMany).not.toHaveBeenCalled();
  });

  it('đơn đã bị xoá → order = null, không làm hỏng cả danh sách', async () => {
    const prisma = makePrisma({
      returnRequest: { findMany: jest.fn().mockResolvedValue([{ id: 'r1', orderId: 'gone', userId: 'u1' }]) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const rows = (await mkAdmin(prisma).listReturnRequests()) as { order: unknown; user: unknown }[];
    expect(rows[0]!.order).toBeNull();
    expect(rows[0]!.user).toBeNull();
  });
});
