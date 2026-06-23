import { OrdersService } from './orders.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { CartService } from '../cart/cart.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const loyalty = { reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService;
const cart = {} as unknown as CartService;
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;

function makeService(
  order: Record<string, unknown>,
  spies: { updateMany?: jest.Mock; userUpdate?: jest.Mock; variationUpdate?: jest.Mock } = {},
) {
  // updateMany trả count=1 (thắng race) mặc định; test race truyền count=0.
  const updateMany = spies.updateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const userUpdate = spies.userUpdate ?? jest.fn().mockResolvedValue({});
  const variationUpdate = spies.variationUpdate ?? jest.fn().mockResolvedValue({});
  // $transaction giờ là CALLBACK form (flip-status + hoàn ví + restock ATOMIC). Forward tx ops vào cùng mock.
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      order: { updateMany },
      user: { update: userUpdate },
      variation: { update: variationUpdate },
    }),
  );
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order), updateMany },
    user: { update: userUpdate },
    variation: { update: variationUpdate },
    $transaction,
  } as unknown as PrismaService;
  return {
    svc: new OrdersService(prisma, loyalty, cart, notifications, config),
    updateMany,
    userUpdate,
    variationUpdate,
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
