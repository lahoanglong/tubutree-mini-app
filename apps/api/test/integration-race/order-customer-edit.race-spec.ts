import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderCodSwitchService } from '../../src/modules/orders/order-cod-switch.service';
import { OrderCustomerEditService } from '../../src/modules/orders/order-customer-edit.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { ORDER_CUSTOMER_SELF_EDIT_KEY, ORDER_EDIT_HISTORY_NOTE, ORDER_EDIT_MAX, ORDER_EDIT_REFUSED } from '../../src/modules/orders/order-customer-edit';
import { PancakeSyncHooks } from '../../src/modules/integrations/pancake/pancake-sync-hooks';
import type { GeoService } from '../../src/modules/integrations/pancake/geo.service';
import { SUBSCRIPTION_NOTE_SEP, SUBSCRIPTION_ORDER_NOTE } from '../../src/modules/subscriptions/subscription-note';
import { PancakeApiError } from '../../src/modules/integrations/pancake/pancake-outbound';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import { createOrder, createUser, deleteItData, pinConfig, warmPool } from './helpers';

/** Mọi cột tiền và trạng thái của đơn: lần khách tự sửa không bao giờ được đổi cột nào trong số này. */
const MONEY_AND_STATUS = {
  subtotal: true,
  discount: true,
  couponDiscount: true,
  comboDiscount: true,
  tierDiscount: true,
  pointsDiscount: true,
  shippingFee: true,
  total: true,
  pointsEarned: true,
  pointsUsed: true,
  pointsUsedConverted: true,
  paymentMethod: true,
  paymentStatus: true,
  status: true,
} satisfies Prisma.OrderSelect;

const SNAP = {
  recipient: 'Khach IT',
  phone: '0900000000',
  street: '1 Duong IT',
  ward: 'Phuong IT',
  district: '',
  province: 'Ha Noi',
  provinceCode: '84_VN01',
  districtCode: '',
  wardCode: '84_VN0100001',
};
const addr = (over: Partial<typeof SNAP> = {}) => {
  const a = { ...SNAP, ...over };
  return { recipient: a.recipient, phone: a.phone, ward: a.ward, street: a.street, provinceCode: a.provinceCode, districtCode: a.districtCode, wardCode: a.wardCode };
};

/**
 * Khách đăng nhập tự sửa địa chỉ cùng tỉnh và ghi chú (OrderCustomerEditService) trên Postgres THẬT: không bao giờ đổi một cột tiền nào, chỉ cùng
 * tỉnh, chỉ trước đóng gói, chạy tuần tự với đóng gói / huỷ / đổi COD / lần sửa khác (khoá dòng đơn), hỏi Pancake trước khi sửa đơn đã lên kho.
 */
describe('Customer self-edit of delivery address + note (real Postgres)', () => {
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let codSwitch: OrderCodSwitchService;
  let edit: OrderCustomerEditService;
  const restores: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    restores.push(await pinConfig(prisma, ORDER_CUSTOMER_SELF_EDIT_KEY, true));
    const loyalty = { reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService;
    const affiliate = { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) } as unknown as AffiliateService;
    const reversal = new OrderReversalService(
      { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
      { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService,
    );
    const notifications = { notify, notifySafe: notify } as unknown as NotificationsService;
    orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal);
    codSwitch = new OrderCodSwitchService(prisma, orderStatus, notifications);
    edit = new OrderCustomerEditService(prisma, new SystemConfigService(prisma));
  });

  afterAll(async () => {
    for (const r of restores.reverse()) await r();
    if (prisma) await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  async function order(over: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    userIds.push(user.id);
    const o = await createOrder(prisma, {
      userId: user.id,
      status: 'CONFIRMED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: 180_000,
      discount: 5_000,
      couponDiscount: 5_000,
      shippingFee: 25_000,
      total: 200_000,
      pointsEarned: 2,
      shippingAddress: SNAP,
      note: 'Giao giờ hành chính',
      ...over,
    });
    return { order: o, userId: user.id };
  }

  const money = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, select: MONEY_AND_STATUS });
  /** Giờ dưới từng bước hành trình của chi tiết đơn (hàm thật của OrdersService): dòng sửa cùng trạng thái không được dời hay xoá mốc nào. */
  const statusTimes = (id: string) =>
    (OrdersService.prototype as unknown as { statusTimesOf(this: unknown, o: { id: string }): Promise<Record<string, string>> }).statusTimesOf.call(
      { prisma },
      { id },
    );
  const editRows = (orderId: string) =>
    prisma.orderStatusHistory.findMany({ where: { orderId, note: { startsWith: ORDER_EDIT_HISTORY_NOTE } }, orderBy: { createdAt: 'asc' } });

  async function refusal(p: Promise<unknown>) {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    if (err instanceof ConflictException || err instanceof BadRequestException) {
      return { status: err.getStatus(), ...(err.getResponse() as { code?: string; reason?: string; message?: string }) };
    }
    if (err instanceof NotFoundException) return { status: 404 };
    if (err) throw err;
    return null;
  }

  it('R1: đã xác nhận, cùng tỉnh, đổi phường + số nhà + người nhận + ghi chú → ảnh chụp mới, giữ tỉnh, mọi cột tiền/trạng thái giữ nguyên', async () => {
    const { order: o, userId } = await order();
    await prisma.orderStatusHistory.create({
      data: { orderId: o.id, fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED', actorType: 'SYSTEM', createdAt: new Date(Date.now() - 60_000) },
    });
    const before = await money(o.id);
    const timesBefore = await statusTimes(o.id);
    expect(Object.keys(timesBefore)).toEqual(['CONFIRMED']);
    const res = await edit.editForOwner(userId, o.code, {
      address: addr({ recipient: 'Nguyen Moi', ward: 'Phuong Moi', wardCode: '84_VN0100002', street: '5 Pho Moi' }),
      note: 'Gọi trước khi giao',
    });
    expect(res).toMatchObject({ code: o.code, note: 'Gọi trước khi giao', editsLeft: ORDER_EDIT_MAX - 1 });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.shippingAddress).toEqual({ ...SNAP, recipient: 'Nguyen Moi', ward: 'Phuong Moi', wardCode: '84_VN0100002', street: '5 Pho Moi' });
    expect(after.note).toBe('Gọi trước khi giao');
    expect(after.recipientSearch).toContain('nguyen moi');
    expect(await money(o.id)).toEqual(before);
    expect(await statusTimes(o.id)).toEqual(timesBefore);
    const rows = await editRows(o.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromStatus: 'CONFIRMED', toStatus: 'CONFIRMED', actorType: 'CUSTOMER', actorId: userId });
    // Không lộ dữ liệu cá nhân trong sổ lịch sử: chỉ tên trường.
    expect(rows[0]!.note).toBe(`${ORDER_EDIT_HISTORY_NOTE}: người nhận, phường/xã, số nhà, ghi chú`);
    expect(rows[0]!.note).not.toMatch(/Nguyen Moi|5 Pho Moi|09\d{8}/);
  });

  it('R1b: chờ thanh toán (chuyển khoản) sửa được; không đổi gì → 200, không ghi, không tính lượt', async () => {
    const { order: o, userId } = await order({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' });
    const same = await edit.editForOwner(userId, o.code, { address: addr({ phone: '+84900000000' }), note: ' Giao giờ hành chính ' });
    expect(same.editsLeft).toBe(ORDER_EDIT_MAX);
    expect(await editRows(o.id)).toHaveLength(0);
    await edit.editForOwner(userId, o.code, { note: '' });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.note).toBeNull();
    expect(after.status).toBe('PENDING_PAYMENT');
    expect(await editRows(o.id)).toEqual([expect.objectContaining({ fromStatus: 'PENDING_PAYMENT', toStatus: 'PENDING_PAYMENT' })]);
  });

  it('R2: khác tỉnh → 400 PROVINCE_CHANGED, không đổi gì; đơn cũ thiếu mã tỉnh: địa chỉ 409 PROVINCE_LOCKED, ghi chú vẫn sửa được', async () => {
    const { order: o, userId } = await order();
    expect(await refusal(edit.editForOwner(userId, o.code, { address: addr({ provinceCode: '84_VN79' }), note: 'x' }))).toMatchObject({
      status: 400,
      code: ORDER_EDIT_REFUSED,
      reason: 'PROVINCE_CHANGED',
      message: expect.stringContaining('Ha Noi'),
    });
    const unchanged = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(unchanged.shippingAddress).toEqual(SNAP);
    expect(unchanged.note).toBe('Giao giờ hành chính');

    const { order: old, userId: oldUser } = await order({ shippingAddress: { ...SNAP, provinceCode: '' } });
    expect(await refusal(edit.editForOwner(oldUser, old.code, { address: addr() }))).toMatchObject({ status: 409, reason: 'PROVINCE_LOCKED' });
    await edit.editForOwner(oldUser, old.code, { note: 'Chỉ ghi chú' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: old.id } })).note).toBe('Chỉ ghi chú');
  });

  it('R3: từ chối đúng lý do và canEdit khớp từng ca; đơn của người khác 404', async () => {
    const cases: [string, Partial<Prisma.OrderUncheckedCreateInput>, string][] = [
      ['PACKED', { status: 'PACKED' }, 'NOT_EDITABLE_STATUS'],
      ['SHIPPING', { status: 'SHIPPING' }, 'NOT_EDITABLE_STATUS'],
      ['DELIVERED', { status: 'DELIVERED' }, 'NOT_EDITABLE_STATUS'],
      ['CANCELLED', { status: 'CANCELLED' }, 'NOT_EDITABLE_STATUS'],
      ['RETURNED', { status: 'RETURNED' }, 'NOT_EDITABLE_STATUS'],
      ['khách vãng lai', { guestTokenHash: 'it-guest-hash' }, 'NOT_ELIGIBLE'],
      ['CTV lên hộ', { placedForCustomer: true }, 'NOT_ELIGIBLE'],
      ['đại lý', { type: 'DEALER' }, 'NOT_ELIGIBLE'],
      ['gian hàng tự giao', { fulfiller: 'MERCHANT' }, 'NOT_ELIGIBLE'],
      ['thu gom tái chế', { hasRecyclingPickup: true }, 'NOT_ELIGIBLE'],
      ['Pancake đã gửi hàng', { autoCancelBlockedAt: new Date() }, 'HANDED_OVER'],
      ['có mã vận đơn hãng', { shippingCode: 'GHN-IT-1', shippingPartner: 'GHN' }, 'HANDED_OVER'],
    ];
    for (const [label, over, reason] of cases) {
      const { order: o, userId } = await order(over);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      expect([label, await edit.canEdit(row)]).toEqual([label, false]);
      expect([label, await refusal(edit.editForOwner(userId, o.code, { note: 'thử' }))]).toEqual([label, expect.objectContaining({ status: 409, reason })]);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).note).toBe('Giao giờ hành chính');
    }
    const { order: mine, userId: owner } = await order();
    const stranger = await createUser(prisma, { role: 'CUSTOMER' });
    userIds.push(stranger.id);
    expect(await refusal(edit.editForOwner(stranger.id, mine.code, { note: 'x' }))).toEqual({ status: 404 });
    expect(await edit.canEdit(await prisma.order.findUniqueOrThrow({ where: { id: mine.id } }))).toBe(true);
    // Cờ tắt: DISABLED, canEdit false.
    const off = new OrderCustomerEditService(prisma, { get: async () => false } as unknown as SystemConfigService);
    expect(await off.canEdit(await prisma.order.findUniqueOrThrow({ where: { id: mine.id } }))).toBe(false);
    expect(await refusal(off.editForOwner(owner, mine.code, { note: 'x' }))).toMatchObject({ status: 409, reason: 'DISABLED' });
  });

  it('R4: sửa chạy chồng với đóng gói × 20 → không bao giờ có dòng sửa ghi lúc đơn đã PACKED; thua thì không đổi gì', async () => {
    for (let i = 0; i < 20; i++) {
      const { order: o, userId } = await order();
      const before = await money(o.id);
      const [edited] = await Promise.allSettled([
        edit.editForOwner(userId, o.code, { address: addr({ street: `${i} Pho Dua` }), note: `vòng ${i}` }),
        orderStatus.setStatus(o.id, 'PACKED', { actorType: 'ADMIN', actorId: 'it-admin' }),
      ]);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(after.status).toBe('PACKED');
      const rows = await editRows(o.id);
      if (edited.status === 'fulfilled') {
        expect(rows).toEqual([expect.objectContaining({ fromStatus: 'CONFIRMED', toStatus: 'CONFIRMED' })]);
        expect((after.shippingAddress as { street: string }).street).toBe(`${i} Pho Dua`);
        const packed = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: o.id, toStatus: 'PACKED' } });
        expect(rows[0]!.createdAt.getTime()).toBeLessThanOrEqual(packed.createdAt.getTime());
      } else {
        expect(rows).toEqual([]);
        expect(after.shippingAddress).toEqual(SNAP);
        expect(after.note).toBe('Giao giờ hành chính');
      }
      expect({ ...(await money(o.id)), status: 'PACKED' }).toEqual({ ...before, status: 'PACKED' });
    }
  });

  it('R5: sửa chồng với huỷ → huỷ luôn thắng trạng thái, sửa trước huỷ thì giữ, sau huỷ thì 409; sửa chồng với đổi COD → cả hai câu ghi đều còn', async () => {
    for (let i = 0; i < 10; i++) {
      const { order: o, userId } = await order();
      const [edited, cancelled] = await Promise.allSettled([
        edit.editForOwner(userId, o.code, { note: `huỷ ${i}` }),
        orderStatus.setStatus(o.id, 'CANCELLED', { actorType: 'CUSTOMER', actorId: userId }),
      ]);
      expect(cancelled.status).toBe('fulfilled');
      const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(after.status).toBe('CANCELLED');
      const rows = await editRows(o.id);
      expect(rows).toHaveLength(edited.status === 'fulfilled' ? 1 : 0);
      expect(after.note).toBe(edited.status === 'fulfilled' ? `huỷ ${i}` : 'Giao giờ hành chính');
      expect(await prisma.orderStatusHistory.count({ where: { orderId: o.id, toStatus: 'CANCELLED', fromStatus: 'CONFIRMED' } })).toBe(1);
    }
    for (let i = 0; i < 10; i++) {
      const { order: o, userId } = await order({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', createdAt: new Date() });
      const [edited, switched] = await Promise.allSettled([
        edit.editForOwner(userId, o.code, { address: addr({ street: `${i} Pho COD` }) }),
        codSwitch.switchForOwner(userId, o.code),
      ]);
      expect([edited.status, switched.status]).toEqual(['fulfilled', 'fulfilled']);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(after).toMatchObject({ status: 'CONFIRMED', paymentMethod: 'COD', total: 200_000, shippingFee: 25_000 });
      expect((after.shippingAddress as { street: string }).street).toBe(`${i} Pho COD`);
      expect(await editRows(o.id)).toHaveLength(1);
      expect(await prisma.orderStatusHistory.count({ where: { orderId: o.id, fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED' } })).toBe(1);
    }
  });

  it(`R6: hai lần sửa đồng thời → 2 dòng lịch sử, ảnh chụp cuối là một trong hai, đếm lượt đúng; lần thứ ${ORDER_EDIT_MAX + 1}: EDIT_LIMIT`, async () => {
    const { order: o, userId } = await order();
    const a = addr({ street: 'A street', recipient: 'Nguoi A' });
    const b = addr({ street: 'B street', recipient: 'Nguoi B' });
    const results = await Promise.all([edit.editForOwner(userId, o.code, { address: a, note: 'A' }), edit.editForOwner(userId, o.code, { address: b, note: 'B' })]);
    expect(results.map((r) => r.editsLeft).sort()).toEqual([ORDER_EDIT_MAX - 2, ORDER_EDIT_MAX - 1]);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    const last = (after.shippingAddress as { street: string }).street === 'A street' ? 'A' : 'B';
    expect(after.note).toBe(last);
    expect(after.shippingAddress).toMatchObject(last === 'A' ? { recipient: 'Nguoi A' } : { recipient: 'Nguoi B' });
    expect(await editRows(o.id)).toHaveLength(2);
    await edit.editForOwner(userId, o.code, { note: 'lần 3' });
    expect(await edit.canEdit(await prisma.order.findUniqueOrThrow({ where: { id: o.id } }))).toBe(false);
    expect(await refusal(edit.editForOwner(userId, o.code, { note: 'lần 4' }))).toMatchObject({ status: 409, reason: 'EDIT_LIMIT' });
    expect(await editRows(o.id)).toHaveLength(ORDER_EDIT_MAX);
  });

  it('R7: lệnh tạo đơn đang bay → SYNCING; đơn đã lên kho: Pancake đóng gói → PACKING_ON_PANCAKE, mất mạng → PANCAKE_UNREACHABLE (DB không đổi), trước đóng gói → sửa + đúng 1 job', async () => {
    const { order: pushing, userId: u1 } = await order({ pancakePushStatus: 'PUSHING', pancakeLastAttemptAt: new Date() });
    expect(await refusal(edit.editForOwner(u1, pushing.code, { note: 'x' }))).toMatchObject({ status: 409, reason: 'SYNCING' });
    const { order: claimed, userId: u2 } = await order({ pancakePushClaimedAt: new Date() });
    expect(await refusal(edit.editForOwner(u2, claimed.code, { note: 'x' }))).toMatchObject({ status: 409, reason: 'SYNCING' });

    const added: { name: string; data: unknown; opts: unknown }[] = [];
    const queue = {
      name: 'pancake-push',
      getJob: jest.fn().mockResolvedValue(null),
      add: jest.fn(async (name: string, data: unknown, opts: unknown) => {
        added.push({ name, data, opts });
        return {};
      }),
    };
    const withPancake = (getOrder: jest.Mock) =>
      new OrderCustomerEditService(
        prisma,
        new SystemConfigService(prisma),
        undefined,
        new PancakeSyncHooks(prisma, { isConfigured: () => true, getOrder } as unknown as PancakeClient, queue as never),
      );
    const tag = () => `it-pk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    for (const status of [12, 13, 8, 9]) {
      const { order: o, userId } = await order({ pancakeOrderId: tag(), pancakePushStatus: 'SYNCED' });
      const svc = withPancake(jest.fn().mockResolvedValue({ id: o.pancakeOrderId, status }));
      expect(await refusal(svc.editForOwner(userId, o.code, { note: 'x' }))).toMatchObject({ status: 409, reason: 'PACKING_ON_PANCAKE' });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).note).toBe('Giao giờ hành chính');
    }
    const { order: down, userId: u3 } = await order({ pancakeOrderId: tag(), pancakePushStatus: 'SYNCED' });
    const downSvc = withPancake(jest.fn().mockRejectedValue(new PancakeApiError('timeout of 5000ms exceeded', true)));
    expect(await refusal(downSvc.editForOwner(u3, down.code, { address: addr({ street: '9 Mat Mang' }) }))).toMatchObject({
      status: 409,
      reason: 'PANCAKE_UNREACHABLE',
    });
    const downAfter = await prisma.order.findUniqueOrThrow({ where: { id: down.id } });
    expect(downAfter.shippingAddress).toEqual(SNAP);
    expect(await editRows(down.id)).toHaveLength(0);

    const { order: ok, userId: u4 } = await order({ pancakeOrderId: tag(), pancakePushStatus: 'SYNCED' });
    const getOrder = jest.fn().mockResolvedValue({ id: ok.pancakeOrderId, status: 1 });
    await withPancake(getOrder).editForOwner(u4, ok.code, { address: addr({ street: '10 Truoc Dong Goi' }) });
    expect(getOrder).toHaveBeenCalledWith(ok.pancakeOrderId, { timeoutMs: PancakeSyncHooks.CANCEL_TIMEOUT_MS });
    expect(added.filter((j) => (j.data as { orderId: string }).orderId === ok.id)).toEqual([
      { name: 'customer-edit', data: { orderId: ok.id }, opts: { jobId: `customer-edit-${ok.id}` } },
    ]);
    expect(((await prisma.order.findUniqueOrThrow({ where: { id: ok.id } })).shippingAddress as { street: string }).street).toBe('10 Truoc Dong Goi');
  });

  it('R8: đổi SĐT người nhận khi đang báo Zalo người nhận → tắt; chỉ đổi tên thì giữ', async () => {
    const { order: phone, userId: u1 } = await order({ notifyRecipientZalo: true });
    const r = await edit.editForOwner(u1, phone.code, { address: addr({ phone: '0911111111' }) });
    expect(r.notifyRecipientZalo).toBe(false);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: phone.id } })).notifyRecipientZalo).toBe(false);

    const { order: name, userId: u2 } = await order({ notifyRecipientZalo: true });
    await edit.editForOwner(u2, name.code, { address: addr({ recipient: 'Ten Moi' }) });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: name.id } })).notifyRecipientZalo).toBe(true);
  });

  it('R9 (MINOR 1): đơn đặt định kỳ: sửa ghi chú → DB giữ dấu hệ thống + phần của khách, khách chỉ thấy phần của mình; xoá trắng → còn đúng dấu', async () => {
    const { order: o, userId } = await order({ source: 'subscription', note: SUBSCRIPTION_ORDER_NOTE });
    const r1 = await edit.editForOwner(userId, o.code, { note: 'Giao giờ HC' });
    expect(r1.note).toBe('Giao giờ HC');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).note).toBe(`${SUBSCRIPTION_ORDER_NOTE}${SUBSCRIPTION_NOTE_SEP}Giao giờ HC`);

    // Màn khách điền sẵn đúng phần đã thấy, chỉ sửa địa chỉ: ghi chú lưu không đổi một chữ.
    await edit.editForOwner(userId, o.code, { address: addr({ street: '5 Dinh Ky' }), note: r1.note });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).note).toBe(`${SUBSCRIPTION_ORDER_NOTE}${SUBSCRIPTION_NOTE_SEP}Giao giờ HC`);

    const r3 = await edit.editForOwner(userId, o.code, { note: '' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).note).toBe(SUBSCRIPTION_ORDER_NOTE);
    expect(r3.note).toBe(SUBSCRIPTION_ORDER_NOTE);
    expect(r3.editsLeft).toBe(0);
    expect(await editRows(o.id)).toHaveLength(3);
  });

  it('R10 (NIT-7): tên phường lưu theo danh mục, không theo chữ client gửi; danh mục lỗi thì giữ chữ client gửi', async () => {
    const catalog = (name: string | null) =>
      new OrderCustomerEditService(prisma, new SystemConfigService(prisma), {
        checkWard: jest.fn().mockResolvedValue(name ? 'ok' : 'unknown'),
        wardName: jest.fn().mockResolvedValue(name),
      } as unknown as GeoService);

    const { order: a, userId: ua } = await order();
    await catalog('Phường Giảng Võ').editForOwner(ua, a.code, { address: addr({ ward: 'gõ sai tên', wardCode: '84_VN0100007' }) });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).shippingAddress).toMatchObject({ ward: 'Phường Giảng Võ', wardCode: '84_VN0100007' });

    // Client gửi lại đúng mã đang có với tên khác: tên danh mục trùng tên đang lưu nên không phải lần sửa, không tốn lượt.
    const { order: same, userId: us } = await order();
    const noop = await catalog(SNAP.ward).editForOwner(us, same.code, { address: addr({ ward: 'tên lạ' }) });
    expect(noop.editsLeft).toBe(ORDER_EDIT_MAX);
    expect(await editRows(same.id)).toHaveLength(0);

    const { order: b, userId: ub } = await order();
    await catalog(null).editForOwner(ub, b.code, { address: addr({ ward: 'Phường Khách Gõ', wardCode: '84_VN0100009' }) });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).shippingAddress).toMatchObject({ ward: 'Phường Khách Gõ', wardCode: '84_VN0100009' });
  });

  it('R11 (còn mở 3): dòng tự sửa CONFIRMED → CONFIRMED đứng đầu sổ không che giờ CONFIRMED thật khi kho lùi PACKED → CONFIRMED', async () => {
    const { order: o, userId } = await order();
    await edit.editForOwner(userId, o.code, { note: 'Sua truoc dong goi' });
    const base = Date.now() + 60_000;
    await prisma.orderStatusHistory.createMany({
      data: [
        { orderId: o.id, fromStatus: 'CONFIRMED', toStatus: 'PACKED', actorType: 'PANCAKE', createdAt: new Date(base) },
        { orderId: o.id, fromStatus: 'PACKED', toStatus: 'CONFIRMED', actorType: 'PANCAKE', createdAt: new Date(base + 60_000) },
      ],
    });
    expect(await statusTimes(o.id)).toEqual({
      PACKED: new Date(base).toISOString(),
      CONFIRMED: new Date(base + 60_000).toISOString(),
    });
  });
});
