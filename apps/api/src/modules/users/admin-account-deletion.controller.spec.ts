import 'reflect-metadata';
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AdminAccountDeletionController } from './admin-account-deletion.controller';
import type { AccountDeletionService } from './account-deletion.service';

describe('AdminAccountDeletionController (C-016)', () => {
  it('chỉ ADMIN gọi được, không có route public', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminAccountDeletionController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminAccountDeletionController)).toBeUndefined();
    for (const m of ['list', 'process'] as const) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, AdminAccountDeletionController.prototype[m])).toBeUndefined();
    }
  });

  it('list mặc định PENDING; process chuyển id + adminId + ghi chú xuống service', async () => {
    const svc = {
      list: jest.fn().mockResolvedValue([]),
      process: jest.fn().mockResolvedValue({ alreadyProcessed: false }),
    };
    const ctrl = new AdminAccountDeletionController(svc as unknown as AccountDeletionService);
    await ctrl.list({});
    expect(svc.list).toHaveBeenCalledWith('PENDING');
    await ctrl.list({ status: 'ALL' });
    expect(svc.list).toHaveBeenCalledWith('ALL');
    await ctrl.process('admin-1', 'req-1', { note: 'ok' });
    expect(svc.process).toHaveBeenCalledWith('req-1', 'admin-1', 'ok', undefined);
    await ctrl.process('admin-1', 'req-2', { overrideWalletBalance: { reason: 'khách mất liên lạc' } });
    expect(svc.process).toHaveBeenCalledWith('req-2', 'admin-1', undefined, { reason: 'khách mất liên lạc' });
  });

  it('từ chối status lạ ở query', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const metatype = Reflect.getMetadata('design:paramtypes', AdminAccountDeletionController.prototype, 'list')[0];
    const meta: ArgumentMetadata = { type: 'query', metatype };
    await expect(pipe.transform({ status: 'DELETE_ALL' }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ status: 'RESOLVED' }, meta)).resolves.toMatchObject({ status: 'RESOLVED' });
  });

  describe('overrideWalletBalance (DTO)', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const meta = (): ArgumentMetadata => ({
      type: 'body',
      metatype: Reflect.getMetadata('design:paramtypes', AdminAccountDeletionController.prototype, 'process')[2],
    });

    it('lý do được cắt khoảng trắng và nhận khi đủ 10 ký tự', async () => {
      await expect(pipe.transform({ overrideWalletBalance: { reason: '   khách đã mất liên lạc   ' } }, meta())).resolves.toMatchObject({
        overrideWalletBalance: { reason: 'khách đã mất liên lạc' },
      });
    });

    it.each([
      ['thiếu lý do', { overrideWalletBalance: {} }],
      ['lý do ngắn (sau khi cắt)', { overrideWalletBalance: { reason: '  ngắn quá  ' } }],
      ['lý do trống', { overrideWalletBalance: { reason: '          ' } }],
      ['lý do quá 500 ký tự', { overrideWalletBalance: { reason: 'a'.repeat(501) } }],
    ])('400: %s', async (_n, body) => {
      await expect(pipe.transform(body, meta())).rejects.toBeDefined();
    });
  });
});
