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
    expect(svc.process).toHaveBeenCalledWith('req-1', 'admin-1', 'ok');
  });

  it('từ chối status lạ ở query', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const metatype = Reflect.getMetadata('design:paramtypes', AdminAccountDeletionController.prototype, 'list')[0];
    const meta: ArgumentMetadata = { type: 'query', metatype };
    await expect(pipe.transform({ status: 'DELETE_ALL' }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ status: 'RESOLVED' }, meta)).resolves.toMatchObject({ status: 'RESOLVED' });
  });
});
