import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { DailyCheckInController } from './daily-check-in.controller';
import type { DailyCheckInService } from './daily-check-in.service';

describe('DailyCheckInController', () => {
  it('POST me/daily-check-in và GET me/daily-check-in là route khách (không giới hạn role)', () => {
    const post = DailyCheckInController.prototype.checkIn;
    const get = DailyCheckInController.prototype.status;
    expect(Reflect.getMetadata(PATH_METADATA, post)).toBe('me/daily-check-in');
    expect(Reflect.getMetadata(METHOD_METADATA, post)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, get)).toBe('me/daily-check-in');
    expect(Reflect.getMetadata(METHOD_METADATA, get)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(ROLES_KEY, post)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, get)).toBeUndefined();
  });

  it('POST có throttle 10 lần/phút như endpoint loyalty', () => {
    const keys = Reflect.getMetadataKeys(DailyCheckInController.prototype.checkIn).filter((k: string) => String(k).startsWith('THROTTLER'));
    expect(keys.length).toBeGreaterThan(0);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', DailyCheckInController.prototype.checkIn)).toBe(10);
  });

  it('chuyển userId cho service', () => {
    const svc = { run: jest.fn().mockReturnValue('r'), status: jest.fn().mockReturnValue('s') };
    const ctrl = new DailyCheckInController(svc as unknown as DailyCheckInService);
    expect(ctrl.checkIn('u1')).toBe('r');
    expect(ctrl.status('u1')).toBe('s');
    expect(svc.run).toHaveBeenCalledWith('u1');
    expect(svc.status).toHaveBeenCalledWith('u1');
  });
});
