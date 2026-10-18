import { ForbiddenException } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { createValidationPipe } from '../../../common/validation-pipe';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteCatalogueService } from './waste-catalogue.service';
import { WasteCustomerController, WasteNearbyDto, WastePointsQueryDto } from './waste-customer.controller';
import { WasteMeService } from './waste-me.service';
import { WasteRequestsService } from './waste-requests.service';

const OFF = 'Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.';
const users: Record<string, unknown> = {
  real: { id: 'real', phone: '0901234567', zaloId: 'z1', isBlocked: false, mergedIntoId: null, wasteFlags: null },
  guest: { id: 'guest', phone: null, zaloId: 'guest_d', isBlocked: false, mergedIntoId: null, wasteFlags: null },
  blocked: { id: 'blocked', phone: '0901234568', zaloId: 'z2', isBlocked: false, mergedIntoId: null, wasteFlags: { blockedAt: new Date(), shipLockedAt: null } },
};
const svc = <T extends string>(...m: T[]) => Object.fromEntries(m.map((k) => [k, jest.fn().mockResolvedValue({ ok: k })])) as Record<T, jest.Mock>;
async function build(enabled: boolean) {
  const me = svc('me', 'rules');
  const catalogue = svc('listItems', 'listPoints', 'nearbyPoints');
  const requests = svc('list', 'detail', 'byOrder');
  const mod = await Test.createTestingModule({
    controllers: [WasteCustomerController],
    providers: [
      WasteAccessService,
      { provide: PrismaService, useValue: { user: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => users[where.id] ?? null) } } },
      { provide: WasteConfigService, useValue: { isEnabled: jest.fn().mockResolvedValue(enabled) } },
      { provide: WasteMeService, useValue: me },
      { provide: WasteCatalogueService, useValue: catalogue },
      { provide: WasteRequestsService, useValue: requests },
    ],
  }).compile();
  return { c: mod.get(WasteCustomerController), me, catalogue, requests };
}

describe('WasteCustomerController read routes (spec 15.1)', () => {
  it('/me and /rules need neither a real user nor the programme flag', async () => {
    const { c, me } = await build(false);
    await expect(c.me('guest')).resolves.toEqual({ ok: 'me' });
    await expect(c.rules()).resolves.toEqual({ ok: 'rules' });
    expect(me.me).toHaveBeenCalledWith('guest');
  });
  it('items, points, nearby are FULL: programme off, guest, blocked -> 403, service not called', async () => {
    const off = await build(false);
    await expect(off.c.items('real')).rejects.toThrow(new ForbiddenException(OFF));
    const on = await build(true);
    await expect(on.c.points('guest', {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(on.c.nearby('blocked', { locationToken: 't', zaloAccessToken: 'a' })).rejects.toThrow('Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree.');
    expect(on.catalogue.listPoints).not.toHaveBeenCalled();
    await expect(on.c.points('real', { provinceCode: '79' })).resolves.toEqual({ ok: 'listPoints' });
    expect(on.catalogue.listPoints).toHaveBeenCalledWith('79');
  });
  it('own reads are OWN: work with the programme off and for a blocked customer; guest 403', async () => {
    const { c, requests } = await build(false);
    await expect(c.list('blocked')).resolves.toEqual({ ok: 'list' });
    await expect(c.detail('blocked', 'r1')).resolves.toEqual({ ok: 'detail' });
    await expect(c.byOrder('real', 'o1')).resolves.toEqual({ ok: 'byOrder' });
    expect(requests.detail).toHaveBeenCalledWith('blocked', 'r1');
    expect(requests.byOrder).toHaveBeenCalledWith('real', 'o1');
    await expect(c.list('guest')).rejects.toThrow('Ưu đãi này chỉ dành cho tài khoản đã đăng nhập Zalo. Vui lòng đăng nhập bằng Zalo rồi thử lại.');
  });
  it('route table: paths, by-order declared before :id, nearby POST 200 with 30/min', () => {
    const p = WasteCustomerController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, WasteCustomerController)).toBe('waste');
    const routes = Object.getOwnPropertyNames(p).filter((k) => Reflect.getMetadata(METHOD_METADATA, (p as never)[k]) !== undefined).map((k) => [k, Reflect.getMetadata(METHOD_METADATA, (p as never)[k]), Reflect.getMetadata(PATH_METADATA, (p as never)[k])]);
    expect(routes).toEqual([
      ['me', 0, 'me'], ['rules', 0, 'rules'], ['items', 0, 'items'], ['points', 0, 'points'], ['nearby', 1, 'points/nearby'],
      ['list', 0, 'requests'], ['byOrder', 0, 'requests/by-order/:orderId'], ['detail', 0, 'requests/:id'],
    ]);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, p.nearby)).toBe(200);
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, p.nearby)).toBe(30);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, p.nearby)).toBe(60_000);
  });
});

describe('read DTOs (global ValidationPipe)', () => {
  const pipe = createValidationPipe();
  const run = (metatype: unknown, value: unknown, type: 'body' | 'query' = 'body') => pipe.transform(value, { type, metatype: metatype as never, data: '' });
  it('nearby: tokens only in the body, both required, bounded; extra fields rejected', async () => {
    await expect(run(WasteNearbyDto, { locationToken: 't', zaloAccessToken: 'a', provinceCode: '79' })).resolves.toBeInstanceOf(WasteNearbyDto);
    await expect(run(WasteNearbyDto, { zaloAccessToken: 'a' })).rejects.toThrow();
    await expect(run(WasteNearbyDto, { locationToken: 'x'.repeat(2049), zaloAccessToken: 'a' })).rejects.toThrow();
    await expect(run(WasteNearbyDto, { locationToken: 't', zaloAccessToken: 'x'.repeat(4097) })).rejects.toThrow();
    await expect(run(WasteNearbyDto, { locationToken: 't', zaloAccessToken: 'a', lat: 10 })).rejects.toThrow();
  });
  it('points query: optional provinceCode, at most 20 chars; no token field accepted', async () => {
    await expect(run(WastePointsQueryDto, {}, 'query')).resolves.toBeInstanceOf(WastePointsQueryDto);
    await expect(run(WastePointsQueryDto, { provinceCode: 'x'.repeat(21) }, 'query')).rejects.toThrow();
    await expect(run(WastePointsQueryDto, { locationToken: 't' }, 'query')).rejects.toThrow();
  });
});
