import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { writeWasteEvent } from '../core/waste-events';
import { WasteAdminGiftsService } from './waste-admin-gifts.service';

jest.mock('../core/waste-events', () => ({
  ...jest.requireActual('../core/waste-events'),
  writeWasteEvent: jest.fn().mockResolvedValue({ id: 'ev-1' }),
}));

const writeEvent = writeWasteEvent as unknown as jest.Mock;

const row = (o: Record<string, unknown>) => ({
  id: 'g', kind: 'GIFT', name: 'Quà', description: null, label: null, pointsCost: 30_000, status: 'ACTIVE', sortOrder: 10, imageUrl: null,
  stock: null, claimInstructions: null, voucherType: null, voucherValue: null, voucherMinOrder: null, voucherMaxDiscount: null,
  voucherValidDays: null, createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'), ...o,
});
const FREESHIP_ROW = row({ id: 'reward-freeship', kind: 'VOUCHER', name: 'Miễn phí vận chuyển', pointsCost: 20_000, voucherType: 'FREESHIP', voucherValue: 0, voucherMinOrder: 99000, voucherValidDays: 30 });
const SEED_ROW = row({ id: 'gift-seed', kind: 'SEED_PACK', name: 'Gói hạt giống', pointsCost: 25_000, stock: 3 });
const TREE_ROW = row({ id: 'gift-tree', kind: 'TREE', name: 'Góp quỹ trồng cây', pointsCost: 0 });

const sqlOf = (call: unknown[]) => {
  const [strings] = call as [TemplateStringsArray, ...unknown[]];
  return strings.join('?');
};

function setup(role = 'ADMIN') {
  const wasteGift = {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => row(data)),
    update: jest.fn(async ({ data }: { data: Record<string, unknown>; where?: { id: string } }) => row(data)),
  };
  const wasteGiftRedemption = { groupBy: jest.fn().mockResolvedValue([]) };
  const plantedTree = { count: jest.fn().mockResolvedValue(0) };
  const $queryRaw = jest.fn().mockResolvedValue([]);
  const tx = { wasteGift, wasteGiftRedemption, plantedTree, $queryRaw };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'a1', role, isBlocked: false, mergedIntoId: null, phone: null }),
      findFirst: jest.fn().mockResolvedValue({ id: 'a1', role, isBlocked: false, mergedIntoId: null }),
    },
    wasteGift,
    wasteGiftRedemption,
    plantedTree,
    $queryRaw,
    $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
  };
  return { svc: new WasteAdminGiftsService(prisma as never), prisma, tx, wasteGift, wasteGiftRedemption, plantedTree, $queryRaw };
}

describe('WasteAdminGiftsService', () => {
  beforeEach(() => writeEvent.mockClear());

  it('list maps every gift with redemption counts, the voucher spec and the TREE fund total', async () => {
    const { svc, wasteGift, wasteGiftRedemption, plantedTree, $queryRaw } = setup();
    wasteGift.findMany.mockResolvedValue([FREESHIP_ROW, SEED_ROW, TREE_ROW]);
    wasteGiftRedemption.groupBy.mockResolvedValue([
      { giftId: 'reward-freeship', _count: { _all: 4 } },
      { giftId: 'gift-seed', _count: { _all: 2 } },
    ]);
    $queryRaw.mockResolvedValue([{ n: 7 }]);
    plantedTree.count.mockResolvedValue(31);

    const out = await svc.list('a1');

    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      id: 'reward-freeship',
      kind: 'VOUCHER',
      stock: null,
      redemptionCount: 4,
      voucher: { type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, validDays: 30 },
    });
    expect(out[0]).not.toHaveProperty('fundTreeTotal');
    expect(out[1]).toMatchObject({ id: 'gift-seed', kind: 'SEED_PACK', stock: 3, redemptionCount: 2, voucher: null });
    expect(out[1]).not.toHaveProperty('fundTreeTotal');
    expect(out[2]).toMatchObject({ id: 'gift-tree', kind: 'TREE', redemptionCount: 7, fundTreeTotal: 31 });
  });

  it('list counts only READY and FULFILLED redemptions and counts TREE by distinct reason', async () => {
    const { svc, wasteGift, wasteGiftRedemption, $queryRaw } = setup();
    wasteGift.findMany.mockResolvedValue([TREE_ROW]);
    $queryRaw.mockResolvedValue([{ n: 0 }]);

    await svc.list('a1');

    expect(wasteGift.findMany).toHaveBeenCalledWith({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    expect(wasteGiftRedemption.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['READY', 'FULFILLED'] } } }),
    );
    const sql = sqlOf($queryRaw.mock.calls[0]!);
    expect(sql).toContain('COUNT(DISTINCT "reason")');
    expect(sql).toContain(`'GAME_BUY_TREE:%'`);
  });

  it('create writes a HIDDEN GIFT with defaults and one GIFT_CREATED event', async () => {
    const { svc, wasteGift } = setup();

    const out = await svc.create('a1', { kind: 'GIFT', name: 'Túi vải Tubu', pointsCost: 30_000, stock: 50 });

    const data = wasteGift.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.id).toMatch(/^gift-[0-9a-f]{10}$/);
    expect(data).toMatchObject({ status: 'HIDDEN', sortOrder: 0, voucherType: null, stock: 50 });
    expect(writeEvent).toHaveBeenCalledTimes(1);
    expect(writeEvent.mock.calls[0]![1]).toMatchObject({
      kind: 'GIFT_CREATED',
      actorRole: 'ADMIN',
      meta: { giftId: data.id, before: null, after: { kind: 'GIFT', pointsCost: 30_000, stock: 50, status: 'HIDDEN' } },
    });
    expect(out.redemptionCount).toBe(0);
  });

  it('create writes the five voucher columns of a VOUCHER', async () => {
    const { svc, wasteGift } = setup();

    await svc.create('a1', {
      kind: 'VOUCHER',
      name: 'Giảm 20.000đ',
      pointsCost: 40_000,
      voucher: { type: 'AMOUNT', value: 20000, minOrder: 150000, maxDiscount: null, validDays: 14 },
    });

    expect(wasteGift.create.mock.calls[0]![0].data).toMatchObject({
      voucherType: 'AMOUNT',
      voucherValue: 20000,
      voucherMinOrder: 150000,
      voucherMaxDiscount: null,
      voucherValidDays: 14,
    });
  });

  it.each([
    ['no kind', { name: 'Quà', pointsCost: 1000 }, 'Chọn loại quà.'],
    ['TREE', { kind: 'TREE', name: 'Cây', pointsCost: 1000 }, 'Chỉ có một thẻ góp quỹ trồng cây, không tạo thêm.'],
    ['no pointsCost', { kind: 'GIFT', name: 'Quà' }, 'Nhập số điểm đổi từ 1 đến 2.000.000.'],
    ['VOUCHER without voucher', { kind: 'VOUCHER', name: 'Mã', pointsCost: 1000 }, 'Mã giảm giá cần loại giảm, giá trị và số ngày hiệu lực.'],
    [
      'SEED_PACK with voucher',
      { kind: 'SEED_PACK', name: 'Hạt', pointsCost: 1000, voucher: { type: 'FREESHIP', value: 0, minOrder: null, maxDiscount: null, validDays: 30 } },
      'Chỉ mã giảm giá mới có thông tin giảm giá.',
    ],
  ])('create rejects %s', async (_label, body, message) => {
    const { svc, wasteGift } = setup();

    await expect(svc.create('a1', body as never)).rejects.toThrow(new BadRequestException(message));

    expect(wasteGift.create).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it('update logs the committed stock under FOR UPDATE', async () => {
    const { svc, wasteGift, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([SEED_ROW]);

    await svc.update('a1', 'gift-seed', { stock: 10 });

    expect(sqlOf($queryRaw.mock.calls[0]!)).toContain('FOR UPDATE');
    expect(wasteGift.update).toHaveBeenCalledWith({ where: { id: 'gift-seed' }, data: { stock: 10 } });
    expect(writeEvent.mock.calls[0]![1]).toMatchObject({
      kind: 'GIFT_UPDATED',
      actorRole: 'ADMIN',
      meta: { giftId: 'gift-seed', before: { stock: 3 }, after: { stock: 10 } },
    });
  });

  it('update logs only the changed keys', async () => {
    const { svc, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([FREESHIP_ROW]);

    await svc.update('a1', 'reward-freeship', { pointsCost: 25_000, name: 'Miễn phí vận chuyển' });

    expect(writeEvent.mock.calls[0]![1].meta).toEqual({ giftId: 'reward-freeship', before: { pointsCost: 20_000 }, after: { pointsCost: 25_000 } });
  });

  it('update with the same values writes nothing and returns the DTO', async () => {
    const { svc, wasteGift, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([SEED_ROW]);

    const out = await svc.update('a1', 'gift-seed', { stock: 3, name: 'Gói hạt giống' });

    expect(wasteGift.update).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
    expect(out).toMatchObject({ id: 'gift-seed', stock: 3 });
  });

  it('update refuses to change the kind before opening a transaction', async () => {
    const { svc, prisma } = setup();

    await expect(svc.update('a1', 'gift-seed', { kind: 'GIFT' })).rejects.toThrow(new BadRequestException('Không đổi được loại quà.'));

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('update of an unknown id is a 404', async () => {
    const { svc, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([]);

    await expect(svc.update('a1', 'nope', { stock: 1 })).rejects.toThrow(new NotFoundException('Không tìm thấy quà.'));
  });

  it('update of the TREE card only allows name, order, image and status', async () => {
    const { svc, wasteGift, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([TREE_ROW]);

    await expect(svc.update('a1', 'gift-tree', { pointsCost: 10_000 })).rejects.toThrow(
      new BadRequestException('Thẻ góp quỹ trồng cây chỉ sửa được tên, thứ tự, ảnh và trạng thái.'),
    );
    expect(wasteGift.update).not.toHaveBeenCalled();

    await svc.update('a1', 'gift-tree', { name: 'Góp quỹ trồng cây Tubu', status: 'HIDDEN' });

    expect(wasteGift.update).toHaveBeenCalledTimes(1);
    expect(writeEvent).toHaveBeenCalledTimes(1);
  });

  it('update replaces the voucher columns and rejects an unsafe spec without writing', async () => {
    const { svc, wasteGift, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([FREESHIP_ROW]);

    await svc.update('a1', 'reward-freeship', { voucher: { type: 'PERCENT', value: 10, minOrder: 200000, maxDiscount: 50000, validDays: 30 } });

    expect(wasteGift.update.mock.calls[0]![0].data).toEqual({
      voucherType: 'PERCENT',
      voucherValue: 10,
      voucherMinOrder: 200000,
      voucherMaxDiscount: 50000,
      voucherValidDays: 30,
    });
    expect(writeEvent.mock.calls[0]![1].meta.before).toEqual({
      voucherType: 'FREESHIP',
      voucherValue: 0,
      voucherMinOrder: 99000,
      voucherMaxDiscount: null,
    });

    wasteGift.update.mockClear();
    writeEvent.mockClear();
    $queryRaw.mockResolvedValue([FREESHIP_ROW]);
    await expect(
      svc.update('a1', 'reward-freeship', { voucher: { type: 'PERCENT', value: 100, minOrder: null, maxDiscount: null, validDays: 30 } }),
    ).rejects.toThrow(new BadRequestException('Mã giảm từ 50% phải đặt Giảm tối đa (đ) để một đơn lớn không được giảm gần hết.'));
    expect(wasteGift.update).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it('reorder locks every gift first, then renumbers by tens and logs the old and new order', async () => {
    const { svc, wasteGift, $queryRaw } = setup();
    wasteGift.findMany.mockResolvedValue([FREESHIP_ROW, SEED_ROW, TREE_ROW]);

    await svc.reorder('a1', { ids: ['gift-tree', 'reward-freeship', 'gift-seed'] });

    expect(wasteGift.update.mock.calls.map((c) => [c[0].where!.id, c[0].data.sortOrder])).toEqual([
      ['gift-tree', 10],
      ['reward-freeship', 20],
      ['gift-seed', 30],
    ]);
    expect(writeEvent).toHaveBeenCalledTimes(1);
    expect(writeEvent.mock.calls[0]![1]).toMatchObject({
      kind: 'GIFTS_REORDERED',
      actorRole: 'ADMIN',
      meta: { before: { ids: ['reward-freeship', 'gift-seed', 'gift-tree'] }, after: { ids: ['gift-tree', 'reward-freeship', 'gift-seed'] } },
    });
    expect(sqlOf($queryRaw.mock.calls[0]!)).toContain('FROM "waste_gifts" ORDER BY "id" FOR NO KEY UPDATE');
    expect($queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(wasteGift.update.mock.invocationCallOrder[0]!);
  });

  it('reorder refuses a list that is not every gift exactly once', async () => {
    const { svc, wasteGift } = setup();
    wasteGift.findMany.mockResolvedValue([FREESHIP_ROW, SEED_ROW, TREE_ROW]);
    const message = 'Danh sách sắp xếp phải gồm đủ mọi quà, mỗi quà một lần.';

    for (const ids of [
      ['gift-tree', 'reward-freeship'],
      ['gift-tree', 'gift-tree', 'gift-seed'],
      ['gift-tree', 'reward-freeship', 'unknown'],
    ]) {
      await expect(svc.reorder('a1', { ids })).rejects.toThrow(new BadRequestException(message));
    }
    expect(wasteGift.update).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it('a STAFF caller cannot create', async () => {
    const { svc, wasteGift } = setup('STAFF');

    await expect(svc.create('a1', { kind: 'GIFT', name: 'Quà', pointsCost: 1000 })).rejects.toBeInstanceOf(ForbiddenException);

    expect(wasteGift.create).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it.each([
    [{ type: 'AMOUNT', value: 0, minOrder: null, maxDiscount: null, validDays: 30 }, 'Mức giảm phải lớn hơn 0.'],
    [{ type: 'PERCENT', value: 101, minOrder: null, maxDiscount: 50000, validDays: 30 }, 'Mức giảm theo % tối đa 100.'],
    [{ type: 'PERCENT', value: 100, minOrder: null, maxDiscount: null, validDays: 30 }, 'Mã giảm từ 50% phải đặt Giảm tối đa (đ) để một đơn lớn không được giảm gần hết.'],
    [{ type: 'AMOUNT', value: 5_000_001, minOrder: null, maxDiscount: null, validDays: 30 }, 'Mức giảm tối đa 5.000.000đ cho mã giảm theo số tiền.'],
    [
      { type: 'AMOUNT', value: 150000, minOrder: 150000, maxDiscount: null, validDays: 30 },
      'Mức giảm 150.000đ phải nhỏ hơn đơn tối thiểu 150.000đ — không thì đơn ở mức tối thiểu được giảm hết tiền hàng. Kiểm tra lại số 0 của hai ô.',
    ],
  ])('create rejects the unsafe voucher %j', async (voucher, message) => {
    const { svc, wasteGift } = setup();

    await expect(svc.create('a1', { kind: 'VOUCHER', name: 'Giảm', pointsCost: 1000, voucher } as never)).rejects.toThrow(new BadRequestException(message));

    expect(wasteGift.create).not.toHaveBeenCalled();
  });
});
