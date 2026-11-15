import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GameController } from './game.controller';
import type { GameGardenService } from './game-garden.service';
import type { GameArcadeService } from './game-arcade.service';
import type { GameService } from './game.service';

function controllerWith(game: Partial<GameService>) {
  const none = {} as never;
  return new GameController(game as GameService, none, none, none, none, none, none, none, none, none);
}

describe('GameController.buyTree', () => {
  it('đọc header Idempotency-Key (không phân biệt hoa thường) cho tham số thứ hai', () => {
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, GameController, 'buyTree') as Record<string, { index: number; data?: unknown }>;
    const header = Object.entries(meta).find(([, v]) => v.index === 1);
    expect(header?.[0].startsWith(`${RouteParamtypes.HEADERS}:`)).toBe(true);
    expect(header?.[1].data).toBe('idempotency-key');
  });

  it('chuyển key tới GameService.buyTree cùng userId', async () => {
    const buyTree = jest.fn().mockResolvedValue({ certificateCode: 'TUBU-X' });
    await controllerWith({ buyTree }).buyTree('u1', 'tree-buy-key-0001');
    expect(buyTree).toHaveBeenCalledWith('u1', 'tree-buy-key-0001');
  });

  it('không có header → key undefined (hành vi cũ)', async () => {
    const buyTree = jest.fn().mockResolvedValue({ certificateCode: 'TUBU-X' });
    await controllerWith({ buyTree }).buyTree('u1');
    expect(buyTree).toHaveBeenCalledWith('u1', undefined);
  });
});

describe('GameController.unlockPlot', () => {
  const dtoClass = (Reflect.getMetadata('design:paramtypes', GameController.prototype, 'unlockPlot') as Array<new () => object>)[1]!;
  const errorsFor = async (plain: object) =>
    (await validate(plainToInstance(dtoClass, plain), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

  it('chuyển slot tới GameGardenService.unlockPlot', async () => {
    const unlockPlot = jest.fn().mockResolvedValue({ slot: 2 });
    const none = {} as never;
    const ctrl = new GameController(none, none, none, none, none, none, none, { unlockPlot } as unknown as GameGardenService, none, none);
    await ctrl.unlockPlot('u1', { currency: 'SEEDS', slot: 2 });
    expect(unlockPlot).toHaveBeenCalledWith('u1', 'SEEDS', 2);
  });

  it('DTO nhận slot nguyên >= 1, vẫn hợp lệ khi không có slot, từ chối slot 0 hoặc không nguyên', async () => {
    expect(await errorsFor({ currency: 'SEEDS' })).toEqual([]);
    expect(await errorsFor({ currency: 'SEEDS', slot: 2 })).toEqual([]);
    expect(await errorsFor({ currency: 'SEEDS', slot: 0 })).toEqual(['slot']);
    expect(await errorsFor({ currency: 'SEEDS', slot: 1.5 })).toEqual(['slot']);
  });
});

describe('GameController — điểm danh', () => {
  it('không còn POST /game/check-in: điểm danh đi qua /me/daily-check-in để chuỗi và điểm xanh cập nhật cùng nhau', () => {
    expect((GameController.prototype as unknown as Record<string, unknown>).checkIn).toBeUndefined();
  });
});

describe('GameController — mini-game arcade và thẻ chẩn đoán tổ ấm', () => {
  const arcadeCtrl = (arcade: Partial<GameArcadeService>) => {
    const none = {} as never;
    return new GameController(none, none, none, none, none, none, none, none, none, arcade as GameArcadeService);
  };
  const dtoOf = (method: string) =>
    (Reflect.getMetadata('design:paramtypes', GameController.prototype, method) as Array<new () => object>)[1]!;
  const errorsFor = async (method: string, plain: object) =>
    (await validate(plainToInstance(dtoOf(method), plain), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property).sort();

  it('POST /game/arcade-complete chuyển body tới GameArcadeService.complete cùng userId', async () => {
    const complete = jest.fn().mockResolvedValue({ rewarded: true });
    await arcadeCtrl({ complete }).arcadeComplete('u1', { gameId: 'refill_rush', score: 120, durationMs: 45_000 });
    expect(complete).toHaveBeenCalledWith('u1', { gameId: 'refill_rush', score: 120, durationMs: 45_000 });
  });

  it('GET /game/arcade/status và POST /game/home-quiz/complete chỉ truyền userId', async () => {
    const status = jest.fn().mockResolvedValue({});
    const completeHomeQuiz = jest.fn().mockResolvedValue({ granted: 20 });
    const ctrl = arcadeCtrl({ status, completeHomeQuiz });
    await ctrl.arcadeStatus('u1');
    await ctrl.homeQuizComplete('u1', { family: 'baby_pet', worry: 'grease', format: 'refill' });
    expect(status).toHaveBeenCalledWith('u1');
    expect(completeHomeQuiz).toHaveBeenCalledWith('u1');
  });

  it('arcade-complete giới hạn 12 lần mỗi phút', () => {
    const handler = GameController.prototype.arcadeComplete;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(12);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });

  it('DTO arcade-complete nhận game hợp lệ, điểm nguyên >= 0 và thời lượng nguyên', async () => {
    expect(await errorsFor('arcadeComplete', { gameId: 'dew_catcher', score: 0, durationMs: 40_000 })).toEqual([]);
    expect(await errorsFor('arcadeComplete', { gameId: 'refill_rush', score: 250, durationMs: 5_000 })).toEqual([]);
  });

  it.each([
    [{ gameId: 'tetris', score: 10, durationMs: 40_000 }, ['gameId']],
    [{ score: 10, durationMs: 40_000 }, ['gameId']],
    [{ gameId: 'dew_catcher', score: -1, durationMs: 40_000 }, ['score']],
    [{ gameId: 'dew_catcher', score: 1.5, durationMs: 40_000 }, ['score']],
    [{ gameId: 'dew_catcher', score: '10', durationMs: 40_000 }, ['score']],
    [{ gameId: 'dew_catcher', score: 10, durationMs: 40_000.5 }, ['durationMs']],
    [{ gameId: 'dew_catcher', score: 10 }, ['durationMs']],
    [{ gameId: 'dew_catcher', score: 10, durationMs: 40_000, userId: 'x' }, ['userId']],
  ])('DTO arcade-complete từ chối %j', async (body, props) => {
    expect(await errorsFor('arcadeComplete', body)).toEqual(props);
  });

  it('DTO home-quiz chỉ nhận đúng các đáp án trong thẻ chẩn đoán', async () => {
    expect(await errorsFor('homeQuizComplete', { family: 'adult_only', worry: 'dry_skin', format: 'bottle' })).toEqual([]);
    expect(await errorsFor('homeQuizComplete', { family: 'baby_pet', worry: 'strong_scent', format: 'refill' })).toEqual([]);
    expect(await errorsFor('homeQuizComplete', { family: 'x', worry: 'grease', format: 'refill' })).toEqual(['family']);
    expect(await errorsFor('homeQuizComplete', { family: 'baby_pet', worry: 'x', format: 'x' })).toEqual(['format', 'worry']);
    expect(await errorsFor('homeQuizComplete', {})).toEqual(['family', 'format', 'worry']);
  });
});
