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

  it('ended/all/không status: giảm dần; cursor → keyset (startAt, id) nhỏ hơn dòng cuối của trang trước, kể cả trùng startAt', async () => {
    const at = new Date('2026-11-04T10:00:00.000Z');
    for (const status of ['ended', 'all', undefined] as const) {
      const { service, findMany } = make([]);
      await service.listSalesPage({ status, cursor: `${at.toISOString()}|s005` });
      const arg = findMany.mock.calls[0]![0];
      expect(arg.orderBy).toEqual([{ startAt: 'desc' }, { id: 'desc' }]);
      expect(arg.where.AND).toContainEqual({ OR: [{ startAt: { lt: at } }, { startAt: at, id: { lt: 's005' } }] });
    }
  });

  it('open: đợt sớm nhất lên đầu (startAt tăng dần, id tăng dần) để đợt đang chạy không bị đẩy xuống trang sau; cursor so sánh lớn hơn', async () => {
    const at = new Date('2026-11-04T10:00:00.000Z');
    const first = make([]);
    await first.service.listSalesPage({ status: 'open' });
    expect(first.findMany.mock.calls[0]![0].orderBy).toEqual([{ startAt: 'asc' }, { id: 'asc' }]);
    const next = make([]);
    await next.service.listSalesPage({ status: 'open', cursor: `${at.toISOString()}|s005` });
    const arg = next.findMany.mock.calls[0]![0];
    expect(arg.orderBy).toEqual([{ startAt: 'asc' }, { id: 'asc' }]);
    expect(arg.where.AND).toContainEqual({ OR: [{ startAt: { gt: at } }, { startAt: at, id: { gt: 's005' } }] });
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

  it.each([
    ['rác'],
    ['+010000-01-01T00:00:00.000Z|x'], // năm ≥ 10000: JS coi hợp lệ nhưng Prisma không đổi được sang DateTime
    ['2026-11-04T10:00:00.000Z|a\u0000'], // NUL trong id làm Postgres báo 22021
    ['2026-11-04T10:00:00.000Z|'],
    ['2026-11-04T10:00:00Z|abc'],
  ])('cursor hỏng %j → 400 tiếng Việt, không query', async (cursor) => {
    const { service, findMany } = make([]);
    await expect(service.listSalesPage({ cursor })).rejects.toThrow('Con trỏ trang không hợp lệ.');
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
    [{ cursor: '+010000-01-01T00:00:00.000Z|x' }, 'Con trỏ trang không hợp lệ.'],
    [{ cursor: '2026-11-04T10:00:00.000Z|a\u0000' }, 'Con trỏ trang không hợp lệ.'],
  ])('%j → 400', async (q, msg) => {
    await expect(run(q)).rejects.toMatchObject({ response: { message: [expect.stringContaining(msg)] } });
  });
});
