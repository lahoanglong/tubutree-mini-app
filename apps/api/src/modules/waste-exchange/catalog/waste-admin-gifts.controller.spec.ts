import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NOT_NULL_CONSTRAINT } from '../../../common/decorators/optional-not-null.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { GiftFulfilByIdDto, GiftRedemptionsQueryDto, WasteAdminGiftsController, WasteGiftCancelDto } from './waste-admin-gifts.controller';

type VErr = { constraints?: Record<string, string>; children?: VErr[] };
const keysOf = (errs: VErr[]): string[] => errs.flatMap((e) => [...Object.keys(e.constraints ?? {}), ...keysOf(e.children ?? [])]);
async function errorKeys<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<string[]> {
  return keysOf(await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true }));
}
const handlers = (p: object) => Object.getOwnPropertyNames(p).filter((k) => Reflect.getMetadata(METHOD_METADATA, (p as never)[k]) !== undefined);

describe('WasteAdminGiftsController', () => {
  const proto = WasteAdminGiftsController.prototype;

  it('declares the route table', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WasteAdminGiftsController)).toBe('admin/waste');
    expect(handlers(proto)).toEqual(expect.arrayContaining(['queue', 'fulfil', 'cancel']));
    expect(Reflect.getMetadata(PATH_METADATA, proto.queue)).toBe('gift-redemptions');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.queue)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, proto.fulfil)).toBe('gift-redemptions/:id/fulfil');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.fulfil)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, proto.cancel)).toBe('gift-redemptions/:id/cancel');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.cancel)).toBe(RequestMethod.POST);
  });

  it('declares roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, proto.queue)).toEqual(['ADMIN', 'STAFF']);
    expect(Reflect.getMetadata(ROLES_KEY, proto.fulfil)).toEqual(['ADMIN', 'STAFF']);
    expect(Reflect.getMetadata(ROLES_KEY, proto.cancel)).toEqual(['ADMIN']);
  });

  it('declares throttles', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.fulfil)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.cancel)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.queue)).toBeUndefined();
  });

  it('accepts valid cancel bodies', async () => {
    expect(await errorKeys(WasteGiftCancelDto, { reason: 'Khách đổi ý' })).toEqual([]);
    expect(await errorKeys(WasteGiftCancelDto, { reason: 'Khách đổi ý', refundPoints: false })).toEqual([]);
  });

  it('rejects malformed cancel bodies', async () => {
    for (const body of [{ reason: 'ab' }, { reason: 'x'.repeat(501) }, { reason: 'Khách đổi ý', refundPoints: 'yes' }, {}]) {
      expect((await errorKeys(WasteGiftCancelDto, body)).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('rejects a null refundPoints', async () => {
    expect(await errorKeys(WasteGiftCancelDto, { reason: 'Khách đổi ý', refundPoints: null })).toContain(NOT_NULL_CONSTRAINT);
  });

  it('validates the queue query', async () => {
    expect(await errorKeys(GiftRedemptionsQueryDto, { status: 'READY' })).toEqual([]);
    expect((await errorKeys(GiftRedemptionsQueryDto, { status: 'DONE' })).length).toBeGreaterThanOrEqual(1);
    expect(plainToInstance(GiftRedemptionsQueryDto, { overdue: 'true' }).overdue).toBe(true);
    expect(plainToInstance(GiftRedemptionsQueryDto, { overdue: 'false' }).overdue).toBe(false);
    expect((await errorKeys(GiftRedemptionsQueryDto, { overdue: 'maybe' })).length).toBeGreaterThanOrEqual(1);
  });

  it('validates the fulfil-by-id body', async () => {
    expect(await errorKeys(GiftFulfilByIdDto, { code: 'QG-ABCDEFGH' })).toEqual([]);
    expect((await errorKeys(GiftFulfilByIdDto, {})).length).toBeGreaterThanOrEqual(1);
  });

  it('passes the caller and arguments to the service', async () => {
    const svc = {
      queue: jest.fn().mockResolvedValue([]),
      cancel: jest.fn().mockResolvedValue({ id: 'r1' }),
      fulfilById: jest.fn().mockResolvedValue({ id: 'r1' }),
    };
    const c = new WasteAdminGiftsController(svc as never);
    await c.queue('a1', { overdue: true });
    expect(svc.queue).toHaveBeenCalledWith('a1', { overdue: true });
    await c.cancel('a1', 'r1', { reason: 'Khách đổi ý', refundPoints: false });
    expect(svc.cancel).toHaveBeenCalledWith('a1', 'r1', { reason: 'Khách đổi ý', refundPoints: false });
  });

  it('fulfil passes the caller, id and code to fulfilById', async () => {
    const svc = { fulfilById: jest.fn().mockResolvedValue({ id: 'r1' }) };
    const out = await new WasteAdminGiftsController(svc as never).fulfil('s1', 'r1', { code: 'QG-ABCDEFGH' });
    expect(svc.fulfilById).toHaveBeenCalledWith('s1', 'r1', { code: 'QG-ABCDEFGH' });
    expect(out).toEqual({ id: 'r1' });
  });
});
