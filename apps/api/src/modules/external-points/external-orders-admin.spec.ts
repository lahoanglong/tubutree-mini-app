import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import { ExternalOrderListQueryDto, ExternalOrdersAdminController } from './external-orders-admin.controller';
import { ExternalOrdersAdminService } from './external-orders-admin.service';
import { DEFAULT_ORDER_SOURCE_MAP, ORDER_SOURCE_MAP_KEY } from './external-order.config';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'x1',
  pancakeOrderId: '910001',
  source: 'MARKETPLACE',
  channel: 'shopee',
  sourceKey: '-3|shopee_gian_hang|-3',
  trackingCode: 'SPXVN0123456789',
  trackingCodes: ['SPXVN0123456789', '2410101ABCDEF'],
  marketplaceOrderSn: '2410101ABCDEF',
  phone: '0912345678',
  phoneLast3: '678',
  goodsValue: 320_000,
  status: 'DELIVERED',
  ...over,
});

function setup(config: unknown = DEFAULT_ORDER_SOURCE_MAP) {
  const prisma = {
    externalOrder: {
      findMany: jest.fn().mockResolvedValue([row()]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue({ ...row(), lastPayload: { bill_phone_number: '0912345678' } }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const cfg = { get: jest.fn((k: string, d: unknown) => Promise.resolve(k === ORDER_SOURCE_MAP_KEY ? config : d)) };
  const service = new ExternalOrdersAdminService(prisma as never, cfg as never);
  return { service, prisma, ctrl: new ExternalOrdersAdminController(service) };
}

describe('ExternalOrdersAdminController — quyền và đường dẫn', () => {
  it('ADMIN và nhóm CSKH, chỉ đọc (không có route ghi)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ExternalOrdersAdminController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, ExternalOrdersAdminController)).toEqual(['CSKH']);
    expect(Reflect.getMetadata(PATH_METADATA, ExternalOrdersAdminController)).toBe('admin/external-orders');
    const methods = Object.getOwnPropertyNames(ExternalOrdersAdminController.prototype).filter((n) => n !== 'constructor');
    for (const name of methods) {
      const h = ExternalOrdersAdminController.prototype[name as 'list'] as unknown as object;
      expect(RequestMethod[Reflect.getMetadata(METHOD_METADATA, h) as number]).toBe('GET');
    }
  });
});

describe('ExternalOrderListQueryDto', () => {
  it('nhận bộ lọc hợp lệ, từ chối nguồn/trạng thái lạ', () => {
    expect(validateSync(plainToInstance(ExternalOrderListQueryDto, { q: ' SPX123 ', source: 'CHAT', status: 'OPEN', page: '2' }))).toHaveLength(0);
    expect(validateSync(plainToInstance(ExternalOrderListQueryDto, { source: 'FACEBOOK' })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(ExternalOrderListQueryDto, { status: 'PAID' })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(ExternalOrderListQueryDto, { q: 'x'.repeat(101) })).length).toBeGreaterThan(0);
  });
});

describe('ExternalOrdersAdminService.list', () => {
  const whereOf = (p: ReturnType<typeof setup>['prisma']) => (p.externalOrder.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;

  it('che SĐT, không trả payload thô', async () => {
    const { service } = setup();
    const res = await service.list({ page: 1, limit: 20 });
    expect(res.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(res.data[0]).toMatchObject({ phone: '091****678', phoneLast3: '678', goodsValue: 320_000 });
    expect(JSON.stringify(res)).not.toContain('0912345678');
    expect(res.data[0]).not.toHaveProperty('lastPayload');
  });

  it('không lọc gì thì where rỗng', async () => {
    const t = setup();
    await t.service.list({ page: 1, limit: 20 });
    expect(whereOf(t.prisma)).toEqual({});
  });

  it('tìm theo mã vận đơn: chuẩn hoá chữ hoa/bỏ gạch, khớp mảng mã, mã đơn Pancake và mã đơn sàn', async () => {
    const t = setup();
    await t.service.list({ page: 1, limit: 20, q: ' spx-vn 0123456789 ' });
    expect(whereOf(t.prisma)).toEqual({ OR: [{ pancakeOrderId: 'spx-vn 0123456789' }, { trackingCodes: { has: 'SPXVN0123456789' } }] });
  });

  it('tìm theo SĐT đầy đủ (mọi dạng gõ) so với số đã chuẩn hoá', async () => {
    const t = setup();
    await t.service.list({ page: 1, limit: 20, q: '+84 912 345 678' });
    expect(whereOf(t.prisma).OR).toEqual(expect.arrayContaining([{ phone: '0912345678' }]));
  });

  it('SĐT che hoặc chuỗi ngắn không tạo điều kiện tìm theo SĐT', () => {
    const { service } = setup();
    expect(service.searchWhere('091****678')).toEqual({ OR: [{ pancakeOrderId: '091****678' }] });
    expect(service.searchWhere('abc')).toEqual({ OR: [{ pancakeOrderId: 'abc' }] });
  });

  it('lọc theo nguồn và trạng thái, phân trang', async () => {
    const t = setup();
    await t.service.list({ page: 3, limit: 10, source: 'CHAT', status: 'OPEN' });
    const args = t.prisma.externalOrder.findMany.mock.calls[0]![0] as { where: unknown; skip: number; take: number };
    expect(args.where).toEqual({ source: 'CHAT', status: 'OPEN' });
    expect([args.skip, args.take]).toEqual([20, 10]);
  });
});

describe('ExternalOrdersAdminService.detail', () => {
  it('ADMIN thấy payload thô, SĐT vẫn che ở các field', async () => {
    const { ctrl } = setup();
    const res = (await ctrl.detail('x1', { sub: 'a', role: 'ADMIN' } as never)) as Record<string, unknown>;
    expect(res['lastPayload']).toEqual({ bill_phone_number: '0912345678' });
    expect(res['phone']).toBe('091****678');
  });

  it('nhân viên CSKH không thấy payload thô', async () => {
    const { ctrl } = setup();
    const res = (await ctrl.detail('x1', { sub: 's', role: 'STAFF', staffPermissions: ['CSKH'] } as never)) as Record<string, unknown>;
    expect(res).not.toHaveProperty('lastPayload');
    expect(JSON.stringify(res)).not.toContain('0912345678');
  });

  it('không có đơn thì 404', async () => {
    const { service, prisma } = setup();
    prisma.externalOrder.findUnique.mockResolvedValue(null);
    await expect(service.detail('none', true)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ExternalOrdersAdminService.sources', () => {
  const group = (sourceKey: string, source: string, n: number, at = '2026-10-18T01:00:00.000Z') => ({
    sourceKey,
    source,
    _count: { _all: n },
    _max: { updatedAt: new Date(at) },
  });

  it('gom theo sourceKey, đếm theo loại đang lưu, loại hiện hành theo bản đồ', async () => {
    const t = setup({ marketplaceIds: { '-3': 'shopee' }, chatSources: ['-1|fanpage_mau|'] });
    t.prisma.externalOrder.groupBy.mockResolvedValue([
      group('-3|shopee_a|-3', 'MARKETPLACE', 5),
      group('-1|fanpage_mau|', 'UNKNOWN', 2, '2026-10-18T03:00:00.000Z'),
      group('-1|fanpage_mau|', 'CHAT', 1),
      group('-9|lazada_a|-4', 'UNKNOWN', 1),
      group('-8|ecom_a|-77', 'MARKETPLACE', 4),
    ]);
    const { sources, truncated } = await t.service.sources();
    expect(truncated).toBe(false);
    const by = Object.fromEntries(sources.map((s) => [s.sourceKey, s]));
    expect(by['-3|shopee_a|-3']).toMatchObject({ total: 5, currentKind: 'MARKETPLACE', currentChannel: 'shopee', marketplaceId: '-3', account: 'shopee_a' });
    expect(by['-1|fanpage_mau|']).toMatchObject({ total: 3, bySource: { UNKNOWN: 2, CHAT: 1 }, currentKind: 'CHAT', orderSources: '-1', marketplaceId: '' });
    expect(by['-1|fanpage_mau|']!.lastSeenAt?.toISOString()).toBe('2026-10-18T03:00:00.000Z');
    expect(by['-9|lazada_a|-4']).toMatchObject({ currentKind: 'UNKNOWN', currentChannel: null });
    expect(by['-8|ecom_a|-77']).toMatchObject({ currentKind: 'MARKETPLACE', currentChannel: null });
    expect(sources[0]!.sourceKey).toBe('-3|shopee_a|-3');
  });

  it('bản đồ hỏng trong DB: dùng mặc định', async () => {
    const t = setup('rác');
    t.prisma.externalOrder.groupBy.mockResolvedValue([group('-4|lazada|-4', 'UNKNOWN', 1)]);
    const { sources } = await t.service.sources();
    expect(sources[0]).toMatchObject({ currentKind: 'MARKETPLACE', currentChannel: 'lazada' });
  });
});
