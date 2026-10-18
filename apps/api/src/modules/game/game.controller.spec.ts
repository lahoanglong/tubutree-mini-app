import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GameController } from './game.controller';
import type { GameGardenService } from './game-garden.service';
import type { GameService } from './game.service';

function controllerWith(game: Partial<GameService>) {
  const none = {} as never;
  return new GameController(game as GameService, none, none, none, none, none, none, none, none);
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
    const ctrl = new GameController(none, none, none, none, none, none, none, { unlockPlot } as unknown as GameGardenService, none);
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
