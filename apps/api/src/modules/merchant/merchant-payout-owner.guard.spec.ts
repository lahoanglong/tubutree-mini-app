import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MerchantController } from './merchant.controller';
import { MerchantPayoutOwnerGuard } from './merchant-payout-owner.guard';

const GUARDS_KEY = '__guards__';

function ctxFor(handler: unknown, user: { sub: string; role: string } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => MerchantController,
  } as unknown as ExecutionContext;
}

/** Chạy RolesGuard rồi các guard gắn riêng ở route, đúng thứ tự Nest chạy. */
async function allowed(method: keyof MerchantController, user: { sub: string; role: string }, prisma: unknown): Promise<boolean> {
  const handler = MerchantController.prototype[method];
  const ctx = ctxFor(handler, user);
  try {
    if (!new RolesGuard(new Reflector()).canActivate(ctx)) return false;
    const routeGuards: (new (p: unknown) => { canActivate(c: ExecutionContext): boolean | Promise<boolean> })[] = Reflect.getMetadata(GUARDS_KEY, handler) ?? [];
    for (const G of routeGuards) if (!(await new G(prisma).canActivate(ctx))) return false;
    return true;
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

const prismaWith = (store: { id: string } | null, payouts: number) => ({
  storefront: { findFirst: jest.fn().mockResolvedValue(store) },
  merchantPayout: { count: jest.fn().mockResolvedValue(payouts) },
});

const OPEN: (keyof MerchantController)[] = ['getStore', 'listReturns', 'markReturnReceived', 'settlement'];
const CLOSED: (keyof MerchantController)[] = [
  'updateStore', 'publishStore', 'pauseOrders', 'listMyProducts', 'createProduct', 'updateProduct', 'stopSellingProduct',
  'checkPancakeVariation', 'addResellProduct', 'removeResellProduct', 'listOrders', 'updateOrderStatus', 'listFulfilOrders',
  'accept', 'pack', 'ship', 'deliver', 'fail', 'cancel',
];

describe('Cổng người bán cho chủ CUSTOMER còn phiếu đối soát', () => {
  const customer = { sub: 'u1', role: 'CUSTOMER' };

  it.each(OPEN)('%s: CUSTOMER chủ gian hàng có phiếu vào được', async (m) => {
    expect(await allowed(m, customer, prismaWith({ id: 's1' }, 2))).toBe(true);
  });

  it.each(OPEN)('%s: CUSTOMER không có gian hàng bị 403', async (m) => {
    expect(await allowed(m, customer, prismaWith(null, 0))).toBe(false);
  });

  it.each(OPEN)('%s: CUSTOMER có gian hàng nhưng chưa có phiếu bị 403', async (m) => {
    expect(await allowed(m, customer, prismaWith({ id: 's1' }, 0))).toBe(false);
  });

  it.each(CLOSED)('%s: CUSTOMER có phiếu vẫn bị 403', async (m) => {
    expect(await allowed(m, customer, prismaWith({ id: 's1' }, 2))).toBe(false);
  });

  it.each(['DEALER', 'AFFILIATE', 'ADMIN'])('%s vào route mở như cũ, không tra gian hàng', async (role) => {
    const prisma = prismaWith(null, 0);
    expect(await allowed('listReturns', { sub: 'u2', role }, prisma)).toBe(true);
    expect(prisma.storefront.findFirst).not.toHaveBeenCalled();
  });

  it('guard tra gian hàng theo đúng chủ trong token', async () => {
    const prisma = prismaWith({ id: 's1' }, 1);
    await new MerchantPayoutOwnerGuard(prisma as never).canActivate(ctxFor(undefined, customer));
    expect(prisma.storefront.findFirst).toHaveBeenCalledWith({ where: { ownerUserId: 'u1' }, select: { id: true } });
  });

  it('mọi route của controller đã được phân loại mở/đóng (thêm route mới phải chọn một)', () => {
    const routes = Object.getOwnPropertyNames(MerchantController.prototype).filter((n) => n !== 'constructor');
    expect(routes.sort()).toEqual([...OPEN, ...CLOSED].sort());
  });
});
