import { PancakeProcessor } from './pancake.processor';
import { ATTENTION_TOTAL_MISMATCH, ATTENTION_UNDERPAID } from './pancake-attention';
import { PANCAKE_ALERT_TEMPLATE } from '../gomdon/gomdon-alert.service';

/** Payload "Đơn hàng" Pancake sau khi nhân viên THÊM một món 50.000 vào đơn TUBU20260001 (Tubu đẩy 269.000). */
const EDITED = {
  id: 7001,
  status: 1,
  custom_id: 'TUBU20260001',
  total_price: 330_000,
  total_price_after_sub_discount: 300_000,
  total_discount: 30_000,
  shipping_fee: 19_000,
  cod: 319_000,
  prepaid: 0,
};
const UNTOUCHED = { ...EDITED, total_price: 280_000, total_price_after_sub_discount: 250_000, cod: 269_000 };

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  code: 'TUBU20260001',
  userId: 'u1',
  status: 'CONFIRMED',
  fulfiller: 'TUBU',
  total: 269_000,
  pancakeOrderId: '7001',
  pancakeAttention: null,
  ...over,
});

type Opts = { lines?: { pancakeId: string | null; fulfilment: string | null }[]; config?: unknown; itemsFail?: boolean };

function setup(o: Record<string, unknown>, opts: Opts = {}) {
  const lines = opts.lines ?? [{ pancakeId: 'pv1', fulfilment: 'TUBU' }];
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const update = jest.fn().mockResolvedValue({});
  const orderItemFindMany = opts.itemsFail
    ? jest.fn().mockRejectedValue(new Error('db down'))
    : jest.fn().mockResolvedValue(lines.map((_, i) => ({ variationId: `v${i}` })));
  const prisma = {
    order: { findFirst: jest.fn().mockResolvedValue(o), updateMany, update },
    orderItem: { findMany: orderItemFindMany },
    variation: {
      findMany: jest.fn().mockResolvedValue(lines.map((l, i) => ({ id: `v${i}`, pancakeId: l.pancakeId, product: { fulfilment: l.fulfilment } }))),
    },
  };
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
  const config =
    opts.config === 'throws'
      ? { get: jest.fn().mockRejectedValue(new Error('config down')) }
      : { get: jest.fn((_k: string, d: unknown) => Promise.resolve(opts.config === undefined ? d : opts.config)) };
  const proc = new PancakeProcessor(prisma as never, {} as never, {} as never, alerts as never, config as never) as unknown as {
    onOrderEvent(d: Record<string, unknown>): Promise<void>;
    onStatusUpdated: jest.Mock;
    onPaymentReconcile: jest.Mock;
    onShippingUpdated: jest.Mock;
  };
  proc.onStatusUpdated = jest.fn().mockResolvedValue(undefined);
  proc.onPaymentReconcile = jest.fn().mockResolvedValue(null);
  proc.onShippingUpdated = jest.fn().mockResolvedValue(undefined);
  return { proc, prisma, updateMany, update, alerts, config };
}

type Call = { where: Record<string, unknown>; data: Record<string, unknown> };
const calls = (m: jest.Mock) => m.mock.calls.map(([a]) => a as Call);
const flagged = (m: jest.Mock) =>
  calls(m)
    .filter((c) => typeof c.data.pancakeAttention === 'string')
    .map((c) => c.data.pancakeAttention as string);
const cleared = (m: jest.Mock) => calls(m).filter((c) => c.data.pancakeAttention === null);

describe('PancakeProcessor — so tổng tiền Pancake với order.total (D1-03)', () => {
  it('đơn bị sửa trên Pancake (thêm món 50.000): đưa vào "Cần xử lý Pancake" kèm hai số và chênh lệch, báo ADMIN', async () => {
    const { proc, updateMany, alerts } = setup(order());
    await proc.onOrderEvent(EDITED);
    const [reason] = flagged(updateMany);
    expect(reason).toContain(ATTENTION_TOTAL_MISMATCH);
    expect(reason).toContain('Pancake ghi 319.000đ');
    expect(reason).toContain('Tubu ghi 269.000đ');
    expect(reason).toContain('+50.000đ');
    expect(reason).toMatch(/huỷ đơn rồi đặt lại/);
    expect(alerts.alert).toHaveBeenCalledWith('TUBU20260001', reason, PANCAKE_ALERT_TEMPLATE);
  });

  it('bớt món: chênh lệch ghi dấu âm', async () => {
    const { proc, updateMany } = setup(order());
    await proc.onOrderEvent({ ...EDITED, total_price: 130_000, total_price_after_sub_discount: 100_000 });
    expect(flagged(updateMany)[0]).toContain('-150.000đ');
  });

  it('KHÔNG tự sửa đơn: không có lệnh ghi nào ngoài hai cột hàng đợi Pancake', async () => {
    const { proc, updateMany, update } = setup(order());
    await proc.onOrderEvent(EDITED);
    expect(update).not.toHaveBeenCalled();
    for (const c of calls(updateMany)) expect(Object.keys(c.data).sort()).toEqual(['pancakeAttention', 'pancakeAttentionAt']);
  });

  it('đơn nguyên vẹn: không báo gì, không đụng cơ sở dữ liệu', async () => {
    const { proc, updateMany, alerts } = setup(order());
    await proc.onOrderEvent(UNTOUCHED);
    expect(updateMany).not.toHaveBeenCalled();
    expect(alerts.alert).not.toHaveBeenCalled();
  });

  it('nhân viên đã sửa lại đúng số: lời nhắc lệch tổng tự gỡ khỏi hàng đợi', async () => {
    const { proc, updateMany } = setup(order({ pancakeAttention: `${ATTENTION_TOTAL_MISMATCH}: cũ` }));
    await proc.onOrderEvent(UNTOUCHED);
    expect(cleared(updateMany)).toEqual([
      expect.objectContaining({ where: { id: 'o1', OR: [{ pancakeAttention: { startsWith: ATTENTION_TOTAL_MISMATCH } }] } }),
    ]);
  });

  it('khớp mà đơn đang chờ lý do KHÁC (khách chuyển thiếu): không gỡ lý do đó', async () => {
    const { proc, updateMany } = setup(order({ pancakeAttention: `${ATTENTION_UNDERPAID}: 1/2` }));
    await proc.onOrderEvent(UNTOUCHED);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('lệch mà đơn đang chờ lý do KHÁC: không ghi đè lý do đó (hàng đợi chỉ có một ô lý do)', async () => {
    const { proc, updateMany, alerts } = setup(order({ pancakeAttention: `${ATTENTION_UNDERPAID}: 1/2` }));
    await proc.onOrderEvent(EDITED);
    expect(updateMany).not.toHaveBeenCalled();
    expect(alerts.alert).not.toHaveBeenCalled();
  });

  it('lệch thêm lần nữa (số khác) thì cập nhật lời nhắc lệch cũ', async () => {
    const { proc, updateMany } = setup(order({ pancakeAttention: `${ATTENTION_TOTAL_MISMATCH}: Pancake ghi 319.000đ` }));
    await proc.onOrderEvent({ ...EDITED, total_price: 380_000, total_price_after_sub_discount: 350_000 });
    expect(flagged(updateMany)[0]).toContain('Pancake ghi 369.000đ');
  });

  it('đơn đã huỷ/trả: bỏ qua (sửa gì cũng không còn ảnh hưởng)', async () => {
    for (const status of ['CANCELLED', 'RETURNED']) {
      const { proc, updateMany } = setup(order({ status }));
      await proc.onOrderEvent(EDITED);
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it('sự kiện hoàn/huỷ/xoá của Pancake: tổng đổi theo phiếu hoàn, không phải sửa đơn → bỏ qua', async () => {
    for (const status of [4, 5, 6, 7, 15]) {
      const { proc, updateMany } = setup(order());
      await proc.onOrderEvent({ ...EDITED, status });
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it('đơn có dòng không qua Pancake (hàng đối tác tự giao): tổng Pancake thấp hơn là đúng thiết kế → không báo', async () => {
    const { proc, updateMany } = setup(order(), {
      lines: [
        { pancakeId: 'pv1', fulfilment: 'TUBU' },
        { pancakeId: null, fulfilment: 'MERCHANT' },
      ],
    });
    await proc.onOrderEvent(EDITED);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('đơn gian hàng đối tác tự giao không bao giờ so tổng', async () => {
    const { proc, updateMany } = setup(order({ fulfiller: 'MERCHANT' }));
    await proc.onOrderEvent(EDITED);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('payload không có số tổng nào (vd chỉ đổi vận chuyển): không kết luận gì', async () => {
    const { proc, updateMany } = setup(order());
    await proc.onOrderEvent({ id: 7001, status: 2, partner: { partner_name: 'GHN', extend_code: 'X1' } });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('công tắc SystemConfig pancake.total_mismatch_check = false: không so, không truy vấn thêm', async () => {
    const { proc, updateMany, config, prisma } = setup(order(), { config: false });
    await proc.onOrderEvent(EDITED);
    expect(config.get).toHaveBeenCalledWith('pancake.total_mismatch_check', true);
    expect(updateMany).not.toHaveBeenCalled();
    expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
  });

  it('mặc định bật: không đọc được cấu hình vẫn so như thường', async () => {
    const { proc, updateMany } = setup(order(), { config: 'throws' });
    await proc.onOrderEvent(EDITED);
    expect(flagged(updateMany)).toHaveLength(1);
  });

  it('lỗi khi so tổng không làm hỏng xử lý trạng thái/thanh toán/vận chuyển của cùng sự kiện', async () => {
    const { proc } = setup(order(), { itemsFail: true });
    await expect(proc.onOrderEvent({ ...EDITED, partner: { partner_name: 'GHN' } })).resolves.toBeUndefined();
    expect(proc.onStatusUpdated).toHaveBeenCalled();
    expect(proc.onPaymentReconcile).toHaveBeenCalled();
    expect(proc.onShippingUpdated).toHaveBeenCalled();
  });
});
