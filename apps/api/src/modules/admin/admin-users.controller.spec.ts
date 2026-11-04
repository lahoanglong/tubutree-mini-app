import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AdminUsersController, BlockUserDto, RevokeSessionsDto } from './admin-users.controller';
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

describe('AdminUsersController — cắt phiên (L1-04)', () => {
  it('chuyển admin, id và lý do sang service', async () => {
    const blocks = { revokeSessions: jest.fn().mockResolvedValue({ revokedSessions: 2 }) };
    const ctrl = new AdminUsersController(blocks as unknown as UserBlockService, {} as never);
    await expect(ctrl.revokeSessions('admin1', 'u9', { reason: 'Nghi lộ phiên' })).resolves.toEqual({ revokedSessions: 2 });
    expect(blocks.revokeSessions).toHaveBeenCalledWith('admin1', 'u9', 'Nghi lộ phiên');
  });

  it.each([
    ['thiếu lý do', {}],
    ['lý do quá ngắn', { reason: 'ab' }],
    ['lý do quá dài', { reason: 'x'.repeat(501) }],
  ])('RevokeSessionsDto từ chối: %s', (_label, body) => {
    expect(validateSync(plainToInstance(RevokeSessionsDto, body)).length).toBeGreaterThan(0);
  });
});

describe('AdminUsersController — chi tiết kèm người xem (m5)', () => {
  it('chuyển id admin đang xem sang service để tính cờ được cắt phiên', async () => {
    const admin = { getUserDetail: jest.fn().mockResolvedValue({}) };
    const ctrl = new AdminUsersController({} as never, admin as never);
    await ctrl.detail('admin1', 'u9');
    expect(admin.getUserDetail).toHaveBeenCalledWith('u9', 'admin1');
  });
});

describe('DTO lý do: cắt khoảng trắng trước khi kiểm độ dài (nit)', () => {
  it.each([BlockUserDto, RevokeSessionsDto])('%p: "  ab  " bị từ chối vì chỉ còn 2 ký tự sau khi cắt', (Dto) => {
    expect(validateSync(plainToInstance(Dto, { reason: '  ab  ' })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(Dto, { reason: '  abc  ' }))).toHaveLength(0);
    expect(plainToInstance(Dto, { reason: '  abc  ' }).reason).toBe('abc');
  });
});
