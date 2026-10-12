import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { GameController } from './game.controller';
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
