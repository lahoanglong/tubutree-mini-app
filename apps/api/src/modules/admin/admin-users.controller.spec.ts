import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AdminUsersController, BlockUserDto } from './admin-users.controller';
import type { UserBlockService } from './user-block.service';

describe('AdminUsersController — khoá/mở khoá người dùng', () => {
  it('chỉ ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminUsersController)).toEqual(['ADMIN']);
  });

  it('chuyển đúng admin đang thao tác, id và lý do sang service', async () => {
    const blocks = { block: jest.fn().mockResolvedValue({ id: 'u9' }), unblock: jest.fn().mockResolvedValue({ id: 'u9' }) };
    const ctrl = new AdminUsersController(blocks as unknown as UserBlockService, {} as never);
    await ctrl.block('admin1', 'u9', { reason: 'Lừa đảo COD' });
    await ctrl.unblock('admin1', 'u9');
    expect(blocks.block).toHaveBeenCalledWith('admin1', 'u9', 'Lừa đảo COD');
    expect(blocks.unblock).toHaveBeenCalledWith('admin1', 'u9');
  });

  it.each([
    ['thiếu lý do', {}],
    ['lý do quá ngắn', { reason: 'ab' }],
    ['lý do quá dài', { reason: 'x'.repeat(501) }],
  ])('BlockUserDto từ chối: %s', (_label, body) => {
    expect(validateSync(plainToInstance(BlockUserDto, body)).length).toBeGreaterThan(0);
  });
});
