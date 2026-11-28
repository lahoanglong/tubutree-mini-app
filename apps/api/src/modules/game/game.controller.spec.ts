import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { GameController } from './game.controller';
import type { GameGardenService } from './game-garden.service';
import type { GameArcadeService } from './game-arcade.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { GameService } from './game.service';

function controllerWith(game: Partial<GameService>) {
  const none = {} as never;
  return new GameController(game as GameService, none, none, none, none, none, none, none, none, none, none);
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
    const ctrl = new GameController(none, none, none, none, none, none, none, { unlockPlot } as unknown as GameGardenService, none, none, none);
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
  const arcadeCtrl = (arcade: Partial<GameArcadeService>, analytics: Partial<AnalyticsEventsService> = { recordBestEffort: jest.fn() }) => {
    const none = {} as never;
    return new GameController(none, none, none, none, none, none, none, none, none, arcade as GameArcadeService, analytics as AnalyticsEventsService);
  };
  const dtoOf = (method: string, index = 1) =>
    (Reflect.getMetadata('design:paramtypes', GameController.prototype, method) as Array<new () => object>)[index]!;
  const errorsFor = async (method: string, plain: object, index = 1) =>
    (await validate(plainToInstance(dtoOf(method, index), plain), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property).sort();
  const RUN = 'r1.dew_catcher.1763190000000.abc.sig';

  it('POST /game/arcade-complete chuyển body tới GameArcadeService.complete cùng userId', async () => {
    const complete = jest.fn().mockResolvedValue({ rewarded: true });
    await arcadeCtrl({ complete }).arcadeComplete('u1', { gameId: 'refill_rush', score: 120, durationMs: 45_000, runId: RUN });
    expect(complete).toHaveBeenCalledWith('u1', { gameId: 'refill_rush', score: 120, durationMs: 45_000, runId: RUN });
  });

  it('arcade-complete ghi sự kiện máy chủ arcade_run (điểm, có thưởng, giọt, điểm) sau khi service xong, không chứa tên hay SĐT', async () => {
    const complete = jest.fn().mockResolvedValue({ rewarded: true, waterEarned: 5, pointsEarned: 1, score: 120 });
    const recordBestEffort = jest.fn().mockResolvedValue(undefined);
    const out = await arcadeCtrl({ complete }, { recordBestEffort }).arcadeComplete('u1', { gameId: 'refill_rush', score: 120, durationMs: 45_000, runId: RUN });
    expect(out).toMatchObject({ rewarded: true, waterEarned: 5 });
    expect(recordBestEffort).toHaveBeenCalledTimes(1);
    expect(recordBestEffort).toHaveBeenCalledWith({
      eventName: 'arcade_run',
      userId: 'u1',
      platform: 'system',
      props: { gameId: 'refill_rush', score: 120, rewarded: true, water: 5, points: 1 },
    });
    expect(complete.mock.invocationCallOrder[0]!).toBeLessThan(recordBestEffort.mock.invocationCallOrder[0]!);
  });

  it('arcade-complete bị từ chối (400/409) thì không ghi arcade_run và lỗi vẫn tới khách', async () => {
    const complete = jest.fn().mockRejectedValue(new Error('RUN_USED'));
    const recordBestEffort = jest.fn();
    await expect(arcadeCtrl({ complete }, { recordBestEffort }).arcadeComplete('u1', { gameId: 'dew_catcher', score: 1, durationMs: 40_000, runId: RUN })).rejects.toThrow('RUN_USED');
    expect(recordBestEffort).not.toHaveBeenCalled();
  });

  it('ghi sự kiện đo đạc lỗi không làm hỏng ván: kết quả thưởng vẫn trả về', async () => {
    const complete = jest.fn().mockResolvedValue({ rewarded: false, waterEarned: 0, pointsEarned: 0 });
    const recordBestEffort = jest.fn().mockResolvedValue(undefined);
    await expect(arcadeCtrl({ complete }, { recordBestEffort }).arcadeComplete('u1', { gameId: 'dew_catcher', score: 5, durationMs: 40_000, runId: RUN })).resolves.toMatchObject({ rewarded: false });
  });

  it('POST /game/arcade-start chuyển game tới GameArcadeService.start, không cần userId', () => {
    const start = jest.fn().mockReturnValue({ runId: RUN });
    expect(arcadeCtrl({ start }).arcadeStart({ gameId: 'dew_catcher' })).toEqual({ runId: RUN });
    expect(start).toHaveBeenCalledWith('dew_catcher');
  });

  it('arcade-start công khai (khách chơi thử cũng xin được mã) và giới hạn 20 lần mỗi phút; arcade-complete vẫn cần đăng nhập', () => {
    const start = GameController.prototype.arcadeStart;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, start)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', start)).toBe(20);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', start)).toBe(60_000);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, GameController.prototype.arcadeComplete)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, GameController)).toBeUndefined();
  });

  it('DTO arcade-start chỉ nhận game hợp lệ', async () => {
    expect(await errorsFor('arcadeStart', { gameId: 'refill_rush' }, 0)).toEqual([]);
    expect(await errorsFor('arcadeStart', { gameId: 'tetris' }, 0)).toEqual(['gameId']);
    expect(await errorsFor('arcadeStart', {}, 0)).toEqual(['gameId']);
    expect(await errorsFor('arcadeStart', { gameId: 'dew_catcher', userId: 'x' }, 0)).toEqual(['userId']);
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
    expect(await errorsFor('arcadeComplete', { gameId: 'dew_catcher', score: 0, durationMs: 40_000, runId: RUN })).toEqual([]);
    expect(await errorsFor('arcadeComplete', { gameId: 'refill_rush', score: 250, durationMs: 5_000, runId: RUN })).toEqual([]);
  });

  it.each([
    [{ gameId: 'tetris', score: 10, durationMs: 40_000, runId: RUN }, ['gameId']],
    [{ score: 10, durationMs: 40_000, runId: RUN }, ['gameId']],
    [{ gameId: 'dew_catcher', score: -1, durationMs: 40_000, runId: RUN }, ['score']],
    [{ gameId: 'dew_catcher', score: 1.5, durationMs: 40_000, runId: RUN }, ['score']],
    [{ gameId: 'dew_catcher', score: '10', durationMs: 40_000, runId: RUN }, ['score']],
    [{ gameId: 'dew_catcher', score: 10, durationMs: 40_000.5, runId: RUN }, ['durationMs']],
    [{ gameId: 'dew_catcher', score: 10, runId: RUN }, ['durationMs']],
    [{ gameId: 'dew_catcher', score: 10, durationMs: 40_000 }, ['runId']],
    [{ gameId: 'dew_catcher', score: 10, durationMs: 40_000, runId: 7 }, ['runId']],
    [{ gameId: 'dew_catcher', score: 10, durationMs: 40_000, runId: 'x'.repeat(201) }, ['runId']],
    [{ gameId: 'dew_catcher', score: 10, durationMs: 40_000, runId: RUN, userId: 'x' }, ['userId']],
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
