import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';
import { ListFlashSalesQuery } from './flash-sale-admin.controller';
import { createValidationPipe } from '../../common/validation-pipe';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { LifecycleService } from '../lifecycle/lifecycle.service';

const NOW = new Date('2026-11-05T03:00:00.000Z');
const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `s${String(n).padStart(3, '0')}`,
  title: `Đợt ${n}`,
  startAt: new Date(NOW.getTime() - n * 3_600_000),
  endAt: new Date(NOW.getTime() - n * 3_600_000 + 1_800_000),
  isActive: true,
  _count: { items: n % 4 },
  ...over,
});

function make(rows: unknown[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const findUnique = jest.fn();
  const prisma = { flashSale: { findMany, findUnique } } as unknown as PrismaService;
  const service = new FlashSaleService(prisma, {} as SystemConfigService, {} as NotificationsService, {} as LifecycleService);
  return { service, findMany, findUnique };
}

describe('FlashSaleService.listSalesPage (L4-06)', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('mặc định lấy 20 đợt, không kèm items, sắp startAt giảm dần rồi id giảm dần', async () => {
    const { service, findMany } = make([]);
    await service.listSalesPage({});
    const arg = findMany.mock.calls[0]![0];
    expect(arg.take).toBe(21);
    expect(arg.orderBy).toEqual([{ startAt: 'desc' }, { id: 'desc' }]);
    expect(arg.include).toBeUndefined();
    expect(arg.select.items).toBeUndefined();
    expect(arg.select._count).toEqual({ select: { items: true } });
  });

  it('trần 50 đợt mỗi trang, take nhỏ được giữ nguyên', async () => {
    const a = make([]);
    await a.service.listSalesPage({ take: '500' });
    expect(a.findMany.mock.calls[0]![0].take).toBe(51);
    const b = make([]);
    await b.service.listSalesPage({ take: '5' });
    expect(b.findMany.mock.calls[0]![0].take).toBe(6);
  });

  it('còn dòng thừa → nextCursor trỏ vào dòng cuối của trang; hết dòng → null', async () => {
    const rows = [row(1), row(2), row(3)];
    const { service } = make(rows);
    const page = await service.listSalesPage({ take: '2' });
    expect(page.items.map((s) => s.id)).toEqual(['s001', 's002']);
    expect(page.items[0]).toMatchObject({ itemCount: 1 });
    expect(page.items[0]).not.toHaveProperty('_count');
    expect(page.nextCursor).toBe(`${rows[1]!.startAt.toISOString()}|s002`);

    const last = await make([row(1), row(2)]).service.listSalesPage({ take: '2' });
    expect(last.nextCursor).toBeNull();
  });

  it('cursor → điều kiện keyset (startAt, id) nhỏ hơn dòng cuối của trang trước', async () => {
    const { service, findMany } = make([]);
    const at = new Date('2026-11-04T10:00:00.000Z');
    await service.listSalesPage({ cursor: `${at.toISOString()}|s005` });
    expect(findMany.mock.calls[0]![0].where).toEqual({ AND: [{ OR: [{ startAt: { lt: at } }, { startAt: at, id: { lt: 's005' } }] }] });
  });

  it('status open = chưa quá giờ kết thúc, ended = đã quá, all = không lọc', async () => {
    const open = make([]);
    await open.service.listSalesPage({ status: 'open' });
    expect(open.findMany.mock.calls[0]![0].where).toEqual({ AND: [{ endAt: { gte: NOW } }] });
    const ended = make([]);
    await ended.service.listSalesPage({ status: 'ended' });
    expect(ended.findMany.mock.calls[0]![0].where).toEqual({ AND: [{ endAt: { lt: NOW } }] });
    const all = make([]);
    await all.service.listSalesPage({ status: 'all' });
    expect(all.findMany.mock.calls[0]![0].where).toEqual({ AND: [] });
  });

  it('cursor hỏng → 400 tiếng Việt, không query', async () => {
    const { service, findMany } = make([]);
    await expect(service.listSalesPage({ cursor: 'rác' })).rejects.toThrow('Con trỏ trang không hợp lệ.');
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('FlashSaleService.getSale (mở một đợt, L4-06)', () => {
  it('trả đợt kèm items', async () => {
    const { service, findUnique } = make([]);
    findUnique.mockResolvedValue({ id: 's1', items: [{ id: 'i1' }] });
    await expect(service.getSale('s1')).resolves.toMatchObject({ id: 's1', items: [{ id: 'i1' }] });
    expect(findUnique.mock.calls[0]![0].include.items.select).toMatchObject({ variationId: true, flashPrice: true, quota: true, soldCount: true });
  });

  it('không có đợt → 404', async () => {
    const { service, findUnique } = make([]);
    findUnique.mockResolvedValue(null);
    await expect(service.getSale('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ListFlashSalesQuery (DTO)', () => {
  const pipe = createValidationPipe();
  const run = (value: Record<string, unknown>) => pipe.transform(value, { type: 'query', metatype: ListFlashSalesQuery, data: undefined });

  it('không truyền gì hoặc truyền đúng kiểu → hợp lệ', async () => {
    await expect(run({})).resolves.toBeDefined();
    await expect(run({ status: 'open', take: '20', cursor: '2026-11-04T10:00:00.000Z|s005' })).resolves.toBeDefined();
  });

  it.each([
    [{ status: 'live' }, 'Trạng thái chỉ nhận một trong: open, ended, all.'],
    [{ take: '0' }, 'Số dòng mỗi trang phải là số nguyên dương'],
    [{ take: '1.5' }, 'Số dòng mỗi trang phải là số nguyên dương'],
  ])('%j → 400', async (q, msg) => {
    await expect(run(q)).rejects.toMatchObject({ response: { message: [expect.stringContaining(msg)] } });
  });
});
