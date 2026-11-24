import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { buildPickList, isGiftLine, pickExclusionReason, PICK_LIST_MAX, type PickSourceItem, type PickSourceOrder } from './pick-list';
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

describe('buildPickList: Phần 1 gộp theo biến thể', () => {
  it('cùng biến thể ở nhiều đơn gộp một dòng (cộng số lượng, đếm số đơn); hai biến thể cùng sản phẩm là hai dòng', () => {
    const a = order('TB0001', [item('v-nuoc-rua-500', { productName: 'Nước rửa chén', variationName: '500ml', quantity: 2 }), item('v-nuoc-rua-1l', { productName: 'Nước rửa chén', variationName: '1L' })]);
    const b = order('TB0002', [item('v-nuoc-rua-500', { productName: 'Nước rửa chén', variationName: '500ml', quantity: 3 })]);
    const r = buildPickList(['id-TB0001', 'id-TB0002'], [a, b], SKU, new Set(), NOW);

    expect(r.summary).toEqual([
      { variationId: 'v-nuoc-rua-1l', sku: 'NRC-1000', productName: 'Nước rửa chén', variationName: '1L', quantity: 1, backorderedQty: 0, isGift: false, orderCount: 1 },
      { variationId: 'v-nuoc-rua-500', sku: 'NRC-500', productName: 'Nước rửa chén', variationName: '500ml', quantity: 5, backorderedQty: 0, isGift: false, orderCount: 2 },
    ]);
    expect(r.totalUnits).toBe(6);
    expect(r.giftUnits).toBe(0);
    expect(r.orderCount).toBe(2);
  });

  it('một đơn có hai dòng cùng biến thể vẫn chỉ đếm một đơn', () => {
    const a = order('TB0001', [item('v-tui-luoi', { quantity: 1 }), item('v-tui-luoi', { quantity: 2 })]);
    const r = buildPickList(['TB0001'], [a], SKU, new Set(), NOW);
    expect(r.summary).toHaveLength(1);
    expect(r.summary[0]).toMatchObject({ quantity: 3, orderCount: 1 });
  });

  it('biến thể không còn trong danh mục: mã SKU null, vẫn in theo tên đã chụp lúc đặt', () => {
    const r = buildPickList(['TB0001'], [order('TB0001', [item('v-da-xoa', { productName: 'Hàng cũ' })])], SKU, new Set(), NOW);
    expect(r.summary[0]).toMatchObject({ sku: null, productName: 'Hàng cũ' });
    expect(r.orders[0]!.items[0]!.sku).toBeNull();
  });

  it('cộng dồn phần đặt trước (chưa có hàng) để kho biết số nhặt được', () => {
    const a = order('TB0001', [item('v-tui-luoi', { quantity: 5, backorderedQty: 2 })], { type: 'DEALER' });
    const b = order('TB0002', [item('v-tui-luoi', { quantity: 1, backorderedQty: 1 })], { type: 'DEALER' });
    const r = buildPickList(['TB0001', 'TB0002'], [a, b], SKU, new Set(), NOW);
    expect(r.summary[0]).toMatchObject({ quantity: 6, backorderedQty: 3, orderCount: 2 });
  });
});

describe('buildPickList: quà 0đ tách riêng', () => {
  it('cùng biến thể vừa bán vừa tặng: hai dòng tổng, quà xếp sau hàng bán; phiếu từng đơn để quà ở mục riêng', () => {
    const a = order('TB0001', [item('v-tui-luoi', { quantity: 2 }), item('v-tui-luoi', { unitPrice: 0, isGift: true, quantity: 1 })]);
    const b = order('TB0002', [item('v-tui-luoi', { unitPrice: 0, isGift: true, quantity: 1 })]);
    const r = buildPickList(['TB0001', 'TB0002'], [a, b], SKU, new Set(), NOW);

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
    const r = buildPickList(['TB0001'], [order('TB0001', [item('v-tui-luoi', { unitPrice: 0 })])], SKU, new Set(), NOW);
    expect(r.summary[0]!.isGift).toBe(true);
    expect(r.orders[0]!.gifts).toHaveLength(1);
  });
});

describe('buildPickList: loại đơn không đóng gói, có lời báo', () => {
  it('đơn đã huỷ không vào phiếu và không cộng vào Phần 1; lời báo nêu mã đơn', () => {
    const ok = order('TB0001', [item('v-tui-luoi', { quantity: 1 })]);
    const cancelled = order('TB0002', [item('v-tui-luoi', { quantity: 9 })], { status: 'CANCELLED' });
    const r = buildPickList(['id-TB0001', 'id-TB0002'], [ok, cancelled], SKU, new Set(), NOW);

    expect(r.orders.map((o) => o.code)).toEqual(['TB0001']);
    expect(r.summary[0]!.quantity).toBe(1);
    expect(r.excluded).toEqual([{ id: 'id-TB0002', code: 'TB0002', status: 'CANCELLED', reason: 'Đơn TB0002 đã huỷ: không soạn, không đóng gói.' }]);
  });

  it('đơn đã hoàn, đơn gian hàng tự giao, mã không tồn tại cũng bị loại kèm lý do', () => {
    const returned = order('TB0003', [item('v-tui-luoi')], { status: 'RETURNED' });
    const merchant = order('TB0004', [item('v-tui-luoi')], { fulfiller: 'MERCHANT' });
    const r = buildPickList(['TB0003', 'TB0004', 'TB9999'], [returned, merchant], SKU, new Set(), NOW);
    expect(r.orders).toEqual([]);
    expect(r.summary).toEqual([]);
    expect(r.excluded.map((e) => [e.id, e.code, e.reason])).toEqual([
      ['TB0003', 'TB0003', 'Đơn TB0003 đã hoàn: không soạn, không đóng gói.'],
      ['TB0004', 'TB0004', 'Đơn TB0004 do gian hàng đối tác tự giao, kho Tubu không đóng gói.'],
      ['TB9999', null, 'Không tìm thấy đơn TB9999.'],
    ]);
  });

  it('các trạng thái còn đi hàng không bị loại', () => {
    for (const status of ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED']) {
      expect(pickExclusionReason({ code: 'TB1', status, fulfiller: 'TUBU' })).toBeNull();
    }
  });

  it('id và mã đơn của cùng một đơn gửi hai lần chỉ in một phiếu; thứ tự phiếu theo thứ tự gửi', () => {
    const a = order('TB0001', [item('v-tui-luoi')]);
    const b = order('TB0002', [item('v-tui-luoi')]);
    const r = buildPickList(['TB0002', 'id-TB0001', 'TB0001', 'id-TB0002'], [a, b], SKU, new Set(), NOW);
    expect(r.orders.map((o) => o.code)).toEqual(['TB0002', 'TB0001']);
    expect(r.summary[0]).toMatchObject({ quantity: 2, orderCount: 2 });
    expect(r.excluded).toEqual([]);
  });
});

describe('buildPickList: phiếu từng đơn', () => {
  it('che giữa SĐT, ghép địa chỉ bỏ cấp trống, che SĐT trong ghi chú khách', () => {
    const r = buildPickList(['TB0001'], [order('TB0001', [item('v-tui-luoi')], { note: 'Gọi 0987 654 321 trước khi giao' })], SKU, new Set(), NOW);
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
    const r = buildPickList(['TB0001'], [order('TB0001', [item('v-tui-luoi')], { shippingAddress: null })], SKU, new Set(), NOW);
    expect(r.orders[0]!).toMatchObject({ recipient: '', phoneMasked: null, address: '' });
  });

  it('số thu COD: COD chưa trả thu đúng tổng đơn; đã trả, công nợ đại lý, chờ chuyển khoản thu 0', () => {
    const cod = order('TB0001', [item('v-tui-luoi')], { total: 245_000 });
    const codPaid = order('TB0002', [item('v-tui-luoi')], { paymentStatus: 'PAID', total: 180_000 });
    const wallet = order('TB0003', [item('v-tui-luoi')], { paymentMethod: 'WALLET', paymentStatus: 'PAID', total: 99_000 });
    const transfer = order('TB0004', [item('v-tui-luoi')], { paymentMethod: 'BANK_TRANSFER', status: 'PENDING_PAYMENT', total: 320_000 });
    const credit = order('TB0005', [item('v-tui-luoi')], { type: 'DEALER', paymentMethod: 'BANK_TRANSFER', total: 5_000_000 });
    const r = buildPickList(['TB0001', 'TB0002', 'TB0003', 'TB0004', 'TB0005'], [cod, codPaid, wallet, transfer, credit], SKU, new Set(['id-TB0005']), NOW);
    expect(r.orders.map((o) => [o.code, o.payment])).toEqual([
      ['TB0001', { method: 'COD', state: 'COD', total: 245_000, collect: 245_000 }],
      ['TB0002', { method: 'COD', state: 'PAID', total: 180_000, collect: 0 }],
      ['TB0003', { method: 'WALLET', state: 'PAID', total: 99_000, collect: 0 }],
      ['TB0004', { method: 'BANK_TRANSFER', state: 'AWAITING_TRANSFER', total: 320_000, collect: 0 }],
      ['TB0005', { method: 'BANK_TRANSFER', state: 'CREDIT', total: 5_000_000, collect: 0 }],
    ]);
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
  function prismaWith(orders: PickSourceOrder[], ledger: { refId: string | null }[] = []) {
    return {
      order: { findMany: jest.fn().mockResolvedValue(orders) },
      variation: { findMany: jest.fn().mockResolvedValue([...SKU].map(([id, sku]) => ({ id, sku }))) },
      dealerCreditLedger: { findMany: jest.fn().mockResolvedValue(ledger) },
    };
  }

  it('đọc đơn theo id hoặc mã, tra SKU một lần, chỉ hỏi sổ công nợ cho đơn đại lý', async () => {
    const retail = order('TB0001', [item('v-nuoc-rua-500')]);
    const dealer = order('TB0002', [item('v-nuoc-rua-500'), item('v-tui-luoi')], { type: 'DEALER', paymentMethod: 'BANK_TRANSFER' });
    const prisma = prismaWith([retail, dealer], [{ refId: 'id-TB0002' }]);
    const r = await new PickListService(prisma as never).build('TB0001,id-TB0002', NOW);

    expect(prisma.order.findMany.mock.calls[0]![0].where).toEqual({ OR: [{ id: { in: ['TB0001', 'id-TB0002'] } }, { code: { in: ['TB0001', 'id-TB0002'] } }] });
    expect(prisma.variation.findMany).toHaveBeenCalledWith({ where: { id: { in: ['v-nuoc-rua-500', 'v-tui-luoi'] } }, select: { id: true, sku: true } });
    expect(prisma.dealerCreditLedger.findMany).toHaveBeenCalledWith({ where: { refType: 'ORDER', refId: { in: ['id-TB0002'] } }, select: { refId: true } });
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
    expect(r.excluded).toHaveLength(1);
  });
});
