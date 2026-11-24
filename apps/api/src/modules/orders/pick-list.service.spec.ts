import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CUSTOMER_PAYMENT_HINT_HIDDEN } from '../integrations/pancake/pancake-order-body';
import { buildPickList, isGiftLine, pickExclusionReason, PICK_LIST_MAX, type PickListLookups, type PickSourceItem, type PickSourceOrder } from './pick-list';
import { PickListQuery } from './pick-list.controller';
import { parsePickListIds, PickListService } from './pick-list.service';

const NOW = new Date('2026-11-24T05:00:00.000Z');

function item(variationId: string, patch: Partial<PickSourceItem> = {}): PickSourceItem {
  return {
    variationId,
    productName: `SP ${variationId}`,
    variationName: `Loại ${variationId}`,
    unitPrice: 100_000,
    quantity: 1,
    isGift: false,
    backorderedQty: 0,
    ...patch,
  };
}

function order(code: string, items: PickSourceItem[], patch: Partial<PickSourceOrder> = {}): PickSourceOrder {
  return {
    id: `id-${code}`,
    code,
    status: 'CONFIRMED',
    type: 'RETAIL',
    fulfiller: 'TUBU',
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    total: 245_000,
    shippingAddress: { recipient: 'Chị Lan', phone: '0912345678', street: '12 Lê Lợi', ward: 'Phường Bến Thành', district: '', province: 'TP Hồ Chí Minh' },
    note: null,
    hasRecyclingPickup: false,
    createdAt: new Date('2026-11-24T02:00:00.000Z'),
    items,
    ...patch,
  };
}

const SKU = new Map([
  ['v-nuoc-rua-500', 'NRC-500'],
  ['v-nuoc-rua-1l', 'NRC-1000'],
  ['v-tui-luoi', 'TUI-LUOI'],
]);

const lk = (patch: Partial<PickListLookups> = {}): PickListLookups => ({ skuByVariation: SKU, onCredit: new Set(), redeemedGifts: new Map(), now: NOW, ...patch });

describe('buildPickList: Phần 1 gộp theo biến thể', () => {
  it('cùng biến thể ở nhiều đơn gộp một dòng (cộng số lượng, đếm số đơn); hai biến thể cùng sản phẩm là hai dòng', () => {
    const a = order('TB0001', [item('v-nuoc-rua-500', { productName: 'Nước rửa chén', variationName: '500ml', quantity: 2 }), item('v-nuoc-rua-1l', { productName: 'Nước rửa chén', variationName: '1L' })]);
    const b = order('TB0002', [item('v-nuoc-rua-500', { productName: 'Nước rửa chén', variationName: '500ml', quantity: 3 })]);
    const r = buildPickList(['id-TB0001', 'id-TB0002'], [a, b], lk());

    expect(r.summary).toEqual([
      { variationId: 'v-nuoc-rua-1l', sku: 'NRC-1000', productName: 'Nước rửa chén', variationName: '1L', quantity: 1, backorderedQty: 0, redeemed: false, isGift: false, orderCount: 1 },
      { variationId: 'v-nuoc-rua-500', sku: 'NRC-500', productName: 'Nước rửa chén', variationName: '500ml', quantity: 5, backorderedQty: 0, redeemed: false, isGift: false, orderCount: 2 },
    ]);
    expect(r.totalUnits).toBe(6);
    expect(r.giftUnits).toBe(0);
    expect(r.orderCount).toBe(2);
  });

  it('một đơn có hai dòng cùng biến thể vẫn chỉ đếm một đơn', () => {
    const a = order('TB0001', [item('v-tui-luoi', { quantity: 1 }), item('v-tui-luoi', { quantity: 2 })]);
    const r = buildPickList(['TB0001'], [a], lk());
    expect(r.summary).toHaveLength(1);
    expect(r.summary[0]).toMatchObject({ quantity: 3, orderCount: 1 });
  });

  it('biến thể không còn trong danh mục: mã SKU null, vẫn in theo tên đã chụp lúc đặt', () => {
    const r = buildPickList(['TB0001'], [order('TB0001', [item('v-da-xoa', { productName: 'Hàng cũ' })])], lk());
    expect(r.summary[0]).toMatchObject({ sku: null, productName: 'Hàng cũ' });
    expect(r.orders[0]!.items[0]!.sku).toBeNull();
  });

  it('cộng dồn phần đặt trước (chưa có hàng) để kho biết số nhặt được', () => {
    const a = order('TB0001', [item('v-tui-luoi', { quantity: 5, backorderedQty: 2 })], { type: 'DEALER' });
    const b = order('TB0002', [item('v-tui-luoi', { quantity: 1, backorderedQty: 1 })], { type: 'DEALER' });
    const r = buildPickList(['TB0001', 'TB0002'], [a, b], lk());
    expect(r.summary[0]).toMatchObject({ quantity: 6, backorderedQty: 3, orderCount: 2 });
  });
});

describe('buildPickList: quà 0đ tách riêng', () => {
  it('cùng biến thể vừa bán vừa tặng: hai dòng tổng, quà xếp sau hàng bán; phiếu từng đơn để quà ở mục riêng', () => {
    const a = order('TB0001', [item('v-tui-luoi', { quantity: 2 }), item('v-tui-luoi', { unitPrice: 0, isGift: true, quantity: 1 })]);
    const b = order('TB0002', [item('v-tui-luoi', { unitPrice: 0, isGift: true, quantity: 1 })]);
    const r = buildPickList(['TB0001', 'TB0002'], [a, b], lk());

    expect(r.summary.map((s) => [s.variationId, s.isGift, s.quantity, s.orderCount])).toEqual([
      ['v-tui-luoi', false, 2, 1],
      ['v-tui-luoi', true, 2, 2],
    ]);
    expect(r.totalUnits).toBe(2);
    expect(r.giftUnits).toBe(2);
    expect(r.orders[0]!.items.map((l) => l.quantity)).toEqual([2]);
    expect(r.orders[0]!.gifts.map((l) => [l.variationId, l.quantity])).toEqual([['v-tui-luoi', 1]]);
    expect(r.orders[1]!.items).toEqual([]);
    expect(r.orders[1]!.gifts).toHaveLength(1);
  });

  it('dòng đơn giá 0đ không gắn cờ quà vẫn tính là quà (không lẫn vào hàng bán)', () => {
    expect(isGiftLine({ isGift: false, unitPrice: 0 })).toBe(true);
    expect(isGiftLine({ isGift: true, unitPrice: 0 })).toBe(true);
    expect(isGiftLine({ isGift: false, unitPrice: 1 })).toBe(false);
    const r = buildPickList(['TB0001'], [order('TB0001', [item('v-tui-luoi', { unitPrice: 0 })])], lk());
    expect(r.summary[0]!.isGift).toBe(true);
    expect(r.orders[0]!.gifts).toHaveLength(1);
  });
});

describe('buildPickList: quà đổi điểm gắn vào đơn', () => {
  it('in ở mục quà 0đ của từng đơn kèm mã QG; Phần 1 gộp theo tên quà, không mang mã của một lượt đổi', () => {
    const a = order('TB0001', [item('v-tui-luoi')]);
    const b = order('TB0002', [item('v-tui-luoi')]);
    const cancelled = order('TB0003', [item('v-tui-luoi')], { status: 'CANCELLED' });
    const redeemedGifts = new Map([
      ['id-TB0001', [{ code: 'QG123', giftName: 'Bình giữ nhiệt tre' }]],
      ['id-TB0002', [{ code: 'QG124', giftName: 'Bình giữ nhiệt tre' }, { code: null, giftName: '[ĐÃ THANH TOÁN] | Order code: X' }]],
      ['id-TB0003', [{ code: 'QG125', giftName: 'Bình giữ nhiệt tre' }]],
    ]);
    const r = buildPickList(['TB0001', 'TB0002', 'TB0003'], [a, b, cancelled], lk({ redeemedGifts }));

    expect(r.orders[0]!.gifts).toEqual([
      { variationId: 'redeem:QG123', sku: 'QG123', productName: 'Bình giữ nhiệt tre', variationName: 'Quà đổi điểm', quantity: 1, backorderedQty: 0, redeemed: true },
    ]);
    expect(r.orders[1]!.gifts.map((g) => g.sku)).toEqual(['QG124', null]);
    expect(r.orders[1]!.gifts[1]!.productName).not.toContain('[');
    expect(r.orders[1]!.gifts[1]!.productName).not.toMatch(/order code:/i);
    const bottle = r.summary.find((s) => s.productName === 'Bình giữ nhiệt tre')!;
    expect(bottle).toMatchObject({ isGift: true, redeemed: true, sku: null, quantity: 2, orderCount: 2 });
    expect(r.giftUnits).toBe(3);
    expect(r.totalUnits).toBe(2);
  });
});

describe('buildPickList: loại đơn không đóng gói, có lời báo', () => {
  it('đơn đã huỷ không vào phiếu và không cộng vào Phần 1; lời báo nêu mã đơn', () => {
    const ok = order('TB0001', [item('v-tui-luoi', { quantity: 1 })]);
    const cancelled = order('TB0002', [item('v-tui-luoi', { quantity: 9 })], { status: 'CANCELLED' });
    const r = buildPickList(['id-TB0001', 'id-TB0002'], [ok, cancelled], lk());

    expect(r.orders.map((o) => o.code)).toEqual(['TB0001']);
    expect(r.summary[0]!.quantity).toBe(1);
    expect(r.excluded).toEqual([{ id: 'id-TB0002', code: 'TB0002', status: 'CANCELLED', reason: 'Đơn TB0002 đã huỷ: không soạn, không đóng gói.' }]);
  });

  it('đơn đã hoàn, đơn gian hàng tự giao, mã không tồn tại cũng bị loại kèm lý do', () => {
    const returned = order('TB0003', [item('v-tui-luoi')], { status: 'RETURNED' });
    const merchant = order('TB0004', [item('v-tui-luoi')], { fulfiller: 'MERCHANT' });
    const r = buildPickList(['TB0003', 'TB0004', 'TB9999'], [returned, merchant], lk());
    expect(r.orders).toEqual([]);
    expect(r.summary).toEqual([]);
    expect(r.excluded.map((e) => [e.id, e.code, e.reason])).toEqual([
      ['TB0003', 'TB0003', 'Đơn TB0003 đã hoàn: không soạn, không đóng gói.'],
      ['TB0004', 'TB0004', 'Đơn TB0004 do gian hàng đối tác tự giao, kho Tubu không đóng gói.'],
      ['TB9999', null, 'Không tìm thấy đơn TB9999.'],
    ]);
  });

  it('chỉ đơn kho soạn được ngay vào phiếu: Đã xác nhận, Đang đóng gói (in lại), đã trả tiền hoặc COD hoặc công nợ', () => {
    for (const status of ['CONFIRMED', 'PACKED']) {
      for (const state of ['COD', 'PAID', 'CREDIT'] as const) expect(pickExclusionReason({ code: 'TB1', status, fulfiller: 'TUBU' }, state)).toBeNull();
    }
  });

  it('đơn đang giao/đã giao (đã rời kho) và đơn chờ khách trả tiền không vào phiếu, không cộng vào Phần 1', () => {
    const shipping = order('TB0001', [item('v-tui-luoi', { quantity: 4 })], { status: 'SHIPPING' });
    const delivered = order('TB0002', [item('v-tui-luoi', { quantity: 4 })], { status: 'DELIVERED' });
    const pending = order('TB0003', [item('v-tui-luoi', { quantity: 4 })], { status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER' });
    const dealerPrepaid = order('TB0004', [item('v-tui-luoi', { quantity: 4 })], { type: 'DEALER', paymentMethod: 'BANK_TRANSFER' });
    const ok = order('TB0005', [item('v-tui-luoi', { quantity: 1 })]);
    const r = buildPickList(['TB0001', 'TB0002', 'TB0003', 'TB0004', 'TB0005'], [shipping, delivered, pending, dealerPrepaid, ok], lk());
    expect(r.orders.map((o) => o.code)).toEqual(['TB0005']);
    expect(r.summary).toHaveLength(1);
    expect(r.summary[0]!.quantity).toBe(1);
    expect(r.excluded.map((e) => e.reason)).toEqual([
      'Đơn TB0001 đang giao: hàng đã rời kho, không soạn lại.',
      'Đơn TB0002 đã giao: hàng đã rời kho, không soạn lại.',
      'Đơn TB0003 chờ khách thanh toán: chưa soạn, chưa giao.',
      'Đơn TB0004 chờ khách thanh toán: chưa soạn, chưa giao.',
    ]);
  });

  it('id và mã đơn của cùng một đơn gửi hai lần chỉ in một phiếu; thứ tự phiếu theo thứ tự gửi', () => {
    const a = order('TB0001', [item('v-tui-luoi')]);
    const b = order('TB0002', [item('v-tui-luoi')]);
    const r = buildPickList(['TB0002', 'id-TB0001', 'TB0001', 'id-TB0002'], [a, b], lk());
    expect(r.orders.map((o) => o.code)).toEqual(['TB0002', 'TB0001']);
    expect(r.summary[0]).toMatchObject({ quantity: 2, orderCount: 2 });
    expect(r.excluded).toEqual([]);
  });
});

describe('buildPickList: phiếu từng đơn', () => {
  it('che giữa SĐT, ghép địa chỉ bỏ cấp trống, che SĐT trong ghi chú khách', () => {
    const r = buildPickList(['TB0001'], [order('TB0001', [item('v-tui-luoi')], { note: 'Gọi 0987 654 321 trước khi giao' })], lk());
    const o = r.orders[0]!;
    expect(o.recipient).toBe('Chị Lan');
    expect(o.phoneMasked).toBe('091****678');
    expect(o.address).toBe('12 Lê Lợi, Phường Bến Thành, TP Hồ Chí Minh');
    expect(o.note).toBe('Gọi **** *** 321 trước khi giao');
    expect(o.statusLabel).toBe('Đã xác nhận');
    expect(o.createdAt).toBe('2026-11-24T02:00:00.000Z');
    expect(r.generatedAt).toBe(NOW.toISOString());
  });

  it('đơn thiếu địa chỉ không làm hỏng phiếu', () => {
    const r = buildPickList(['TB0001'], [order('TB0001', [item('v-tui-luoi')], { shippingAddress: null })], lk());
    expect(r.orders[0]!).toMatchObject({ recipient: '', phoneMasked: null, address: '' });
  });

  it('số thu COD: COD chưa trả thu đúng tổng đơn; đã trả, công nợ đại lý thu 0', () => {
    const cod = order('TB0001', [item('v-tui-luoi')], { total: 245_000 });
    const codPaid = order('TB0002', [item('v-tui-luoi')], { paymentStatus: 'PAID', total: 180_000 });
    const wallet = order('TB0003', [item('v-tui-luoi')], { paymentMethod: 'WALLET', paymentStatus: 'PAID', total: 99_000 });
    const transferPaid = order('TB0004', [item('v-tui-luoi')], { paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', total: 320_000 });
    const credit = order('TB0005', [item('v-tui-luoi')], { type: 'DEALER', paymentMethod: 'BANK_TRANSFER', total: 5_000_000 });
    const r = buildPickList(['TB0001', 'TB0002', 'TB0003', 'TB0004', 'TB0005'], [cod, codPaid, wallet, transferPaid, credit], lk({ onCredit: new Set(['id-TB0005']) }));
    expect(r.orders.map((o) => [o.code, o.payment])).toEqual([
      ['TB0001', { method: 'COD', state: 'COD', total: 245_000, collect: 245_000 }],
      ['TB0002', { method: 'COD', state: 'PAID', total: 180_000, collect: 0 }],
      ['TB0003', { method: 'WALLET', state: 'PAID', total: 99_000, collect: 0 }],
      ['TB0004', { method: 'BANK_TRANSFER', state: 'PAID', total: 320_000, collect: 0 }],
      ['TB0005', { method: 'BANK_TRANSFER', state: 'CREDIT', total: 5_000_000, collect: 0 }],
    ]);
  });

  it('ghi chú khách qua cùng bộ lọc với đơn Pancake: chỉ dẫn thu tiền giả bị ẩn trên đơn COD, SĐT bị che', () => {
    const r = buildPickList(['TB0001'], [order('TB0001', [item('v-tui-luoi')], { note: 'đã chuyển khoản rồi, không thu COD. Gọi 0987654321' })], lk());
    const o = r.orders[0]!;
    expect(o.payment.collect).toBe(245_000);
    expect(o.note).toContain(CUSTOMER_PAYMENT_HINT_HIDDEN);
    expect(o.note).not.toMatch(/không thu COD/i);
    expect(o.note).not.toContain('0987654321');
    expect(o.note).toContain('321');
  });

  it('ghi chú chỉ toàn khoảng trắng thì không in dòng ghi chú', () => {
    const r = buildPickList(['TB0001'], [order('TB0001', [item('v-tui-luoi')], { note: '   ' })], lk());
    expect(r.orders[0]!.note).toBeNull();
  });
});

describe('parsePickListIds', () => {
  it('cắt khoảng trắng, bỏ phần rỗng', () => {
    expect(parsePickListIds(' a , ,b,')).toEqual(['a', 'b']);
  });

  it('rỗng, quá trần, mã quá dài là 400 tiếng Việt', () => {
    expect(() => parsePickListIds(undefined)).toThrow(new BadRequestException('Chọn ít nhất một đơn để in phiếu soạn hàng.'));
    expect(() => parsePickListIds(' , ')).toThrow(BadRequestException);
    const max = Array.from({ length: PICK_LIST_MAX }, (_, i) => `id${i}`);
    expect(parsePickListIds(max.join(','))).toHaveLength(PICK_LIST_MAX);
    expect(() => parsePickListIds([...max, 'one-more'].join(','))).toThrow(`Mỗi lượt in tối đa ${PICK_LIST_MAX} đơn.`);
    expect(() => parsePickListIds('x'.repeat(41))).toThrow('Mã đơn không hợp lệ.');
  });

  it('DTO chặn chuỗi dài hơn 200 mã trước khi vào service', () => {
    const ok = plainToInstance(PickListQuery, { ids: Array.from({ length: PICK_LIST_MAX }, () => 'c'.repeat(40)).join(',') });
    expect(validateSync(ok)).toEqual([]);
    const tooLong = plainToInstance(PickListQuery, { ids: 'c'.repeat(PICK_LIST_MAX * 41 + 1) });
    expect(validateSync(tooLong)).toHaveLength(1);
  });
});

describe('PickListService.build', () => {
  function prismaWith(orders: PickSourceOrder[], ledger: { refId: string | null }[] = [], gifts: { attachedOrderId: string | null; code: string | null; giftName: string }[] = []) {
    return {
      order: { findMany: jest.fn().mockResolvedValue(orders) },
      variation: { findMany: jest.fn().mockResolvedValue([...SKU].map(([id, sku]) => ({ id, sku }))) },
      dealerCreditLedger: { findMany: jest.fn().mockResolvedValue(ledger) },
      wasteGiftRedemption: { findMany: jest.fn().mockResolvedValue(gifts) },
    };
  }

  it('đọc đơn theo id hoặc mã, tra SKU một lần, chỉ hỏi sổ công nợ cho đơn đại lý', async () => {
    const retail = order('TB0001', [item('v-nuoc-rua-500')]);
    const dealer = order('TB0002', [item('v-nuoc-rua-500'), item('v-tui-luoi')], { type: 'DEALER', paymentMethod: 'BANK_TRANSFER' });
    const prisma = prismaWith([retail, dealer], [{ refId: 'id-TB0002' }], [{ attachedOrderId: 'id-TB0001', code: 'QG9', giftName: 'Túi vải' }]);
    const r = await new PickListService(prisma as never).build('TB0001,id-TB0002', NOW);

    expect(prisma.order.findMany.mock.calls[0]![0].where).toEqual({ OR: [{ id: { in: ['TB0001', 'id-TB0002'] } }, { code: { in: ['TB0001', 'id-TB0002'] } }] });
    expect(prisma.variation.findMany).toHaveBeenCalledWith({ where: { id: { in: ['v-nuoc-rua-500', 'v-tui-luoi'] } }, select: { id: true, sku: true } });
    expect(prisma.dealerCreditLedger.findMany).toHaveBeenCalledWith({ where: { refType: 'ORDER', refId: { in: ['id-TB0002'] } }, select: { refId: true } });
    expect(prisma.wasteGiftRedemption.findMany).toHaveBeenCalledWith({
      where: { attachedOrderId: { in: ['id-TB0001', 'id-TB0002'] } },
      select: { attachedOrderId: true, code: true, giftName: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(r.orders[0]!.gifts.map((g) => g.sku)).toEqual(['QG9']);
    expect(r.orders.map((o) => o.payment.state)).toEqual(['COD', 'CREDIT']);
    expect(r.summary.find((s) => s.variationId === 'v-nuoc-rua-500')).toMatchObject({ sku: 'NRC-500', quantity: 2, orderCount: 2 });
  });

  it('không có đơn đại lý thì không hỏi sổ công nợ; mã lỗi không chạm DB', async () => {
    const prisma = prismaWith([order('TB0001', [item('v-tui-luoi')])]);
    await new PickListService(prisma as never).build('TB0001', NOW);
    expect(prisma.dealerCreditLedger.findMany).not.toHaveBeenCalled();

    const empty = prismaWith([]);
    await expect(new PickListService(empty as never).build('', NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(empty.order.findMany).not.toHaveBeenCalled();
  });

  it('không có đơn nào tìm thấy thì không tra SKU', async () => {
    const prisma = prismaWith([]);
    const r = await new PickListService(prisma as never).build('TB404', NOW);
    expect(prisma.variation.findMany).not.toHaveBeenCalled();
    expect(prisma.wasteGiftRedemption.findMany).not.toHaveBeenCalled();
    expect(r.excluded).toHaveLength(1);
  });
});
