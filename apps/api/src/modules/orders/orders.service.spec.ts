import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { CartService } from '../cart/cart.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { FlashSaleService } from '../flash-sale/flash-sale.service';

const loyalty = { reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService;
const cart = {} as unknown as CartService;
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
const flash = { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService;

function makeService(
  order: Record<string, unknown>,
  spies: {
    updateMany?: jest.Mock;
    userUpdate?: jest.Mock;
    variationUpdate?: jest.Mock;
    coinCreate?: jest.Mock;
  } = {},
) {
  // updateMany trả count=1 (thắng race) mặc định; test race truyền count=0.
  const updateMany = spies.updateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const userUpdate = spies.userUpdate ?? jest.fn().mockResolvedValue({});
  const variationUpdate = spies.variationUpdate ?? jest.fn().mockResolvedValue({});
  const coinCreate = spies.coinCreate ?? jest.fn().mockResolvedValue({});
  // $transaction giờ là CALLBACK form (flip-status + hoàn ví/xu + restock ATOMIC). Forward tx ops vào cùng mock.
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      order: { updateMany },
      user: { update: userUpdate },
      variation: { update: variationUpdate },
      coinTransaction: { create: coinCreate },
    }),
  );
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order), updateMany },
    user: { update: userUpdate },
    variation: { update: variationUpdate },
    coinTransaction: { create: coinCreate },
    $transaction,
  } as unknown as PrismaService;
  return {
    svc: new OrdersService(prisma, loyalty, cart, notifications, config, flash),
    updateMany,
    userUpdate,
    variationUpdate,
    coinCreate,
    $transaction,
  };
}

const baseOrder = {
  id: 'o1',
  code: 'TUBU1',
  userId: 'u1',
  status: 'CONFIRMED',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  total: 300000,
  items: [],
};

describe('OrdersService.cancel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hủy được đơn CONFIRMED → set CANCELLED (atomic guard) + hoàn điểm + notify', async () => {
    const { svc, updateMany } = makeService({ ...baseOrder, status: 'CONFIRMED' });
    await svc.cancel('u1', 'TUBU1');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1', status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } },
        data: { status: 'CANCELLED' },
      }),
    );
    expect((loyalty.reverseOrderPoints as jest.Mock)).toHaveBeenCalledWith('o1');
    expect((notifications.notify as jest.Mock)).toHaveBeenCalled();
  });

  it('KHÔNG hủy được đơn SHIPPING (đã vào giao)', async () => {
    const { svc, updateMany } = makeService({ ...baseOrder, status: 'SHIPPING' });
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('hủy đồng thời (race): request THUA (count=0) KHÔNG hoàn ví lần 2', async () => {
    const userUpdate = jest.fn().mockResolvedValue({});
    const { svc } = makeService(
      { ...baseOrder, paymentMethod: 'WALLET', paymentStatus: 'PAID' },
      { updateMany: jest.fn().mockResolvedValue({ count: 0 }), userUpdate },
    );
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).not.toHaveBeenCalled();
    expect((loyalty.reverseOrderPoints as jest.Mock)).not.toHaveBeenCalled();
  });

  it('hoàn Ví khi đơn thanh toán bằng WALLET + PAID', async () => {
    const { svc, userUpdate } = makeService({
      ...baseOrder,
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
    });
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { walletBalance: { increment: 300000 } } }),
    );
  });

  it('hoàn Ví khi đơn thanh toán bằng ZALOPAY + PAID (kênh prepaid, nhất quán reviewReturn)', async () => {
    const { svc, userUpdate } = makeService({
      ...baseOrder,
      paymentMethod: 'ZALOPAY',
      paymentStatus: 'PAID',
    });
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { walletBalance: { increment: 300000 } } }),
    );
  });

  it('KHÔNG hoàn Ví khi thanh toán COD', async () => {
    const { svc, userUpdate } = makeService({ ...baseOrder, paymentMethod: 'COD', paymentStatus: 'UNPAID' });
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('hoàn XU (coinsBalance + CoinTransaction) khi đơn trả bằng XU + PAID — KHÔNG hoàn ví', async () => {
    const { svc, userUpdate, coinCreate } = makeService({
      ...baseOrder,
      paymentMethod: 'XU',
      paymentStatus: 'PAID',
    });
    await svc.cancel('u1', 'TUBU1');
    // Hoàn vào coinsBalance, KHÔNG phải walletBalance (xu không rút được → tránh leak giá trị).
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { coinsBalance: { increment: 300000 } } }),
    );
    expect(userUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { walletBalance: { increment: 300000 } } }),
    );
    // Ghi sổ cái xu (+total) giữ bất biến coinsBalance == Σdelta.
    expect(coinCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', delta: 300000, reason: 'ORDER_REFUND:TUBU1', refType: 'ORDER' }),
      }),
    );
  });

  it('hủy XU race THUA (count=0) → KHÔNG hoàn xu, KHÔNG ghi sổ cái', async () => {
    const { svc, userUpdate, coinCreate } = makeService(
      { ...baseOrder, paymentMethod: 'XU', paymentStatus: 'PAID' },
      { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    );
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(coinCreate).not.toHaveBeenCalled();
  });

  it('chặn xem/hủy đơn của người khác', async () => {
    const { svc } = makeService({ ...baseOrder, userId: 'someone-else' });
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow();
  });
});

describe('OrdersService.cancel — atomic flip+refund (B1)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('WALLET+PAID: status flip + walletBalance increment THỰC HIỆN trong cùng $transaction callback', async () => {
    const { svc, $transaction, updateMany, userUpdate } = makeService({
      ...baseOrder,
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
    });
    await svc.cancel('u1', 'TUBU1');
    // $transaction được gọi với 1 callback (function), không phải array of ops
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(typeof $transaction.mock.calls[0]?.[0]).toBe('function');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1', status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } },
        data: { status: 'CANCELLED' },
      }),
    );
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { walletBalance: { increment: 300000 } } }),
    );
  });

  it('COD+UNPAID: chỉ flip status, KHÔNG đụng tới user.update walletBalance', async () => {
    const { svc, $transaction, userUpdate } = makeService({
      ...baseOrder,
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
    });
    await svc.cancel('u1', 'TUBU1');
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('race count=0: KHÔNG gọi reverseOrderPoints, KHÔNG hoàn ví', async () => {
    const userUpdate = jest.fn().mockResolvedValue({});
    const { svc } = makeService(
      { ...baseOrder, paymentMethod: 'WALLET', paymentStatus: 'PAID' },
      { updateMany: jest.fn().mockResolvedValue({ count: 0 }), userUpdate },
    );
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).not.toHaveBeenCalled();
    expect((loyalty.reverseOrderPoints as jest.Mock)).not.toHaveBeenCalled();
  });
});

describe('OrdersService.cancel — B5 restock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancel THẮNG → tx.variation.update increment cho mỗi item', async () => {
    const items = [
      { variationId: 'v1', quantity: 2 },
      { variationId: 'v2', quantity: 5 },
    ];
    const { svc, variationUpdate } = makeService({ ...baseOrder, items });
    await svc.cancel('u1', 'TUBU1');
    expect(variationUpdate).toHaveBeenCalledTimes(2);
    expect(variationUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'v1' },
      data: { stock: { increment: 2 } },
    });
    expect(variationUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'v2' },
      data: { stock: { increment: 5 } },
    });
  });

  it('cancel THUA race (count=0) → KHÔNG restock', async () => {
    const items = [{ variationId: 'v1', quantity: 2 }];
    const { svc, variationUpdate } = makeService(
      { ...baseOrder, items },
      { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    );
    await svc.cancel('u1', 'TUBU1');
    expect(variationUpdate).not.toHaveBeenCalled();
  });
});

describe('OrdersService.cancel — flash sale quota restore', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancel THẮNG → gọi flash.restore(tx, itemId, userId, qty) cho item có flashSaleItemId', async () => {
    const items = [
      { variationId: 'v1', quantity: 2, flashSaleItemId: 'fi1' },
      { variationId: 'v2', quantity: 5, flashSaleItemId: null },
    ];
    const { svc } = makeService({ ...baseOrder, items });
    await svc.cancel('u1', 'TUBU1');
    expect(flash.restore).toHaveBeenCalledTimes(1);
    expect(flash.restore).toHaveBeenCalledWith(expect.anything(), 'fi1', 'u1', 2);
  });

  it('cancel THUA race (count=0) → KHÔNG gọi flash.restore', async () => {
    const items = [{ variationId: 'v1', quantity: 2, flashSaleItemId: 'fi1' }];
    const { svc } = makeService(
      { ...baseOrder, items },
      { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    );
    await svc.cancel('u1', 'TUBU1');
    expect(flash.restore).not.toHaveBeenCalled();
  });
});

describe('OrdersService.requestReturn', () => {
  const deliveredOrder = { ...baseOrder, status: 'DELIVERED', updatedAt: new Date(), createdAt: new Date() };

  function makeReturnService(over: { create?: jest.Mock; findFirst?: jest.Mock } = {}) {
    const create = over.create ?? jest.fn().mockResolvedValue({ id: 'r1' });
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(deliveredOrder) },
      returnRequest: { findFirst: over.findFirst ?? jest.fn().mockResolvedValue(null), create },
    } as unknown as PrismaService;
    return { svc: new OrdersService(prisma, loyalty, cart, notifications, config, flash), create };
  }

  it('race: 2 request đổi/trả song song — pre-check đọc "chưa có" nhưng create() đụng unique index partial (orderId, status=REQUESTED) → BadRequest, KHÔNG tạo 2 dòng', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
    const { svc } = makeReturnService({ create });
    await expect(svc.requestReturn('u1', 'TUBU1', { reason: 'lỗi' })).rejects.toThrow(
      'Đơn đang có yêu cầu đổi/trả chờ xử lý.',
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('gửi hợp lệ (chưa có yêu cầu chờ xử lý) → tạo return request', async () => {
    const { svc, create } = makeReturnService();
    const r = await svc.requestReturn('u1', 'TUBU1', { reason: 'lỗi sản phẩm' });
    expect(r).toEqual({ id: 'r1' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
