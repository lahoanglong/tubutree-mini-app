import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { WasteDeskGiftFulfilDto, WasteDeskGiftsController } from './waste-desk-gifts.controller';

type VErr = { constraints?: Record<string, string>; children?: VErr[] };
const keysOf = (errs: VErr[]): string[] => errs.flatMap((e) => [...Object.keys(e.constraints ?? {}), ...keysOf(e.children ?? [])]);
async function errorKeys<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<string[]> {
  return keysOf(await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true }));
}
const handlers = (p: object) => Object.getOwnPropertyNames(p).filter((k) => Reflect.getMetadata(METHOD_METADATA, (p as never)[k]) !== undefined);

describe('WasteDeskGiftsController', () => {
  it('declares the route table', () => {
    const proto = WasteDeskGiftsController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, WasteDeskGiftsController)).toBe('waste/desk/gifts');
    expect(Reflect.getMetadata(PATH_METADATA, proto.fulfil)).toBe('fulfil');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.fulfil)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ROLES_KEY, proto.fulfil)).toBeUndefined();
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.fulfil)).toBe(30);
    expect(handlers(proto)).toEqual(['fulfil']);
  });

  it('accepts a valid body', async () => {
    expect(await errorKeys(WasteDeskGiftFulfilDto, { code: 'QG-ABCDEFGH', pointId: 'wh' })).toEqual([]);
  });

  it('rejects malformed bodies', async () => {
    for (const body of [{ code: 'QG', pointId: 'wh' }, { code: 'Q'.repeat(41), pointId: 'wh' }, { code: 'QG-ABCDEFGH' }, { code: 'QG-ABCDEFGH', pointId: '' }]) {
      expect((await errorKeys(WasteDeskGiftFulfilDto, body)).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('rejects an extra field', async () => {
    expect(await errorKeys(WasteDeskGiftFulfilDto, { code: 'QG-ABCDEFGH', pointId: 'wh', userId: 'u2' })).toContain('whitelistValidation');
  });

  it('passes the caller and body to the service', async () => {
    const svc = { fulfilAtDesk: jest.fn().mockResolvedValue({ id: 'r1' }) };
    const body = { code: 'QG-ABCDEFGH', pointId: 'wh' };
    const out = await new WasteDeskGiftsController(svc as never).fulfil('s1', body);
    expect(svc.fulfilAtDesk).toHaveBeenCalledWith('s1', body);
    expect(out).toEqual({ id: 'r1' });
  });
});
