import { NotImplementedException } from '@nestjs/common';
import { PancakeDirectBackend } from '../pancake/pancake-direct.backend';
import type { PancakeOrderService } from '../pancake/pancake-order.service';
import { CommerceBackendUnavailableError, DEFAULT_BACKEND_ROUTE, isBackendRoute, type CommerceBackend } from './commerce-backend';
import { CommerceBackendResolver } from './commerce-backend.resolver';
import { MssBackend } from './mss.backend';
import type { MssHealthService } from './mss-health.service';

function pancakeOrders() {
  return {
    enqueuePush: jest.fn(async () => undefined),
    enqueueCancel: jest.fn(async () => undefined),
    enqueuePayment: jest.fn(async () => undefined),
  };
}

describe('PancakeDirectBackend: chỉ chuyển tiếp tới hàm xếp việc Pancake sẵn có', () => {
  it('push/cancel/payment gọi đúng enqueuePush/enqueueCancel/enqueuePayment với đúng mã đơn', async () => {
    const orders = pancakeOrders();
    const b = new PancakeDirectBackend(orders as unknown as PancakeOrderService);
    expect(b.route).toBe('PANCAKE_DIRECT');
    await b.pushOrder('o1');
    await b.cancelOrder('o2');
    await b.confirmPayment('o3');
    await b.requestInvoice('o4');
    expect(orders.enqueuePush).toHaveBeenCalledWith('o1');
    expect(orders.enqueueCancel).toHaveBeenCalledWith('o2');
    expect(orders.enqueuePayment).toHaveBeenCalledWith('o3');
    expect([orders.enqueuePush, orders.enqueueCancel, orders.enqueuePayment].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('lỗi xếp hàng của Pancake được trả nguyên cho người gọi', async () => {
    const orders = pancakeOrders();
    orders.enqueuePush.mockRejectedValueOnce(new Error('redis down'));
    await expect(new PancakeDirectBackend(orders as unknown as PancakeOrderService).pushOrder('o1')).rejects.toThrow('redis down');
  });
});

describe('MssBackend: khung rỗng, chưa vào đường chạy', () => {
  it.each(['pushOrder', 'cancelOrder', 'confirmPayment', 'requestInvoice'] as const)('%s ném NotImplemented', async (m) => {
    await expect(new MssBackend()[m]('o1')).rejects.toBeInstanceOf(NotImplementedException);
  });
});

describe('CommerceBackendResolver', () => {
  const pancake = new PancakeDirectBackend(pancakeOrders() as unknown as PancakeOrderService);
  const health = (capable: boolean) => ({ assertCapability: jest.fn(async () => capable) }) as unknown as MssHealthService & { assertCapability: jest.Mock };

  it('cờ tắt (cấu hình build này): mọi đơn, kể cả đơn cũ không mang tuyến tường minh, ra PancakeDirectBackend', () => {
    const r = new CommerceBackendResolver(pancake, health(false));
    for (let i = 0; i < 50; i++) expect(r.resolveBackend({ backendRoute: DEFAULT_BACKEND_ROUTE })).toBe(pancake);
  });

  it('routeForNewOrder: không có hiện thực MSS trong build thì luôn PANCAKE_DIRECT và không đọc cờ (kể cả MSS báo đủ năng lực)', async () => {
    const h = health(true);
    const r = new CommerceBackendResolver(pancake, h);
    await expect(r.routeForNewOrder()).resolves.toBe('PANCAKE_DIRECT');
    expect(h.assertCapability).not.toHaveBeenCalled();
    await expect(new CommerceBackendResolver(pancake).routeForNewOrder()).resolves.toBe('PANCAKE_DIRECT');
  });

  it('đơn tuyến MSS mà build chưa có hiện thực: ném, không rơi về Pancake (tránh đẩy hai đường)', () => {
    const r = new CommerceBackendResolver(pancake, health(true));
    expect(() => r.resolveBackend({ backendRoute: 'MSS' })).toThrow(CommerceBackendUnavailableError);
  });

  it('tuyến lạ (dữ liệu hỏng, đọc thiếu cột): ném', () => {
    const r = new CommerceBackendResolver(pancake);
    for (const v of ['', 'pancake_direct', 'SHOPIFY', undefined as unknown as string]) {
      expect(() => r.resolveBackend({ backendRoute: v })).toThrow(CommerceBackendUnavailableError);
    }
  });

  it('khi wave sau đăng ký hiện thực MSS: tuyến ghi theo năng lực lúc tạo đơn, đơn đã có tuyến không đổi theo cờ', async () => {
    const mss: CommerceBackend = new MssBackend();
    const h = health(true);
    const r = new CommerceBackendResolver(pancake, h, mss);
    await expect(r.routeForNewOrder()).resolves.toBe('MSS');
    expect(h.assertCapability).toHaveBeenCalledWith('orderPush');
    h.assertCapability.mockResolvedValue(false);
    await expect(r.routeForNewOrder()).resolves.toBe('PANCAKE_DIRECT');
    expect(r.resolveBackend({ backendRoute: 'MSS' })).toBe(mss);
    expect(r.resolveBackend({ backendRoute: 'PANCAKE_DIRECT' })).toBe(pancake);
  });

  it('isBackendRoute chỉ nhận đúng hai giá trị của CHECK ở DB', () => {
    expect(['PANCAKE_DIRECT', 'MSS'].every(isBackendRoute)).toBe(true);
    expect([null, '', 'mss', 'PANCAKE'].some(isBackendRoute)).toBe(false);
  });
});
