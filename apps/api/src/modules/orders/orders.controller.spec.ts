import { OrdersController } from './orders.controller';
import type { OrdersService } from './orders.service';

describe('OrdersController', () => {
  it('khai báo GET active-count TRƯỚC GET :code — Express khớp theo thứ tự khai báo, nếu sau thì "active-count" bị hiểu là mã đơn → 404', () => {
    const methods = Object.getOwnPropertyNames(OrdersController.prototype);
    expect(methods).toContain('activeCount');
    expect(methods.indexOf('activeCount')).toBeLessThan(methods.indexOf('detail'));
    expect(Reflect.getMetadata('path', OrdersController.prototype.activeCount)).toBe('active-count');
  });

  it('list chuyển status + group xuống service', async () => {
    const list = jest.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    const ctrl = new OrdersController({ list } as unknown as OrdersService);
    await ctrl.list('u1', { group: 'processing', page: 1, limit: 20 } as never);
    expect(list).toHaveBeenCalledWith('u1', { status: undefined, group: 'processing' }, 1, 20);
  });

  it('activeCount trả { count } của service', async () => {
    const activeCount = jest.fn().mockResolvedValue({ count: 3 });
    const ctrl = new OrdersController({ activeCount } as unknown as OrdersService);
    await expect(ctrl.activeCount('u1')).resolves.toEqual({ count: 3 });
    expect(activeCount).toHaveBeenCalledWith('u1');
  });
  it('GET :code dùng detailView (có ảnh/tồn kho), không phải detail thô', async () => {
    const detailView = jest.fn().mockResolvedValue({ code: 'A', items: [] });
    const ctrl = new OrdersController({ detailView } as unknown as OrdersService);
    await ctrl.detail('u1', 'A');
    expect(detailView).toHaveBeenCalledWith('u1', 'A');
  });
});
