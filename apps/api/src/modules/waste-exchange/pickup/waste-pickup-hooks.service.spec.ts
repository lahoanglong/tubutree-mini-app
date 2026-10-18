import { writeWasteEvent } from '../core/waste-events';
import { WasteCoreModule } from '../core/waste-core.module';
import { OrdersModule } from '../../orders/orders.module';
import { OrderStatusService } from '../../orders/order-status.service';
import { OrdersService } from '../../orders/orders.service';
import { WastePickupHooks } from './waste-pickup-hooks.service';
import { WastePickupModule } from './waste-pickup.module';

jest.mock('../core/waste-events', () => ({ writeWasteEvent: jest.fn().mockResolvedValue({ id: 'ev1' }) }));

const DELIVERED_AT = new Date('2026-10-20T03:00:00.000Z');
const EXPIRES_AT = new Date('2026-11-03T03:00:00.000Z'); // DELIVERED_AT + 14 days
const REQ = { id: 'r1', code: 'TR-ABC23', userId: 'u1', status: 'OPEN' };

function setup(o: { order?: { status: string; deliveredAt: Date | null } | null; request?: typeof REQ | null; count?: number; reread?: string; updateError?: Error } = {}) {
  const updateMany = o.updateError ? jest.fn().mockRejectedValue(o.updateError) : jest.fn().mockResolvedValue({ count: o.count ?? 1 });
  const findReq = jest.fn().mockResolvedValueOnce(o.request === undefined ? REQ : o.request).mockResolvedValue(o.reread ? { status: o.reread } : null);
  const prisma: Record<string, unknown> = {
    order: { findUnique: jest.fn().mockResolvedValue(o.order === undefined ? { status: 'DELIVERED', deliveredAt: DELIVERED_AT } : o.order) },
    wasteRequest: { findUnique: findReq, updateMany },
  };
  const order: string[] = [];
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => {
    const r = await cb(prisma);
    order.push('tx end');
    return r;
  });
  const config = { snapshot: jest.fn().mockResolvedValue({ enabled: false, pickupWaitDays: 14 }) };
  const notifier = {
    pickupStarted: jest.fn(async () => { order.push('pickupStarted'); }),
    pickupCancelled: jest.fn(async () => { order.push('pickupCancelled'); }),
  };
  const hooks = new WastePickupHooks(prisma as never, config as never, notifier as never);
  return { hooks, prisma: prisma as { $transaction: jest.Mock; order: { findUnique: jest.Mock } }, updateMany, notifier, findReq, order };
}

beforeEach(() => (writeWasteEvent as jest.Mock).mockClear());

describe('WastePickupHooks.applyOrderDelivered (§12.2 bước 3 (b))', () => {
  it('OPEN → IN_TRANSIT, expiresAt = deliveredAt đọc lại từ DB + pickup_wait_days, inTransitAt = lúc đó, event SYSTEM, báo khách sau commit', async () => {
    const { hooks, prisma, updateMany, notifier, order } = setup();
    await expect(hooks.applyOrderDelivered('o1')).resolves.toBe('APPLIED');
    expect(prisma.order.findUnique).toHaveBeenCalledWith({ where: { id: 'o1' }, select: { status: true, deliveredAt: true } });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', orderId: 'o1', method: 'PICKUP', status: 'OPEN' },
      data: { status: 'IN_TRANSIT', inTransitAt: expect.any(Date), expiresAt: EXPIRES_AT },
    });
    expect(writeWasteEvent).toHaveBeenCalledWith(expect.anything(), {
      kind: 'PICKUP_STARTED', actorUserId: null, actorRole: 'SYSTEM', requestId: 'r1',
      meta: { orderId: 'o1', expiresAt: EXPIRES_AT.toISOString(), before: { status: 'OPEN' }, after: { status: 'IN_TRANSIT' } },
    });
    expect(notifier.pickupStarted).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-ABC23' }, EXPIRES_AT);
    expect(order.indexOf('tx end')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('tx end')).toBeLessThan(order.indexOf('pickupStarted'));
  });

  it('đơn RETURNED (đã giao trước đó) → cũng IN_TRANSIT; waste.enabled tắt không chặn hook (§11.5)', async () => {
    const { hooks, updateMany } = setup({ order: { status: 'RETURNED', deliveredAt: DELIVERED_AT } });
    await expect(hooks.applyOrderDelivered('o1')).resolves.toBe('APPLIED');
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('đơn chưa giao hoặc deliveredAt trống → SKIPPED, không ghi (CHECK 11.3 cấm IN_TRANSIT không hạn)', async () => {
    for (const order of [{ status: 'SHIPPING', deliveredAt: null }, { status: 'DELIVERED', deliveredAt: null }]) {
      const { hooks, updateMany } = setup({ order });
      await expect(hooks.applyOrderDelivered('o1')).resolves.toBe('SKIPPED');
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it('đơn không có yêu cầu gắn kèm → NO_REQUEST', async () => {
    const { hooks, updateMany } = setup({ request: null });
    await expect(hooks.applyOrderDelivered('o1')).resolves.toBe('NO_REQUEST');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(['IN_TRANSIT', 'RECEIVED', 'COMPLETED', 'REJECTED', 'REVERSED', 'EXPIRED'])('không trúng dòng, đọc lại %s → SKIPPED im lặng', async (status) => {
    const { hooks, notifier } = setup({ count: 0, reread: status });
    await expect(hooks.applyOrderDelivered('o1')).resolves.toBe('SKIPPED');
    expect(writeWasteEvent).not.toHaveBeenCalled();
    expect(notifier.pickupStarted).not.toHaveBeenCalled();
  });

  it('không trúng dòng, đọc lại CANCELLED cạnh đơn đã giao → một HOOK_ANOMALY, không báo khách', async () => {
    const { hooks, notifier } = setup({ count: 0, reread: 'CANCELLED' });
    await expect(hooks.applyOrderDelivered('o1')).resolves.toBe('ANOMALY');
    expect(writeWasteEvent).toHaveBeenCalledTimes(1);
    expect(writeWasteEvent).toHaveBeenCalledWith(expect.anything(), {
      kind: 'HOOK_ANOMALY', actorUserId: null, actorRole: 'SYSTEM', requestId: 'r1',
      meta: {
        orderId: 'o1',
        before: { requestStatus: 'CANCELLED', orderStatus: 'DELIVERED' },
        after: { requestStatus: 'CANCELLED', orderStatus: 'DELIVERED' },
      },
    });
    expect(notifier.pickupStarted).not.toHaveBeenCalled();
  });

  it('đơn RETURNED, đọc lại CANCELLED → HOOK_ANOMALY ghi đúng orderStatus RETURNED', async () => {
    const { hooks } = setup({ order: { status: 'RETURNED', deliveredAt: DELIVERED_AT }, count: 0, reread: 'CANCELLED' });
    await expect(hooks.applyOrderDelivered('o1')).resolves.toBe('ANOMALY');
    expect(writeWasteEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'HOOK_ANOMALY',
      meta: { orderId: 'o1', before: { requestStatus: 'CANCELLED', orderStatus: 'RETURNED' }, after: { requestStatus: 'CANCELLED', orderStatus: 'RETURNED' } },
    }));
  });
});

describe('WastePickupHooks.applyOrderCancelled (§12.2 bước 3 (a))', () => {
  it('OPEN → CANCELLED, closeReason ORDER_CANCELLED, closedAt, event SYSTEM, WASTE_PICKUP_CANCELLED sau commit', async () => {
    const { hooks, updateMany, notifier, order } = setup({ order: { status: 'CANCELLED', deliveredAt: null } });
    await expect(hooks.applyOrderCancelled('o1')).resolves.toBe('APPLIED');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', orderId: 'o1', status: 'OPEN' },
      data: { status: 'CANCELLED', closeReason: 'ORDER_CANCELLED', closedAt: expect.any(Date) },
    });
    expect(writeWasteEvent).toHaveBeenCalledWith(expect.anything(), {
      kind: 'PICKUP_ORDER_CANCELLED', actorUserId: null, actorRole: 'SYSTEM', requestId: 'r1',
      meta: { orderId: 'o1', before: { status: 'OPEN' }, after: { status: 'CANCELLED', closeReason: 'ORDER_CANCELLED' } },
    });
    expect(notifier.pickupCancelled).toHaveBeenCalledWith('u1', { id: 'r1', code: 'TR-ABC23' });
    expect(order.indexOf('tx end')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('tx end')).toBeLessThan(order.indexOf('pickupCancelled'));
  });

  it('đơn không ở CANCELLED → SKIPPED, không ghi', async () => {
    const { hooks, updateMany } = setup({ order: { status: 'CONFIRMED', deliveredAt: null } });
    await expect(hooks.applyOrderCancelled('o1')).resolves.toBe('SKIPPED');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('không trúng dòng, đọc lại CANCELLED → SKIPPED; đọc lại IN_TRANSIT → HOOK_ANOMALY', async () => {
    const a = setup({ order: { status: 'CANCELLED', deliveredAt: null }, count: 0, reread: 'CANCELLED' });
    await expect(a.hooks.applyOrderCancelled('o1')).resolves.toBe('SKIPPED');
    expect(writeWasteEvent).not.toHaveBeenCalled();
    const b = setup({ order: { status: 'CANCELLED', deliveredAt: null }, count: 0, reread: 'IN_TRANSIT' });
    await expect(b.hooks.applyOrderCancelled('o1')).resolves.toBe('ANOMALY');
    expect(writeWasteEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'HOOK_ANOMALY',
        meta: {
          orderId: 'o1',
          before: { requestStatus: 'IN_TRANSIT', orderStatus: 'CANCELLED' },
          after: { requestStatus: 'IN_TRANSIT', orderStatus: 'CANCELLED' },
        },
      }),
    );
  });
});

describe('WastePickupHooks.on* never throw (registry 4.8)', () => {
  it('lỗi DB trong hook → resolve undefined, ghi log lỗi', async () => {
    const d = setup({ updateError: new Error('db down') });
    await expect(d.hooks.onOrderDelivered('o1')).resolves.toBeUndefined();
    const c = setup({ order: { status: 'CANCELLED', deliveredAt: null }, updateError: new Error('db down') });
    await expect(c.hooks.onOrderCancelled('o1')).resolves.toBeUndefined();
  });
});

describe('WastePickupModule wiring (registry 8.2 note 2)', () => {
  it('provides and exports WastePickupHooks, imports WasteCoreModule only, and OrdersModule imports it', () => {
    expect(Reflect.getMetadata('providers', WastePickupModule)).toContain(WastePickupHooks);
    expect(Reflect.getMetadata('exports', WastePickupModule)).toEqual([WastePickupHooks]);
    expect(Reflect.getMetadata('imports', WastePickupModule)).toEqual([WasteCoreModule]);
    expect(Reflect.getMetadata('imports', OrdersModule)).toContain(WastePickupModule);
  });

  it('OrderStatusService và OrdersService nhận WastePickupHooks qua DI (import giá trị, không phải import type)', () => {
    expect(Reflect.getMetadata('design:paramtypes', OrderStatusService)[8]).toBe(WastePickupHooks);
    expect(Reflect.getMetadata('design:paramtypes', OrdersService)[9]).toBe(WastePickupHooks);
  });
});
