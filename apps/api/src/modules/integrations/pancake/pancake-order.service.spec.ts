import { isPancakeForbiddenError, PANCAKE_FORBIDDEN_ERROR_PREFIX } from '@tubutree/shared-types';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PANCAKE_CANCEL, PANCAKE_CANCEL_REFUSED_PREFIX, PANCAKE_PUSH, PancakeOrderService, pushRetryGateDecision } from './pancake-order.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PancakeClient } from './pancake.client';
import type { PancakeCreateOrderBody } from './pancake.types';
import { PancakeApiError, PancakeCancelRefusedError, PancakeOrderDataError, PancakePushBusyError, PancakePushSettlingError } from './pancake-outbound';
import { ATTENTION_PUSH_FAILED } from './pancake-attention';
import { QUEUE_COMMAND_TIMEOUT_MS, QueueTimeoutError } from '../../../jobs/queue-timeout';
import { baseOrder, fakeOrderDb, fakeQueue } from '../../../../test/fakes/pancake-order.fake';

const FAKE_TAG_IDS = new Map<string, number>();
/** Shop giả có đủ mọi thẻ ta cần; id cấp theo thứ tự gặp tên. */
const resolveAll = async (names: readonly string[]) =>
  names.map((name) => {
    if (!FAKE_TAG_IDS.has(name)) FAKE_TAG_IDS.set(name, 100 + FAKE_TAG_IDS.size);
    return { id: FAKE_TAG_IDS.get(name)!, name };
  });
const tagNames = (tags?: { name?: string }[]) => tags?.map((t) => t.name);

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    resolveOrderTags: jest.fn(resolveAll),
    isConfigured: jest.fn().mockReturnValue(true),
    createOrder: jest.fn().mockResolvedValue({ id: 'pk-new' }),
    searchOrders: jest.fn().mockResolvedValue([]),
    getOrder: jest.fn().mockResolvedValue({ id: 'pk-1', status: 0 }),
    updateOrder: jest.fn().mockResolvedValue({ id: 'pk-1', status: 6 }),
    ...overrides,
  };
}

function setup(order: Record<string, unknown> = {}, opts: { client?: Record<string, unknown>; extra?: Record<string, unknown> } = {}) {
  const db = fakeOrderDb([baseOrder(order)], opts.extra);
  const client = fakeClient(opts.client);
  const queue = fakeQueue();
  const alerts = { alert: jest.fn().mockResolvedValue(undefined), resolveKinds: jest.fn().mockResolvedValue(0) };
  const svc = new PancakeOrderService(
    db.prisma as unknown as PrismaService,
    client as unknown as PancakeClient,
    queue as never,
    undefined,
    alerts as never,
  );
  const body = (n = 0) => client.createOrder.mock.calls[n]![0] as PancakeCreateOrderBody;
  return { ...db, client, queue, alerts, svc, body };
}

/** Tổng tiền Pancake tính từ body: Σ(giá lẻ − giảm/đv)×SL + ship − giảm cấp đơn. */
function pancakeTotal(b: PancakeCreateOrderBody): number {
  const goods = b.items.reduce((s, i) => s + ((i.variation_info?.retail_price ?? 0) - (i.discount_each_product ?? 0)) * i.quantity, 0);
  return goods + (b.shipping_fee ?? 0) - (b.total_discount ?? 0);
}

describe('PancakeOrderService.pushOrder — tiền trong body (PANCAKE-1, PANCAKE-8, MONEY-1)', () => {
  it('đơn đã trả qua Ví/ZaloPay → transfer_money = tổng, cod = 0, tag + ghi chú "KHÔNG THU COD"', async () => {
    const t = setup({ paymentMethod: 'WALLET', paymentStatus: 'PAID' });
    await t.svc.pushOrder('o1');
    const b = t.body();
    expect(b.transfer_money).toBe(230_000);
    expect(b.cod).toBe(0);
    expect(tagNames(b.tags)).toContain('DA_THANH_TOAN');
    expect(b.note).toContain('[ĐÃ THANH TOÁN VÍ TUBU 230.000đ - KHÔNG THU COD]');
    expect(t.row().pancakePaymentSynced).toBe(true);
  });

  it('COD → cod = tổng, transfer_money = 0', async () => {
    const t = setup();
    await t.svc.pushOrder('o1');
    expect(t.body()).toMatchObject({ cod: 230_000, transfer_money: 0, custom_id: 'TUBU1' });
    expect(t.body().note).toBe('Order code: TUBU1 | [THU COD 230.000đ]');
    expect(t.row().pancakePaymentSynced).toBe(false);
  });

  it('giá từng dòng: giá lẻ danh mục + giảm/đv về đúng đơn giá đã bán; tổng Pancake = order.total kể cả có mã giảm', async () => {
    const t = setup(
      {
        items: [
          { id: 'i1', variationId: 'v1', quantity: 2, unitPrice: 80_000 },
          { id: 'i2', variationId: 'v2', quantity: 1, unitPrice: 50_000 },
        ],
        subtotal: 210_000,
        discount: 25_000,
        shippingFee: 30_000,
        total: 215_000,
      },
      {
        extra: {
          variation: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'v1', pancakeId: 'pv1', retailPrice: 100_000, weight: 0 },
              { id: 'v2', pancakeId: 'pv2', retailPrice: 50_000, weight: 0 },
            ]),
          },
        },
      },
    );
    await t.svc.pushOrder('o1');
    const b = t.body();
    expect(b.items).toEqual([
      { variation_id: 'pv1', quantity: 2, discount_each_product: 20_000, variation_info: { retail_price: 100_000 } },
      { variation_id: 'pv2', quantity: 1, discount_each_product: 0, variation_info: { retail_price: 50_000 } },
    ]);
    expect(b.total_discount).toBe(25_000);
    expect(pancakeTotal(b)).toBe(215_000);
  });

  it('đơn giá bán cao hơn giá danh mục (giá đã đổi) → không gửi giảm âm', async () => {
    const t = setup({}, { extra: { variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', pancakeId: 'pv1', retailPrice: 90_000 }]) } } });
    await t.svc.pushOrder('o1');
    expect(t.body().items[0]).toMatchObject({ discount_each_product: 0, variation_info: { retail_price: 100_000 } });
    expect(pancakeTotal(t.body())).toBe(230_000);
  });

  it('chuyển khoản chưa về tiền → VẪN đẩy (Pancake đối soát theo mã đơn) kèm "CHỜ CHUYỂN KHOẢN"', async () => {
    const t = setup({ paymentMethod: 'BANK_TRANSFER', status: 'PENDING_PAYMENT' });
    await t.svc.pushOrder('o1');
    expect(tagNames(t.body().tags)).toContain('CHO_CHUYEN_KHOAN');
    expect(t.body().note).toContain('CHỜ CHUYỂN KHOẢN 230.000đ - CHƯA GIAO');
  });

  it('ZaloPay chưa thanh toán → không đẩy, WAITING_PAYMENT', async () => {
    const t = setup({ paymentMethod: 'ZALOPAY', status: 'PENDING_PAYMENT' });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.WAITING_PAYMENT);
  });
});

describe('PancakeOrderService.pushOrder — người nhận, tag kênh (SELLER-2, BUYERWEB-6)', () => {
  it('đơn web → tag WEB, không phải MINIAPP', async () => {
    const t = setup({ platform: 'web' });
    await t.svc.pushOrder('o1');
    expect(tagNames(t.body().tags)).toEqual(['WEB', 'RETAIL', 'COD']);
  });

  it('gửi tên/SĐT/địa chỉ ở bill_* + shipping_address; không gửi fb_id; hệ 2 cấp không gửi district_id', async () => {
    const t = setup();
    await t.svc.pushOrder('o1');
    const b = t.body();
    expect(b).toMatchObject({
      bill_full_name: 'Nguyễn Văn A',
      bill_phone_number: '0900000001',
      shipping_address: {
        full_name: 'Nguyễn Văn A',
        phone_number: '0900000001',
        full_address: '1 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh',
        commune_id: '84_VN7926743',
        province_id: '84_VN79',
      },
    });
    expect(b.shipping_address!.district_id).toBeUndefined();
    expect(b.customer).not.toHaveProperty('fb_id');
  });

  it('địa chỉ hệ cũ 3 cấp (còn mã quận) → vẫn gửi district_id', async () => {
    const t = setup({
      shippingAddress: {
        recipient: 'A', phone: '0900000001', street: 'S', ward: 'W', district: 'D', province: 'P',
        provinceCode: '101', districtCode: '10101', wardCode: '1010115',
      },
    });
    await t.svc.pushOrder('o1');
    expect(t.body().customer!.district_id).toBe('10101');
  });

  it('đơn đại lý cũ chỉ có ghi chú → lấy người nhận từ sổ địa chỉ; ghi công nợ → transfer_money = tổng, CONG_NO', async () => {
    const t = setup(
      { type: 'DEALER', shippingAddress: { note: 'Giao theo hợp đồng đại lý' }, items: [{ id: 'i1', variationId: 'v1', quantity: 10, unitPrice: 70_000 }], subtotal: 700_000, shippingFee: 0, total: 700_000 },
      {
        extra: {
          address: {
            findFirst: jest.fn().mockResolvedValue({
              recipient: 'Đại lý Hoa Mai', phone: '0911111111', street: '5 Trần Phú', ward: 'Phường 1', district: '',
              province: 'Đà Nẵng', provinceCode: '84_VN48', districtCode: '', wardCode: '84_VN4820',
            }),
          },
          dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue({ id: 'led1' }) },
          variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', pancakeId: 'pv1', retailPrice: 100_000 }]) },
        },
      },
    );
    await t.svc.pushOrder('o1');
    const b = t.body();
    expect(b.bill_full_name).toBe('Đại lý Hoa Mai');
    expect(b.bill_phone_number).toBe('0911111111');
    expect(b.items[0]).toMatchObject({ quantity: 10, discount_each_product: 30_000, variation_info: { retail_price: 100_000 } });
    expect(pancakeTotal(b)).toBe(700_000);
    expect(b).toMatchObject({ transfer_money: 700_000, cod: 0 });
    expect(tagNames(b.tags)).toEqual(['MINIAPP', 'DEALER', 'CONG_NO']);
  });

  it('thiếu SĐT người nhận → PancakeOrderDataError (thử lại không giúp), không gọi Pancake', async () => {
    const t = setup({ shippingAddress: { recipient: 'A', phone: '', street: 'S' } });
    await expect(t.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeOrderDataError);
    expect(t.client.createOrder).not.toHaveBeenCalled();
  });
});

describe('PancakeOrderService — đơn/dòng gian hàng đối tác tự giao không bao giờ tới Pancake (D4 × P1)', () => {
  const merchantVariations = {
    variation: {
      findMany: jest.fn().mockResolvedValue([{ id: 'vm', pancakeId: null, retailPrice: 100_000, product: { fulfilment: 'MERCHANT' } }]),
    },
  };
  const merchantOrder = { fulfiller: 'MERCHANT', paymentMethod: 'WALLET', paymentStatus: 'PAID', items: [{ id: 'i1', variationId: 'vm', quantity: 1, unitPrice: 100_000 }] };

  it('đơn MERCHANT → pushOrder không gọi Pancake, không ghi cột đồng bộ / cờ cần xử lý', async () => {
    const t = setup(merchantOrder, { extra: merchantVariations });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.client.searchOrders).not.toHaveBeenCalled();
    expect(t.prisma.order.updateMany).not.toHaveBeenCalled();
    expect(t.row()).toMatchObject({ pancakePushStatus: null, pancakeAttention: null, pancakePushClaimedAt: null });
  });

  it('đơn MERCHANT đã trả bằng Ví → job thanh toán (syncPayment) không đẩy, không PUT', async () => {
    const t = setup(merchantOrder, { extra: merchantVariations });
    await t.svc.syncPayment('o1', true);
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.client.updateOrder).not.toHaveBeenCalled();
  });

  it('admin "Đẩy lại Pancake" trên đơn MERCHANT → 400, không xếp job', async () => {
    const t = setup(merchantOrder, { extra: merchantVariations });
    await expect(t.svc.retryPushByAdmin('admin1', 'TUBU1')).rejects.toBeInstanceOf(BadRequestException);
    expect(t.queue.added).toEqual([]);
  });

  it('đơn MERCHANT đã huỷ → job huỷ không gọi Pancake, không ghi trạng thái huỷ Pancake', async () => {
    const t = setup({ ...merchantOrder, status: 'CANCELLED' }, { extra: merchantVariations });
    await t.svc.cancelOnPancake('o1', true);
    expect(t.client.getOrder).not.toHaveBeenCalled();
    expect(t.client.searchOrders).not.toHaveBeenCalled();
    expect(t.client.updateOrder).not.toHaveBeenCalled();
    expect(t.row().pancakeCancelStatus).toBeNull();
  });

  it('mã giả MCH_ còn sót trên đơn kho Tubu → không tới Pancake, gắn cờ cần xử lý', async () => {
    const t = setup({ items: [{ id: 'i1', variationId: 'vx', quantity: 1, unitPrice: 100_000 }] }, {
      extra: { variation: { findMany: jest.fn().mockResolvedValue([{ id: 'vx', pancakeId: 'MCH_1791_abc_VAR', retailPrice: null, product: { fulfilment: 'TUBU' } }]) } },
    });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.row().pancakeAttention).toContain('chưa gửi kho');
  });

  it('đơn cũ lẫn hàng đối tác → chỉ gửi dòng Pancake (không id nội bộ, không MCH_), COD chia theo phần hàng Tubu', async () => {
    const t = setup(
      {
        items: [
          { id: 'i1', variationId: 'v1', quantity: 2, unitPrice: 50_000 },
          { id: 'i2', variationId: 'vm', quantity: 1, unitPrice: 100_000 },
          { id: 'i3', variationId: 'vgone', quantity: 1, unitPrice: 10_000 },
        ],
        subtotal: 210_000,
        discount: 21_000,
        shippingFee: 30_000,
        total: 219_000,
      },
      {
        extra: {
          variation: {
            findMany: jest.fn().mockResolvedValue([
              { id: 'v1', pancakeId: 'pv1', retailPrice: 50_000, product: { fulfilment: 'TUBU' } },
              { id: 'vm', pancakeId: null, retailPrice: 100_000, product: { fulfilment: 'MERCHANT' } },
            ]),
          },
        },
      },
    );
    expect(await t.svc.pushOrder('o1')).toBe('pk-new');
    const b = t.body();
    expect(b.items.map((i) => i.variation_id)).toEqual(['pv1']);
    expect(JSON.stringify(b)).not.toMatch(/"vm"|"vgone"|MCH_/);
    // Phần hàng Tubu 100.000 / 210.000 → giảm 10.000; ship 30.000 → thu 120.000.
    expect(b.cod).toBe(120_000);
    expect(pancakeTotal(b)).toBe(120_000);
    expect(t.row().pancakeAttention).toContain('2 dòng');
  });
});

describe('PancakeOrderService.pushOrder — không đẩy đơn huỷ / đã rời kho (PANCAKE-3, PLATFORM-8)', () => {
  it('đơn đã CANCELLED (job retry chạy sau khi huỷ) → không tạo đơn, SKIPPED', async () => {
    const t = setup({ status: 'CANCELLED' });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.SKIPPED);
  });

  it('đơn CANCELLED mà lần đẩy trước có thể đã tạo → xếp job huỷ bên Pancake', async () => {
    const t = setup({ status: 'CANCELLED', pancakePushClaimedAt: new Date('2026-10-13T00:00:00Z') });
    await t.svc.pushOrder('o1');
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.row().pancakeCancelStatus).toBe(PANCAKE_CANCEL.PENDING);
    expect(t.queue.added).toEqual([{ name: 'cancel', data: { orderId: 'o1' }, opts: { jobId: 'cancel-o1' } }]);
  });

  it('đơn DELIVERED chưa từng lên Pancake → không đẩy (kho giao lần hai), STALE', async () => {
    const t = setup({ status: 'DELIVERED' });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.STALE);
  });

  it('đơn bị huỷ TRONG LÚC đang tạo → lưu id rồi xếp job huỷ ngay', async () => {
    const t = setup();
    t.client.createOrder.mockImplementation(async () => {
      t.row().status = 'CANCELLED';
      return { id: 'pk-new' };
    });
    await t.svc.pushOrder('o1');
    expect(t.row().pancakeOrderId).toBe('pk-new');
    expect(t.queue.added.map((j) => j.name)).toEqual(['cancel']);
  });
});

describe('PancakeOrderService.pushOrder — chống tạo trùng (PANCAKE-4, PANCAKE-14, PLATFORM-1)', () => {
  it('đã có pancakeOrderId → trả luôn, không gọi Pancake', async () => {
    const t = setup({ pancakeOrderId: 'pk-existing' });
    expect(await t.svc.pushOrder('o1')).toBe('pk-existing');
    expect(t.client.createOrder).not.toHaveBeenCalled();
  });

  it('phản hồi bọc {success, data:{id}} → vẫn lưu đúng id', async () => {
    const t = setup({}, { client: { createOrder: jest.fn().mockResolvedValue({ success: true, data: { id: 98765 } }) } });
    expect(await t.svc.pushOrder('o1')).toBe('98765');
    expect(t.row()).toMatchObject({ pancakeOrderId: '98765', pancakePushStatus: PANCAKE_PUSH.SYNCED, pancakePushClaimedAt: null });
  });

  it('timeout khi tạo → giữ mốc; lần sau TRA theo mã đơn, thấy thì nhận đơn đó — chỉ một lệnh tạo', async () => {
    const t = setup();
    t.client.createOrder.mockRejectedValueOnce(new PancakeApiError('timeout of 15000ms exceeded', true));
    await expect(t.svc.pushOrder('o1')).rejects.toThrow('timeout');
    expect(t.row().pancakePushClaimedAt).toBeInstanceOf(Date);
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.PENDING);
    // Lần sau phải đợi hết cửa sổ chờ (SEND_SETTLE_MS) mới được tra cứu.
    t.row().pancakePushClaimedAt = new Date(Date.now() - PancakeOrderService.SEND_SETTLE_MS - 1_000);

    t.client.searchOrders.mockResolvedValue([
      { id: 555, status: 0, note: 'Order code: TUBU12 | x' },
      { id: 777, status: 0, custom_id: 'TUBU1', inserted_at: '2026-10-14T01:00:00' },
    ]);
    expect(await t.svc.pushOrder('o1')).toBe('777');
    expect(t.client.createOrder).toHaveBeenCalledTimes(1);
    expect(t.row()).toMatchObject({ pancakeOrderId: '777', pancakePushStatus: PANCAKE_PUSH.SYNCED });
  });

  it('timeout rồi tra không thấy → mới tạo lại', async () => {
    const t = setup({ pancakePushClaimedAt: new Date('2026-10-14T00:00:00Z'), pancakePushStatus: PANCAKE_PUSH.PENDING });
    expect(await t.svc.pushOrder('o1')).toBe('pk-new');
    expect(t.client.searchOrders).toHaveBeenCalledWith('TUBU1');
    expect(t.client.createOrder).toHaveBeenCalledTimes(1);
  });

  it('Pancake trả thành công nhưng không có id → không coi là xong, giữ mốc để lần sau tra cứu', async () => {
    const t = setup({}, { client: { createOrder: jest.fn().mockResolvedValue({ success: true }) } });
    await expect(t.svc.pushOrder('o1')).rejects.toMatchObject({ transient: true });
    expect(t.row().pancakeOrderId).toBeNull();
    expect(t.row().pancakePushClaimedAt).toBeInstanceOf(Date);
  });

  it('Pancake từ chối dứt khoát (4xx) → gỡ mốc (chắc chắn chưa tạo), ghi lỗi cho admin', async () => {
    const t = setup({}, { client: { createOrder: jest.fn().mockRejectedValue(new PancakeApiError('Pancake 422: variation_id không hợp lệ', false)) } });
    await expect(t.svc.pushOrder('o1')).rejects.toThrow('422');
    expect(t.row()).toMatchObject({ pancakePushClaimedAt: null, pancakeSyncError: 'Pancake 422: variation_id không hợp lệ', pancakePushAttempts: 1 });
  });

  it('tiến trình khác đang giữ quyền đẩy (PUSHING < 60s) → không tạo, ném lỗi tạm để thử lại', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakeLastAttemptAt: new Date(Date.now() - 5_000), pancakePushClaimedAt: new Date() });
    await expect(t.svc.pushOrder('o1')).rejects.toMatchObject({ transient: true });
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.client.searchOrders).not.toHaveBeenCalled();
  });

  it('PUSHING đã quá hạn (worker chết giữa chừng) → vào lại, tra cứu trước khi tạo', async () => {
    const t = setup({
      pancakePushStatus: PANCAKE_PUSH.PUSHING,
      pancakeLastAttemptAt: new Date(Date.now() - 120_000),
      pancakePushClaimedAt: new Date(Date.now() - PancakeOrderService.SEND_SETTLE_MS - 60_000),
    });
    t.client.searchOrders.mockResolvedValue([{ id: 31, status: 1, custom_id: 'TUBU1' }]);
    expect(await t.svc.pushOrder('o1')).toBe('31');
    expect(t.client.createOrder).not.toHaveBeenCalled();
  });

  it('hai lần đẩy song song (job push + job thanh toán) → chỉ MỘT lệnh tạo', async () => {
    const t = setup();
    let release!: () => void;
    t.client.createOrder.mockImplementation(() => new Promise((r) => { release = () => r({ id: 'pk-new' }); }));
    const a = t.svc.pushOrder('o1');
    await new Promise((r) => setImmediate(r));
    const b = t.svc.pushOrder('o1').catch((e: unknown) => e);
    await new Promise((r) => setImmediate(r));
    release();
    expect(await a).toBe('pk-new');
    expect(await b).toBeInstanceOf(PancakeApiError);
    expect(t.client.createOrder).toHaveBeenCalledTimes(1);
  });

  it('Pancake chưa cấu hình → NOT_CONFIGURED + lý do, không gọi Pancake', async () => {
    const t = setup({}, { client: { isConfigured: jest.fn().mockReturnValue(false) } });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.NOT_CONFIGURED);
    expect(t.row().pancakeSyncError).toContain('chưa cấu hình');
  });

  it('đẩy thành công → gỡ "Cần xử lý Pancake" do lần đẩy hỏng trước ghi', async () => {
    const t = setup({ pancakeAttention: 'Chưa đẩy được đơn sang Pancake (kho chưa thấy đơn): 500' });
    await t.svc.pushOrder('o1');
    expect(t.row().pancakeAttention).toBeNull();
  });
});

describe('PancakeOrderService.markPushFailure', () => {
  it('lần cuối → FAILED + "Cần xử lý Pancake" + báo admin', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING });
    await t.svc.markPushFailure('o1', new Error('Pancake 500'), true);
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.FAILED, pancakeSyncError: 'Pancake 500' });
    expect(t.row().pancakeAttention).toContain('Chưa đẩy được đơn sang Pancake');
    expect(t.alerts.alert).toHaveBeenCalledTimes(1);
  });

  it('Pancake chập tạm (lỗi mạng/5xx) với đơn mới đặt → FAILED nhưng KHÔNG báo admin, để cron 15 phút tự đẩy lại (R2-PLATFORM-9)', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, createdAt: new Date(Date.now() - 5 * 60_000), paidAt: null });
    await t.svc.markPushFailure('o1', new PancakeApiError('Không kết nối được Pancake khi tạo đơn: ECONNREFUSED', true), true);
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.FAILED);
    expect(t.row().pancakeAttention ?? null).toBeNull();
    expect(t.alerts.alert).not.toHaveBeenCalled();
  });

  it('lỗi tạm kéo dài quá thời gian ân hạn kể từ lúc đặt/trả tiền → mới vào "Cần xử lý Pancake"', async () => {
    const t = setup({
      pancakePushStatus: PANCAKE_PUSH.PENDING,
      createdAt: new Date(Date.now() - 3 * 3_600_000),
      paidAt: new Date(Date.now() - (PancakeOrderService.PUSH_ATTENTION_GRACE_MINUTES + 1) * 60_000),
    });
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 503 khi tạo đơn: busy', true), true);
    expect(t.row().pancakeAttention).toContain('Chưa đẩy được đơn sang Pancake');
    expect(t.alerts.alert).toHaveBeenCalledTimes(1);
  });

  it('trả tiền mới đây (đơn đặt lâu rồi) → vẫn trong ân hạn, chưa báo', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, createdAt: new Date(Date.now() - 3 * 3_600_000), paidAt: new Date(Date.now() - 2 * 60_000) });
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 502 khi tạo đơn', true), true);
    expect(t.alerts.alert).not.toHaveBeenCalled();
  });

  it('Pancake từ chối dứt khoát (4xx) → báo ngay dù đơn mới đặt', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, createdAt: new Date(), paidAt: null });
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 422 khi tạo đơn: thiếu kho', false), true);
    expect(t.alerts.alert).toHaveBeenCalledTimes(1);
  });

  it('đơn đang PUSHING bởi tiến trình khác → không ghi đè trạng thái (giữ khoá)', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakeLastAttemptAt: new Date() });
    await t.svc.markPushFailure('o1', new Error('đang đẩy'), true);
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.PUSHING);
  });

  it('đơn còn PUSHING nhưng quá hạn thuê (tiến trình đẩy đã chết), lỗi DATA ném trước claim: job ghi DATA, FAILED và "Cần xử lý" (cùng luật với claim)', async () => {
    const t = setup({
      pancakePushStatus: PANCAKE_PUSH.PUSHING,
      pancakeLastAttemptAt: new Date(Date.now() - PancakeOrderService.PUSH_LEASE_MS - 5_000),
      shippingAddress: { recipient: 'A', phone: '', street: 'S' },
    });
    const err = await t.svc.pushOrder('o1').catch((e) => e);
    expect(err).toBeInstanceOf(PancakeOrderDataError);
    await t.svc.markPushFailure('o1', err, true);
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.FAILED, pancakeErrorKind: 'DATA' });
    expect(t.row().pancakeAttention).toContain('Chưa đẩy được đơn sang Pancake');
  });

  it('lỗi CONFIG trên đơn PUSHING quá hạn thuê: hoàn lượt đã đốt trong cùng câu ghi', async () => {
    const t = setup({
      pancakePushStatus: PANCAKE_PUSH.PUSHING,
      pancakePushAttempts: 3,
      pancakeLastAttemptAt: new Date(Date.now() - PancakeOrderService.PUSH_LEASE_MS - 5_000),
    });
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 401 khi tạo đơn', false, false, 401), true);
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.FAILED, pancakeErrorKind: 'CONFIG', pancakePushAttempts: 2 });
  });
});

describe('PancakeOrderService.markPushFailure — loại lỗi (hi)', () => {
  it('ghi loại lỗi lên đơn: tạm / bị từ chối / dữ liệu', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING });
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 503 khi tạo đơn', true, false, 503), false);
    expect(t.row().pancakeErrorKind).toBe('TRANSIENT');
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 422 khi tạo đơn: x', false, false, 422), true);
    expect(t.row().pancakeErrorKind).toBe('REJECTED');
    await t.svc.markPushFailure('o1', new PancakeOrderDataError('thiếu SĐT'), true);
    expect(t.row().pancakeErrorKind).toBe('DATA');
  });

  it('401/403 (CONFIG): ghi loại, hoàn lại lượt đã đốt, KHÔNG báo từng đơn', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakePushAttempts: 3 });
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 401 khi tạo đơn: invalid key', false, false, 401), true);
    expect(t.row()).toMatchObject({ pancakeErrorKind: 'CONFIG', pancakePushStatus: PANCAKE_PUSH.FAILED, pancakePushAttempts: 2 });
    expect(t.row().pancakeAttention ?? null).toBeNull();
    expect(t.alerts.alert).not.toHaveBeenCalled();
  });

  const forbidden = () => new PancakeApiError('Pancake trả 403 khi tạo đơn: forbidden', false, false, 403);

  const forbiddenText = `${PANCAKE_FORBIDDEN_ERROR_PREFIX}Pancake trả 403 khi tạo đơn`;
  it.each([
    [null, null, 'CONFIG', 2],
    ['CONFIG', null, 'CONFIG', 2],
    ['CONFIG_RECHECK', null, 'REJECTED', 3],
    ['REJECTED', forbiddenText, 'REJECTED', 3],
    ['REJECTED', 'Pancake trả 422 khi tạo đơn: thiếu kho', 'CONFIG', 2],
    ['REJECTED', null, 'CONFIG', 2],
  ])('401/403 khi loại trước đó là %s (lời lỗi cũ %s) → %s (lượt thử còn %s)', async (prior, priorText, expected, attempts) => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakePushAttempts: 3, pancakeErrorKind: prior, pancakeSyncError: priorText });
    await t.svc.markPushFailure('o1', forbidden(), true);
    expect(t.row()).toMatchObject({ pancakeErrorKind: expected, pancakePushAttempts: attempts });
    if (expected === 'REJECTED') expect(t.row().pancakeAttention).toEqual(expect.any(String));
    else expect(t.row().pancakeAttention ?? null).toBeNull();
  });

  it('CONFIG_RECHECK + lỗi tạm 503 → vẫn CONFIG_RECHECK (không báo trong ân hạn); rồi 403 → REJECTED', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeErrorKind: 'CONFIG_RECHECK', createdAt: new Date(), paidAt: null });
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 503 khi tạo đơn', true, false, 503), false);
    expect(t.row().pancakeErrorKind).toBe('CONFIG_RECHECK');
    expect(t.alerts.alert).not.toHaveBeenCalled();
    await t.svc.markPushFailure('o1', forbidden(), true);
    expect(t.row().pancakeErrorKind).toBe('REJECTED');
  });

  it('CONFIG_RECHECK + 429 cuối lượt → vẫn CONFIG_RECHECK, không thành CONFIG (không góp vào báo động tổng)', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeErrorKind: 'CONFIG_RECHECK' });
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 429 khi tạo đơn', true, false, 429), true);
    expect(t.row().pancakeErrorKind).toBe('CONFIG_RECHECK');
  });

  describe('bảng loại lỗi trước × lỗi mới (lỗi tạm không mang thông tin mới: giữ loại cũ và lời lỗi cũ)', () => {
    const forbiddenOld = `${PANCAKE_FORBIDDEN_ERROR_PREFIX}Pancake trả 403 cũ`;
    const priors: Array<[string, string | null, string | null]> = [
      ['trống', null, null],
      ['TRANSIENT', 'TRANSIENT', 'Pancake trả 503 cũ'],
      ['DATA', 'DATA', 'thiếu SĐT cũ'],
      ['CONFIG', 'CONFIG', 'Pancake trả 401 cũ'],
      ['CONFIG_RECHECK', 'CONFIG_RECHECK', 'Pancake trả 401 cũ'],
      ['REJECTED (422)', 'REJECTED', 'Pancake trả 422 cũ'],
      ['REJECTED (401/403)', 'REJECTED', forbiddenOld],
    ];
    const errors: Array<[string, () => unknown, string[]]> = [
      // [tên, lỗi, loại kết quả theo thứ tự các dòng priors]; keptKinds: các loại cũ được giữ nguyên lời lỗi
      ['tạm 503', () => new PancakeApiError('Pancake trả 503 mới', true, false, 503), ['TRANSIENT', 'TRANSIENT', 'TRANSIENT', 'CONFIG', 'CONFIG_RECHECK', 'REJECTED', 'REJECTED']],
      ['DATA', () => new PancakeOrderDataError('thiếu SĐT mới'), ['DATA', 'DATA', 'DATA', 'DATA', 'DATA', 'DATA', 'DATA']],
      ['từ chối 422', () => new PancakeApiError('Pancake trả 422 mới', false, false, 422), ['REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED']],
      ['401/403', () => new PancakeApiError('Pancake trả 403 mới', false, false, 403), ['CONFIG', 'CONFIG', 'CONFIG', 'CONFIG', 'REJECTED', 'CONFIG', 'REJECTED']],
    ];
    const kept = new Set(['CONFIG', 'CONFIG_RECHECK', 'REJECTED']);
    for (const [errName, mk, expectedKinds] of errors) {
      priors.forEach(([priorName, priorKind, priorText], i) => {
        it(`${priorName} × ${errName} → ${expectedKinds[i]}`, async () => {
          const t = setup({
            pancakePushStatus: PANCAKE_PUSH.PENDING,
            pancakePushAttempts: 3,
            pancakeErrorKind: priorKind,
            pancakeSyncError: priorText,
            createdAt: new Date('2020-01-01T00:00:00Z'),
            paidAt: null,
          });
          await t.svc.markPushFailure('o1', mk(), true);
          const keptPrior = errName === 'tạm 503' && priorKind !== null && kept.has(priorKind);
          expect(t.row().pancakeErrorKind).toBe(expectedKinds[i]);
          if (keptPrior) {
            // Lỗi tạm: chỉ ghi log, không đổi lời lỗi, không đổi trạng thái, không hoàn/đốt lượt, không báo thêm.
            expect(t.row()).toMatchObject({ pancakeSyncError: priorText, pancakePushStatus: PANCAKE_PUSH.PENDING, pancakePushAttempts: 3 });
            if (priorKind !== 'CONFIG_RECHECK') expect(t.row().pancakeAttention ?? null).toBeNull();
          } else {
            expect(t.row().pancakeSyncError).not.toBe(priorText);
          }
          expect(t.row().pancakePushAttempts).toBe(expectedKinds[i] === 'CONFIG' && !keptPrior ? 2 : 3);
        });
      });
    }
  });

  it('nhánh "Pancake không trả mã đơn" đi qua cùng luật: đơn đã REJECTED vì 403 giữ loại và lời lỗi, chỉ rời trạng thái PUSHING', async () => {
    const text = `${PANCAKE_FORBIDDEN_ERROR_PREFIX}Pancake trả 403 cũ`;
    const t = setup(
      { pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeErrorKind: 'REJECTED', pancakeSyncError: text },
      { client: { createOrder: jest.fn().mockResolvedValue({}) } },
    );
    await expect(t.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeApiError);
    expect(t.row()).toMatchObject({ pancakeErrorKind: 'REJECTED', pancakeSyncError: text, pancakePushStatus: PANCAKE_PUSH.PENDING });
    const fresh = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING }, { client: { createOrder: jest.fn().mockResolvedValue({}) } });
    await expect(fresh.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeApiError);
    expect(fresh.row().pancakeErrorKind).toBe('TRANSIENT');
  });

  it('đơn đã lên Pancake giữa lúc đọc và ghi (tiến trình khác đẩy xong): không ghi lỗi, không báo "Cần xử lý", không đốt hay hoàn lượt', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakePushAttempts: 3, createdAt: new Date('2020-01-01T00:00:00Z'), paidAt: null });
    const real = (t.prisma.order.updateMany as jest.Mock).getMockImplementation()!;
    (t.prisma.order.updateMany as jest.Mock).mockImplementationOnce(async (args: unknown) => {
      Object.assign(t.row(), { pancakeOrderId: 'pk-9', pancakePushStatus: PANCAKE_PUSH.SYNCED });
      return real(args);
    });
    await t.svc.markPushFailure('o1', new PancakeOrderDataError('thiếu SĐT'), true);
    expect(t.row()).toMatchObject({ pancakeOrderId: 'pk-9', pancakePushStatus: PANCAKE_PUSH.SYNCED, pancakePushAttempts: 3 });
    expect(t.row().pancakeAttention ?? null).toBeNull();
    expect(t.row().pancakeSyncError ?? null).toBeNull();
  });

  it('lần này thua tranh chấp quyền đẩy (PancakePushBusyError): không ghi TRANSIENT đè loại tiến trình kia vừa ghi', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeErrorKind: 'REJECTED', pancakeSyncError: forbiddenText });
    await t.svc.markPushFailure('o1', new PancakePushBusyError('Đơn TUBU1 đang được đẩy bởi tiến trình khác'), true);
    expect(t.row()).toMatchObject({ pancakeErrorKind: 'REJECTED', pancakeSyncError: forbiddenText, pancakePushStatus: PANCAKE_PUSH.PENDING });
  });

  it('pushOrder đọc lại loại lỗi ngay trước khi ghi: đơn vừa được thả sang CONFIG_RECHECK giữa chừng không bị ghi CONFIG', async () => {
    const holder: { row?: Record<string, unknown> } = {};
    const createOrder = jest.fn().mockImplementation(async () => {
      holder.row!.pancakeErrorKind = 'CONFIG_RECHECK';
      throw forbidden();
    });
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeErrorKind: 'CONFIG' }, { client: { createOrder } });
    holder.row = t.rows[0] as Record<string, unknown>;
    await expect(t.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeApiError);
    expect(t.row().pancakeErrorKind).toBe('REJECTED');
  });

  it('CONFIG: hoàn lượt nằm CÙNG câu updateMany ghi FAILED + CONFIG (không có trạng thái trung gian)', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakePushAttempts: 3 });
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 401 khi tạo đơn', false, false, 401), true);
    const writes = (t.prisma.order.updateMany as jest.Mock).mock.calls.map(([a]) => a.data as Record<string, unknown>);
    expect(writes.some((d) => d.pancakeErrorKind === 'CONFIG' && d.pancakePushStatus === PANCAKE_PUSH.FAILED && JSON.stringify(d.pancakePushAttempts) === '{"increment":-1}')).toBe(true);
    expect(writes.some((d) => d.pancakeErrorKind === undefined && JSON.stringify(d.pancakePushAttempts) === '{"increment":-1}')).toBe(false);
  });

  it('qua pushOrder thật: đơn CONFIG_RECHECK gặp 403 ngay trong lượt đẩy → REJECTED, lời lỗi không bị ghi đè về CONFIG', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeErrorKind: 'CONFIG_RECHECK' }, { client: { createOrder: jest.fn().mockRejectedValue(forbidden()) } });
    await expect(t.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeApiError);
    expect(t.row().pancakeErrorKind).toBe('REJECTED');
    await t.svc.markPushFailure('o1', forbidden(), true);
    expect(t.row().pancakeErrorKind).toBe('REJECTED');
  });

  it('REJECTED vì 401/403 riêng đơn: lời lỗi mang tiền tố cố định (web nhận biết, không dò chuỗi tự do); CONFIG thì không', async () => {
    const rejected = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeErrorKind: 'CONFIG_RECHECK' });
    await rejected.svc.markPushFailure('o1', forbidden(), true);
    expect(isPancakeForbiddenError(rejected.row().pancakeSyncError as string)).toBe(true);
    const config = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING });
    await config.svc.markPushFailure('o1', forbidden(), true);
    expect(isPancakeForbiddenError(config.row().pancakeSyncError as string)).toBe(false);
    const other = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeErrorKind: 'REJECTED' });
    await other.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 422 khi tạo đơn: x', false, false, 422), true);
    expect(isPancakeForbiddenError(other.row().pancakeSyncError as string)).toBe(false);
  });

  it('đánh đổi đã chấp nhận: khoá bị thu hồi SAU khi nhóm CONFIG được thả → đơn CONFIG_RECHECK nhận 401 thành REJECTED (không báo động tổng)', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeErrorKind: 'CONFIG_RECHECK' });
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 401 khi tạo đơn: invalid key', false, false, 401), true);
    expect(t.row().pancakeErrorKind).toBe('REJECTED');
  });

  it('lượt đẩy thành công xoá loại lỗi', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.FAILED, pancakeErrorKind: 'REJECTED', pancakeSyncError: 'cũ' });
    await t.svc.pushOrder('o1');
    expect(t.row()).toMatchObject({ pancakeErrorKind: null, pancakeSyncError: null });
  });

  it('BẤT KỲ lần đẩy thành công (đơn không mang CONFIG) cũng chuyển cả nhóm CONFIG sang CONFIG_RECHECK (cron thử lại, 401 lần nữa là lỗi riêng đơn)', async () => {
    const t = setup(
      { id: 'o1' },
      {},
    );
    t.rows.push({ ...t.rows[0], id: 'o2', code: 'TUBU2', pancakeErrorKind: 'CONFIG', pancakePushStatus: PANCAKE_PUSH.FAILED });
    t.rows.push({ ...t.rows[0], id: 'o3', code: 'TUBU3', pancakeErrorKind: 'REJECTED', pancakePushStatus: PANCAKE_PUSH.FAILED });
    await t.svc.pushOrder('o1');
    expect(t.row('o2').pancakeErrorKind).toBe('CONFIG_RECHECK');
    expect(t.row('o3').pancakeErrorKind).toBe('REJECTED');
  });

  it('lượt đẩy lỗi 401 ngay trong pushOrder: lượt thử không bị đốt', async () => {
    const t = setup({}, { client: { createOrder: jest.fn().mockRejectedValue(new PancakeApiError('Pancake trả 401 khi tạo đơn', false, false, 401)) } });
    await expect(t.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeApiError);
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 401 khi tạo đơn', false, false, 401), true);
    expect(t.row().pancakePushAttempts).toBe(0);
  });
});

describe('PancakeOrderService — dọn job lỗi (hi)', () => {
  const failedJob = (remove = jest.fn().mockResolvedValue(undefined)) => ({ getState: jest.fn().mockResolvedValue('failed'), remove });

  it('đẩy thành công thì gỡ job lỗi cũ của đơn', async () => {
    const job = failedJob();
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.FAILED });
    t.queue.getJob.mockResolvedValue(job);
    await t.svc.pushOrder('o1');
    expect(t.queue.getJob).toHaveBeenCalledWith('o1');
    expect(job.remove).toHaveBeenCalledTimes(1);
  });

  it('không gỡ job đang chờ/đang chạy', async () => {
    const job = { getState: jest.fn().mockResolvedValue('active'), remove: jest.fn() };
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.FAILED });
    t.queue.getJob.mockResolvedValue(job);
    await t.svc.pushOrder('o1');
    expect(job.remove).not.toHaveBeenCalled();
  });

  it('đơn đã huỷ chưa từng lên Pancake: gỡ job lỗi cũ', async () => {
    const job = failedJob();
    const t = setup({ status: 'CANCELLED' });
    t.queue.getJob.mockResolvedValue(job);
    await t.svc.pushOrder('o1');
    expect(job.remove).toHaveBeenCalledTimes(1);
  });

  it('lỗi Redis khi gỡ job không làm hỏng việc đẩy đơn', async () => {
    const t = setup();
    t.queue.getJob.mockRejectedValue(new Error('redis'));
    await expect(t.svc.pushOrder('o1')).resolves.toBe('pk-new');
  });

  it('sweepSettledFailedJobs gỡ job lỗi của đơn đã lên Pancake hoặc đã huỷ, giữ job của đơn còn mở', async () => {
    const t = setup(
      { id: 'o1', status: 'CANCELLED' },
      {
        extra: undefined,
      },
    );
    const rows = [
      { id: 'o1', status: 'CANCELLED', pancakeOrderId: null },
      { id: 'o2', status: 'CONFIRMED', pancakeOrderId: 'pk-2' },
      { id: 'o3', status: 'CONFIRMED', pancakeOrderId: null },
    ];
    const removed: string[] = [];
    const mk = (id: string) => ({ id, name: 'push', data: { orderId: id }, remove: jest.fn(async () => { removed.push(id); }) });
    const jobs = ['o1', 'o2', 'o3'].map(mk);
    const queue = { ...t.queue, getFailed: jest.fn().mockResolvedValue(jobs) };
    const prisma = { order: { findMany: jest.fn().mockResolvedValue(rows) } };
    const svc = new PancakeOrderService(prisma as never, t.client as never, queue as never, undefined, t.alerts as never);
    await expect(svc.sweepSettledFailedJobs()).resolves.toBe(2);
    expect(removed.sort()).toEqual(['o1', 'o2']);
  });
});

describe('PancakeOrderService.retryPushByAdmin (PANCAKE-9, ADMINOPS-4)', () => {
  it('đơn còn trong kho chưa lên Pancake → reset lượt + xếp job đẩy', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.FAILED, pancakePushAttempts: 5 });
    const res = await t.svc.retryPushByAdmin('admin1', 'TUBU1');
    expect(res.message).toBe('Đã xếp lệnh đẩy đơn TUBU1 sang Pancake.');
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakePushAttempts: 0 });
    expect(t.queue.added).toEqual([{ name: 'push', data: { orderId: 'o1' }, opts: { jobId: 'o1' } }]);
  });

  it.each([
    [{ status: 'CANCELLED' }, 'đã huỷ'],
    [{ status: 'DELIVERED' }, 'giao lần hai'],
    [{ pancakeOrderId: 'pk-9' }, 'đã có trên Pancake'],
    [{ paymentMethod: 'ZALOPAY', status: 'PENDING_PAYMENT' }, 'chưa thanh toán'],
    [{ pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakeLastAttemptAt: new Date() }, 'đang được đẩy'],
  ])('%j → từ chối (%s)', async (order, msg) => {
    const t = setup(order);
    const err = await t.svc.retryPushByAdmin('admin1', 'o1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain(msg);
    expect(t.queue.add).not.toHaveBeenCalled();
  });
});

describe('PancakeOrderService.retryPushByAdmin: ghi nguyên tử, không đè lượt đẩy vừa claim (hai đơn kho)', () => {
  /** Lệnh đọc đơn trả bản chụp CŨ rồi lượt khác mới ghi trạng thái: đúng khe giữa "đọc quyết định" và "đặt PENDING". */
  const changeAfterRead = (t: ReturnType<typeof setup>, change: (row: Record<string, unknown>) => void) =>
    t.prisma.order.findFirst.mockImplementationOnce(async () => {
      const snapshot = { ...t.row() };
      change(t.row());
      return snapshot;
    });

  it('lượt khác vừa claim PUSHING trong hạn thuê sau khi đọc: 409, không đặt PENDING, không đặt lại lượt, không xếp job', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.FAILED, pancakePushAttempts: 5 });
    const claimedAt = new Date();
    changeAfterRead(t, (row) => Object.assign(row, { pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakePushAttempts: 6, pancakeLastAttemptAt: claimedAt }));
    const err = await t.svc.retryPushByAdmin('admin1', 'TUBU1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe('Đơn TUBU1 đang được đẩy sang Pancake, tải lại sau ít phút.');
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakePushAttempts: 6, pancakeLastAttemptAt: claimedAt });
    expect(t.queue.add).not.toHaveBeenCalled();
  });

  it('đơn vừa lên Pancake sau khi đọc: 409 nói đã có trên Pancake, không xếp job', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.FAILED });
    changeAfterRead(t, (row) => Object.assign(row, { pancakeOrderId: 'pk-77', pancakePushStatus: PANCAKE_PUSH.SYNCED }));
    const err = await t.svc.retryPushByAdmin('admin1', 'TUBU1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toContain('#pk-77');
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.SYNCED);
    expect(t.queue.add).not.toHaveBeenCalled();
  });

  it('PUSHING đã quá hạn thuê (tiến trình đẩy đã chết): vẫn đẩy lại được', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakeLastAttemptAt: new Date(Date.now() - PancakeOrderService.PUSH_LEASE_MS - 5_000), pancakePushAttempts: 2 });
    await t.svc.retryPushByAdmin('admin1', 'TUBU1');
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakePushAttempts: 0 });
    expect(t.queue.add).toHaveBeenCalledTimes(1);
  });
});

describe('PancakeOrderService.retryPushByAdmin: nhãn phương thức trả trước', () => {
  it.each([
    ['VNPAY', 'VNPAY'],
    ['XU', 'Xu'],
    ['WALLET', 'ví Tubu'],
    ['ZALOPAY', 'ZaloPay'],
  ])('%s → nêu "%s", không gộp thành ví Tubu', async (paymentMethod, label) => {
    const t = setup({ paymentMethod, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' });
    const err = await t.svc.retryPushByAdmin('admin1', 'o1').catch((e: unknown) => e);
    expect((err as Error).message).toContain(`trả trước (${label}) chưa thanh toán`);
  });
});

describe('PancakeOrderService.syncPayment — 401/403 (hi)', () => {
  const unauthorized = () => new PancakeApiError('Pancake trả 401 khi tạo đơn: invalid api key', false, false, 401);

  it('chưa lên Pancake mà tạo đơn bị 401: ghi loại CONFIG, hoàn lượt đã đốt, không báo từng đơn', async () => {
    const t = setup({ paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', pancakePushAttempts: 2 }, { client: { createOrder: jest.fn().mockRejectedValue(unauthorized()) } });
    await expect(t.svc.syncPayment('o1')).rejects.toBeInstanceOf(PancakeApiError);
    expect(t.row()).toMatchObject({ pancakeErrorKind: 'CONFIG', pancakePushStatus: PANCAKE_PUSH.FAILED, pancakePushAttempts: 2 });
    expect(t.row().pancakeAttention ?? null).toBeNull();
    expect(t.alerts.alert).not.toHaveBeenCalled();
  });

  it('đã lên Pancake mà PUT thanh toán bị 401: báo "Cần xử lý" ngay lượt đầu (shipper có thể thu COD lần nữa), kể cả khi chưa phải lượt cuối', async () => {
    const t = setup(
      { pancakeOrderId: 'pk-1', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' },
      { client: { updateOrder: jest.fn().mockRejectedValue(new PancakeApiError('Pancake trả 403 khi cập nhật đơn', false, false, 403)) } },
    );
    await expect(t.svc.syncPayment('o1', false)).rejects.toBeInstanceOf(PancakeApiError);
    expect(t.row().pancakeAttention).toContain('Chưa báo được');
  });

  it('lỗi tạm ở lượt chưa cuối vẫn không báo (hành vi cũ)', async () => {
    const t = setup(
      { pancakeOrderId: 'pk-1', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' },
      { client: { updateOrder: jest.fn().mockRejectedValue(new PancakeApiError('Pancake trả 503', true, false, 503)) } },
    );
    await expect(t.svc.syncPayment('o1', false)).rejects.toBeInstanceOf(PancakeApiError);
    expect(t.row().pancakeAttention ?? null).toBeNull();
  });
});

describe('PancakeOrderService — đơn STALE không có đường tự động nào đẩy', () => {
  it('pushOrder trên đơn STALE (Gomdon, job push, hook khác): không gọi Pancake, không đổi trạng thái', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.client.searchOrders).not.toHaveBeenCalled();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.STALE);
  });

  it('đơn STALE vừa được thanh toán (job thanh toán): không đẩy, gắn "Cần xử lý" bảo kiểm kho rồi mới bấm Đẩy lại, job không lỗi', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE, paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' });
    await expect(t.svc.syncPayment('o1')).resolves.toBeUndefined();
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.STALE);
    expect(t.row().pancakeAttention).toContain('quá hạn tự đẩy');
    expect(t.row().pancakeAttention).toContain('Đẩy lại Pancake');
  });

  it('nhắc của đơn STALE vừa thanh toán mở đầu bằng ATTENTION_PUSH_FAILED: đẩy thành công sau "Đẩy lại" tự gỡ nhắc', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE, paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' });
    await t.svc.syncPayment('o1');
    expect(t.row().pancakeAttention).toMatch(new RegExp(`^${ATTENTION_PUSH_FAILED}`));
    await t.svc.retryPushByAdmin('admin1', 'TUBU1');
    await t.svc.pushOrder('o1');
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.SYNCED, pancakeOrderId: 'pk-new' });
    expect(t.row().pancakeAttention ?? null).toBeNull();
  });

  it('huỷ đơn STALE vừa thanh toán: đường huỷ gỡ nhắc "kiểm tra kho rồi Đẩy lại" như mọi lời nhắc đẩy lỗi', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE, paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' });
    await t.svc.syncPayment('o1');
    expect(t.row().pancakeAttention).not.toBeNull();
    t.row().status = 'CANCELLED';
    await t.svc.cancelOnPancake('o1');
    expect(t.row().pancakeAttention ?? null).toBeNull();
  });

  it('đơn STALE đã rời kho (đang giao/đã giao) rồi mới được thanh toán: không nhắc "bấm Đẩy lại" (admin không đẩy lại được, kho giao lần hai)', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE, paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', status: 'DELIVERED' });
    await expect(t.svc.syncPayment('o1')).resolves.toBeUndefined();
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.row().pancakeAttention ?? null).toBeNull();
    expect(t.alerts.alert).not.toHaveBeenCalled();
  });

  describe('lời nhắc đơn STALE vừa thanh toán theo ĐÚNG quyết định của "Đẩy lại" (một vị từ chung với retryPushByAdmin)', () => {
    const stale = { pancakePushStatus: PANCAKE_PUSH.STALE, paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' };
    const dealerItems = [{ id: 'i1', variationId: 'v1', quantity: 5, unitPrice: 70_000, backorderedQty: 3 }];
    const scenarios: Array<[string, Record<string, unknown>, 'NOW' | 'WAIT' | 'NEVER', string | null, Record<string, unknown>?]> = [
      ['cổng PUSH', stale, 'NOW', null],
      ['LEFT_WAREHOUSE (đã giao)', { ...stale, status: 'DELIVERED' }, 'NEVER', null],
      ['DEAD (đã huỷ)', { ...stale, status: 'CANCELLED' }, 'NEVER', null],
      ['MERCHANT (đối tác tự giao)', { ...stale, fulfiller: 'MERCHANT' }, 'NEVER', null],
      ['WAIT_STOCK (đại lý còn hàng đặt trước)', { ...stale, type: 'DEALER', items: dealerItems }, 'WAIT', 'đủ hàng đặt trước'],
      ['WAIT_GOMDON (chờ vận đơn Gomdon)', { ...stale, hasRecyclingPickup: true, gomdonStatus: 'CREATING' }, 'WAIT', 'vận đơn Gomdon'],
      ['WAIT_PAYMENT (trả trước chưa PAID)', { ...stale, paymentStatus: 'UNPAID' }, 'WAIT', 'khách thanh toán'],
    ];

    it.each(scenarios)('%s: admin Đẩy lại và lời nhắc cùng một quyết định', async (_name, order, kind, waiting) => {
      const t = setup(order);
      const decision = pushRetryGateDecision({ ...(t.row() as Parameters<typeof pushRetryGateDecision>[0]) });
      expect(decision.kind).toBe(kind);
      const retry = await t.svc.retryPushByAdmin('admin1', 'TUBU1').then(() => 'accepted', (e: unknown) => (e instanceof BadRequestException ? 'refused' : 'error'));
      expect(retry).toBe(kind === 'NOW' ? 'accepted' : 'refused');
      const u = setup(order);
      await expect(u.svc.syncPayment('o1')).resolves.toBeUndefined();
      expect(u.client.createOrder).not.toHaveBeenCalled();
      const text = u.row().pancakeAttention as string | null;
      if (kind === 'NEVER') {
        expect(text ?? null).toBeNull();
        return;
      }
      expect(text).toMatch(new RegExp(`^${ATTENTION_PUSH_FAILED}`));
      expect(text).toContain('kiểm tra kho đã giao tay chưa');
      if (kind === 'NOW') {
        expect(text).not.toContain('CHƯA bấm');
        expect(text).toContain('bấm "Đẩy lại Pancake"');
      } else {
        expect(text).toContain(`đang chờ ${waiting}`);
        expect(text).toContain('CHƯA bấm "Đẩy lại Pancake" lúc này');
      }
    });

    it('Pancake chưa cấu hình: admin Đẩy lại bị từ chối nên lời nhắc cũng là "chờ", không bảo bấm ngay', async () => {
      const t = setup(stale, { client: { isConfigured: jest.fn().mockReturnValue(false) } });
      await expect(t.svc.retryPushByAdmin('admin1', 'TUBU1')).rejects.toBeInstanceOf(BadRequestException);
      await t.svc.syncPayment('o1');
      expect(t.row().pancakeAttention).toMatch(new RegExp(`^${ATTENTION_PUSH_FAILED}`));
      expect(t.row().pancakeAttention).toContain('CHƯA bấm "Đẩy lại Pancake" lúc này');
      expect(t.row().pancakeAttention).toContain('cấu hình Pancake');
    });

    it('đơn đã lên Pancake: không có quyết định Đẩy lại (NEVER)', () => {
      expect(pushRetryGateDecision({ ...(setup({ pancakeOrderId: 'pk-1' }).row() as Parameters<typeof pushRetryGateDecision>[0]) }).kind).toBe('NEVER');
    });
  });

  it('"Đẩy lại" của admin vẫn đưa đơn STALE lên Pancake', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE, status: 'CONFIRMED' });
    await t.svc.retryPushByAdmin('admin1', 'TUBU1');
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.PENDING);
    await t.svc.pushOrder('o1');
    expect(t.client.createOrder).toHaveBeenCalledTimes(1);
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.SYNCED);
  });
});

describe('PancakeOrderService — STALE chỉ rời bằng đẩy thành công hoặc "Đẩy lại" của admin (mọi chỗ ghi pancakePushStatus)', () => {
  const transient = () => new PancakeApiError('Pancake trả 503 khi tạo đơn', true, false, 503);

  /** Đơn bị đánh STALE giữa lúc lượt đẩy đang bay (markStale của lượt khác): lật hàng ngay trong lệnh gọi Pancake. */
  const staleDuringCreate = (t: ReturnType<typeof setup>, outcome: () => unknown) =>
    t.client.createOrder.mockImplementation(async () => {
      t.row().pancakePushStatus = PANCAKE_PUSH.STALE;
      return outcome();
    });

  it('lượt đang bay gặp lỗi tạm sau khi đơn thành STALE: vẫn STALE (loại và lời lỗi vẫn ghi), không về PENDING', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING });
    staleDuringCreate(t, () => {
      throw transient();
    });
    await expect(t.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeApiError);
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.STALE, pancakeErrorKind: 'TRANSIENT' });
    expect(t.row().pancakeSyncError).toContain('503');
    // Job BullMQ thử lại: đơn STALE không có đường tự động nào, không gọi Pancake lần hai.
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.client.createOrder).toHaveBeenCalledTimes(1);
  });

  it('lỗi dứt khoát (422) sau khi đơn thành STALE: vẫn STALE, mốc "đã gửi lệnh tạo" vẫn được gỡ', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING });
    staleDuringCreate(t, () => {
      throw new PancakeApiError('Pancake trả 422 khi tạo đơn: x', false, false, 422);
    });
    await expect(t.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeApiError);
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.STALE, pancakeErrorKind: 'REJECTED', pancakePushClaimedAt: null });
  });

  it('nhánh "Pancake không trả mã đơn" sau khi đơn thành STALE: vẫn STALE', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING });
    staleDuringCreate(t, () => ({}));
    await expect(t.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeApiError);
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.STALE);
  });

  it('lỗi tạm gặp loại cũ cần giữ (REJECTED) trên đơn STALE: không ghi lời lỗi, vẫn STALE', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeErrorKind: 'REJECTED', pancakeSyncError: 'Pancake trả 422 cũ' });
    staleDuringCreate(t, () => {
      throw transient();
    });
    await expect(t.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeApiError);
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.STALE, pancakeErrorKind: 'REJECTED', pancakeSyncError: 'Pancake trả 422 cũ' });
  });

  it('markPushFailure(final) trên đơn STALE: không ghi FAILED đè STALE, loại lỗi vẫn ghi', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE });
    await t.svc.markPushFailure('o1', new PancakeOrderDataError('thiếu SĐT'), true);
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.STALE, pancakeErrorKind: 'DATA' });
  });

  describe('markPushFailure trên đơn STALE: lời nhắc theo ĐÚNG quyết định "Đẩy lại", không bị câu "hệ thống tự thử lại" đè', () => {
    const dataErr = () => new PancakeOrderDataError('thiếu SĐT');
    const transientErr = () => new PancakeApiError('Pancake trả 503 khi tạo đơn', true, false, 503);
    const retryClaims = /tự hỏi lại|tự thử lại/;

    it('lỗi dứt khoát lượt cuối (cổng PUSH): vẫn STALE, nhắc kiểm kho rồi mới bấm Đẩy lại, không nói "vẫn tự hỏi lại"', async () => {
      const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE });
      await t.svc.markPushFailure('o1', dataErr(), true);
      const text = t.row().pancakeAttention as string;
      expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.STALE);
      expect(text).toMatch(new RegExp(`^${ATTENTION_PUSH_FAILED}`));
      expect(text).toContain('quá hạn tự đẩy');
      expect(text).toContain('thiếu SĐT');
      expect(text).toContain('kiểm tra kho đã giao tay chưa');
      expect(text).not.toContain('CHƯA bấm');
      expect(text).not.toMatch(retryClaims);
    });

    it('lỗi tạm quá ân hạn lượt cuối: cùng câu STALE, không "Hệ thống tự thử lại mỗi 15 phút"', async () => {
      const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE });
      await t.svc.markPushFailure('o1', transientErr(), true);
      const text = t.row().pancakeAttention as string;
      expect(text).toContain('quá hạn tự đẩy');
      expect(text).toContain('kiểm tra kho đã giao tay chưa');
      expect(text).not.toMatch(retryClaims);
    });

    it('lời nhắc của syncPayment trên đơn STALE không bị lượt đang bay lỗi muộn đổi thành câu "tự thử lại"', async () => {
      const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE, paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' });
      await t.svc.syncPayment('o1');
      await t.svc.markPushFailure('o1', dataErr(), true);
      expect(t.row().pancakeAttention).toContain('quá hạn tự đẩy');
      expect(t.row().pancakeAttention).not.toMatch(retryClaims);
    });

    it('đơn đang chờ khách thanh toán (WAIT): nói chờ gì và CHƯA bấm Đẩy lại', async () => {
      const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE, paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID' });
      await t.svc.markPushFailure('o1', dataErr(), true);
      const text = t.row().pancakeAttention as string;
      expect(text).toContain('đang chờ khách thanh toán');
      expect(text).toContain('CHƯA bấm "Đẩy lại Pancake" lúc này');
      expect(text).not.toMatch(retryClaims);
    });

    it('đơn đã rời kho (NEVER): không gắn nhắc nào, nhắc có sẵn còn nguyên, không báo admin', async () => {
      const prior = `${ATTENTION_PUSH_FAILED} (quá hạn tự đẩy): nhắc cũ`;
      const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE, status: 'DELIVERED', pancakeAttention: prior });
      await t.svc.markPushFailure('o1', dataErr(), true);
      expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.STALE, pancakeErrorKind: 'DATA', pancakeAttention: prior });
      expect(t.alerts.alert).not.toHaveBeenCalled();
    });

    it('đơn không STALE vẫn nhận lời cũ "tự hỏi lại" (không đổi hành vi)', async () => {
      const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING });
      await t.svc.markPushFailure('o1', dataErr(), true);
      expect(t.row().pancakeAttention).toContain('vẫn tự hỏi lại');
      expect(t.row().pancakeAttention).not.toContain('quá hạn tự đẩy');
    });
  });

  describe('câu ghi thứ hai (bỏ trường trạng thái) chỉ chạy khi câu đầu hụt VÌ đơn STALE', () => {
    /** Câu ghi đầu hụt vì lượt khác đang giữ quyền đẩy (PUSHING trong hạn thuê); ngay sau đó lượt kia nhả quyền (về PENDING). */
    const holderReleasesAfterFirstWrite = (t: ReturnType<typeof setup>) => {
      const real = t.prisma.order.updateMany.getMockImplementation()!;
      t.prisma.order.updateMany.mockImplementationOnce(async (args: Parameters<typeof real>[0]) => {
        const r = await real(args);
        t.row().pancakePushStatus = PANCAKE_PUSH.PENDING;
        return r;
      });
    };

    it('câu đầu hụt vì lease (không phải STALE), lượt kia nhả quyền ngay sau: không ghi gì, written=false → không báo, không FAILED', async () => {
      const t = setup({ pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakeLastAttemptAt: new Date() });
      holderReleasesAfterFirstWrite(t);
      await t.svc.markPushFailure('o1', new PancakeOrderDataError('thiếu SĐT'), true);
      expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.PENDING);
      expect([t.row().pancakeErrorKind ?? null, t.row().pancakeSyncError ?? null, t.row().pancakeAttention ?? null]).toEqual([null, null, null]);
      expect(t.alerts.alert).not.toHaveBeenCalled();
    });

    it('lỗi 401 trên đơn đang PUSHING trong hạn thuê: không ghi, không hoàn lượt, không báo', async () => {
      const t = setup({ pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakeLastAttemptAt: new Date(), pancakePushAttempts: 3 });
      await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 401 khi tạo đơn', false, false, 401), true);
      expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakePushAttempts: 3 });
      expect(t.row().pancakeErrorKind ?? null).toBeNull();
      expect(t.alerts.alert).not.toHaveBeenCalled();
    });

    it('câu đầu hụt VÌ đơn STALE: câu thứ hai vẫn ghi loại lỗi và lời lỗi (không trạng thái)', async () => {
      const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE });
      await t.svc.markPushFailure('o1', new PancakeOrderDataError('thiếu SĐT'), true);
      expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.STALE, pancakeErrorKind: 'DATA' });
      expect(t.row().pancakeSyncError).toContain('thiếu SĐT');
    });
  });

  it('lượt lỗi: đơn lên Pancake giữa lúc đọc và lúc gắn nhắc → không còn "Chưa đẩy được…" nằm lại, không báo admin', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING });
    const real = t.prisma.order.findUnique.getMockImplementation()!;
    // Lệnh đọc của failureReminder (có include) trả bản chụp CŨ rồi đơn mới lên Pancake (saveCreated).
    t.prisma.order.findUnique.mockImplementation(async (args: Parameters<typeof real>[0] & { include?: unknown }) => {
      const snapshot = await real(args);
      if (args.include) Object.assign(t.row(), { pancakeOrderId: 'pk-1', pancakePushStatus: PANCAKE_PUSH.SYNCED });
      return snapshot;
    });
    await t.svc.markPushFailure('o1', new PancakeOrderDataError('thiếu SĐT'), true);
    expect(t.row()).toMatchObject({ pancakeOrderId: 'pk-1', pancakePushStatus: PANCAKE_PUSH.SYNCED });
    expect(t.row().pancakeAttention ?? null).toBeNull();
    expect(t.alerts.alert).not.toHaveBeenCalled();
  });

  it('markPushFailure(final) trên đơn STALE gặp 401: vẫn hoàn lượt đã đốt và vẫn STALE', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE, pancakePushAttempts: 3 });
    await t.svc.markPushFailure('o1', new PancakeApiError('Pancake trả 401 khi tạo đơn', false, false, 401), true);
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.STALE, pancakeErrorKind: 'CONFIG', pancakePushAttempts: 2 });
  });

  it('markPushFailure trên đơn không STALE vẫn ghi FAILED như cũ', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING });
    await t.svc.markPushFailure('o1', new PancakeOrderDataError('thiếu SĐT'), true);
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.FAILED);
  });

  it('đơn STALE đã huỷ (cổng DEAD): không ghi SKIPPED đè STALE', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE, status: 'CANCELLED' });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.STALE);
  });

  it('đơn STALE trả trước chưa thanh toán (cổng WAIT_PAYMENT): không ghi WAITING_PAYMENT đè STALE', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE, paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID' });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.STALE);
  });

  it('Pancake chưa cấu hình, đơn thành STALE giữa lúc đọc và ghi: không ghi NOT_CONFIGURED đè STALE', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING });
    t.client.isConfigured.mockImplementation(() => {
      t.row().pancakePushStatus = PANCAKE_PUSH.STALE;
      return false;
    });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.STALE);
  });

  it('đẩy thành công và "Đẩy lại" của admin vẫn là hai đường rời STALE', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.STALE });
    await t.svc.retryPushByAdmin('admin1', 'TUBU1');
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.PENDING);
    staleDuringCreate(t, () => ({ id: 'pk-77' }));
    await t.svc.pushOrder('o1');
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.SYNCED, pancakeOrderId: 'pk-77' });
  });
});

describe('PancakeOrderService.pushOrder: câu ghi trạng thái của cổng/cấu hình không đè lượt đẩy đang giữ quyền (PUSHING trong hạn thuê)', () => {
  /** Lệnh đọc đơn trả bản chụp CŨ rồi lượt khác claim PUSHING (job thanh toán đang gọi createOrder): khe giữa "đọc cổng" và "ghi trạng thái". */
  const claimedAfterRead = (t: ReturnType<typeof setup>, claimedAt: Date) =>
    t.prisma.order.findUniqueOrThrow.mockImplementationOnce(async () => {
      const snapshot = { ...t.row() };
      Object.assign(t.row(), { pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakeLastAttemptAt: claimedAt, pancakePushAttempts: 1 });
      return snapshot;
    });

  const gates: Array<[string, Record<string, unknown>]> = [
    ['WAIT_PAYMENT', { paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID' }],
    ['WAIT_STOCK', { type: 'DEALER', items: [{ id: 'i1', variationId: 'v1', quantity: 5, unitPrice: 70_000, backorderedQty: 3 }] }],
    ['DEAD', { status: 'CANCELLED' }],
  ];

  it.each(gates)('cổng %s: lượt khác vừa claim PUSHING sau khi đọc → không ghi đè, lượt đang bay tự quyết kết cục', async (_gate, order) => {
    const t = setup(order);
    const claimedAt = new Date();
    claimedAfterRead(t, claimedAt);
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakeLastAttemptAt: claimedAt });
    expect(t.client.createOrder).not.toHaveBeenCalled();
  });

  it('Pancake chưa cấu hình: lượt khác vừa claim PUSHING giữa lúc đọc và ghi → không ghi NOT_CONFIGURED đè', async () => {
    const t = setup({ pancakePushStatus: PANCAKE_PUSH.PENDING });
    t.client.isConfigured.mockImplementation(() => {
      Object.assign(t.row(), { pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakeLastAttemptAt: new Date() });
      return false;
    });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.PUSHING);
    expect(t.row().pancakeSyncError).toBeNull();
  });

  it('PUSHING đã quá hạn thuê (tiến trình đẩy chết): cổng vẫn ghi được trạng thái chờ', async () => {
    const t = setup({ paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID' });
    claimedAfterRead(t, new Date(Date.now() - PancakeOrderService.PUSH_LEASE_MS - 5_000));
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.WAITING_PAYMENT);
  });
});

describe('PancakeOrderService.syncPayment', () => {
  it('đơn đã lên Pancake lúc chờ chuyển khoản, nay PAID → PUT transfer_money = tổng, cod = 0', async () => {
    const t = setup({ pancakeOrderId: 'pk-1', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });
    await t.svc.syncPayment('o1');
    expect(t.client.updateOrder).toHaveBeenCalledWith(
      'pk-1',
      expect.objectContaining({ transfer_money: 230_000, cod: 0 }),
    );
    expect(tagNames(t.client.updateOrder.mock.calls[0]![1].tags)).toEqual(['MINIAPP', 'RETAIL', 'DA_THANH_TOAN']);
    expect(t.row().pancakePaymentSynced).toBe(true);
  });

  it('chưa lên Pancake (ZaloPay chờ tiền) → đẩy đơn mới, body đã mang "đã thanh toán"', async () => {
    const t = setup({ paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' });
    await t.svc.syncPayment('o1');
    expect(t.body()).toMatchObject({ transfer_money: 230_000, cod: 0 });
  });

  it('lỗi ở lần cuối → "Cần xử lý Pancake" (shipper có thể thu tiền lần nữa)', async () => {
    const t = setup(
      { pancakeOrderId: 'pk-1', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' },
      { client: { updateOrder: jest.fn().mockRejectedValue(new PancakeApiError('Pancake 500', true)) } },
    );
    await expect(t.svc.syncPayment('o1', true)).rejects.toThrow('Pancake 500');
    expect(t.row().pancakeAttention).toContain('không thu COD');
    expect(t.row().pancakePaymentSynced).toBe(false);
  });

  it('ghi chú giao hàng của khách có trong body tạo đơn và vẫn giữ khi PUT lại note lúc đã thanh toán (R2-PANCAKE-2)', async () => {
    const created = setup({ paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', note: 'Để ở bảo vệ' });
    await created.svc.syncPayment('o1');
    expect(created.body().note).toContain('Khách dặn: Để ở bảo vệ');

    const updated = setup({ pancakeOrderId: 'pk-1', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', note: 'Để ở bảo vệ' });
    await updated.svc.syncPayment('o1');
    expect(updated.client.updateOrder).toHaveBeenCalledWith('pk-1', expect.objectContaining({ note: expect.stringContaining('Khách dặn: Để ở bảo vệ') }));
  });

  it('đã đồng bộ / đơn COD chưa trả → không gọi Pancake', async () => {
    const a = setup({ pancakeOrderId: 'pk-1', paymentMethod: 'WALLET', paymentStatus: 'PAID', pancakePaymentSynced: true });
    await a.svc.syncPayment('o1');
    const b = setup({ pancakeOrderId: 'pk-1' });
    await b.svc.syncPayment('o1');
    expect(a.client.updateOrder).not.toHaveBeenCalled();
    expect(b.client.updateOrder).not.toHaveBeenCalled();
  });
});

describe('PancakeOrderService — đơn đại lý còn hàng đặt trước chưa lên kho (R1)', () => {
  const backordered = {
    type: 'DEALER',
    paymentMethod: 'BANK_TRANSFER',
    paymentStatus: 'PAID',
    items: [
      { id: 'i1', variationId: 'v1', quantity: 5, unitPrice: 40_000, backorderedQty: 3 },
      { id: 'i2', variationId: 'v2', quantity: 1, unitPrice: 30_000, backorderedQty: 0 },
    ],
  };

  it('admin xác nhận chuyển khoản (syncPayment) khi còn thiếu hàng → KHÔNG tạo đơn Pancake, WAITING_STOCK', async () => {
    const t = setup(backordered);
    await t.svc.syncPayment('o1');
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.client.searchOrders).not.toHaveBeenCalled();
    expect(t.row()).toMatchObject({ pancakeOrderId: null, pancakePushStatus: PANCAKE_PUSH.WAITING_STOCK, pancakePushClaimedAt: null });
  });

  it('job push / cron với đơn còn thiếu hàng → không đẩy', async () => {
    const t = setup({ ...backordered, paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' });
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.WAITING_STOCK);
  });

  it('"Đẩy lại Pancake" của admin với đơn còn thiếu hàng → từ chối, không xếp job', async () => {
    const t = setup(backordered);
    const err = await t.svc.retryPushByAdmin('admin1', 'o1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe('Đơn TUBU1 còn hàng đặt trước chưa về đủ — hệ thống tự đẩy sang kho khi đủ hàng.');
    expect(t.queue.add).not.toHaveBeenCalled();
  });

  it('đã lấp đủ hàng (backorderedQty = 0) → đẩy bình thường', async () => {
    const t = setup({ ...backordered, items: backordered.items.map((i) => ({ ...i, backorderedQty: 0 })) });
    await t.svc.syncPayment('o1');
    expect(t.client.createOrder).toHaveBeenCalledTimes(1);
    expect(t.row().pancakeOrderId).toBe('pk-new');
  });

  it('đơn lẻ (không phải đại lý) có backorderedQty lạ → vẫn đẩy (chỉ đơn đại lý được đặt trước)', async () => {
    const t = setup({ items: [{ id: 'i1', variationId: 'v1', quantity: 2, unitPrice: 100_000, backorderedQty: 1 }] });
    await t.svc.pushOrder('o1');
    expect(t.client.createOrder).toHaveBeenCalledTimes(1);
  });
});

describe('PancakeOrderService.cancelOnPancake (PANCAKE-2, D1)', () => {
  it('đơn Pancake còn mới → PUT status 6, CANCELLED, gỡ cờ chờ huỷ', async () => {
    const t = setup({ status: 'CANCELLED', pancakeOrderId: 'pk-1', pancakeCancelStatus: 'PENDING', pancakeAttention: 'Đã huỷ ở Tubu nhưng CHƯA huỷ được trên Pancake (x)' });
    await t.svc.cancelOnPancake('o1');
    expect(t.client.updateOrder).toHaveBeenCalledWith('pk-1', { status: 6 }, {});
    expect(t.row()).toMatchObject({ pancakeCancelStatus: PANCAKE_CANCEL.CANCELLED, pancakeAttention: null });
  });

  it('Pancake đã gửi hàng → TOO_LATE + báo admin chặn giao, không PUT', async () => {
    const t = setup({ status: 'CANCELLED', pancakeOrderId: 'pk-1' }, { client: { getOrder: jest.fn().mockResolvedValue({ id: 'pk-1', status: 2 }) } });
    await t.svc.cancelOnPancake('o1');
    expect(t.client.updateOrder).not.toHaveBeenCalled();
    expect(t.row().pancakeCancelStatus).toBe(PANCAKE_CANCEL.TOO_LATE);
    expect(t.row().pancakeAttention).toContain('đã bàn giao vận chuyển');
  });

  it('chỉ có mốc (không id) → tra theo mã; không thấy → NOT_FOUND', async () => {
    const t = setup({ status: 'CANCELLED', pancakePushClaimedAt: new Date() });
    await t.svc.cancelOnPancake('o1');
    expect(t.row()).toMatchObject({ pancakeCancelStatus: PANCAKE_CANCEL.NOT_FOUND, pancakePushClaimedAt: null });
  });

  it('huỷ xong (đơn không có trên Pancake) → tự gỡ lý do "Cần xử lý Pancake" của chiều đẩy/huỷ/thanh toán (R2-ADMINOPS-5)', async () => {
    for (const reason of [
      'Chưa đẩy được đơn sang Pancake (kho chưa thấy đơn): 500',
      'Đã huỷ ở Tubu nhưng CHƯA huỷ được trên Pancake (đơn Pancake #chưa rõ): timeout',
    ]) {
      const never = setup({ status: 'CANCELLED', pancakeAttention: reason, pancakeAttentionAt: new Date() });
      await never.svc.cancelOnPancake('o1');
      expect(never.row()).toMatchObject({ pancakeCancelStatus: PANCAKE_CANCEL.NOT_FOUND, pancakeAttention: null, pancakeAttentionAt: null });

      const searched = setup({ status: 'CANCELLED', pancakePushClaimedAt: new Date(), pancakeAttention: reason, pancakeAttentionAt: new Date() });
      await searched.svc.cancelOnPancake('o1');
      expect(searched.row()).toMatchObject({ pancakeCancelStatus: PANCAKE_CANCEL.NOT_FOUND, pancakeAttention: null });
    }
  });

  it('huỷ xong không gỡ lý do do người/webhook ghi (vd. đơn trùng trên Pancake)', async () => {
    const t = setup({ status: 'CANCELLED', pancakeAttention: 'Pancake có 2 đơn mang mã TUBU1', pancakeAttentionAt: new Date() });
    await t.svc.cancelOnPancake('o1');
    expect(t.row().pancakeAttention).toBe('Pancake có 2 đơn mang mã TUBU1');
  });

  it('chưa từng lên Pancake → NOT_FOUND, không gọi Pancake', async () => {
    const t = setup({ status: 'CANCELLED' });
    await t.svc.cancelOnPancake('o1');
    expect(t.client.getOrder).not.toHaveBeenCalled();
    expect(t.row().pancakeCancelStatus).toBe(PANCAKE_CANCEL.NOT_FOUND);
  });

  it('mất kết nối ở lần cuối → FAILED + "HUỶ TAY"', async () => {
    const t = setup({ status: 'CANCELLED', pancakeOrderId: 'pk-1' }, { client: { getOrder: jest.fn().mockRejectedValue(new PancakeApiError('ECONNRESET', true)) } });
    await expect(t.svc.cancelOnPancake('o1', true)).rejects.toThrow('ECONNRESET');
    expect(t.row().pancakeCancelStatus).toBe(PANCAKE_CANCEL.FAILED);
    expect(t.row().pancakeAttention).toContain('HUỶ TAY');
  });

  it('SYNC-5: Pancake từ chối lệnh huỷ dứt khoát → FAILED + "HUỶ TAY" ngay lượt đầu, lý do mang dấu từ chối để cron hỏi lại thưa', async () => {
    const getOrder = jest.fn().mockResolvedValue({ id: 'pk-1', status: 1 });
    const updateOrder = jest.fn().mockRejectedValue(new PancakeApiError('Pancake trả 400 khi huỷ: đơn đã xuất kho', false));
    const t = setup({ status: 'CANCELLED', pancakeOrderId: 'pk-1' }, { client: { getOrder, updateOrder } });
    await expect(t.svc.cancelOnPancake('o1', false)).rejects.toBeInstanceOf(PancakeCancelRefusedError);
    expect(t.row().pancakeCancelStatus).toBe(PANCAKE_CANCEL.FAILED);
    expect(t.row().pancakeSyncError).toMatch(new RegExp(`^${PANCAKE_CANCEL_REFUSED_PREFIX}`));
    expect(t.row().pancakeAttention).toContain('HUỶ TAY');
  });

  it('SYNC-5: mất kết nối ở lượt chưa cuối → vẫn PENDING, lý do KHÔNG mang dấu từ chối (cron thử lại 15 phút một lần)', async () => {
    const t = setup({ status: 'CANCELLED', pancakeOrderId: 'pk-1' }, { client: { getOrder: jest.fn().mockRejectedValue(new PancakeApiError('ECONNRESET', true)) } });
    await expect(t.svc.cancelOnPancake('o1', false)).rejects.toThrow('ECONNRESET');
    expect(t.row().pancakeCancelStatus).not.toBe(PANCAKE_CANCEL.FAILED);
    expect(t.row().pancakeSyncError).not.toContain(PANCAKE_CANCEL_REFUSED_PREFIX);
  });

  it('đã chốt (CANCELLED) → bỏ qua', async () => {
    const t = setup({ status: 'CANCELLED', pancakeOrderId: 'pk-1', pancakeCancelStatus: 'CANCELLED' });
    await t.svc.cancelOnPancake('o1');
    expect(t.client.getOrder).not.toHaveBeenCalled();
  });
});

describe('PancakeOrderService — xếp job (PLATFORM-1)', () => {
  function svcWith(queue: Record<string, unknown>) {
    return new PancakeOrderService({} as unknown as PrismaService, {} as unknown as PancakeClient, { name: 'q', ...queue } as never);
  }

  it('add job push với jobId = orderId', async () => {
    const add = jest.fn().mockResolvedValue({});
    await svcWith({ add, getJob: jest.fn().mockResolvedValue(null) }).enqueuePush('o1');
    expect(add).toHaveBeenCalledWith('push', { orderId: 'o1' }, { jobId: 'o1' });
  });

  it.each(['completed', 'failed'])('job cũ %s → xoá rồi add lại (đơn đặt lúc Pancake chưa cấu hình không kẹt)', async (state) => {
    const calls: string[] = [];
    const remove = jest.fn(async () => { calls.push('remove'); });
    const add = jest.fn(async () => { calls.push('add'); return {}; });
    await svcWith({ add, getJob: jest.fn().mockResolvedValue({ getState: jest.fn().mockResolvedValue(state), remove }) }).enqueuePush('o1');
    expect(calls).toEqual(['remove', 'add']);
  });

  it('job đang chạy → không xoá', async () => {
    const remove = jest.fn();
    await svcWith({ add: jest.fn().mockResolvedValue({}), getJob: jest.fn().mockResolvedValue({ getState: jest.fn().mockResolvedValue('active'), remove }) }).enqueuePush('o1');
    expect(remove).not.toHaveBeenCalled();
  });

  it('job huỷ / thanh toán có jobId riêng (không dính dedupe của job push)', async () => {
    const add = jest.fn().mockResolvedValue({});
    const svc = svcWith({ add, getJob: jest.fn().mockResolvedValue(null) });
    await svc.enqueueCancel('o1');
    await svc.enqueuePayment('o1');
    expect(add.mock.calls).toEqual([
      ['cancel', { orderId: 'o1' }, { jobId: 'cancel-o1' }],
      ['payment', { orderId: 'o1' }, { jobId: 'payment-o1' }],
    ]);
  });

  it('không đọc được trạng thái job (redis chớp) → vẫn add', async () => {
    const add = jest.fn().mockResolvedValue({});
    await expect(svcWith({ add, getJob: jest.fn().mockRejectedValue(new Error('redis down')) }).enqueuePush('o1')).resolves.toBeUndefined();
    expect(add).toHaveBeenCalled();
  });

  it('Redis treo → QueueTimeoutError sau hạn chờ để checkout trả đơn ngay', async () => {
    jest.useFakeTimers();
    try {
      const svc = svcWith({ add: jest.fn(() => new Promise(() => undefined)), getJob: jest.fn(() => new Promise(() => undefined)) });
      const settled = expect(svc.enqueuePush('o1')).rejects.toBeInstanceOf(QueueTimeoutError);
      await jest.advanceTimersByTimeAsync(QUEUE_COMMAND_TIMEOUT_MS);
      await settled;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('PancakeOrderService — note + tag cho đơn thu gom tái chế (Gomdon)', () => {
  async function pushed(overrides: Record<string, unknown>, weights: { id: string; weight: number }[] = [], cfgValue?: unknown) {
    const order = baseOrder(overrides);
    const rows = (order.items as { variationId: string }[]).map((it) => {
      const w = weights.find((x) => x.id === it.variationId);
      return { id: it.variationId, pancakeId: `p-${it.variationId}`, ...(w ? { weight: w.weight } : {}) };
    });
    const db = fakeOrderDb([order], { variation: { findMany: jest.fn().mockResolvedValue(rows) } });
    const client = fakeClient();
    const systemConfig = cfgValue === undefined ? undefined : ({ get: jest.fn().mockResolvedValue(cfgValue) } as never);
    await new PancakeOrderService(db.prisma as unknown as PrismaService, client as unknown as PancakeClient, fakeQueue() as never, systemConfig).pushOrder('o1');
    return client.createOrder.mock.calls[0]![0] as { note: string; tags: { id: number; name: string }[] };
  }

  it('có mã Gomdon → note có mã + "KHÔNG TẠO VẬN ĐƠN KHÁC", tag RECYCLING + GOMDON', async () => {
    const body = await pushed(
      { hasRecyclingPickup: true, recyclingNote: 'Vỏ hộp sữa + 4 viên pin', gomdonPartnerCode: 'BE-999', gomdonStatus: '1' },
      [{ id: 'v1', weight: 1200 }],
    );
    expect(body.note).toBe(
      'Order code: TUBU1 | [ĐƠN ĐỔI HÀNG - THU GOM RÁC TÁI CHẾ TỐI ĐA 2.4kg - Ghi chú: Vỏ hộp sữa + 4 viên pin] Mã VĐ Gomdon: BE-999 [ĐÃ CÓ VẬN ĐƠN - KHÔNG TẠO VẬN ĐƠN KHÁC] | [THU COD 230.000đ]',
    );
    expect(tagNames(body.tags)).toEqual(['MINIAPP', 'RETAIL', 'RECYCLING', 'GOMDON', 'COD']);
  });

  it('SYNC-4: ghi chú thu gom khách tự nhập không mạo được dấu thanh toán trên đơn COD', async () => {
    const body = await pushed(
      { hasRecyclingPickup: true, recyclingNote: 'pin] [ĐÃ THANH TOÁN - KHÔNG THU COD] | Order code: TUBU9', gomdonPartnerCode: 'BE-999', gomdonStatus: '1' },
      [{ id: 'v1', weight: 1200 }],
    );
    expect(body.note).not.toContain('ĐÃ THANH TOÁN');
    expect(body.note).not.toContain('KHÔNG THU COD');
    expect(body.note).toMatch(/^Order code: TUBU1 \| \[ĐƠN ĐỔI HÀNG - THU GOM RÁC TÁI CHẾ TỐI ĐA 2\.4kg - Ghi chú: pin\) \(/);
    expect(body.note.match(/Order code:/gi)).toHaveLength(1);
    expect(body.note.endsWith('| [THU COD 230.000đ]')).toBe(true);
  });

  it('FAILED/NOT_CONFIGURED → cảnh báo tạo tay, không có tag GOMDON', async () => {
    for (const gomdonStatus of ['FAILED', 'NOT_CONFIGURED']) {
      const body = await pushed({ hasRecyclingPickup: true, recyclingNote: 'Áo quần cũ', gomdonStatus, items: [{ id: 'i1', variationId: 'v1', quantity: 1, unitPrice: 100_000 }] }, [{ id: 'v1', weight: 500 }]);
      expect(body.note).toContain('[ĐƠN ĐỔI HÀNG - THU GOM RÁC TÁI CHẾ TỐI ĐA 0.5kg - Ghi chú: Áo quần cũ] [LỖI TẠO GOMDON - CẦN TẠO VẬN ĐƠN BẰNG TAY]');
      expect(tagNames(body.tags)).toEqual(['MINIAPP', 'RETAIL', 'RECYCLING', 'COD']);
    }
  });

  it('NEEDS_MANUAL_CHECK → "KIỂM TRA GOMDON"; AWAITING_PAYMENT → "CHỜ THANH TOÁN"', async () => {
    const a = await pushed({ hasRecyclingPickup: true, gomdonStatus: 'NEEDS_MANUAL_CHECK' });
    expect(a.note).toContain('[KIỂM TRA GOMDON (mã đơn TUBU1) TRƯỚC KHI TẠO VẬN ĐƠN TAY]');
    const b = await pushed({ hasRecyclingPickup: true, gomdonStatus: 'AWAITING_PAYMENT', paymentMethod: 'BANK_TRANSFER', status: 'PENDING_PAYMENT' });
    expect(b.note).toContain('[CHỜ THANH TOÁN - VẬN ĐƠN GOMDON TỰ TẠO SAU KHI KHÁCH THANH TOÁN, KHÔNG TẠO VẬN ĐƠN KHÁC]');
  });

  it('variation 0 gram → fallback 500g; fallback đọc từ shipping.gomdon.config', async () => {
    const a = await pushed({ hasRecyclingPickup: true, gomdonPartnerCode: 'BE-7' }, [{ id: 'v1', weight: 0 }]);
    expect(a.note).toContain('TỐI ĐA 1.0kg');
    const b = await pushed({ hasRecyclingPickup: true, gomdonPartnerCode: 'BE-7' }, [{ id: 'v1', weight: 0 }], { defaultWeightFallback: 800 });
    expect(b.note).toContain('TỐI ĐA 1.6kg');
  });
});

describe('PancakeOrderService — đơn thu gom: Pancake chờ vận đơn Gomdon, ghi chú luôn mang mã vận đơn (R2-GOMDON-1)', () => {
  const recycling = { hasRecyclingPickup: true, recyclingNote: 'Pin cũ' };

  it.each([
    ['ZaloPay vừa trả, Gomdon còn AWAITING_PAYMENT', { paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', gomdonStatus: 'AWAITING_PAYMENT' }],
    ['Ví đã trả, Gomdon đang CREATING', { paymentMethod: 'WALLET', paymentStatus: 'PAID', gomdonStatus: 'CREATING' }],
    ['COD, Gomdon chưa chạy (null)', { gomdonStatus: null }],
  ])('%s → job thanh toán/đẩy KHÔNG tạo đơn Pancake (Gomdon tự đẩy sau khi có mã)', async (_label, over) => {
    const t = setup({ ...recycling, ...over });
    await t.svc.syncPayment('o1');
    expect(await t.svc.pushOrder('o1')).toBeNull();
    expect(t.client.createOrder).not.toHaveBeenCalled();
  });

  it('chuyển khoản CHƯA trả, Gomdon AWAITING_PAYMENT → vẫn đẩy ngay (Pancake đối soát CK) với ghi chú chờ thanh toán', async () => {
    const t = setup({ ...recycling, paymentMethod: 'BANK_TRANSFER', status: 'PENDING_PAYMENT', gomdonStatus: 'AWAITING_PAYMENT' });
    await t.svc.pushOrder('o1');
    expect(t.body().note).toContain('CHỜ THANH TOÁN - VẬN ĐƠN GOMDON TỰ TẠO');
  });

  it('admin "Đẩy lại Pancake" khi đơn thu gom đang chờ vận đơn → từ chối, nói rõ hệ thống tự đẩy', async () => {
    const t = setup({ ...recycling, paymentMethod: 'ZALOPAY', paymentStatus: 'PAID', gomdonStatus: 'CREATING' });
    await expect(t.svc.retryPushByAdmin('admin1', 'o1')).rejects.toThrow(/đang chờ tạo vận đơn Gomdon/);
  });

  it('syncWaybillNote: đơn đã lên Pancake, vừa có vận đơn → PUT note có mã + tag GOMDON, giữ lời dặn khách; đã trả thì kèm cod 0', async () => {
    const t = setup({
      ...recycling,
      note: 'Gọi trước',
      pancakeOrderId: 'pk-1',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      gomdonPartnerCode: 'BE-9105',
      gomdonOrderId: '9105',
      gomdonStatus: '1',
    });
    await t.svc.syncWaybillNote('o1');
    const [id, payload] = t.client.updateOrder.mock.calls[0]!;
    expect(id).toBe('pk-1');
    expect(payload.note).toContain('Mã VĐ Gomdon: BE-9105 [ĐÃ CÓ VẬN ĐƠN - KHÔNG TẠO VẬN ĐƠN KHÁC]');
    expect(payload.note).toContain('[ĐÃ THANH TOÁN CHUYỂN KHOẢN');
    expect(payload.note).toContain('Khách dặn: Gọi trước');
    expect(tagNames(payload.tags)).toContain('GOMDON');
    expect(payload).toMatchObject({ cod: 0, transfer_money: 230_000 });
    expect(t.row().pancakePaymentSynced).toBe(true);
    expect(t.alerts.resolveKinds).toHaveBeenCalledWith('o1', ['WAYBILL_NOTE']);
  });

  it('syncWaybillNote: đơn COD → chỉ PUT note/tag, không đụng tiền', async () => {
    const t = setup({ ...recycling, pancakeOrderId: 'pk-1', gomdonPartnerCode: 'BE-1', gomdonOrderId: '1', gomdonStatus: '1' });
    await t.svc.syncWaybillNote('o1');
    const payload = t.client.updateOrder.mock.calls[0]![1];
    expect(Object.keys(payload).sort()).toEqual(['note', 'tags']);
    expect(payload.note).toContain('[THU COD 230.000đ]');
  });

  it('job thanh toán PUT ghi chú cũ trong lúc Gomdon vừa gắn vận đơn → PUT lại ghi chú mới (không để note "CHỜ THANH TOÁN")', async () => {
    const t = setup({ ...recycling, pancakeOrderId: 'pk-1', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', gomdonStatus: 'CREATING' });
    t.client.updateOrder.mockImplementationOnce(async () => {
      Object.assign(t.rows[0]!, { gomdonPartnerCode: 'BE-2', gomdonOrderId: '2', gomdonStatus: '1' });
      return { id: 'pk-1' };
    });
    await t.svc.syncPayment('o1');
    expect(t.client.updateOrder).toHaveBeenCalledTimes(2);
    expect(t.client.updateOrder.mock.calls[1]![1].note).toContain('Mã VĐ Gomdon: BE-2');
    expect(t.alerts.alert).not.toHaveBeenCalled();
  });

  it('PUT lại ghi chú lỗi → báo "ghi mã vào Pancake" (nhóm WAYBILL_NOTE), không nhắc "sau khi khách thanh toán"', async () => {
    const t = setup({ ...recycling, gomdonStatus: 'NEEDS_MANUAL_CHECK' });
    t.client.createOrder.mockImplementationOnce(async () => {
      Object.assign(t.rows[0]!, { gomdonPartnerCode: 'BE-4', gomdonOrderId: '4', gomdonStatus: '1' });
      return { id: 'pk-new' };
    });
    t.client.updateOrder.mockRejectedValueOnce(new PancakeApiError('Pancake 503', true));
    await t.svc.pushOrder('o1');
    expect(t.alerts.alert).toHaveBeenCalledWith(
      'TUBU1',
      expect.stringMatching(/vận đơn Gomdon BE-4 nhưng chưa ghi được mã vào đơn Pancake #pk-new .*KHÔNG tạo vận đơn khác/),
      undefined,
      'WAYBILL_NOTE',
    );
    expect(t.alerts.alert.mock.calls[0]![1]).not.toContain('khách thanh toán');
  });

  it('đơn lên Pancake với ghi chú chưa có mã, vận đơn tới trong lúc tạo → PUT lại ghi chú ngay sau khi lưu mã Pancake', async () => {
    const t = setup({ ...recycling, gomdonStatus: 'NEEDS_MANUAL_CHECK' });
    t.client.createOrder.mockImplementationOnce(async () => {
      Object.assign(t.rows[0]!, { gomdonPartnerCode: 'BE-3', gomdonOrderId: '3', gomdonStatus: '1' });
      return { id: 'pk-new' };
    });
    await t.svc.pushOrder('o1');
    expect(t.body().note).toContain('KIỂM TRA GOMDON');
    expect(t.client.updateOrder).toHaveBeenCalledWith('pk-new', expect.objectContaining({ note: expect.stringContaining('Mã VĐ Gomdon: BE-3') }));
  });
});

describe('PancakeOrderService — thẻ đơn (Pancake chỉ nhận thẻ đã có trong shop, theo id)', () => {
  it('POST: tên thẻ → {id, name} của shop; thẻ shop không có bị bỏ', async () => {
    const t = setup({}, { client: { resolveOrderTags: jest.fn().mockResolvedValue([{ id: 7, name: 'COD' }]) } });
    await t.svc.pushOrder('o1');
    expect(t.client.resolveOrderTags).toHaveBeenCalledWith(['MINIAPP', 'RETAIL', 'COD']);
    expect(t.body().tags).toEqual([{ id: 7, name: 'COD' }]);
  });

  it('POST: không thẻ nào khớp → không có khoá tags trong body', async () => {
    const t = setup({}, { client: { resolveOrderTags: jest.fn().mockResolvedValue([]) } });
    await t.svc.pushOrder('o1');
    expect(t.client.createOrder).toHaveBeenCalledTimes(1);
    expect(t.body()).not.toHaveProperty('tags');
  });

  it('PUT: giữ thẻ nhân viên gắn tay, gỡ thẻ thanh toán cũ của ta, thêm thẻ mới', async () => {
    const shop = [
      { id: 1, name: 'MINIAPP' },
      { id: 2, name: 'RETAIL' },
      { id: 3, name: 'CHO_CHUYEN_KHOAN' },
      { id: 4, name: 'DA_THANH_TOAN' },
    ];
    const resolveOrderTags = jest.fn(async (names: readonly string[]) => shop.filter((s) => names.includes(s.name)));
    const getOrder = jest.fn().mockResolvedValue({ id: 'pk-1', tags: [{ id: 3, name: 'CHO_CHUYEN_KHOAN' }, { id: 9000, name: 'Hẹn gọi' }, { id: 1, name: 'MINIAPP' }] });
    const t = setup({ pancakeOrderId: 'pk-1', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' }, { client: { resolveOrderTags, getOrder } });
    await t.svc.syncPayment('o1');
    const sent = t.client.updateOrder.mock.calls[0]![1].tags as { id: number }[];
    expect(sent.map((x) => x.id).sort((a, b) => a - b)).toEqual([1, 2, 4, 9000]);
  });

  it('PUT: không đọc được đơn hiện tại → bỏ tags, vẫn PUT note/tiền', async () => {
    const getOrder = jest.fn().mockRejectedValue(new PancakeApiError('ECONNRESET', true));
    const t = setup({ pancakeOrderId: 'pk-1', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' }, { client: { getOrder } });
    await t.svc.syncPayment('o1');
    const payload = t.client.updateOrder.mock.calls[0]![1];
    expect(payload).not.toHaveProperty('tags');
    expect(payload).toMatchObject({ transfer_money: 230_000, cod: 0 });
  });
});

describe('PancakeOrderService — thẻ: lùi về không thẻ, gỡ thẻ cũ, thẻ lạ', () => {
  const rejectTags = () => new PancakeApiError('Pancake trả 422 khi tạo đơn: [tags]: is invalid', false);
  const paidBank = { pancakeOrderId: 'pk-1', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' };
  const only = (shop: { id: number; name: string }[]) => jest.fn(async (names: readonly string[]) => shop.filter((x) => names.includes(x.name)));

  it('POST bị 422 vì tags → bỏ cache thẻ, gửi lại MỘT lần không có tags', async () => {
    const createOrder = jest.fn().mockRejectedValueOnce(rejectTags()).mockResolvedValue({ id: 'pk-new' });
    const invalidateOrderTags = jest.fn();
    const t = setup({}, { client: { createOrder, invalidateOrderTags } });
    expect(await t.svc.pushOrder('o1')).toBe('pk-new');
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(createOrder.mock.calls[0]![0]).toHaveProperty('tags');
    expect(createOrder.mock.calls[1]![0]).not.toHaveProperty('tags');
    expect(invalidateOrderTags).toHaveBeenCalledTimes(1);
  });

  it('POST bị 422 vì lý do khác, hoặc body không có tags → không gửi lại', async () => {
    const other = jest.fn().mockRejectedValue(new PancakeApiError('Pancake trả 422 khi tạo đơn: [items]: is invalid', false));
    const a = setup({}, { client: { createOrder: other, invalidateOrderTags: jest.fn() } });
    await expect(a.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeApiError);
    expect(other).toHaveBeenCalledTimes(1);
    const noTags = jest.fn().mockRejectedValue(rejectTags());
    const b = setup({}, { client: { createOrder: noTags, resolveOrderTags: jest.fn().mockResolvedValue([]), invalidateOrderTags: jest.fn() } });
    await expect(b.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakeApiError);
    expect(noTags).toHaveBeenCalledTimes(1);
  });

  it('PUT bị 422 vì tags → gửi lại một lần với cùng tiền/ghi chú nhưng không có tags', async () => {
    const updateOrder = jest.fn().mockRejectedValueOnce(rejectTags()).mockResolvedValue({ id: 'pk-1' });
    const invalidateOrderTags = jest.fn();
    const t = setup(paidBank, { client: { updateOrder, invalidateOrderTags } });
    await t.svc.syncPayment('o1');
    expect(updateOrder).toHaveBeenCalledTimes(2);
    expect(updateOrder.mock.calls[0]![1]).toHaveProperty('tags');
    expect(updateOrder.mock.calls[1]![1]).not.toHaveProperty('tags');
    expect(updateOrder.mock.calls[1]![1]).toMatchObject({ transfer_money: 230_000, cod: 0 });
    expect(invalidateOrderTags).toHaveBeenCalledTimes(1);
    expect(t.row().pancakePaymentSynced).toBe(true);
  });

  it('PUT: thẻ mới chưa có trong shop nhưng đơn còn thẻ thanh toán cũ của ta → gỡ nó, giữ thẻ tay', async () => {
    const getOrder = jest.fn().mockResolvedValue({ id: 'pk-1', tags: [{ id: 3, name: 'CHO_CHUYEN_KHOAN' }, { id: 9000, name: 'Hẹn gọi' }] });
    const t = setup(paidBank, { client: { resolveOrderTags: only([{ id: 3, name: 'CHO_CHUYEN_KHOAN' }]), getOrder } });
    await t.svc.syncPayment('o1');
    expect(t.client.updateOrder.mock.calls[0]![1].tags).toEqual([{ id: 9000, name: 'Hẹn gọi' }]);
  });

  it('PUT: shop không có thẻ nào của ta → không đọc đơn, không gửi tags', async () => {
    const t = setup(paidBank, { client: { resolveOrderTags: jest.fn().mockResolvedValue([]) } });
    await t.svc.syncPayment('o1');
    expect(t.client.getOrder).not.toHaveBeenCalled();
    expect(t.client.updateOrder.mock.calls[0]![1]).not.toHaveProperty('tags');
  });

  it('PUT: thẻ hiện có không phải {id: số} (chuỗi / id chuỗi) → không đụng tags', async () => {
    for (const tags of [['Hẹn gọi'], [{ id: '12', name: 'x' }]]) {
      const t = setup(paidBank, { client: { getOrder: jest.fn().mockResolvedValue({ id: 'pk-1', tags }) } });
      await t.svc.syncPayment('o1');
      expect(t.client.updateOrder.mock.calls[0]![1]).not.toHaveProperty('tags');
    }
  });

  it('PUT: getOrder trả null → không đụng tags', async () => {
    const t = setup(paidBank, { client: { getOrder: jest.fn().mockResolvedValue(null) } });
    await t.svc.syncPayment('o1');
    expect(t.client.updateOrder.mock.calls[0]![1]).not.toHaveProperty('tags');
  });

  it('PUT: lần đọc danh sách thẻ đầu lỗi (resolve trả []) → không gửi tags, thẻ thanh toán đang có trên Pancake được giữ', async () => {
    const resolveOrderTags = jest.fn().mockResolvedValueOnce([]).mockResolvedValue([{ id: 4, name: 'DA_THANH_TOAN' }]);
    const t = setup(paidBank, { client: { resolveOrderTags } });
    await t.svc.syncPayment('o1');
    expect(resolveOrderTags).toHaveBeenCalledTimes(1);
    expect(t.client.updateOrder.mock.calls[0]![1]).not.toHaveProperty('tags');
  });

  it('PUT: tags của đơn không phải mảng → không ném, vẫn PUT tiền, không đụng tags', async () => {
    const t = setup(paidBank, { client: { getOrder: jest.fn().mockResolvedValue({ id: 'pk-1', tags: 'Hẹn gọi' }) } });
    await t.svc.syncPayment('o1');
    expect(t.client.updateOrder.mock.calls[0]![1]).toMatchObject({ transfer_money: 230_000, cod: 0 });
    expect(t.client.updateOrder.mock.calls[0]![1]).not.toHaveProperty('tags');
  });

  it('tags null → coi như đơn chưa có thẻ', async () => {
    const t = setup(paidBank, { client: { getOrder: jest.fn().mockResolvedValue({ id: 'pk-1', tags: null }) } });
    await t.svc.syncPayment('o1');
    expect(t.client.updateOrder.mock.calls[0]![1].tags).toHaveLength(3);
  });

  it('POST: HTTP 200 success:false nhắc tags ("Pancake từ chối tạo đơn: …") cũng lùi về không thẻ', async () => {
    const createOrder = jest.fn().mockRejectedValueOnce(new PancakeApiError('Pancake từ chối tạo đơn: [tags]: is invalid', false)).mockResolvedValue({ id: 'pk-new' });
    const t = setup({}, { client: { createOrder, invalidateOrderTags: jest.fn() } });
    expect(await t.svc.pushOrder('o1')).toBe('pk-new');
    expect(createOrder.mock.calls[1]![0]).not.toHaveProperty('tags');
  });
});

describe('PancakeOrderService.pushOrder — dấu gửi: tối đa MỘT lệnh tạo đơn chưa rõ kết quả mỗi cửa sổ chờ', () => {
  const settle = PancakeOrderService.SEND_SETTLE_MS;
  const ago = (ms: number) => new Date(Date.now() - ms);
  const claimedBefore = { pancakePushStatus: PANCAKE_PUSH.PENDING, pancakeLastAttemptAt: ago(3 * 60_000) };

  it('dấu null → đóng dấu rồi gửi ngay, không tra cứu', async () => {
    const t = setup();
    let stampDuringSend: unknown;
    t.client.createOrder.mockImplementation(async () => {
      stampDuringSend = t.row().pancakePushClaimedAt;
      return { id: 'pk-new' };
    });
    expect(await t.svc.pushOrder('o1')).toBe('pk-new');
    expect(stampDuringSend).toBeInstanceOf(Date);
    expect(t.client.searchOrders).not.toHaveBeenCalled();
    expect(t.row()).toMatchObject({ pancakeOrderId: 'pk-new', pancakePushStatus: PANCAKE_PUSH.SYNCED, pancakePushClaimedAt: null });
  });

  it('dấu còn trong cửa sổ → không gửi, không tra, giữ loại lỗi/lời lỗi, về PENDING, không đốt thêm lượt, không báo', async () => {
    const stamp = ago(2 * 60_000);
    const t = setup({
      ...claimedBefore,
      pancakePushClaimedAt: stamp,
      pancakeErrorKind: 'REJECTED',
      pancakeSyncError: 'Pancake trả 422: x',
      pancakePushAttempts: 3,
    });
    const err = await t.svc.pushOrder('o1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PancakePushSettlingError);
    expect(err).toMatchObject({ transient: true });
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.client.searchOrders).not.toHaveBeenCalled();
    expect(t.row()).toMatchObject({
      pancakeOrderId: null,
      pancakePushStatus: PANCAKE_PUSH.PENDING,
      pancakeErrorKind: 'REJECTED',
      pancakeSyncError: 'Pancake trả 422: x',
      pancakePushAttempts: 4,
      pancakePushClaimedAt: stamp,
      pancakeAttention: null,
    });
    expect(t.alerts.alert).not.toHaveBeenCalled();
  });

  it('lỗi "đang chờ cửa sổ" không bị markPushFailure ghi (không đổi loại lỗi, không đốt/hoàn lượt, không báo)', async () => {
    const t = setup({ ...claimedBefore, pancakePushClaimedAt: ago(60_000), pancakeErrorKind: 'REJECTED', pancakeSyncError: 'cũ', pancakePushAttempts: 2 });
    const before = JSON.stringify(t.row());
    await t.svc.markPushFailure('o1', new PancakePushSettlingError('Đơn TUBU1 vừa gửi'), true);
    expect(JSON.stringify(t.row())).toBe(before);
    expect(t.alerts.alert).not.toHaveBeenCalled();
  });

  it('dấu đã quá cửa sổ, tra thấy đơn → nhận đơn đó, không tạo', async () => {
    const t = setup({ ...claimedBefore, pancakePushClaimedAt: ago(settle + 60_000) });
    t.client.searchOrders.mockResolvedValue([{ id: 31, status: 1, custom_id: 'TUBU1' }]);
    expect(await t.svc.pushOrder('o1')).toBe('31');
    expect(t.client.searchOrders).toHaveBeenCalledTimes(1);
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.row()).toMatchObject({ pancakeOrderId: '31', pancakePushStatus: PANCAKE_PUSH.SYNCED, pancakePushClaimedAt: null });
  });

  it('dấu đã quá cửa sổ, tra không thấy → tạo đúng một lần, dấu được đóng lại mới', async () => {
    const old = ago(settle + 60_000);
    const t = setup({ ...claimedBefore, pancakePushClaimedAt: old });
    let stampDuringSend: Date | null = null;
    t.client.createOrder.mockImplementation(async () => {
      stampDuringSend = t.row().pancakePushClaimedAt as Date;
      return { id: 'pk-new' };
    });
    expect(await t.svc.pushOrder('o1')).toBe('pk-new');
    expect(t.client.searchOrders).toHaveBeenCalledTimes(1);
    expect(t.client.createOrder).toHaveBeenCalledTimes(1);
    expect(stampDuringSend!.getTime()).toBeGreaterThan(old.getTime());
  });

  it('dấu đã quá cửa sổ, tra không thấy, Pancake từ chối dứt khoát → KHÔNG gỡ dấu (lệnh cũ chưa rõ kết quả vẫn còn dấu vết)', async () => {
    const t = setup(
      { ...claimedBefore, pancakePushClaimedAt: ago(settle + 60_000) },
      { client: { createOrder: jest.fn().mockRejectedValue(new PancakeApiError('Pancake trả 422 khi tạo đơn: x', false, false, 422)) } },
    );
    await expect(t.svc.pushOrder('o1')).rejects.toThrow('422');
    expect(t.row().pancakePushClaimedAt).toBeInstanceOf(Date);
    expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.PENDING);
  });

  it('mất quyền giữa claim và đóng dấu (lượt khác vừa claim) → không gửi, không ghi gì, ném lỗi chờ', async () => {
    const t = setup();
    const lastAttempt = ago(-1_000);
    const read = t.prisma.order.findUnique.getMockImplementation()!;
    t.prisma.order.findUnique.mockImplementationOnce(async (args: Parameters<typeof read>[0]) => {
      t.row().pancakeLastAttemptAt = lastAttempt; // lượt B claim sau khi hết hạn thuê của ta
      return read(args);
    });
    const err = await t.svc.pushOrder('o1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PancakePushSettlingError);
    expect(t.client.createOrder).not.toHaveBeenCalled();
    expect(t.client.searchOrders).not.toHaveBeenCalled();
    expect(t.row()).toMatchObject({ pancakePushStatus: PANCAKE_PUSH.PUSHING, pancakeLastAttemptAt: lastAttempt, pancakePushClaimedAt: null });
  });

  describe('gửi lại không thẻ', () => {
    const rejectTags = () => new PancakeApiError('Pancake trả 422 khi tạo đơn: [tags]: is invalid', false);
    const mk = (onFirst?: (t: ReturnType<typeof setup>) => void) => {
      const stamps: unknown[] = [];
      const ref: { t?: ReturnType<typeof setup> } = {};
      const createOrder = jest.fn(async () => {
        stamps.push(ref.t!.row().pancakePushClaimedAt);
        if (stamps.length === 1) {
          onFirst?.(ref.t!);
          throw rejectTags();
        }
        return { id: 'pk-new' };
      });
      const t = setup({}, { client: { createOrder, invalidateOrderTags: jest.fn() } });
      ref.t = t;
      return { t, createOrder, stamps };
    };

    it('cùng lượt: đóng dấu lại bằng CAS theo dấu của chính mình rồi gửi lần hai (dấu mới không cũ hơn)', async () => {
      const { t, createOrder, stamps } = mk();
      expect(await t.svc.pushOrder('o1')).toBe('pk-new');
      expect(createOrder).toHaveBeenCalledTimes(2);
      expect((stamps[1] as Date).getTime()).toBeGreaterThanOrEqual((stamps[0] as Date).getTime());
    });

    it('dấu đã đổi sang lượt khác giữa hai lần gửi → không gửi lần hai, không ghi gì', async () => {
      const other = new Date(Date.now() + 5_000);
      const { t, createOrder } = mk((x) => {
        x.row().pancakePushClaimedAt = other;
      });
      const err = await t.svc.pushOrder('o1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PancakePushSettlingError);
      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(t.row()).toMatchObject({ pancakePushClaimedAt: other, pancakePushStatus: PANCAKE_PUSH.PUSHING });
    });

    it('lượt khác đã nhả đơn về PENDING giữa hai lần gửi → không gửi lần hai', async () => {
      const { t, createOrder } = mk((x) => {
        x.row().pancakePushStatus = PANCAKE_PUSH.PENDING;
      });
      await expect(t.svc.pushOrder('o1')).rejects.toBeInstanceOf(PancakePushSettlingError);
      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(t.row().pancakePushStatus).toBe(PANCAKE_PUSH.PENDING);
    });
  });
});
