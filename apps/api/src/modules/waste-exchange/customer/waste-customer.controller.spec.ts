import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { createValidationPipe } from '../../../common/validation-pipe';
import { parseTreeBuyKey } from '../../game/tree-purchase-key';
import { PrismaService } from '../../../prisma/prisma.service';
import { WASTE_MAX_REQUEST_LINES } from '../waste.constants';
import { WasteConfirmDto } from '../receiving/waste-receiving.dto';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteCatalogueService } from './waste-catalogue.service';
import { ReturnPackagingQueryDto, WasteCreateDto, WasteCustomerController, WasteEditDto, WasteNearbyDto, WastePickupQuoteDto, WastePointsQueryDto, WastePreviewDto, WasteTrackingDto } from './waste-customer.controller';
import { WasteMeService } from './waste-me.service';
import { WastePreviewService } from './waste-preview.service';
import { WasteRequestsService } from './waste-requests.service';
import { WasteReturnPackagingService } from './waste-return-packaging.service';

const OFF = 'Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.';
const users: Record<string, unknown> = {
  real: { id: 'real', phone: '0901234567', zaloId: 'z1', isBlocked: false, mergedIntoId: null, wasteFlags: null },
  guest: { id: 'guest', phone: null, zaloId: 'guest_d', isBlocked: false, mergedIntoId: null, wasteFlags: null },
  nophone: { id: 'nophone', phone: null, zaloId: 'z3', isBlocked: false, mergedIntoId: null, wasteFlags: null },
  blocked: { id: 'blocked', phone: '0901234568', zaloId: 'z2', isBlocked: false, mergedIntoId: null, wasteFlags: { blockedAt: new Date(), shipLockedAt: null } },
};
const svc = <T extends string>(...m: T[]) => Object.fromEntries(m.map((k) => [k, jest.fn().mockResolvedValue({ ok: k })])) as Record<T, jest.Mock>;
async function build(enabled: boolean) {
  const me = svc('me', 'rules', 'openCount');
  const catalogue = svc('listItems', 'listPoints', 'nearbyPoints', 'publicWarehouses');
  const requests = svc('list', 'detail', 'feeQr', 'byOrder', 'create', 'edit', 'setTracking', 'cancel', 'pickupQuote');
  const preview = svc('preview');
  const packaging = { forOrder: jest.fn().mockResolvedValue(null) };
  const mod = await Test.createTestingModule({
    controllers: [WasteCustomerController],
    providers: [
      WasteAccessService,
      { provide: PrismaService, useValue: { user: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => users[where.id] ?? null) } } },
      { provide: WasteConfigService, useValue: { isEnabled: jest.fn().mockResolvedValue(enabled) } },
      { provide: WasteMeService, useValue: me },
      { provide: WasteCatalogueService, useValue: catalogue },
      { provide: WasteRequestsService, useValue: requests },
      { provide: WastePreviewService, useValue: preview },
      { provide: WasteReturnPackagingService, useValue: packaging },
    ],
  }).compile();
  return { c: mod.get(WasteCustomerController), me, catalogue, requests, preview, packaging };
}

describe('WasteCustomerController read routes (spec 15.1)', () => {
  it('U6-B03: /rules là route công khai (trang thể lệ web cho khách chưa đăng nhập), /me và /items thì không', () => {
    const proto = WasteCustomerController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.rules!)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.publicCatalogue!)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.publicWarehouses!)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.points!)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.me!)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.items!)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, WasteCustomerController)).toBeUndefined();
  });
  it('/me and /rules need neither a real user nor the programme flag', async () => {
    const { c, me } = await build(false);
    await expect(c.me('guest')).resolves.toEqual({ ok: 'me' });
    await expect(c.rules()).resolves.toEqual({ ok: 'rules' });
    expect(me.me).toHaveBeenCalledWith('guest');
  });
  it('/warehouses: công khai, không qua cổng khách, trả nguyên kết quả của dịch vụ', async () => {
    const { c, catalogue } = await build(false);
    await expect(c.publicWarehouses()).resolves.toEqual({ ok: 'publicWarehouses' });
    expect(catalogue.publicWarehouses).toHaveBeenCalledWith();
  });
  it('/me/open-count: cần đăng nhập (không công khai), chạy cả khi chương trình tắt, truyền đúng userId', async () => {
    const proto = WasteCustomerController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.openCount!)).toBeUndefined();
    const { c, me } = await build(false);
    await expect(c.openCount('blocked')).resolves.toEqual({ ok: 'openCount' });
    expect(me.openCount).toHaveBeenCalledWith('blocked');
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
  it('return-packaging is FULL and returns the service suggestion for the caller and order code', async () => {
    const off = await build(false);
    await expect(off.c.returnPackagingOf('real', { orderCode: 'TT1' })).rejects.toThrow(new ForbiddenException(OFF));
    const on = await build(true);
    await expect(on.c.returnPackagingOf('blocked', { orderCode: 'TT1' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(on.packaging.forOrder).not.toHaveBeenCalled();
    const suggestion = { orderCodes: ['TT1'], lines: [], estimatedPoints: 0, minPoints: 3000 };
    on.packaging.forOrder.mockResolvedValueOnce(suggestion);
    await expect(on.c.returnPackagingOf('real', { orderCode: 'TT1' })).resolves.toEqual({ suggestion });
    expect(on.packaging.forOrder).toHaveBeenCalledWith('real', 'TT1');
    await expect(on.c.returnPackagingOf('real', { orderCode: 'TT2' })).resolves.toEqual({ suggestion: null });
  });
  it('ReturnPackagingQueryDto: orderCode bắt buộc, cắt khoảng trắng, tối đa 32 ký tự', () => {
    const check = (v: unknown) => validateSync(plainToInstance(ReturnPackagingQueryDto, v));
    expect(check({ orderCode: ' TT1 ' })).toHaveLength(0);
    expect(plainToInstance(ReturnPackagingQueryDto, { orderCode: ' TT1 ' }).orderCode).toBe('TT1');
    expect(check({})).not.toHaveLength(0);
    expect(check({ orderCode: '   ' })).not.toHaveLength(0);
    expect(check({ orderCode: 'X'.repeat(33) })).not.toHaveLength(0);
  });
  it('own reads are OWN: work with the programme off and for a blocked customer; guest 403', async () => {
    const { c, requests } = await build(false);
    await expect(c.list('blocked')).resolves.toEqual({ ok: 'list' });
    await expect(c.detail('blocked', 'r1')).resolves.toEqual({ ok: 'detail' });
    await expect(c.feeQr('blocked', 'r1')).resolves.toEqual({ ok: 'feeQr' });
    await expect(c.byOrder('real', 'o1')).resolves.toEqual({ ok: 'byOrder' });
    expect(requests.detail).toHaveBeenCalledWith('blocked', 'r1');
    expect(requests.feeQr).toHaveBeenCalledWith('blocked', 'r1');
    expect(requests.byOrder).toHaveBeenCalledWith('real', 'o1');
    await expect(c.list('guest')).rejects.toThrow('Ưu đãi này chỉ dành cho tài khoản đã đăng nhập Zalo. Bạn đăng nhập bằng Zalo rồi thử lại nhé.');
  });
  it('route table: paths, by-order declared before :id, nearby POST 200 with 30/min', () => {
    const p = WasteCustomerController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, WasteCustomerController)).toBe('waste');
    const routes = Object.getOwnPropertyNames(p).filter((k) => Reflect.getMetadata(METHOD_METADATA, (p as never)[k]) !== undefined).map((k) => [k, Reflect.getMetadata(METHOD_METADATA, (p as never)[k]), Reflect.getMetadata(PATH_METADATA, (p as never)[k])]);
    expect(routes).toEqual([
      ['me', 0, 'me'], ['openCount', 0, 'me/open-count'], ['rules', 0, 'rules'], ['publicCatalogue', 0, 'catalogue'], ['publicWarehouses', 0, 'warehouses'], ['items', 0, 'items'], ['points', 0, 'points'], ['returnPackagingOf', 0, 'return-packaging'], ['nearby', 1, 'points/nearby'], ['preview', 1, 'preview'], ['pickupQuote', 1, 'pickup-quote'],
      ['list', 0, 'requests'], ['byOrder', 0, 'requests/by-order/:orderId'], ['detail', 0, 'requests/:id'], ['feeQr', 0, 'requests/:id/fee-qr'], ['create', 1, 'requests'], ['edit', 4, 'requests/:id'],
      ['setTracking', 2, 'requests/:id/tracking'], ['cancel', 1, 'requests/:id/cancel'],
    ]);
    expect(Reflect.getMetadata('__headers__', p.publicCatalogue)).toEqual([{ name: 'Cache-Control', value: 'public, max-age=60' }]);
    expect(Reflect.getMetadata('__headers__', p.publicWarehouses)).toEqual([{ name: 'Cache-Control', value: 'public, max-age=300' }]);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, p.nearby)).toBe(200);
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, p.nearby)).toBe(30);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, p.nearby)).toBe(60_000);
  });
});

describe('WasteCustomerController.preview (spec 15.2)', () => {
  it('FULL gate: programme off 403 and the service is not called; otherwise the body is passed through', async () => {
    const off = await build(false);
    await expect(off.c.preview('real', { lines: [{ itemId: 'carton', declaredQty: 2 }] })).rejects.toThrow(new ForbiddenException(OFF));
    expect(off.preview.preview).not.toHaveBeenCalled();
    const on = await build(true);
    const body = { lines: [{ itemId: 'carton', declaredQty: 2 }], method: 'MAIL_IN' as const };
    await expect(on.c.preview('real', body)).resolves.toEqual({ ok: 'preview' });
    expect(on.preview.preview).toHaveBeenCalledWith('real', body);
  });
  it('POST 200 with 60/min', () => {
    const p = WasteCustomerController.prototype;
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, p.preview)).toBe(200);
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, p.preview)).toBe(60);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, p.preview)).toBe(60_000);
  });
});

describe('WasteCustomerController.pickupQuote (W168 shipper lấy rác tận nhà)', () => {
  const body = { addressId: 'a1', declaredWeightGrams: 2000, lines: [{ itemId: 'carton', declaredQty: 5 }] };
  it('FULL gate: chương trình tắt, khách khách/chưa có số điện thoại/bị chặn đều 403 và dịch vụ không được gọi; còn lại body đi thẳng xuống dịch vụ', async () => {
    const on = await build(true);
    await expect(on.c.pickupQuote('guest', body)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(on.c.pickupQuote('nophone', body)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(on.c.pickupQuote('blocked', body)).rejects.toBeInstanceOf(ForbiddenException);
    const off = await build(false);
    await expect(off.c.pickupQuote('real', body)).rejects.toThrow(new ForbiddenException(OFF));
    expect(on.requests.pickupQuote).not.toHaveBeenCalled();
    expect(off.requests.pickupQuote).not.toHaveBeenCalled();
    await expect(on.c.pickupQuote('real', body)).resolves.toEqual({ ok: 'pickupQuote' });
    expect(on.requests.pickupQuote).toHaveBeenCalledWith('real', body);
  });
  it('POST pickup-quote trả 200, 30 lần mỗi phút (mỗi lần có thể gọi Gomdon báo phí)', () => {
    const p = WasteCustomerController.prototype;
    expect(Reflect.getMetadata(METHOD_METADATA, p.pickupQuote)).toBe(1);
    expect(Reflect.getMetadata(PATH_METADATA, p.pickupQuote)).toBe('pickup-quote');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, p.pickupQuote)).toBe(200);
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, p.pickupQuote)).toBe(30);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, p.pickupQuote)).toBe(60_000);
  });
  it.each([
    [{ addressId: 'a1', declaredWeightGrams: 499, lines: [{ itemId: 'a', declaredQty: 1 }] }],
    [{ addressId: 'a1', declaredWeightGrams: 10_001, lines: [{ itemId: 'a', declaredQty: 1 }] }],
    [{ addressId: 'a1', declaredWeightGrams: 1500.5, lines: [{ itemId: 'a', declaredQty: 1 }] }],
    [{ declaredWeightGrams: 2000, lines: [{ itemId: 'a', declaredQty: 1 }] }],
    [{ addressId: '', declaredWeightGrams: 2000, lines: [{ itemId: 'a', declaredQty: 1 }] }],
    [{ addressId: 'a1', declaredWeightGrams: 2000, lines: [] }],
    [{ addressId: 'a1', declaredWeightGrams: 2000, lines: [{ itemId: 'a', declaredQty: 0 }] }],
    [{ addressId: 'a1', declaredWeightGrams: 2000, lines: [{ itemId: 'a', declaredQty: 1 }], method: 'HOME_PICKUP' }],
  ])('DTO từ chối %j', async (bad) => {
    const pipe = createValidationPipe();
    await expect(pipe.transform(bad, { type: 'body', metatype: WastePickupQuoteDto as never, data: '' })).rejects.toThrow();
  });
  it('DTO nhận body đúng, biên 500 g và 10.000 g', async () => {
    const pipe = createValidationPipe();
    for (const w of [500, 2000, 10_000]) {
      await expect(pipe.transform({ ...body, declaredWeightGrams: w }, { type: 'body', metatype: WastePickupQuoteDto as never, data: '' })).resolves.toBeInstanceOf(WastePickupQuoteDto);
    }
  });
});

describe('WasteCustomerController.create (spec 11.2, 15.1)', () => {
  const body = { method: 'DROP_OFF' as const, pointId: 'p1', lines: [{ itemId: 'carton', declaredQty: 5 }], consent: true as const };
  const invalidKey = (() => { try { parseTreeBuyKey('bad'); } catch (e) { return (e as Error).message; } return ''; })();
  it('FULL gate runs before the key: guest, no phone, waste-blocked and programme off are 403; the service is not called', async () => {
    const on = await build(true);
    await expect(on.c.create('guest', undefined, body)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(on.c.create('nophone', 'key-00000001', body)).rejects.toThrow(new ForbiddenException('Bạn cần chia sẻ số điện thoại để dùng Đổi rác lấy quà.'));
    await expect(on.c.create('blocked', 'key-00000001', body)).rejects.toThrow(new ForbiddenException('Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree.'));
    const off = await build(false);
    await expect(off.c.create('real', 'key-00000001', body)).rejects.toThrow(new ForbiddenException(OFF));
    expect(on.requests.create).not.toHaveBeenCalled();
    expect(off.requests.create).not.toHaveBeenCalled();
  });
  it('Idempotency-Key: missing or malformed is 400; a valid key reaches the service with the body', async () => {
    const { c, requests } = await build(true);
    await expect(c.create('real', undefined, body)).rejects.toThrow(new BadRequestException('Thiếu Idempotency-Key: cần 8 đến 128 ký tự gồm chữ cái, chữ số, dấu gạch dưới (_) hoặc gạch nối (-).'));
    await expect(c.create('real', 'short', body)).rejects.toThrow(new BadRequestException(invalidKey));
    expect(requests.create).not.toHaveBeenCalled();
    await expect(c.create('real', 'key-00000001', body)).resolves.toEqual({ ok: 'create' });
    expect(requests.create).toHaveBeenCalledWith('real', 'key-00000001', body);
  });
  it('POST requests with 10/min', () => {
    const p = WasteCustomerController.prototype;
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, p.create)).toBe(10);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, p.create)).toBe(60_000);
  });
});

describe('WasteCustomerController.edit (spec 15.2 PATCH)', () => {
  const body = { lines: [{ itemId: 'carton', declaredQty: 2 }] };
  it('FULL gate: programme off and a waste-blocked customer are 403 and the service is not called (spec 17.3)', async () => {
    const off = await build(false);
    await expect(off.c.edit('real', 'r1', body)).rejects.toThrow(new ForbiddenException(OFF));
    const on = await build(true);
    await expect(on.c.edit('blocked', 'r1', body)).rejects.toThrow('Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree.');
    expect(off.requests.edit).not.toHaveBeenCalled();
    expect(on.requests.edit).not.toHaveBeenCalled();
    await expect(on.c.edit('real', 'r1', body)).resolves.toEqual({ ok: 'edit' });
    expect(on.requests.edit).toHaveBeenCalledWith('real', 'r1', body);
  });
  it('PATCH requests/:id with 10/min', () => {
    const p = WasteCustomerController.prototype;
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, p.edit)).toBe(10);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, p.edit)).toBe(60_000);
  });
});

describe('WasteCustomerController.setTracking and cancel (spec 15.1 OWN)', () => {
  const body = { carrier: 'GHTK', trackingCode: 'S1' };
  it('OWN gate: programme off and a waste-blocked customer still reach the service; guest and no phone are 403', async () => {
    const off = await build(false);
    await expect(off.c.setTracking('blocked', 'r1', body)).resolves.toEqual({ ok: 'setTracking' });
    await expect(off.c.cancel('blocked', 'r1')).resolves.toEqual({ ok: 'cancel' });
    expect(off.requests.setTracking).toHaveBeenCalledWith('blocked', 'r1', body);
    expect(off.requests.cancel).toHaveBeenCalledWith('blocked', 'r1');
    const on = await build(true);
    await expect(on.c.setTracking('guest', 'r1', body)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(on.c.cancel('nophone', 'r1')).rejects.toThrow(new ForbiddenException('Bạn cần chia sẻ số điện thoại để dùng Đổi rác lấy quà.'));
    expect(on.requests.setTracking).not.toHaveBeenCalled();
    expect(on.requests.cancel).not.toHaveBeenCalled();
  });
  it('PUT tracking and POST cancel with 10/min; cancel answers 200', () => {
    const p = WasteCustomerController.prototype;
    for (const m of [p.setTracking, p.cancel]) {
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, m)).toBe(10);
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, m)).toBe(60_000);
    }
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, p.cancel)).toBe(200);
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
  it.each([
    [{ lines: Array.from({ length: 51 }, () => ({ itemId: 'a', declaredQty: 1 })) }],
    [{ lines: [] }],
    [{ lines: [{ itemId: 'a', declaredQty: 0 }] }],
    [{ lines: [{ itemId: 'a', declaredQty: 1001 }] }],
    [{ lines: [{ itemId: 'a', declaredQty: 1.5 }] }],
    [{ lines: [{ itemId: 'a', declaredQty: 1 }], method: 'BIKE' }],
  ])('preview DTO rejects %j', async (body) => {
    await expect(run(WastePreviewDto, body)).rejects.toThrow();
  });
  it('preview DTO accepts a MAIL_IN body with a province', async () => {
    await expect(run(WastePreviewDto, { lines: [{ itemId: 'a', declaredQty: 1 }], method: 'MAIL_IN', provinceCode: '79' })).resolves.toBeInstanceOf(WastePreviewDto);
  });
  it.each([
    [{ method: 'DROP_OFF', pointId: 'p1', lines: [{ itemId: 'a', declaredQty: 1 }] }],
    [{ method: 'DROP_OFF', pointId: 'p1', lines: [{ itemId: 'a', declaredQty: 1 }], consent: false }],
    [{ method: 'BIKE', lines: [{ itemId: 'a', declaredQty: 1 }], consent: true }],
    [{ method: 'MAIL_IN', lines: [{ itemId: 'a', declaredQty: 15 }], consent: true, packagingConsent: 'yes', postagePaidConsent: true }],
  ])('create DTO rejects %j', async (b) => {
    await expect(run(WasteCreateDto, b)).rejects.toThrow();
  });
  it('create DTO nhận HOME_PICKUP kèm địa chỉ, cân nặng 500 đến 10.000 g, công tắc trừ điểm, shipFeePayment và expectedCashVnd; từ chối giá trị ngoài biên', async () => {
    const ok = { method: 'HOME_PICKUP', lines: [{ itemId: 'a', declaredQty: 15 }], consent: true, pickupAddressId: 'a1', declaredWeightGrams: 2500, usePointsForShipFee: true };
    await expect(run(WasteCreateDto, ok)).resolves.toBeInstanceOf(WasteCreateDto);
    await expect(run(WasteCreateDto, { ...ok, shipFeePayment: 'WALLET', expectedCashVnd: 17000 })).resolves.toBeInstanceOf(WasteCreateDto);
    await expect(run(WasteCreateDto, { ...ok, shipFeePayment: 'BANK_TRANSFER', expectedCashVnd: 0 })).resolves.toBeInstanceOf(WasteCreateDto);
    await expect(run(WasteCreateDto, { ...ok, shipFeePayment: 'COD' })).rejects.toThrow();
    await expect(run(WasteCreateDto, { ...ok, expectedCashVnd: -1 })).rejects.toThrow();
    await expect(run(WasteCreateDto, { ...ok, expectedCashVnd: 10_000_001 })).rejects.toThrow();
    await expect(run(WasteCreateDto, { ...ok, declaredWeightGrams: 499 })).rejects.toThrow();
    await expect(run(WasteCreateDto, { ...ok, declaredWeightGrams: 10_001 })).rejects.toThrow();
    await expect(run(WasteCreateDto, { ...ok, usePointsForShipFee: 'yes' })).rejects.toThrow();
    await expect(run(WasteCreateDto, { ...ok, pickupAddressId: 'x'.repeat(65) })).rejects.toThrow();
  });
  it('create DTO accepts a MAIL_IN body with both commitments', async () => {
    await expect(run(WasteCreateDto, { method: 'MAIL_IN', lines: [{ itemId: 'a', declaredQty: 15 }], consent: true, packagingConsent: true, postagePaidConsent: true })).resolves.toBeInstanceOf(WasteCreateDto);
  });
  it('edit DTO: pointId null is a 400 (not a 500), a method or empty lines are rejected, lines alone are accepted without consent', async () => {
    await expect(run(WasteEditDto, { lines: [{ itemId: 'carton', declaredQty: 2 }], pointId: null })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run(WasteEditDto, { lines: [{ itemId: 'carton', declaredQty: 2 }], method: 'MAIL_IN' })).rejects.toThrow();
    await expect(run(WasteEditDto, { lines: [] })).rejects.toThrow();
    await expect(run(WasteEditDto, { lines: [{ itemId: 'carton', declaredQty: 2 }] })).resolves.toBeInstanceOf(WasteEditDto);
  });
  it.each([
    [{ carrier: '  ', trackingCode: 'S1' }],
    [{ carrier: 'x'.repeat(61), trackingCode: 'S1' }],
    [{ carrier: 'GHTK', trackingCode: 'x'.repeat(65) }],
    [{ carrier: null, trackingCode: 'S1' }],
    [{ trackingCode: 'S1' }],
    [{ carrier: 'GHTK' }],
  ])('tracking DTO rejects %j', async (b) => {
    await expect(run(WasteTrackingDto, b)).rejects.toThrow();
  });
  it('tracking DTO trims both fields', async () => {
    await expect(run(WasteTrackingDto, { carrier: ' GHTK ', trackingCode: ' S1 ' })).resolves.toMatchObject({ carrier: 'GHTK', trackingCode: 'S1' });
  });
});

describe('request line cap is one shared limit', () => {
  const declared = (n: number) => Array.from({ length: n }, (_, i) => ({ itemId: `i${i}`, declaredQty: 1 }));
  const confirmed = (n: number) => declared(n).map((l) => ({ ...l, receivedQty: 1 }));
  const pipe = createValidationPipe();
  const run = (metatype: unknown, value: unknown) => pipe.transform(value, { type: 'body', metatype: metatype as never, data: '' });
  const keys = (es: ValidationError[]): string[] => es.flatMap((e) => [...Object.keys(e.constraints ?? {}), ...keys(e.children ?? [])]);
  const errorKeys = (cls: new () => object, body: object) => keys(validateSync(plainToInstance(cls, body)));
  const cases: Array<[string, new () => object, (n: number) => object]> = [
    ['create', WasteCreateDto, (n) => ({ method: 'MAIL_IN', lines: declared(n), consent: true, packagingConsent: true, postagePaidConsent: true })],
    ['edit', WasteEditDto, (n) => ({ lines: declared(n) })],
    ['preview', WastePreviewDto, (n) => ({ lines: declared(n) })],
    ['confirm', WasteConfirmDto, (n) => ({ lines: confirmed(n) })],
  ];
  it('the cap is 50', () => {
    expect(WASTE_MAX_REQUEST_LINES).toBe(50);
  });
  it.each(cases)('%s DTO accepts the cap and rejects one more line with maxSize', async (_name, cls, body) => {
    await expect(run(cls, body(WASTE_MAX_REQUEST_LINES))).resolves.toBeInstanceOf(cls);
    expect(errorKeys(cls, body(WASTE_MAX_REQUEST_LINES + 1))).toEqual(['arrayMaxSize']);
  });
  it('a request created with the most lines can still be confirmed with the same count', async () => {
    await expect(run(WasteCreateDto, cases[0]![2](WASTE_MAX_REQUEST_LINES))).resolves.toBeInstanceOf(WasteCreateDto);
    await expect(run(WasteConfirmDto, { lines: confirmed(WASTE_MAX_REQUEST_LINES) })).resolves.toBeInstanceOf(WasteConfirmDto);
  });
  it('a full-size confirm body with one invalid line is rejected (nested errors are not skipped)', async () => {
    const lines = confirmed(WASTE_MAX_REQUEST_LINES);
    lines[7] = { ...lines[7]!, receivedQty: -1 };
    await expect(run(WasteConfirmDto, { lines })).rejects.toThrow();
    expect(errorKeys(WasteConfirmDto, { lines })).toEqual(['min']);
  });
});
