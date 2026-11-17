import 'reflect-metadata';
import { GUARDS_METADATA, HEADERS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { HttpException, HttpStatus, RequestMethod } from '@nestjs/common';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../../../common/guards/optional-jwt-auth.guard';
import { MatcherController, MatcherResultDto } from './matcher.controller';
import type { MatcherService } from './matcher.service';

type Route = 'status' | 'content' | 'result';
const handler = (name: Route) => MatcherController.prototype[name] as unknown as object;
const cacheControl = (name: Route) =>
  (Reflect.getMetadata(HEADERS_METADATA, handler(name)) as { name: string; value: string }[]).find((h) => h.name.toLowerCase() === 'cache-control')?.value;

describe('MatcherController: metadata route', () => {
  it('nằm dưới game/matcher; status và nội dung là GET công khai có cache; result là POST 200 có giới hạn', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MatcherController)).toBe('game/matcher');
    expect(Reflect.getMetadata(PATH_METADATA, handler('status'))).toBe('status');
    expect(Reflect.getMetadata(METHOD_METADATA, handler('status'))).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(METHOD_METADATA, handler('content'))).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, handler('result'))).toBe('result');
    expect(Reflect.getMetadata(METHOD_METADATA, handler('result'))).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('result'))).toBe(200);
    for (const r of ['status', 'content', 'result'] as Route[]) expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler(r))).toBe(true);
    expect(cacheControl('status')).toBe('public, max-age=60');
    expect(cacheControl('content')).toBe('public, max-age=600');
    expect(cacheControl('result')).toBe('private, no-store');
  });

  it('result: biết khách nếu có phiên (OptionalJwtAuthGuard), tối đa 20 lượt mỗi phút', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler('result'))).toEqual([OptionalJwtAuthGuard]);
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler('result'))).toBe(20);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler('result'))).toBe(60_000);
  });

  it('DTO: answers là mảng ≤ 6 phần tử; deviceId tuỳ chọn 8–128 ký tự', () => {
    const ok = (body: unknown) => validateSync(plainToInstance(MatcherResultDto, body)).length === 0;
    expect(ok({ answers: [{ code: 'need', value: 'laundry' }] })).toBe(true);
    expect(ok({ answers: [{}], deviceId: 'device-12345678' })).toBe(true);
    expect(ok({ answers: 'laundry' })).toBe(false);
    expect(ok({ answers: Array.from({ length: 7 }, () => ({})) })).toBe(false);
    expect(ok({ answers: [], deviceId: 'short' })).toBe(false);
  });
});

describe('MatcherController: chuyển cho service', () => {
  const make = (ready: boolean) => {
    const svc = {
      enabled: jest.fn().mockResolvedValue(true),
      ready: jest.fn().mockResolvedValue(ready),
      publicContent: jest.fn().mockRejectedValue(new HttpException({ code: 'GAME_DISABLED' }, HttpStatus.NOT_FOUND)),
      result: jest.fn().mockResolvedValue({ items: [] }),
    };
    return { svc, ctl: new MatcherController(svc as unknown as MatcherService) };
  };

  it('cờ tắt: status 200 { enabled: false }, nội dung 404 từ service', async () => {
    const { ctl } = make(false);
    await expect(ctl.status()).resolves.toEqual({ enabled: false });
    await expect(ctl.content()).rejects.toMatchObject({ status: 404 });
  });

  it('status theo ready() (cờ bật và nội dung đủ), không theo riêng cờ', async () => {
    const off = make(false);
    await expect(off.ctl.status()).resolves.toEqual({ enabled: false });
    expect(off.svc.ready).toHaveBeenCalledTimes(1);
    expect(off.svc.enabled).not.toHaveBeenCalled();
    await expect(make(true).ctl.status()).resolves.toEqual({ enabled: true });
  });

  it('result: khách chưa đăng nhập thành userId null, có phiên thì chuyển sub', async () => {
    const { ctl, svc } = make(true);
    const dto = { answers: [] } as MatcherResultDto;
    await ctl.result(dto);
    await ctl.result(dto, 'u1');
    expect(svc.result.mock.calls).toEqual([
      [null, dto],
      ['u1', dto],
    ]);
  });
});
