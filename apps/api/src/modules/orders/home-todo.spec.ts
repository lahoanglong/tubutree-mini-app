import { Logger } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { OrdersController } from './orders.controller';
import { loadHomeTodo } from './home-todo';
import type { OrdersService } from './orders.service';

const page = (rows: object[], total = rows.length) => ({ data: rows, meta: { page: 1, limit: 1, total } });
const pendingOrder = { code: 'TUBU1', status: 'PENDING_PAYMENT', total: 250000, items: [{ id: 'i1', thumbnail: 'x' }] };
const shippingOrder = { code: 'TUBU2', status: 'SHIPPING', total: 100000, items: [] };
const prepOrder = { code: 'TUBU3', status: 'CONFIRMED', total: 90000, items: [] };

describe('GET /orders/home-todo', () => {
  it('khai báo TRƯỚC GET :code, không thì "home-todo" bị hiểu là mã đơn → 404', () => {
    const methods = Object.getOwnPropertyNames(OrdersController.prototype);
    expect(methods.indexOf('homeTodo')).toBeGreaterThan(-1);
    expect(methods.indexOf('homeTodo')).toBeLessThan(methods.indexOf('detail'));
    expect(Reflect.getMetadata('path', OrdersController.prototype.homeTodo)).toBe('home-todo');
  });

  it('không công khai: đi qua guard đăng nhập toàn cục như GET /orders', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, OrdersController.prototype.homeTodo)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, OrdersController)).toBeUndefined();
  });

  it('chỉ đơn của người gọi: cả ba lời list nhận đúng userId, limit 1 trang 1', async () => {
    const list = jest.fn().mockResolvedValue(page([]));
    const ctrl = new OrdersController({ list } as unknown as OrdersService, {} as never, {} as never, {} as never);
    await ctrl.homeTodo('u1');
    expect(list).toHaveBeenCalledTimes(3);
    expect(list).toHaveBeenCalledWith('u1', { status: 'PENDING_PAYMENT' }, 1, 1);
    expect(list).toHaveBeenCalledWith('u1', { status: 'SHIPPING' }, 1, 1);
    expect(list).toHaveBeenCalledWith('u1', { group: 'processing' }, 1, 1);
  });

  it('thân bằng đúng ba lời /orders cũ ghép lại: phần tử đầu + tổng của từng bộ lọc', async () => {
    const list = jest.fn(async (_u: string, f: { status?: string; group?: string }) =>
      f.status === 'PENDING_PAYMENT' ? page([pendingOrder]) : f.status === 'SHIPPING' ? page([shippingOrder], 3) : page([prepOrder], 2),
    );
    await expect(loadHomeTodo(list as never, 'u1')).resolves.toEqual({
      pending: { order: pendingOrder, total: 1 },
      shipping: { order: shippingOrder, total: 3 },
      processing: { order: prepOrder, total: 2 },
    });
  });

  it('không có đơn nào: cả ba null', async () => {
    const list = jest.fn().mockResolvedValue(page([]));
    await expect(loadHomeTodo(list as never, 'u1')).resolves.toEqual({ pending: null, shipping: null, processing: null });
  });

  it('một lời lỗi: phần đó null, các phần còn lại vẫn trả, đánh dấu partial để giao diện không ghi số dòng sai', async () => {
    const list = jest.fn(async (_u: string, f: { status?: string; group?: string }) => {
      if (f.status === 'PENDING_PAYMENT') throw new Error('db blip');
      return f.status === 'SHIPPING' ? page([shippingOrder]) : page([]);
    });
    await expect(loadHomeTodo(list as never, 'u1')).resolves.toEqual({
      pending: null,
      shipping: { order: shippingOrder, total: 1 },
      processing: null,
      partial: true,
    });
  });

  it('lỗi một phần vẫn ghi log từng phần lỗi, không im lặng (trả 200 nên bộ lọc lỗi của Nest không thấy)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const list = jest.fn(async (_u: string, f: { status?: string; group?: string }) => {
        if (f.status === 'PENDING_PAYMENT') throw new Error('db blip');
        return page([]);
      });
      await loadHomeTodo(list as never, 'u1');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/pending.*db blip/);
    } finally {
      warn.mockRestore();
    }
  });

  it('cả ba lỗi: ném lỗi như GET /orders (giao diện ẩn dải)', async () => {
    const list = jest.fn().mockRejectedValue(new Error('down'));
    await expect(loadHomeTodo(list as never, 'u1')).rejects.toThrow('down');
  });
});
