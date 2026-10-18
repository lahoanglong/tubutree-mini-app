import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { writeWasteEvent } from '../core/waste-events';
import { WasteAdminItemsService } from './waste-admin-items.service';

jest.mock('../core/waste-events', () => ({
  ...jest.requireActual('../core/waste-events'),
  writeWasteEvent: jest.fn().mockResolvedValue({ id: 'ev-1' }),
}));

const writeEvent = writeWasteEvent as unknown as jest.Mock;

const p2002 = (target: string) =>
  new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target}`, { code: 'P2002', clientVersion: 'test', meta: { target } });

const carton = {
  id: 'i1', code: 'CARTON', name: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 2, pointsPerGroup: 1000, dropsPerUnit: 1, dailyCapQty: null,
  monthlyCapQty: 40, status: 'ACTIVE', prepInstructions: null, imageUrl: null, sortOrder: 10, gramsPerUnit: 300, hazardous: false,
  createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-02T00:00:00Z'),
};
const battery = { ...carton, id: 'i9', code: 'PIN', status: 'COMING_SOON', hazardous: true };

const sqlOf = (call: unknown[]) => {
  const [strings] = call as [TemplateStringsArray, ...unknown[]];
  return strings.join('?');
};

function setup(role = 'ADMIN') {
  const wasteItem = {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
  };
  const $queryRaw = jest.fn().mockResolvedValue([]);
  const tx = { wasteItem, $queryRaw };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'a1', role, isBlocked: false, mergedIntoId: null, phone: null }) },
    wasteItem,
    $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
  };
  return { svc: new WasteAdminItemsService(prisma as never), prisma, tx, wasteItem, $queryRaw };
}

describe('WasteAdminItemsService', () => {
  beforeEach(() => writeEvent.mockClear());

  it('list maps every item with ISO dates in sortOrder then code order', async () => {
    const { svc, wasteItem } = setup();
    wasteItem.findMany.mockResolvedValue([carton, battery]);

    const out = await svc.list('a1');

    expect(wasteItem.findMany).toHaveBeenCalledWith({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'i1', code: 'CARTON', unitsPerPoint: 2, hazardous: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' });
    expect(out[1]).toMatchObject({ id: 'i9', hazardous: true, status: 'COMING_SOON' });
  });

  it('create applies defaults and logs ITEM_CREATED with before null', async () => {
    const { svc, wasteItem } = setup();
    wasteItem.create.mockResolvedValue({ ...carton, id: 'i2', code: 'HOP_SUA', unitsPerPoint: 5, dropsPerUnit: 0 });

    await svc.create('a1', { code: 'HOP_SUA', name: 'Vỏ hộp sữa', unitLabel: 'vỏ', unitsPerPoint: 5, pointsPerGroup: 1000 });

    expect(wasteItem.create).toHaveBeenCalledWith({
      data: {
        code: 'HOP_SUA', name: 'Vỏ hộp sữa', unitLabel: 'vỏ', unitsPerPoint: 5, pointsPerGroup: 1000, dropsPerUnit: 0, dailyCapQty: null,
        monthlyCapQty: null, status: 'HIDDEN', prepInstructions: null, imageUrl: null, sortOrder: 0, gramsPerUnit: null, hazardous: false,
      },
    });
    expect(writeEvent).toHaveBeenCalledTimes(1);
    expect(writeEvent.mock.calls[0]![1]).toMatchObject({
      kind: 'ITEM_CREATED',
      actorUserId: 'a1',
      actorRole: 'ADMIN',
      meta: { itemId: 'i2', before: null, after: { code: 'HOP_SUA', unitsPerPoint: 5, pointsPerGroup: 1000, dropsPerUnit: 0, hazardous: false } },
    });
  });

  it('create rejects a hazardous item set to ACTIVE', async () => {
    const { svc, wasteItem } = setup();
    await expect(
      svc.create('a1', { code: 'PIN', name: 'Pin', unitLabel: 'viên', unitsPerPoint: 1, pointsPerGroup: 1000, hazardous: true, status: 'ACTIVE' }),
    ).rejects.toThrow(new BadRequestException('Món nguy hại không được đặt Đang nhận.'));
    expect(wasteItem.create).not.toHaveBeenCalled();
  });

  it('create maps a P2002 on code to a 409', async () => {
    const { svc, wasteItem } = setup();
    wasteItem.create.mockRejectedValue(p2002('code'));
    await expect(svc.create('a1', { code: 'CARTON', name: 'x', unitLabel: 'x', unitsPerPoint: 1, pointsPerGroup: 1000 })).rejects.toThrow(
      new ConflictException('Mã món đã tồn tại.'),
    );
  });

  it('update logs a rate change with before and after and reads the row FOR UPDATE', async () => {
    const { svc, wasteItem, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([carton]);
    wasteItem.update.mockResolvedValue({ ...carton, unitsPerPoint: 3 });

    await svc.update('a1', 'i1', { unitsPerPoint: 3 });

    expect(sqlOf($queryRaw.mock.calls[0]!)).toContain('FOR UPDATE');
    expect(wasteItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { unitsPerPoint: 3 } });
    expect(writeEvent.mock.calls[0]![1]).toMatchObject({
      kind: 'ITEM_UPDATED',
      actorUserId: 'a1',
      actorRole: 'ADMIN',
      meta: { itemId: 'i1', before: { unitsPerPoint: 2 }, after: { unitsPerPoint: 3 } },
    });
  });

  it('update logs pointsPerGroup and dropsPerUnit changes together', async () => {
    const { svc, wasteItem, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([carton]);
    wasteItem.update.mockResolvedValue({ ...carton, pointsPerGroup: 2000, dropsPerUnit: 0 });

    await svc.update('a1', 'i1', { pointsPerGroup: 2000, dropsPerUnit: 0 });

    expect(writeEvent.mock.calls[0]![1].meta).toEqual({
      itemId: 'i1',
      before: { pointsPerGroup: 1000, dropsPerUnit: 1 },
      after: { pointsPerGroup: 2000, dropsPerUnit: 0 },
    });
  });

  it('update never clears the hazardous flag', async () => {
    const { svc, wasteItem, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([battery]);
    await expect(svc.update('a1', 'i9', { hazardous: false })).rejects.toThrow(new BadRequestException('Không gỡ được cờ nguy hại của món.'));
    expect(wasteItem.update).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it('update hazardous false on an item that is not hazardous changes nothing', async () => {
    const { svc, wasteItem, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([carton]);

    const out = await svc.update('a1', 'i1', { hazardous: false });

    expect(out).toMatchObject({ id: 'i1', code: 'CARTON', hazardous: false });
    expect(wasteItem.update).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it('update refuses ACTIVE on a hazardous item', async () => {
    const { svc, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([battery]);
    await expect(svc.update('a1', 'i9', { status: 'ACTIVE' })).rejects.toThrow(new BadRequestException('Món nguy hại không được đặt Đang nhận.'));
  });

  it('update refuses to flag an ACTIVE item hazardous', async () => {
    const { svc, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([carton]);
    await expect(svc.update('a1', 'i1', { hazardous: true })).rejects.toThrow(
      new BadRequestException('Món đang nhận không bật được cờ nguy hại; hãy chuyển món sang Sắp nhận hoặc Ẩn trước.'),
    );
  });

  it('update accepts hazardous together with a non-ACTIVE status', async () => {
    const { svc, wasteItem, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([carton]);
    wasteItem.update.mockResolvedValue({ ...carton, hazardous: true, status: 'HIDDEN' });

    await svc.update('a1', 'i1', { hazardous: true, status: 'HIDDEN' });

    expect(writeEvent.mock.calls[0]![1].meta).toMatchObject({
      before: { hazardous: false, status: 'ACTIVE' },
      after: { hazardous: true, status: 'HIDDEN' },
    });
  });

  it('update accepts guidance text on a hazardous item', async () => {
    const { svc, wasteItem, $queryRaw } = setup();
    const text = 'Sạch, khô, mở nắp và để riêng ra cho bạn đổi một cái pin tại điểm thu gom của phường';
    $queryRaw.mockResolvedValue([battery]);
    wasteItem.update.mockResolvedValue({ ...battery, prepInstructions: text });

    await expect(svc.update('a1', 'i9', { prepInstructions: text })).resolves.toMatchObject({ id: 'i9', prepInstructions: text });
    expect(writeEvent.mock.calls[0]![1].meta).toMatchObject({ before: { prepInstructions: null }, after: { prepInstructions: text } });
  });

  it('update with the same values writes nothing', async () => {
    const { svc, wasteItem, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([carton]);

    await svc.update('a1', 'i1', { unitsPerPoint: 2, name: 'Thùng carton', dailyCapQty: null });

    expect(wasteItem.update).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it('update of an unknown id is a 404', async () => {
    const { svc } = setup();
    await expect(svc.update('a1', 'nope', { name: 'x' })).rejects.toThrow(new NotFoundException('Không tìm thấy món.'));
  });

  it('update maps a P2002 on code to a 409', async () => {
    const { svc, wasteItem, $queryRaw } = setup();
    $queryRaw.mockResolvedValue([carton]);
    wasteItem.update.mockRejectedValue(p2002('code'));
    await expect(svc.update('a1', 'i1', { code: 'PIN' })).rejects.toThrow(new ConflictException('Mã món đã tồn tại.'));
  });

  it('reorder locks every row first, writes sortOrder in steps of 10 and logs one event', async () => {
    const { svc, wasteItem, $queryRaw } = setup();
    wasteItem.findMany.mockResolvedValue([carton, battery]);

    await svc.reorder('a1', { ids: ['i9', 'i1'] });

    expect(sqlOf($queryRaw.mock.calls[0]!)).toContain('FROM "waste_items" ORDER BY "id" FOR UPDATE');
    expect(wasteItem.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 'i9' }, data: { sortOrder: 10 } },
      { where: { id: 'i1' }, data: { sortOrder: 20 } },
    ]);
    expect($queryRaw.mock.invocationCallOrder[0]).toBeLessThan(wasteItem.update.mock.invocationCallOrder[0]!);
    expect(writeEvent).toHaveBeenCalledTimes(1);
    expect(writeEvent.mock.calls[0]![1]).toMatchObject({
      kind: 'ITEMS_REORDERED',
      meta: { before: { ids: ['i1', 'i9'] }, after: { ids: ['i9', 'i1'] } },
    });

    await expect(svc.reorder('a1', { ids: ['i9'] })).rejects.toThrow(new BadRequestException('Danh sách sắp xếp phải gồm đủ mọi món, mỗi món một lần.'));
  });

  it('a STAFF caller is forbidden and nothing is written', async () => {
    const { svc, prisma, wasteItem } = setup('STAFF');
    await expect(svc.list('a1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.create('a1', { code: 'AB', name: 'x', unitLabel: 'x', unitsPerPoint: 1, pointsPerGroup: 1000 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.update('a1', 'i1', { name: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.reorder('a1', { ids: ['i1'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(wasteItem.create).not.toHaveBeenCalled();
    expect(wasteItem.update).not.toHaveBeenCalled();
    expect(writeEvent).not.toHaveBeenCalled();
  });
});
