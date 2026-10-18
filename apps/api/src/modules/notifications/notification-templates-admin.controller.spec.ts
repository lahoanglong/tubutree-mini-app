import 'reflect-metadata';
import { NotificationTemplatesAdminController } from './notification-templates-admin.controller';

describe('NotificationTemplatesAdminController — báo service người sửa không phải quản trị viên (D1-05)', () => {
  it.each([
    ['ADMIN', false],
    ['STAFF', true],
    ['DEALER', true],
  ])('role %s → staff %s', async (role, staff) => {
    const templates = { update: jest.fn().mockResolvedValue({}) };
    await new NotificationTemplatesAdminController(templates as never).update('u-1', role, 'FLASH_STARTING', { bodyTemplate: 'x' });
    expect(templates.update).toHaveBeenCalledWith('FLASH_STARTING', { bodyTemplate: 'x' }, { id: 'u-1', staff });
  });
});
