import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MerchShelvesController } from './merch-shelves.controller';

const ctx = (handler: (...args: never[]) => unknown, user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => MerchShelvesController,
  }) as unknown as ExecutionContext;

describe('MerchShelvesController: quyền', () => {
  const guard = new RolesGuard(new Reflector());
  const proto = MerchShelvesController.prototype;
  const handlers = [proto.overview, proto.get, proto.save, proto.suggest, proto.product, proto.emptyEntrances];

  it.each(handlers.map((h) => [h.name, h] as const))('%s: quản trị viên và nhân viên Marketing vào được', (_name, h) => {
    expect(guard.canActivate(ctx(h, { sub: 'a', role: 'ADMIN' }))).toBe(true);
    expect(guard.canActivate(ctx(h, { sub: 's', role: 'STAFF', staffPermissions: ['MARKETING'] }))).toBe(true);
  });

  it.each(handlers.map((h) => [h.name, h] as const))('%s: nhân viên không có nhóm Marketing, khách, chưa đăng nhập nhận 403', (_name, h) => {
    expect(() => guard.canActivate(ctx(h, { sub: 's', role: 'STAFF', staffPermissions: ['KHO', 'CSKH'] }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(h, { sub: 's', role: 'STAFF', staffPermissions: [] }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(h, { sub: 'c', role: 'CUSTOMER' }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(h, undefined))).toThrow(ForbiddenException);
  });
});

describe('MerchShelvesController: tham số', () => {
  const svc = {
    suggest: jest.fn().mockResolvedValue({ items: [] }),
    save: jest.fn().mockResolvedValue({}),
  };
  const ctrl = new MerchShelvesController(svc as never);

  it('`exclude` tách theo dấu phẩy, bỏ rỗng, tối đa 50 id', async () => {
    await ctrl.suggest({ key: 'home_featured', exclude: 'a,,b,' });
    expect(svc.suggest).toHaveBeenLastCalledWith('home_featured', ['a', 'b']);
    await ctrl.suggest({ key: 'home_featured' });
    expect(svc.suggest).toHaveBeenLastCalledWith('home_featured', []);
    await ctrl.suggest({ key: 'home_featured', exclude: Array.from({ length: 60 }, (_, i) => `p${i}`).join(',') });
    expect((svc.suggest.mock.calls.at(-1) as [string, string[]])[1]).toHaveLength(50);
  });

  it('người lưu là người đang đăng nhập', async () => {
    const dto = { key: 'home_featured', version: 'v', pins: [] };
    await ctrl.save({ sub: 'u-1', role: 'STAFF' } as never, dto);
    expect(svc.save).toHaveBeenCalledWith(dto, 'u-1');
  });
});
