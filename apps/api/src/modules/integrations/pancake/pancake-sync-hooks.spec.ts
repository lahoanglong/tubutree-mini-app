import { PancakeHandedOverError, PancakeSyncHooks, PancakeUnreachableError } from './pancake-sync-hooks';
import { PancakeApiError } from './pancake-outbound';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PancakeClient } from './pancake.client';
import { baseOrder, fakeOrderDb, fakeQueue } from '../../../../test/fakes/pancake-order.fake';

function setup(order: Record<string, unknown> = {}, client: Record<string, unknown> = {}) {
  const db = fakeOrderDb([baseOrder(order)]);
  const c = {
    isConfigured: jest.fn().mockReturnValue(true),
    getOrder: jest.fn().mockResolvedValue({ id: 'pk-1', status: 1 }),
    updateOrder: jest.fn().mockResolvedValue({ id: 'pk-1', status: 6 }),
    searchOrders: jest.fn().mockResolvedValue([]),
    ...client,
  };
  const queue = fakeQueue();
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
  const hooks = new PancakeSyncHooks(db.prisma as unknown as PrismaService, c as unknown as PancakeClient, queue as never, alerts as never);
  return { ...db, client: c, queue, alerts, hooks };
}

const subject = (o: Record<string, unknown>) => ({ id: 'o1', code: 'TUBU1', pancakeOrderId: null, pancakePushClaimedAt: null, ...o }) as never;

describe('PancakeSyncHooks.precheckCancel (D1)', () => {
  it('chưa từng lên Pancake → NONE, không gọi Pancake', async () => {
    const t = setup();
    expect(await t.hooks.precheckCancel(subject({}), 'INTERACTIVE')).toEqual({ kind: 'NONE' });
    expect(t.client.getOrder).not.toHaveBeenCalled();
  });

  it('Pancake chưa gửi hàng → PUT status 6 với timeout ngắn, CONFIRMED', async () => {
    const t = setup();
    const d = await t.hooks.precheckCancel(subject({ pancakeOrderId: 'pk-1' }), 'INTERACTIVE');
    expect(d).toEqual({ kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' });
    expect(t.client.getOrder).toHaveBeenCalledWith('pk-1', { timeoutMs: PancakeSyncHooks.CANCEL_TIMEOUT_MS });
    expect(t.client.updateOrder).toHaveBeenCalledWith('pk-1', { status: 6 }, { timeoutMs: PancakeSyncHooks.CANCEL_TIMEOUT_MS });
  });

  it.each([2, 3, 4, 5, 15, 16])('Pancake ở trạng thái %s (đã bàn giao vận chuyển) → từ chối huỷ', async (status) => {
    const t = setup({}, { getOrder: jest.fn().mockResolvedValue({ id: 'pk-1', status }) });
    const err = await t.hooks.precheckCancel(subject({ pancakeOrderId: 'pk-1' }), 'INTERACTIVE').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PancakeHandedOverError);
    expect((err as Error).message).toBe('Đơn đã bàn giao cho đơn vị vận chuyển, vui lòng liên hệ CSKH');
    expect(t.client.updateOrder).not.toHaveBeenCalled();
  });

  it('Pancake không còn đơn → CONFIRMED NOT_FOUND', async () => {
    const t = setup({}, { getOrder: jest.fn().mockResolvedValue(null) });
    expect(await t.hooks.precheckCancel(subject({ pancakeOrderId: 'pk-1' }), 'INTERACTIVE')).toMatchObject({ kind: 'CONFIRMED', cancelStatus: 'NOT_FOUND' });
  });

  it('cron (BACKGROUND): Pancake không phản hồi → DEFERRED; các lần sau trong 60s đi thẳng đường hoãn (không treo cron)', async () => {
    const t = setup({}, { getOrder: jest.fn().mockRejectedValue(new PancakeApiError('timeout of 5000ms exceeded', true)) });
    expect(await t.hooks.precheckCancel(subject({ pancakeOrderId: 'pk-1' }), 'BACKGROUND')).toMatchObject({ kind: 'DEFERRED' });
    expect(await t.hooks.precheckCancel(subject({ pancakeOrderId: 'pk-2' }), 'BACKGROUND')).toMatchObject({
      kind: 'DEFERRED',
      reason: 'Pancake vừa không phản hồi',
    });
    expect(t.client.getOrder).toHaveBeenCalledTimes(1);
  });

  describe('người bấm huỷ (INTERACTIVE) — không hỏi được Pancake thì từ chối, không huỷ (R3-CANCEL-1, R2-PANCAKE-1)', () => {
    it.each([
      ['timeout', new PancakeApiError('timeout of 5000ms exceeded', true)],
      ['lỗi mạng', new Error('socket hang up')],
      ['Pancake 401', new PancakeApiError('Pancake trả 401 khi đọc đơn: unauthorized', false)],
    ])('%s → PancakeUnreachableError "Kho chưa phản hồi…"', async (_label, failure) => {
      const t = setup({}, { getOrder: jest.fn().mockRejectedValue(failure) });
      const err = await t.hooks.precheckCancel(subject({ pancakeOrderId: 'pk-1' }), 'INTERACTIVE').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PancakeUnreachableError);
      expect((err as Error).message).toBe('Kho chưa phản hồi, vui lòng thử lại sau ít phút');
      expect(t.client.updateOrder).not.toHaveBeenCalled();
    });

    it('Pancake chưa cấu hình mà đơn đã lên Pancake → từ chối', async () => {
      const t = setup({}, { isConfigured: jest.fn().mockReturnValue(false) });
      await expect(t.hooks.precheckCancel(subject({ pancakeOrderId: 'pk-1' }), 'INTERACTIVE')).rejects.toBeInstanceOf(PancakeUnreachableError);
    });

    it('đơn chưa lên Pancake → vẫn NONE dù Pancake chưa cấu hình (huỷ bình thường)', async () => {
      const t = setup({}, { isConfigured: jest.fn().mockReturnValue(false) });
      expect(await t.hooks.precheckCancel(subject({}), 'INTERACTIVE')).toEqual({ kind: 'NONE' });
    });

    it('khoảng nghỉ 60s sau một lần timeout (ở đơn khác) KHÔNG áp cho người bấm: vẫn hỏi Pancake và thấy đã gửi hàng', async () => {
      const getOrder = jest
        .fn()
        .mockRejectedValueOnce(new PancakeApiError('timeout of 5000ms exceeded', true))
        .mockResolvedValue({ id: 'pk-2', status: 2 });
      const t = setup({}, { getOrder });
      await expect(t.hooks.precheckCancel(subject({ pancakeOrderId: 'pk-1' }), 'BACKGROUND')).resolves.toMatchObject({ kind: 'DEFERRED' });
      await expect(t.hooks.precheckCancel(subject({ pancakeOrderId: 'pk-2' }), 'INTERACTIVE')).rejects.toBeInstanceOf(PancakeHandedOverError);
      expect(getOrder).toHaveBeenCalledTimes(2);
      // Cron vẫn giữ khoảng nghỉ của mình.
      expect(await t.hooks.precheckCancel(subject({ pancakeOrderId: 'pk-3' }), 'BACKGROUND')).toMatchObject({ reason: 'Pancake vừa không phản hồi' });
    });

    it('Pancake trả lời "chưa gửi hàng" nhưng từ chối lệnh huỷ → DEFERRED (trạng thái đã biết, job thử lại)', async () => {
      const t = setup(
        {},
        {
          getOrder: jest.fn().mockResolvedValue({ id: 'pk-1', status: 1 }),
          updateOrder: jest.fn().mockRejectedValue(new PancakeApiError('Pancake trả 400 khi cập nhật đơn: locked', false)),
        },
      );
      expect(await t.hooks.precheckCancel(subject({ pancakeOrderId: 'pk-1' }), 'INTERACTIVE')).toMatchObject({ kind: 'DEFERRED' });
    });

    it('nhiều đơn cùng mã trên Pancake, một đơn đã gửi hàng → từ chối như đã bàn giao', async () => {
      const t = setup(
        {},
        {
          searchOrders: jest.fn().mockResolvedValue([
            { id: 1, status: 1, custom_id: 'TUBU1' },
            { id: 2, status: 2, custom_id: 'TUBU1' },
          ]),
        },
      );
      await expect(t.hooks.precheckCancel(subject({ pancakePushClaimedAt: new Date() }), 'INTERACTIVE')).rejects.toBeInstanceOf(
        PancakeHandedOverError,
      );
    });
  });

  it('chỉ có mốc đẩy (chưa rõ id) → tra theo mã; không thấy → NOT_FOUND; thấy → huỷ đơn đó', async () => {
    const a = setup();
    expect(await a.hooks.precheckCancel(subject({ pancakePushClaimedAt: new Date() }), 'INTERACTIVE')).toMatchObject({ kind: 'CONFIRMED', cancelStatus: 'NOT_FOUND' });
    const b = setup({}, { searchOrders: jest.fn().mockResolvedValue([{ id: 88, status: 0, custom_id: 'TUBU1' }]) });
    expect(await b.hooks.precheckCancel(subject({ pancakePushClaimedAt: new Date() }), 'INTERACTIVE')).toEqual({
      kind: 'CONFIRMED',
      cancelStatus: 'CANCELLED',
      pancakeOrderId: '88',
    });
  });
});

describe('PancakeSyncHooks.afterLocalCancel', () => {
  it('CONFIRMED → ghi kết quả + id tìm được, không xếp job', async () => {
    const t = setup({ status: 'CANCELLED', pancakePushClaimedAt: new Date() });
    await t.hooks.afterLocalCancel('o1', { kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: '88' });
    expect(t.row()).toMatchObject({ pancakeCancelStatus: 'CANCELLED', pancakeOrderId: '88', pancakePushClaimedAt: null });
    expect(t.queue.add).not.toHaveBeenCalled();
  });

  it('DEFERRED → PENDING + "Cần xử lý Pancake" + job huỷ có retry', async () => {
    const t = setup({ status: 'CANCELLED', pancakeOrderId: 'pk-1' });
    await t.hooks.afterLocalCancel('o1', { kind: 'DEFERRED', reason: 'timeout' });
    expect(t.row().pancakeCancelStatus).toBe('PENDING');
    expect(t.row().pancakeAttention).toContain('CHƯA huỷ được trên Pancake');
    expect(t.queue.added).toEqual([{ name: 'cancel', data: { orderId: 'o1' }, opts: { jobId: 'cancel-o1' } }]);
  });

  it('huỷ không qua cổng (Gomdon/hệ thống) mà đơn đã lên Pancake → xếp job huỷ (không cờ)', async () => {
    const t = setup({ status: 'CANCELLED', pancakeOrderId: 'pk-1' });
    await t.hooks.afterLocalCancel('o1');
    expect(t.row().pancakeAttention).toBeNull();
    expect(t.queue.added.map((j) => j.name)).toEqual(['cancel']);
  });

  it('NONE / chưa lên Pancake → không làm gì', async () => {
    const t = setup({ status: 'CANCELLED' });
    await t.hooks.afterLocalCancel('o1', { kind: 'NONE' });
    await t.hooks.afterLocalCancel('o1');
    expect(t.row().pancakeCancelStatus).toBeNull();
    expect(t.queue.add).not.toHaveBeenCalled();
  });

  it('NONE lúc hỏi nhưng lần đẩy song song vừa tạo đơn Pancake → vẫn xếp job huỷ', async () => {
    const t = setup({ status: 'CANCELLED', pancakeOrderId: 'pk-late' });
    await t.hooks.afterLocalCancel('o1', { kind: 'NONE' });
    expect(t.row().pancakeCancelStatus).toBe('PENDING');
    expect(t.queue.added.map((j) => j.name)).toEqual(['cancel']);
  });

  it('CONFIRMED (tra theo mã không thấy) nhưng lần đẩy vừa lưu id khác → không ghi NOT_FOUND, xếp job huỷ', async () => {
    const t = setup({ status: 'CANCELLED', pancakeOrderId: 'pk-late' });
    await t.hooks.afterLocalCancel('o1', { kind: 'CONFIRMED', cancelStatus: 'NOT_FOUND', pancakeOrderId: null });
    expect(t.row().pancakeCancelStatus).toBe('PENDING');
    expect(t.queue.added.map((j) => j.name)).toEqual(['cancel']);
  });

  it('lỗi xếp job không ném ra (huỷ đã commit; cron cứu hộ quét PENDING)', async () => {
    const t = setup({ status: 'CANCELLED', pancakeOrderId: 'pk-1' });
    t.queue.add.mockRejectedValue(new Error('redis down'));
    await expect(t.hooks.afterLocalCancel('o1')).resolves.toBeUndefined();
    expect(t.row().pancakeCancelStatus).toBe('PENDING');
  });
});

describe('PancakeSyncHooks.afterPaid', () => {
  it('xếp job thanh toán; lỗi không ném', async () => {
    const t = setup();
    await t.hooks.afterPaid('o1');
    expect(t.queue.added).toEqual([{ name: 'payment', data: { orderId: 'o1' }, opts: { jobId: 'payment-o1' } }]);
    t.queue.add.mockRejectedValue(new Error('redis down'));
    await expect(t.hooks.afterPaid('o1')).resolves.toBeUndefined();
  });
});

describe('PancakeSyncHooks — đơn gian hàng đối tác tự giao (D4) không chạm Pancake', () => {
  it('precheckCancel đơn MERCHANT → NONE, không hỏi Pancake kể cả khi cột Pancake có dấu vết lạ', async () => {
    const t = setup({ fulfiller: 'MERCHANT' });
    expect(await t.hooks.precheckCancel(subject({ fulfiller: 'MERCHANT', pancakePushClaimedAt: new Date() }), 'INTERACTIVE')).toEqual({ kind: 'NONE' });
    expect(t.client.searchOrders).not.toHaveBeenCalled();
    expect(t.client.getOrder).not.toHaveBeenCalled();
  });

  it('afterLocalCancel đơn MERCHANT → không xếp job huỷ, không ghi pancakeCancelStatus', async () => {
    const t = setup({ fulfiller: 'MERCHANT', status: 'CANCELLED', pancakePushClaimedAt: new Date() });
    await t.hooks.afterLocalCancel('o1', { kind: 'NONE' });
    await t.hooks.afterLocalCancel('o1');
    expect(t.queue.added).toEqual([]);
    expect(t.row().pancakeCancelStatus).toBeNull();
  });

  it('afterPaid đơn MERCHANT → không xếp job thanh toán Pancake; đơn TUBU thì có', async () => {
    const m = setup({ fulfiller: 'MERCHANT' });
    await m.hooks.afterPaid('o1');
    expect(m.queue.added).toEqual([]);
    const t = setup();
    await t.hooks.afterPaid('o1');
    expect(t.queue.added.map((j) => j.name)).toEqual(['payment']);
  });
});
