import 'reflect-metadata';
import { GUARDS_METADATA, HEADERS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../../common/guards/optional-jwt-auth.guard';
import { GameMiniController, MiniSubmitDto } from './game-mini.controller';
import type { GameMiniService } from './game-mini.service';

type Route = 'today' | 'start' | 'submit';
const ROUTES: Route[] = ['today', 'start', 'submit'];
const handler = (name: Route) => GameMiniController.prototype[name] as unknown as object;

describe('GameMiniController: metadata route', () => {
  it('controller nằm dưới game/mini', () => {
    expect(Reflect.getMetadata(PATH_METADATA, GameMiniController)).toBe('game/mini');
  });

  it.each(ROUTES)('%s: @Public + OptionalJwtAuthGuard (có phiên thì biết khách, token hỏng thành khách chứ không 401)', (name) => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler(name))).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler(name))).toEqual([OptionalJwtAuthGuard]);
  });

  it.each(ROUTES)('%s: Cache-Control private, no-store (kết quả theo khách, không cho proxy giữ)', (name) => {
    const headers = Reflect.getMetadata(HEADERS_METADATA, handler(name)) as { name: string; value: string }[];
    expect(headers.find((h) => h.name.toLowerCase() === 'cache-control')?.value).toBe('private, no-store');
  });

  it('today là GET; start và submit là POST trả 200 (không phải 201)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler('today'))).toBe('today');
    expect(Reflect.getMetadata(METHOD_METADATA, handler('today'))).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, handler('start'))).toBe(':game/start');
    expect(Reflect.getMetadata(METHOD_METADATA, handler('start'))).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('start'))).toBe(200);
    expect(Reflect.getMetadata(PATH_METADATA, handler('submit'))).toBe(':game/submit');
    expect(Reflect.getMetadata(METHOD_METADATA, handler('submit'))).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('submit'))).toBe(200);
  });

  it('start giới hạn 20 lượt mỗi phút', () => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler('start'))).toBe(20);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler('start'))).toBe(60_000);
  });

  it('submit giới hạn 12 lượt mỗi phút', () => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler('submit'))).toBe(12);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler('submit'))).toBe(60_000);
  });
});

describe('GameMiniController: chuyển cho service', () => {
  const makeCtl = () => {
    const svc = {
      today: jest.fn().mockResolvedValue({ dayKey: '2026-11-17' }),
      start: jest.fn().mockResolvedValue({ game: 'sort' }),
      submit: jest.fn().mockResolvedValue({ game: 'sort' }),
    };
    return { svc, ctl: new GameMiniController(svc as unknown as GameMiniService) };
  };

  it('today: có phiên thì chuyển userId, khách thì null', async () => {
    const { svc, ctl } = makeCtl();
    await ctl.today('u1');
    await ctl.today(undefined);
    expect(svc.today.mock.calls).toEqual([['u1'], [null]]);
  });

  it('start: chuyển game từ đường dẫn và userId (khách thì null)', async () => {
    const { svc, ctl } = makeCtl();
    await ctl.start('sort', 'u1');
    await ctl.start('arcade', undefined);
    expect(svc.start.mock.calls).toEqual([
      ['u1', 'sort'],
      [null, 'arcade'],
    ]);
  });

  it('submit: chuyển nguyên DTO cho service (service tự kiểm hình dạng bài nộp), khách thì userId null', async () => {
    const { svc, ctl } = makeCtl();
    const dto: MiniSubmitDto = { roundId: 'r1', answers: ['food'], deviceId: 'thiet-bi-12345' };
    await ctl.submit('sort', dto, 'u1');
    const guestDto: MiniSubmitDto = { token: 'm1.a.b', answers: [] };
    await ctl.submit('match', guestDto, undefined);
    expect(svc.submit.mock.calls).toEqual([
      ['u1', 'sort', dto],
      [null, 'match', guestDto],
    ]);
  });
});
