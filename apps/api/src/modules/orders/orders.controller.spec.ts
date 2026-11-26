import { OrdersController } from './orders.controller';
import type { OrdersService } from './orders.service';
import { ReturnEstimateDto, ReturnRequestDto } from './dto/return-request.dto';

describe('OrdersController', () => {
  it('khai báo GET active-count TRƯỚC GET :code — Express khớp theo thứ tự khai báo, nếu sau thì "active-count" bị hiểu là mã đơn → 404', () => {
    const methods = Object.getOwnPropertyNames(OrdersController.prototype);
    expect(methods).toContain('activeCount');
    expect(methods.indexOf('activeCount')).toBeLessThan(methods.indexOf('detail'));
    expect(Reflect.getMetadata('path', OrdersController.prototype.activeCount)).toBe('active-count');
  });

  it('khai báo GET status-counts TRƯỚC GET :code, không thì ":code" nuốt route và đếm đơn im lặng về 0', () => {
    const methods = Object.getOwnPropertyNames(OrdersController.prototype);
    expect(methods.indexOf('statusCounts')).toBeGreaterThan(-1);
    expect(methods.indexOf('statusCounts')).toBeLessThan(methods.indexOf('detail'));
    expect(Reflect.getMetadata('path', OrdersController.prototype.statusCounts)).toBe('status-counts');
  });

  it('statusCounts trả số đơn theo tab của chính người gọi', async () => {
    const statusCounts = jest.fn().mockResolvedValue({ pending_payment: 1, processing: 0, shipping: 2, delivered: 5, closed: 0 });
    const ctrl = new OrdersController({} as never, {} as never, {} as never, { statusCounts } as never, {} as never, {} as never);
    await expect(ctrl.statusCounts('u1')).resolves.toEqual({ pending_payment: 1, processing: 0, shipping: 2, delivered: 5, closed: 0 });
    expect(statusCounts).toHaveBeenCalledWith('u1');
  });

  it('list chuyển status + group xuống service', async () => {
    const list = jest.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    const ctrl = new OrdersController({ list } as unknown as OrdersService, {} as never, {} as never, {} as never, {} as never, {} as never);
    await ctrl.list('u1', { group: 'processing', page: 1, limit: 20 } as never);
    expect(list).toHaveBeenCalledWith('u1', { status: undefined, group: 'processing' }, 1, 20);
  });

  it('activeCount trả { count } của service', async () => {
    const activeCount = jest.fn().mockResolvedValue({ count: 3 });
    const ctrl = new OrdersController({ activeCount } as unknown as OrdersService, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(ctrl.activeCount('u1')).resolves.toEqual({ count: 3 });
    expect(activeCount).toHaveBeenCalledWith('u1');
  });
  it('GET :code dùng detailView (có ảnh/tồn kho), không phải detail thô', async () => {
    const detailView = jest.fn().mockResolvedValue({ code: 'A', items: [] });
    const ctrl = new OrdersController({ detailView } as unknown as OrdersService, {} as never, {} as never, {} as never, {} as never, {} as never);
    await ctrl.detail('u1', 'A');
    expect(detailView).toHaveBeenCalledWith('u1', 'A');
  });
  it('repurchase chuyển items + addSource trong body; body thiếu → input rỗng', async () => {
    const repurchase = jest.fn().mockResolvedValue({ items: [], results: [] });
    const ctrl = new OrdersController({ repurchase } as unknown as OrdersService, {} as never, {} as never, {} as never, {} as never, {} as never);
    await ctrl.repurchase('u1', 'A', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' });
    expect(repurchase).toHaveBeenLastCalledWith('u1', 'A', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' });
    await ctrl.repurchase('u1', 'A', undefined as never);
    expect(repurchase).toHaveBeenLastCalledWith('u1', 'A', { items: undefined, addSource: undefined });
  });

  it('POST :code/return-request validate body bằng ReturnRequestDto (ảnh minh chứng chỉ https Cloudinary / base64 raster — C-050)', () => {
    const types = Reflect.getMetadata('design:paramtypes', OrdersController.prototype, 'requestReturn') as unknown[];
    expect(types[2]).toBe(ReturnRequestDto);
  });

  it('POST :code/return-estimate: tính trước số tiền hoàn cho khách, validate bằng ReturnEstimateDto (R2-BUYERMINI-7)', async () => {
    const types = Reflect.getMetadata('design:paramtypes', OrdersController.prototype, 'estimateReturn') as unknown[];
    expect(types[2]).toBe(ReturnEstimateDto);
    expect(Reflect.getMetadata('path', OrdersController.prototype.estimateReturn)).toBe(':code/return-estimate');
    const estimate = jest.fn().mockResolvedValue({ refund: 1 });
    const ctrl = new OrdersController({} as never, { estimate } as never, {} as never, {} as never, {} as never, {} as never);
    const dto = { reasonCode: 'OTHER' as const, items: [{ orderItemId: 'i1', quantity: 1 }] };
    await expect(ctrl.estimateReturn('u1', 'A', dto)).resolves.toEqual({ refund: 1 });
    expect(estimate).toHaveBeenCalledWith('u1', 'A', dto);
  });
});

describe('OrdersController POST :code/order-zalo-consent', () => {
  it('gọi enableOrderZalo với người đang đăng nhập và mã đơn', async () => {
    const enableOrderZalo = jest.fn().mockResolvedValue({ orderZaloConsent: true });
    const ctrl = new OrdersController({ enableOrderZalo } as unknown as OrdersService, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(ctrl.enableOrderZalo('u1', 'TUBU1')).resolves.toEqual({ orderZaloConsent: true });
    expect(enableOrderZalo).toHaveBeenCalledWith('u1', 'TUBU1');
  });
});

describe('OrdersController POST :code/csat', () => {
  it('gọi submitCsat với người đang đăng nhập, mã đơn và body đã kiểm (thẻ "Đơn này thế nào?")', async () => {
    const submitCsat = jest.fn().mockResolvedValue({ recorded: true });
    const ctrl = new OrdersController({ submitCsat } as unknown as OrdersService, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(ctrl.csat('u1', 'TUBU1', { answer: 'up', platform: 'web' })).resolves.toEqual({ recorded: true });
    expect(submitCsat).toHaveBeenCalledWith('u1', 'TUBU1', { answer: 'up', platform: 'web' });
  });
});

describe('OrdersController PATCH :code/delivery', () => {
  it('gọi editForOwner với người đang đăng nhập, mã đơn, địa chỉ và ghi chú (không chuyển trường lạ)', async () => {
    const editForOwner = jest.fn().mockResolvedValue({ code: 'TUBU1', editsLeft: 2 });
    const ctrl = new OrdersController({} as never, {} as never, {} as never, {} as never, {} as never, { editForOwner } as never);
    const address = { recipient: 'Lan', phone: '0912345678', ward: 'P', street: '1 A', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN0100004' };
    await expect(ctrl.editDelivery('u1', 'TUBU1', { address, note: null, total: 1 } as never)).resolves.toEqual({ code: 'TUBU1', editsLeft: 2 });
    expect(editForOwner).toHaveBeenCalledWith('u1', 'TUBU1', { address, note: null });
  });
});
