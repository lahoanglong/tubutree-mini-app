import { OrdersService } from './orders.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { CartService } from '../cart/cart.service';
import type { NotificationsService } from '../notifications/notifications.service';

const loyalty = { reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService;
const cart = {} as unknown as CartService;
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;

function makeService(order: Record<string, unknown>, spies: { update?: jest.Mock; userUpdate?: jest.Mock } = {}) {
  const update = spies.update ?? jest.fn().mockResolvedValue({});
  const userUpdate = spies.userUpdate ?? jest.fn().mockResolvedValue({});
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order), update },
    user: { update: userUpdate },
  } as unknown as PrismaService;
  return { svc: new OrdersService(prisma, loyalty, cart, notifications), update, userUpdate };
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

  it('hủy được đơn CONFIRMED → set CANCELLED + hoàn điểm + notify', async () => {
    const { svc, update } = makeService({ ...baseOrder, status: 'CONFIRMED' });
    await svc.cancel('u1', 'TUBU1');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELLED' } }));
    expect((loyalty.reverseOrderPoints as jest.Mock)).toHaveBeenCalledWith('o1');
    expect((notifications.notify as jest.Mock)).toHaveBeenCalled();
  });

  it('KHÔNG hủy được đơn SHIPPING (đã vào giao)', async () => {
    const { svc, update } = makeService({ ...baseOrder, status: 'SHIPPING' });
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
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
