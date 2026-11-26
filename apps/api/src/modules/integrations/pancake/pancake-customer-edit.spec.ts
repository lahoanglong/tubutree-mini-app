import { UnrecoverableError } from 'bullmq';
import { customerEditMismatch, customerEditMoneyDrift, editFingerprint, PancakeOrderService } from './pancake-order.service';
import { PancakePackingError, PancakeSyncHooks, PancakeUnreachableError } from './pancake-sync-hooks';
import { PancakePushProcessor } from './pancake-push.processor';
import { PancakeApiError } from './pancake-outbound';
import { ATTENTION_CUSTOMER_EDIT_PENDING } from './pancake-attention';
import { pancakeCustomerEditJobId } from './pancake-queue';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PancakeClient } from './pancake.client';
import type { PancakeUpdateOrderBody } from './pancake.types';
import { ORDER_EDIT_HISTORY_NOTE } from '../../orders/order-customer-edit';
import { baseOrder, fakeOrderDb, fakeQueue } from '../../../../test/fakes/pancake-order.fake';

const edited = {
  recipient: 'Trần Thị B',
  phone: '0900000002',
  street: '9 Pasteur',
  ward: 'Phường Sài Gòn',
  district: '',
  province: 'TP. Hồ Chí Minh',
  provinceCode: '84_VN79',
  districtCode: '',
  wardCode: '84_VN7926740',
};
/** Đơn Pancake đọc lại sau PUT mang đúng địa chỉ mới. */
const readBack = (sa: Record<string, unknown> = {}) => ({
  id: 'pk-1',
  status: 1,
  tags: [],
  shipping_address: { commune_id: edited.wardCode, phone_number: edited.phone, full_name: edited.recipient, address: edited.street, full_address: `${edited.street}, ${edited.ward}, ${edited.province}`, ...sa },
});

function setup(order: Record<string, unknown> = {}, client: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const db = fakeOrderDb([baseOrder({ pancakeOrderId: 'pk-1', shippingAddress: edited, note: 'Gọi trước khi giao', ...order })], extra);
  const c = {
    resolveOrderTags: jest.fn(async (names: readonly string[]) => names.map((name, i) => ({ id: 100 + i, name }))),
    isConfigured: jest.fn().mockReturnValue(true),
    createOrder: jest.fn().mockResolvedValue({ id: 'pk-new' }),
    searchOrders: jest.fn().mockResolvedValue([]),
    getOrder: jest.fn().mockResolvedValue(readBack()),
    updateOrder: jest.fn().mockResolvedValue({ id: 'pk-1' }),
    ...client,
  };
  const queue = fakeQueue();
  const alerts = { alert: jest.fn().mockResolvedValue(undefined), resolveKinds: jest.fn().mockResolvedValue(0) };
  const svc = new PancakeOrderService(db.prisma as unknown as PrismaService, c as unknown as PancakeClient, queue as never, undefined, alerts as never);
  const hooks = new PancakeSyncHooks(db.prisma as unknown as PrismaService, c as unknown as PancakeClient, queue as never, alerts as never);
  const put = (n = 0) => c.updateOrder.mock.calls[n]![1] as PancakeUpdateOrderBody & Record<string, unknown>;
  return { ...db, client: c, queue, alerts, svc, hooks, put };
}

describe('PancakeOrderService.syncCustomerEdit', () => {
  it('PUT địa chỉ giao + tên/SĐT người nhận + ghi chú dựng lại; KHÔNG gửi phí giao hay dòng hàng; đọc lại khớp thì gỡ cờ', async () => {
    const t = setup({ pancakeAttention: `${ATTENTION_CUSTOMER_EDIT_PENDING} (#pk-1): cũ`, pancakeSyncError: 'cũ' });
    await t.svc.syncCustomerEdit('o1');
    expect(t.client.updateOrder).toHaveBeenCalledTimes(1);
    const body = t.put();
    expect(body.shipping_address).toEqual(
      expect.objectContaining({ full_name: edited.recipient, phone_number: edited.phone, address: edited.street, commune_id: edited.wardCode, province_id: '84_VN79' }),
    );
    expect(body.shipping_address?.full_address).toContain(edited.ward);
    expect(body.bill_full_name).toBe(edited.recipient);
    expect(body.bill_phone_number).toBe(edited.phone);
    expect(body.note).toMatch(/^Order code: TUBU1/);
    expect(body.note).toContain('Khách dặn: Gọi trước khi giao');
    expect(body.note).toContain('[THU COD');
    expect(body).not.toHaveProperty('shipping_fee');
    expect(body).not.toHaveProperty('items');
    expect(body).not.toHaveProperty('total_discount');
    expect(t.client.getOrder).toHaveBeenLastCalledWith('pk-1');
    expect(t.row().pancakeAttention).toBeNull();
    expect(t.row().pancakeSyncError).toBeNull();
  });

  it('không gửi tiền (transfer_money/cod) ở PUT sửa địa chỉ với mọi loại thanh toán: kho có thể đã chỉnh tay', async () => {
    for (const order of [{ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' }, { paymentMethod: 'COD', paymentStatus: 'UNPAID' }]) {
      const t = setup(order);
      await t.svc.syncCustomerEdit('o1');
      const body = t.put();
      expect(body).not.toHaveProperty('transfer_money');
      expect(body).not.toHaveProperty('cod');
      expect(body).not.toHaveProperty('shipping_fee');
      expect(Object.keys(body).sort()).toEqual(expect.arrayContaining(['bill_full_name', 'bill_phone_number', 'note', 'shipping_address']));
      expect(t.row().pancakeAttention).toBeNull();
    }
  });

  it('tiền trên Pancake đổi sau PUT (Pancake tự tính lại phí ship/COD theo địa chỉ mới) → "Cần xử lý Pancake" nêu khoản lệch, không ném', async () => {
    for (const [before, after, want] of [
      [{ cod: 230_000 }, { cod: 0 }, 'cod 230.000đ→0đ'],
      [{ shipping_fee: '30000' }, { shipping_fee: 45_000 }, 'shipping_fee 30.000đ→45.000đ'],
      [{ cod: 230_000, transfer_money: 0 }, { cod: 200_000, transfer_money: 30_000 }, 'cod 230.000đ→200.000đ, transfer_money 0đ→30.000đ'],
    ] as const) {
      // Thứ tự gọi getOrder: đọc trước PUT (current), mergedTags đọc thẻ, đọc lại sau PUT (found).
      const getOrder = jest
        .fn()
        .mockResolvedValueOnce({ ...readBack(), ...before })
        .mockResolvedValueOnce({ ...readBack(), ...before })
        .mockResolvedValueOnce({ ...readBack(), ...after });
      const t = setup({}, { getOrder });
      await expect(t.svc.syncCustomerEdit('o1')).resolves.toBeUndefined();
      expect(getOrder).toHaveBeenCalledTimes(3);
      expect(t.row().pancakeAttention).toBe(
        `${ATTENTION_CUSTOMER_EDIT_PENDING} (#pk-1): tiền trên Pancake đổi sau khi sửa địa chỉ (${want}). Sửa tay tiền theo đơn Tubu rồi giao.`,
      );
    }
  });

  it('địa chỉ lệch và tiền lệch cùng lúc → một cờ nêu cả hai', async () => {
    const getOrder = jest
      .fn()
      .mockResolvedValueOnce({ ...readBack(), cod: 230_000 })
      .mockResolvedValueOnce({ ...readBack(), cod: 230_000 })
      .mockResolvedValueOnce({ ...readBack({ commune_id: '84_VN7900001' }), cod: 0 });
    const t = setup({}, { getOrder });
    await t.svc.syncCustomerEdit('o1');
    expect(t.row().pancakeAttention).toBe(
      `${ATTENTION_CUSTOMER_EDIT_PENDING} (#pk-1): phường/xã trên Pancake khác đơn Tubu. Sửa tay trên Pancake theo đơn Tubu rồi giao. tiền trên Pancake đổi sau khi sửa địa chỉ (cod 230.000đ→0đ). Sửa tay tiền theo đơn Tubu rồi giao.`,
    );
  });

  it('thiếu trường tiền ở một trong hai lần đọc (hoặc không phải số) → không gắn cờ: không chứng minh được có lệch', () => {
    expect(customerEditMoneyDrift({ cod: 230_000 }, {})).toBeNull();
    expect(customerEditMoneyDrift({}, { cod: 0 })).toBeNull();
    expect(customerEditMoneyDrift({ cod: null }, { cod: 0 })).toBeNull();
    expect(customerEditMoneyDrift({ cod: '' }, { cod: 0 })).toBeNull();
    expect(customerEditMoneyDrift({ cod: 'abc' }, { cod: 0 })).toBeNull();
    expect(customerEditMoneyDrift(null, { cod: 0 })).toBeNull();
    expect(customerEditMoneyDrift({ cod: '230000', shipping_fee: 30_000 }, { cod: 230_000, shipping_fee: '30000' })).toBeNull();
  });

  it('job chạy với đơn Pancake thiếu trường tiền → đi tiếp như cũ, gỡ cờ', async () => {
    const getOrder = jest
      .fn()
      .mockResolvedValueOnce({ ...readBack(), cod: 230_000 })
      .mockResolvedValueOnce(readBack())
      .mockResolvedValueOnce(readBack());
    const t = setup({ pancakeAttention: `${ATTENTION_CUSTOMER_EDIT_PENDING} (#pk-1): cũ` }, { getOrder });
    await t.svc.syncCustomerEdit('o1');
    expect(t.row().pancakeAttention).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ['phường/xã', { commune_id: '84_VN7926743' }],
    ['SĐT', { phone_number: '0900000001' }],
    ['số nhà', { address: '1 Lê Lợi', full_address: '1 Lê Lợi, Phường Bến Thành' }],
  ])('đọc lại lệch %s → "Cần xử lý Pancake" ngay, không ném (thử lại không giúp)', async (_l, sa) => {
    const t = setup({}, { getOrder: jest.fn().mockResolvedValue(readBack(sa)) });
    await expect(t.svc.syncCustomerEdit('o1')).resolves.toBeUndefined();
    expect(t.row().pancakeAttention).toEqual(expect.stringContaining(ATTENTION_CUSTOMER_EDIT_PENDING));
    expect(t.alerts.alert).toHaveBeenCalled();
  });

  it('Pancake không trả địa chỉ khi đọc lại → cũng là lệch', async () => {
    const t = setup({}, { getOrder: jest.fn().mockResolvedValue({ id: 'pk-1', status: 1, tags: [] }) });
    await t.svc.syncCustomerEdit('o1');
    expect(t.row().pancakeAttention).toEqual(expect.stringContaining('không trả địa chỉ'));
  });

  it('khách sửa thêm trong lúc PUT → ném để BullMQ chạy lại với dữ liệu mới, không gỡ/gắn cờ', async () => {
    const t = setup();
    t.client.updateOrder.mockImplementation(async () => {
      Object.assign(t.row(), { note: 'Để ở bảo vệ' });
      return { id: 'pk-1' };
    });
    await expect(t.svc.syncCustomerEdit('o1')).rejects.toThrow('vừa sửa thêm');
    expect(t.row().pancakeAttention ?? null).toBeNull();
  });

  it('khách sửa thêm ở lượt cuối → "Cần xử lý Pancake" bảo sửa tay (không còn lượt chạy lại)', async () => {
    const t = setup();
    t.client.updateOrder.mockImplementation(async () => {
      Object.assign(t.row(), { note: 'Để ở bảo vệ' });
      return { id: 'pk-1' };
    });
    await expect(t.svc.syncCustomerEdit('o1', true)).rejects.toThrow('vừa sửa thêm');
    expect(t.row().pancakeAttention).toEqual(expect.stringContaining(ATTENTION_CUSTOMER_EDIT_PENDING));
    expect(t.alerts.alert).toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ['Chờ in (12)', { id: 'pk-1', status: 12, tags: [] }],
    ['Đã gửi hàng (2)', { id: 'pk-1', status: '2', tags: [] }],
    ['không còn đơn', null],
  ])('lúc job chạy kho đã %s → không PUT, "Cần xử lý Pancake" bảo đổi nhãn tay, không ném', async (_l, pancakeOrder) => {
    const t = setup({}, { getOrder: jest.fn().mockResolvedValue(pancakeOrder) });
    await expect(t.svc.syncCustomerEdit('o1')).resolves.toBeUndefined();
    expect(t.client.updateOrder).not.toHaveBeenCalled();
    expect(t.row().pancakeAttention).toEqual(expect.stringContaining('kho đã vào đóng gói'));
    expect(t.row().pancakeAttention).toEqual(expect.stringContaining('Đổi nhãn'));
  });

  it('không hỏi được trạng thái trước khi PUT → như PUT lỗi: ghi lỗi rồi ném để thử lại', async () => {
    const t = setup({}, { getOrder: jest.fn().mockRejectedValue(new PancakeApiError('timeout of 5000ms exceeded', true)) });
    await expect(t.svc.syncCustomerEdit('o1', false)).rejects.toBeInstanceOf(PancakeApiError);
    expect(t.client.updateOrder).not.toHaveBeenCalled();
    expect(t.row().pancakeAttention ?? null).toBeNull();
  });

  it('chưa có mã Pancake: lệnh tạo đang bay → ném (lượt cuối thì thôi); không bay → thôi, lần đẩy sau dựng thân mới', async () => {
    const inFlight = setup({ pancakeOrderId: null, pancakePushClaimedAt: new Date() });
    await expect(inFlight.svc.syncCustomerEdit('o1', false)).rejects.toThrow('đang được tạo trên Pancake');
    await expect(inFlight.svc.syncCustomerEdit('o1', true)).resolves.toBeUndefined();
    const idle = setup({ pancakeOrderId: null });
    await expect(idle.svc.syncCustomerEdit('o1', false)).resolves.toBeUndefined();
    const stale = setup({ pancakeOrderId: null, pancakePushClaimedAt: new Date(Date.now() - 6 * 60_000) });
    await expect(stale.svc.syncCustomerEdit('o1', false)).resolves.toBeUndefined();
    for (const t of [inFlight, idle, stale]) expect(t.client.updateOrder).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ['đã huỷ', { status: 'CANCELLED' }],
    ['đã hoàn', { status: 'RETURNED' }],
    ['gian hàng tự giao', { fulfiller: 'MERCHANT' }],
  ])('%s → không PUT', async (_l, over) => {
    const t = setup(over);
    await t.svc.syncCustomerEdit('o1');
    expect(t.client.updateOrder).not.toHaveBeenCalled();
  });

  it('PUT lỗi: lượt chưa cuối chỉ ghi lỗi rồi ném; lượt cuối thêm "Cần xử lý Pancake" bảo sửa tay', async () => {
    const failing = { updateOrder: jest.fn().mockRejectedValue(new PancakeApiError('Pancake trả 503', true, false, 503)) };
    const early = setup({}, failing);
    await expect(early.svc.syncCustomerEdit('o1', false)).rejects.toBeInstanceOf(PancakeApiError);
    expect(early.row().pancakeSyncError).toEqual(expect.stringContaining('503'));
    expect(early.row().pancakeAttention ?? null).toBeNull();
    const last = setup({}, failing);
    await expect(last.svc.syncCustomerEdit('o1', true)).rejects.toBeInstanceOf(PancakeApiError);
    expect(last.row().pancakeAttention).toEqual(expect.stringContaining(ATTENTION_CUSTOMER_EDIT_PENDING));
    expect(last.row().pancakeAttention).toEqual(expect.stringContaining('Sửa tay'));
  });
});

describe('PancakeOrderService.saveCreated — khách sửa trong lúc lệnh tạo đơn đang bay', () => {
  it('đơn đổi giữa lúc dựng thân và lúc lưu mã → xếp job customer-edit', async () => {
    const t = setup({ pancakeOrderId: null });
    t.client.createOrder.mockImplementation(async () => {
      Object.assign(t.row(), { shippingAddress: { ...edited, street: '77 Hai Bà Trưng' } });
      return { id: 'pk-new' };
    });
    await t.svc.pushOrder('o1');
    expect(t.row().pancakeOrderId).toBe('pk-new');
    expect(t.queue.added).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'customer-edit', data: { orderId: 'o1' } })]));
    expect(t.queue.add).toHaveBeenCalledWith('customer-edit', { orderId: 'o1' }, { jobId: pancakeCustomerEditJobId('o1') });
  });

  it('không ai sửa → không xếp customer-edit', async () => {
    const t = setup({ pancakeOrderId: null });
    await t.svc.pushOrder('o1');
    expect(t.queue.added.filter((j) => j.name === 'customer-edit')).toEqual([]);
  });

  it('gắn lại đơn do lần thử trước tạo (không biết thân lúc đó) mà khách từng sửa → xếp customer-edit; chưa từng sửa thì không', async () => {
    const prior = { pancakeOrderId: null, pancakePushClaimedAt: new Date(Date.now() - 10 * 60_000) };
    const search = { searchOrders: jest.fn().mockResolvedValue([{ id: 'pk-old', status: 1, note: 'Order code: TUBU1', custom_id: 'TUBU1' }]) };
    const editedBefore = setup(prior, search, { orderStatusHistory: { findFirst: jest.fn().mockResolvedValue({ id: 'h1' }) } });
    await editedBefore.svc.pushOrder('o1');
    expect(editedBefore.row().pancakeOrderId).toBe('pk-old');
    expect(editedBefore.queue.added.map((j) => j.name)).toContain('customer-edit');
    expect(editedBefore.prisma.orderStatusHistory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orderId: 'o1', actorType: 'CUSTOMER', note: { startsWith: ORDER_EDIT_HISTORY_NOTE } }) }),
    );
    const never = setup(prior, search);
    await never.svc.pushOrder('o1');
    expect(never.queue.added.map((j) => j.name)).not.toContain('customer-edit');
  });
});

describe('editFingerprint / customerEditMismatch', () => {
  it('khoảng trắng thừa không đổi dấu vân tay; đổi số nhà hay ghi chú thì đổi', () => {
    const a = { shippingAddress: edited, note: 'x' };
    expect(editFingerprint({ shippingAddress: { ...edited, street: ` ${edited.street} ` }, note: ' x ' })).toBe(editFingerprint(a));
    expect(editFingerprint({ shippingAddress: { ...edited, street: '1 A' }, note: 'x' })).not.toBe(editFingerprint(a));
    expect(editFingerprint({ shippingAddress: edited, note: null })).not.toBe(editFingerprint(a));
    expect(editFingerprint({ shippingAddress: edited, note: '' })).toBe(editFingerprint({ shippingAddress: edited, note: null }));
  });

  it('SĐT so 9 số cuối (+84 ↔ 0); số nhà so không phân biệt hoa thường', () => {
    expect(customerEditMismatch(readBack({ phone_number: '+84900000002', address: '9 PASTEUR' }) as never, { shippingAddress: edited })).toBeNull();
    expect(customerEditMismatch(null, { shippingAddress: edited })).toEqual(expect.stringContaining('không trả địa chỉ'));
  });
});

describe('PancakeSyncHooks.precheckCustomerEdit', () => {
  it.each([0, 17, 11, 20, 1, '1'])('Pancake trạng thái %s (trước đóng gói) → cho sửa, hỏi với timeout ngắn', async (status) => {
    const t = setup({}, { getOrder: jest.fn().mockResolvedValue({ id: 'pk-1', status }) });
    await expect(t.hooks.precheckCustomerEdit({ code: 'TUBU1', pancakeOrderId: 'pk-1' })).resolves.toBeUndefined();
    expect(t.client.getOrder).toHaveBeenCalledWith('pk-1', { timeoutMs: PancakeSyncHooks.CANCEL_TIMEOUT_MS });
  });

  it.each([12, 13, 8, 9, 2, 3, 4, 5, 6, 7, 15, 16, 99, undefined])('Pancake trạng thái %s → PancakePackingError (đóng khi không chắc)', async (status) => {
    const t = setup({}, { getOrder: jest.fn().mockResolvedValue({ id: 'pk-1', status }) });
    await expect(t.hooks.precheckCustomerEdit({ code: 'TUBU1', pancakeOrderId: 'pk-1' })).rejects.toBeInstanceOf(PancakePackingError);
  });

  it('Pancake không còn đơn → PancakePackingError; lỗi mạng hay chưa cấu hình → PancakeUnreachableError', async () => {
    const gone = setup({}, { getOrder: jest.fn().mockResolvedValue(null) });
    await expect(gone.hooks.precheckCustomerEdit({ code: 'TUBU1', pancakeOrderId: 'pk-1' })).rejects.toBeInstanceOf(PancakePackingError);
    const down = setup({}, { getOrder: jest.fn().mockRejectedValue(new PancakeApiError('timeout of 5000ms exceeded', true)) });
    await expect(down.hooks.precheckCustomerEdit({ code: 'TUBU1', pancakeOrderId: 'pk-1' })).rejects.toBeInstanceOf(PancakeUnreachableError);
    const off = setup({}, { isConfigured: jest.fn().mockReturnValue(false) });
    await expect(off.hooks.precheckCustomerEdit({ code: 'TUBU1', pancakeOrderId: 'pk-1' })).rejects.toBeInstanceOf(PancakeUnreachableError);
    expect(off.client.getOrder).not.toHaveBeenCalled();
  });

  it('chưa lên Pancake → không hỏi gì', async () => {
    const t = setup({ pancakeOrderId: null });
    await expect(t.hooks.precheckCustomerEdit({ code: 'TUBU1', pancakeOrderId: null })).resolves.toBeUndefined();
    expect(t.client.getOrder).not.toHaveBeenCalled();
  });
});

describe('PancakeSyncHooks.afterCustomerEdit', () => {
  it('đơn đã lên Pancake → đúng một job customer-edit-<id>', async () => {
    const t = setup();
    await t.hooks.afterCustomerEdit('o1');
    expect(t.queue.added).toEqual([expect.objectContaining({ name: 'customer-edit', data: { orderId: 'o1' }, opts: { jobId: 'customer-edit-o1' } })]);
  });

  it('job sửa trước đang chạy (có thể đã qua bước so dấu vân tay) → thêm job nối tiếp id riêng, hoãn một nhịp; job đã xong thì gỡ rồi thêm lại đúng id', async () => {
    const active = setup();
    const running = { getState: jest.fn().mockResolvedValue('active'), remove: jest.fn() };
    active.queue.getJob.mockResolvedValue(running);
    await active.hooks.afterCustomerEdit('o1');
    expect(running.remove).not.toHaveBeenCalled();
    expect(active.queue.added).toEqual([
      expect.objectContaining({ name: 'customer-edit', data: { orderId: 'o1' }, opts: { jobId: expect.stringMatching(/^customer-edit-o1-\d+$/), delay: 5_000 } }),
    ]);

    const done = setup();
    const finished = { getState: jest.fn().mockResolvedValue('completed'), remove: jest.fn().mockResolvedValue(undefined) };
    done.queue.getJob.mockResolvedValue(finished);
    await done.hooks.afterCustomerEdit('o1');
    expect(finished.remove).toHaveBeenCalledTimes(1);
    expect(done.queue.added).toEqual([expect.objectContaining({ opts: { jobId: 'customer-edit-o1' } })]);
  });

  it('chưa lên Pancake hay gian hàng tự giao → không xếp gì', async () => {
    for (const over of [{ pancakeOrderId: null }, { fulfiller: 'MERCHANT' }]) {
      const t = setup(over);
      await t.hooks.afterCustomerEdit('o1');
      expect(t.queue.added).toEqual([]);
    }
  });

  it('xếp lỗi → "Cần xử lý Pancake" bảo sửa tay, không ném', async () => {
    const t = setup();
    t.queue.add.mockRejectedValue(new Error('redis down'));
    await expect(t.hooks.afterCustomerEdit('o1')).resolves.toBeUndefined();
    expect(t.row().pancakeAttention).toEqual(expect.stringContaining(ATTENTION_CUSTOMER_EDIT_PENDING));
  });
});

describe('PancakePushProcessor — job customer-edit', () => {
  const job = (attemptsMade: number) => ({ name: 'customer-edit', data: { orderId: 'o1' }, attemptsMade, opts: { attempts: 5 } }) as never;
  it('gọi syncCustomerEdit với cờ lượt cuối; khoá API sai (401) → UnrecoverableError', async () => {
    const syncCustomerEdit = jest.fn().mockResolvedValue(undefined);
    const proc = new PancakePushProcessor({ syncCustomerEdit } as unknown as PancakeOrderService);
    await proc.process(job(0));
    await proc.process(job(4));
    expect(syncCustomerEdit.mock.calls).toEqual([
      ['o1', false],
      ['o1', true],
    ]);
    syncCustomerEdit.mockRejectedValue(new PancakeApiError('Pancake trả 401', false, false, 401));
    await expect(proc.process(job(0))).rejects.toBeInstanceOf(UnrecoverableError);
    syncCustomerEdit.mockRejectedValue(new PancakeApiError('Pancake trả 503', true, false, 503));
    await expect(proc.process(job(0))).rejects.toBeInstanceOf(PancakeApiError);
  });
});
