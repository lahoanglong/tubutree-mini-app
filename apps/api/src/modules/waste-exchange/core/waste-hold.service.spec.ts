import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { WasteHoldService, type WasteCapUsage, type WasteHoldInput } from './waste-hold.service';

const NOW = new Date('2026-10-17T03:00:00.000Z');
const CFG = { laneDropoff: true, laneMailin: true, lanePickup: true, mailinMinPoints: 15_000, pickupMinPoints: 10_000, customerMonthlyCapPoints: 60_000, maxOpenRequests: 3, requestHoldDays: 7 };
const carton = { id: 'carton', code: 'CARTON', name: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1_000, dropsPerUnit: 2, gramsPerUnit: 300, dailyCapQty: 20, monthlyCapQty: 60, status: 'ACTIVE', hazardous: false };
const battery = { ...carton, id: 'pin', code: 'PIN', name: 'Pin cũ', unitLabel: 'viên', status: 'COMING_SOON', hazardous: true };
function setup(o: { items?: unknown[]; storedLines?: unknown[]; flags?: unknown; partner?: unknown; links?: string[]; usageRow?: unknown; usage?: Partial<WasteCapUsage>; available?: boolean } = {}) {
  const tx = {
    wasteItem: { findMany: jest.fn().mockResolvedValue(o.items ?? [carton]) },
    wasteRequestLine: { findMany: jest.fn().mockResolvedValue(o.storedLines ?? ((o.items ?? [carton]) as (typeof carton)[]).map((i) => ({ itemId: i.id, unitsPerPoint: i.unitsPerPoint, pointsPerGroup: i.pointsPerGroup, dropsPerUnit: i.dropsPerUnit, gramsPerUnit: i.gramsPerUnit }))) },
    wasteUserFlags: { findUnique: jest.fn().mockResolvedValue(o.flags ?? null) },
    wastePoint: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => (where.id === 'wh' ? { id: 'wh', kind: 'WAREHOUSE', monthlyQuotaPoints: null } : (o.partner === undefined ? { id: where.id, kind: 'PARTNER', monthlyQuotaPoints: 100_000 } : o.partner))) },
    wastePointItem: { findMany: jest.fn().mockResolvedValue((o.links ?? ['carton']).map((itemId) => ({ itemId }))) },
    wastePointUsage: { findUnique: jest.fn().mockResolvedValue(o.usageRow ?? null) },
  };
  const access = { availablePointIds: jest.fn(async (_db: unknown, ids: string[]) => new Set(o.available === false ? [] : ids)), warehousePoint: jest.fn().mockResolvedValue({ id: 'wh' }) };
  const svc = new WasteHoldService(access as never);
  jest.spyOn(svc, 'capUsage').mockResolvedValue({ itemDay: new Map(), itemMonth: new Map(), pointsMonth: 0, openCount: 0, pickupPendingCode: null, ...o.usage });
  return { svc, tx: tx as never, access, raw: tx };
}
const input = (o: Partial<WasteHoldInput> = {}): WasteHoldInput => ({ path: 'CREATE', userId: 'u1', method: 'DROP_OFF', lines: [{ itemId: 'carton', declaredQty: 5 }], pointId: 'p1', now: NOW, ...o });
const existing = { id: 'r1', pointId: 'p1', capDayKey: '2026-10-15', capMonthKey: '2026-10' };

describe('WasteHoldService.validateAndHold', () => {
  it('CREATE DROP_OFF: snapshot lines, totals, VN cap keys, expiresAt = now + requestHoldDays', async () => {
    const { svc, tx } = setup();
    await expect(svc.validateAndHold(tx, input(), CFG)).resolves.toEqual({
      pointId: 'p1', capDayKey: '2026-10-17', capMonthKey: '2026-10', expiresAt: new Date('2026-10-24T03:00:00.000Z'),
      lines: [{ itemId: 'carton', itemCode: 'CARTON', itemName: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1_000, dropsPerUnit: 2, gramsPerUnit: 300, declaredQty: 5, hazardous: false }],
      estimatedPoints: 5_000, estimatedDrops: 10,
    });
  });
  it('MAIL_IN and PICKUP resolve the warehouse; the body pointId is ignored', async () => {
    const { svc, tx } = setup();
    await expect(svc.validateAndHold(tx, input({ method: 'MAIL_IN', pointId: 'p9', lines: [{ itemId: 'carton', declaredQty: 15 }] }), CFG)).resolves.toMatchObject({ pointId: 'wh' });
  });
  it.each<[string, Parameters<typeof setup>[0], Partial<WasteHoldInput>, unknown]>([
    ['duplicate itemId lines', {}, { lines: [{ itemId: 'carton', declaredQty: 1 }, { itemId: 'carton', declaredQty: 2 }] }, new BadRequestException('Mỗi món chỉ khai một dòng')],
    ['DROP_OFF without point', {}, { pointId: null }, new BadRequestException('Hãy chọn điểm nhận')],
    ['over 2000000 points', { items: [{ ...carton, pointsPerGroup: 1_000_000, dailyCapQty: null, monthlyCapQty: null }] }, { lines: [{ itemId: 'carton', declaredQty: 3 }] }, new ConflictException('Một yêu cầu tối đa 2.000.000 điểm, hãy tách thành nhiều yêu cầu')],
    ['blockedAt', { flags: { blockedAt: NOW, shipLockedAt: null } }, {}, new ForbiddenException('Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree.')],
    ['ship-locked MAIL_IN', { flags: { blockedAt: null, shipLockedAt: NOW } }, { method: 'MAIL_IN', lines: [{ itemId: 'carton', declaredQty: 15 }] }, new ForbiddenException('Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.')],
    ['lane off', {}, {}, new ConflictException('Cách giao này đang tạm tắt, hãy chọn cách khác')],
    ['max open', { usage: { openCount: 3 } }, {}, new ConflictException('Bạn đang có 3 yêu cầu chưa xong, hãy hoàn tất hoặc huỷ bớt trước khi tạo thêm')],
    ['second unattached PICKUP', { usage: { pickupPendingCode: 'TR-AAAAA' } }, { method: 'PICKUP', lines: [{ itemId: 'carton', declaredQty: 10 }] }, new ConflictException('Bạn đã có yêu cầu thu kèm TR-AAAAA, hãy gắn vào đơn kế tiếp')],
    ['battery line (hazardous, never ACTIVE)', { items: [carton, battery], links: ['carton', 'pin'] }, { lines: [{ itemId: 'carton', declaredQty: 1 }, { itemId: 'pin', declaredQty: 1 }] }, new ConflictException('Món này hiện chưa nhận, hãy bỏ khỏi danh sách')],
    ['unknown item id', { items: [] }, { lines: [{ itemId: 'gone', declaredQty: 1 }] }, new ConflictException('Món này hiện chưa nhận, hãy bỏ khỏi danh sách')],
    ['point unavailable', { available: false }, {}, new ConflictException('Điểm nhận đang tạm ngừng, hãy chọn điểm khác')],
    ['quota full', { usageRow: { pointsUsed: 100_000 } }, {}, new ConflictException('Điểm nhận đã hết hạn mức tháng này, hãy chọn điểm khác')],
    ['point lacks an item', { links: [] }, {}, new ConflictException('Điểm nhận này không nhận: Thùng carton')],
    ['day cap DROP_OFF', { usage: { itemDay: new Map([['carton', 16]]) } }, {}, new ConflictException('Thùng carton: hôm nay bạn chỉ còn mang tới điểm nhận được 4 thùng')],
    ['month cap', { usage: { itemMonth: new Map([['carton', 58]]) } }, {}, new ConflictException('Thùng carton: tháng này bạn chỉ còn gửi được 2 thùng')],
    ['points cap', { usage: { pointsMonth: 57_000 } }, {}, new ConflictException('Tháng này bạn chỉ còn 3.000 Điểm Xanh trong trần đổi rác')],
    ['MAIL_IN below min', {}, { method: 'MAIL_IN', lines: [{ itemId: 'carton', declaredQty: 10 }] }, new ConflictException('Gói gửi về kho cần tối thiểu 15.000 điểm, bạn cần thêm 5.000 điểm nữa')],
    ['PICKUP below min', {}, { method: 'PICKUP', lines: [{ itemId: 'carton', declaredQty: 9 }] }, new ConflictException('Thu kèm đơn cần tối thiểu 10.000 điểm, bạn cần thêm 1.000 điểm nữa')],
    ['MAIL_IN min does not fit the month cap', { usage: { pointsMonth: 50_000 } }, { method: 'MAIL_IN', lines: [{ itemId: 'carton', declaredQty: 5 }] }, new ConflictException('Tháng này bạn không đủ trần tháng cho gói gửi kho')],
  ])('CREATE %s', async (name, o, inp, err) => {
    const { svc, tx } = setup(o);
    const cfg = name === 'lane off' ? { ...CFG, laneDropoff: false } : CFG;
    const call = svc.validateAndHold(tx, input(inp), cfg);
    await expect(call).rejects.toThrow(err as Error);
    await expect(call).rejects.toBeInstanceOf((err as Error).constructor);
  });
  it('the quota hint reads the usage row by (pointId, VN month key)', async () => {
    const { svc, tx, raw } = setup({ usageRow: { pointsUsed: 100_000 } });
    await expect(svc.validateAndHold(tx, input(), CFG)).rejects.toThrow('Điểm nhận đã hết hạn mức tháng này, hãy chọn điểm khác');
    expect(raw.wastePointUsage.findUnique).toHaveBeenCalledWith({ where: { pointId_monthKey: { pointId: 'p1', monthKey: '2026-10' } }, select: { pointsUsed: true } });
  });
  it('day cap is not checked for MAIL_IN (only DROP_OFF)', async () => {
    const { svc, tx } = setup({ usage: { itemDay: new Map([['carton', 20]]) } });
    await expect(svc.validateAndHold(tx, input({ method: 'MAIL_IN', lines: [{ itemId: 'carton', declaredQty: 15 }] }), CFG)).resolves.toMatchObject({ estimatedPoints: 15_000 });
  });
  it('an unknown point id or a missing warehouse is 409 POINT_UNAVAILABLE, never a 500', async () => {
    const a = setup({ available: false, partner: null });
    const call = a.svc.validateAndHold(a.tx, input({ pointId: 'nope' }), CFG);
    await expect(call).rejects.toThrow(new ConflictException('Điểm nhận đang tạm ngừng, hãy chọn điểm khác'));
    await expect(call).rejects.toBeInstanceOf(ConflictException);
    const b = setup({ available: false, partner: null });
    await expect(b.svc.evaluate(b.tx, input({ pointId: 'nope' }), CFG)).resolves.toMatchObject({ blocks: [{ code: 'POINT_UNAVAILABLE' }] });
    const c = setup();
    c.access.warehousePoint.mockResolvedValue(null);
    await expect(c.svc.validateAndHold(c.tx, input({ method: 'MAIL_IN', pointId: null, lines: [{ itemId: 'carton', declaredQty: 15 }] }), CFG)).rejects.toThrow('Điểm nhận đang tạm ngừng, hãy chọn điểm khác');
  });
  it('a PARTNER hidden from the customer lists for inactivity is still accepted on CREATE (spec 5.5: hiding affects only the two customer lists)', async () => {
    const { svc, tx, access } = setup({ partner: { id: 'p1', kind: 'PARTNER', monthlyQuotaPoints: 100_000, lastConfirmedAt: new Date('2026-07-01T00:00:00Z'), activatedAt: new Date('2026-06-01T00:00:00Z') } });
    await expect(svc.validateAndHold(tx, input(), CFG)).resolves.toMatchObject({ pointId: 'p1' });
    expect(access.availablePointIds).toHaveBeenCalled();
  });

  describe('EDIT path matrix (spec 11.2; 17.3 permission list)', () => {
    it('ignores lane flags and max open; keeps stored keys; expiresAt null; excludes itself from usage', async () => {
      const { svc, tx } = setup({ usage: { openCount: 3 } });
      const r = await svc.validateAndHold(tx, input({ path: 'EDIT', method: 'MAIL_IN', pointId: null, existing: { ...existing, pointId: 'wh' }, lines: [{ itemId: 'carton', declaredQty: 15 }] }), { ...CFG, laneMailin: false });
      expect(r).toMatchObject({ pointId: 'wh', capDayKey: '2026-10-15', capMonthKey: '2026-10', expiresAt: null });
      expect(svc.capUsage).toHaveBeenCalledWith(tx, 'u1', '2026-10-15', '2026-10', 'r1');
    });
    it('keeping an unavailable point is allowed; switching to an unavailable point is 409', async () => {
      const keep = setup({ available: false });
      await expect(keep.svc.validateAndHold(keep.tx, input({ path: 'EDIT', existing }), CFG)).resolves.toMatchObject({ pointId: 'p1' });
      expect(keep.access.availablePointIds).not.toHaveBeenCalled();
      const sw = setup({ available: false });
      await expect(sw.svc.validateAndHold(sw.tx, input({ path: 'EDIT', existing, pointId: 'p2' }), CFG)).rejects.toThrow('Điểm nhận đang tạm ngừng, hãy chọn điểm khác');
    });
    it('still checks ship lock, ACTIVE items, point items, day cap and min', async () => {
      const locked = setup({ flags: { blockedAt: null, shipLockedAt: NOW } });
      await expect(locked.svc.validateAndHold(locked.tx, input({ path: 'EDIT', method: 'PICKUP', pointId: null, existing: { ...existing, pointId: 'wh' }, lines: [{ itemId: 'carton', declaredQty: 10 }] }), CFG)).rejects.toBeInstanceOf(ForbiddenException);
      const pin = setup({ items: [battery], links: ['pin'] });
      await expect(pin.svc.validateAndHold(pin.tx, input({ path: 'EDIT', existing, lines: [{ itemId: 'pin', declaredQty: 1 }] }), CFG)).rejects.toThrow('Món này hiện chưa nhận, hãy bỏ khỏi danh sách');
      const day = setup({ usage: { itemDay: new Map([['carton', 18]]) } });
      await expect(day.svc.validateAndHold(day.tx, input({ path: 'EDIT', existing }), CFG)).rejects.toThrow('Thùng carton: hôm nay bạn chỉ còn mang tới điểm nhận được 2 thùng');
      const min = setup();
      await expect(min.svc.validateAndHold(min.tx, input({ path: 'EDIT', method: 'MAIL_IN', pointId: null, existing: { ...existing, pointId: 'wh' }, lines: [{ itemId: 'carton', declaredQty: 10 }] }), CFG)).rejects.toThrow('Gói gửi về kho cần tối thiểu 15.000 điểm, bạn cần thêm 5.000 điểm nữa');
      const pts = setup({ usage: { pointsMonth: 57_000 } });
      await expect(pts.svc.validateAndHold(pts.tx, input({ path: 'EDIT', existing }), CFG)).rejects.toThrow('Tháng này bạn chỉ còn 3.000 Điểm Xanh trong trần đổi rác');
    });
  });

  describe('REOPEN checks month caps only (spec 11.2)', () => {
    it('lane off, ship lock, item no longer ACTIVE, below min, max open: still passes', async () => {
      const { svc, tx } = setup({ flags: { blockedAt: null, shipLockedAt: NOW }, items: [{ ...carton, status: 'HIDDEN' }], usage: { openCount: 3 } });
      await expect(svc.validateAndHold(tx, input({ path: 'REOPEN', method: 'MAIL_IN', pointId: null, existing: { ...existing, pointId: 'wh' }, lines: [{ itemId: 'carton', declaredQty: 2 }] }), { ...CFG, laneMailin: false, mailinMinPoints: 50_000 })).resolves.toMatchObject({ estimatedPoints: 2_000, expiresAt: null });
    });
    it('month cap hit is 409', async () => {
      const { svc, tx } = setup({ usage: { itemMonth: new Map([['carton', 59]]) } });
      await expect(svc.validateAndHold(tx, input({ path: 'REOPEN', method: 'MAIL_IN', pointId: null, existing: { ...existing, pointId: 'wh' }, lines: [{ itemId: 'carton', declaredQty: 2 }] }), CFG)).rejects.toThrow('Thùng carton: tháng này bạn chỉ còn gửi được 1 thùng');
    });
    it('REOPEN prices its own share with the stored line rates, not the current item rates (spec 5.1, 11.2)', async () => {
      const { svc, tx } = setup({
        items: [{ ...carton, unitsPerPoint: 2 }],
        storedLines: [{ itemId: carton.id, unitsPerPoint: 1, pointsPerGroup: carton.pointsPerGroup, dropsPerUnit: carton.dropsPerUnit, gramsPerUnit: carton.gramsPerUnit }],
        usage: { pointsMonth: 45_000 },
      });
      await expect(svc.validateAndHold(tx, input({ path: 'REOPEN', method: 'MAIL_IN', pointId: null, existing: { ...existing, pointId: 'wh' }, lines: [{ itemId: 'carton', declaredQty: 20 }] }), CFG)).rejects.toThrow('Tháng này bạn chỉ còn 15.000 Điểm Xanh trong trần đổi rác');
    });
    it('REOPEN line without a stored snapshot is a programming error', async () => {
      const { svc, tx } = setup({ storedLines: [] });
      await expect(svc.validateAndHold(tx, input({ path: 'REOPEN', method: 'MAIL_IN', pointId: null, existing: { ...existing, pointId: 'wh' }, lines: [{ itemId: 'carton', declaredQty: 2 }] }), CFG)).rejects.toThrow('REOPEN line without stored snapshot');
    });
  });
});

describe('WasteHoldService.evaluate', () => {
  it('collects every block in check order with DTO fields, never throws for caps', async () => {
    const { svc, tx } = setup({ usage: { openCount: 3, pickupPendingCode: 'TR-BBBBB', itemMonth: new Map([['carton', 58]]), pointsMonth: 51_000 } });
    const { blocks, result } = await svc.evaluate(tx, input({ method: 'PICKUP', pointId: null, lines: [{ itemId: 'carton', declaredQty: 4 }] }), { ...CFG, lanePickup: false });
    expect(blocks).toEqual([
      { code: 'LANE_DISABLED' }, { code: 'MAX_OPEN', openCount: 3 }, { code: 'PICKUP_PENDING', pickupRequestCode: 'TR-BBBBB' },
      { code: 'ITEM_MONTH_CAP', itemId: 'carton' }, { code: 'MONTH_CAP_FOR_MIN', pointsRemaining: 9_000 },
    ]);
    expect(result).toMatchObject({ pointId: 'wh', estimatedPoints: 4_000, estimatedDrops: 8 });
  });
  it('DROP_OFF without a point skips the point checks and returns pointId empty', async () => {
    const { svc, tx } = setup();
    await expect(svc.evaluate(tx, input({ pointId: null }), CFG)).resolves.toMatchObject({ blocks: [], result: { pointId: '' } });
  });
  it('BELOW_MIN carries missingPoints; POINTS_MONTH_CAP carries pointsRemaining; ship lock is a block', async () => {
    const { svc, tx } = setup({ flags: { blockedAt: null, shipLockedAt: NOW }, usage: { pointsMonth: 40_000 } });
    const { blocks } = await svc.evaluate(tx, input({ method: 'MAIL_IN', pointId: null, lines: [{ itemId: 'carton', declaredQty: 12 }] }), CFG);
    expect(blocks).toEqual([{ code: 'SHIP_LOCKED' }, { code: 'BELOW_MIN', missingPoints: 3_000 }]);
    const p = setup({ usage: { pointsMonth: 58_000 } });
    expect((await p.svc.evaluate(p.tx, input(), CFG)).blocks).toEqual([{ code: 'POINTS_MONTH_CAP', pointsRemaining: 2_000 }]);
  });
  it('item and point blocks carry their DTO fields in COLLECT mode', async () => {
    const day = setup({ usage: { itemDay: new Map([['carton', 18]]) } });
    expect((await day.svc.evaluate(day.tx, input(), CFG)).blocks).toEqual([{ code: 'ITEM_DAY_CAP', itemId: 'carton' }]);
    const pin = setup({ items: [carton, battery], links: ['carton', 'pin'] });
    expect((await pin.svc.evaluate(pin.tx, input({ lines: [{ itemId: 'carton', declaredQty: 1 }, { itemId: 'pin', declaredQty: 1 }] }), CFG)).blocks).toEqual([{ code: 'ITEM_NOT_ACTIVE', itemId: 'pin' }]);
    const gone = setup({ available: false });
    expect((await gone.svc.evaluate(gone.tx, input(), CFG)).blocks).toEqual([{ code: 'POINT_UNAVAILABLE' }]);
    const full = setup({ usageRow: { pointsUsed: 100_000 } });
    expect((await full.svc.evaluate(full.tx, input(), CFG)).blocks).toEqual([{ code: 'POINT_QUOTA_FULL' }]);
    const missing = setup({ links: [] });
    expect((await missing.svc.evaluate(missing.tx, input(), CFG)).blocks).toEqual([{ code: 'POINT_MISSING_ITEMS', itemId: 'carton' }]);
  });
});
