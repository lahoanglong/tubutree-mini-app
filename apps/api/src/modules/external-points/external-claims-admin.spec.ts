import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import {
  AttachAttemptDto,
  ClaimReasonDto,
  ExternalClaimListQueryDto,
  ExternalClaimsAdminController,
} from './external-claims-admin.controller';
import { ExternalClaimsController, SubmitExternalClaimDto } from './external-claims.controller';

const proto = ExternalClaimsAdminController.prototype as unknown as Record<string, object>;
const perms = (handler: string): string[] =>
  (Reflect.getMetadata(STAFF_PERMISSIONS_KEY, proto[handler]!) as string[] | undefined) ??
  (Reflect.getMetadata(STAFF_PERMISSIONS_KEY, ExternalClaimsAdminController) as string[]);

describe('ExternalClaimsAdminController: phân quyền', () => {
  it('lớp chỉ ADMIN, mặc định nhóm CSKH', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ExternalClaimsAdminController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(PATH_METADATA, ExternalClaimsAdminController)).toBe('admin/external-claims');
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, ExternalClaimsAdminController)).toEqual(['CSKH']);
  });
  it('KE_TOAN chỉ đọc: có ở mọi GET và không có ở bất kỳ POST nào', () => {
    for (const name of Object.getOwnPropertyNames(ExternalClaimsAdminController.prototype).filter((n) => n !== 'constructor')) {
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, proto[name]!) as number];
      expect({ name, hasKeToan: perms(name).includes('KE_TOAN') }).toEqual({ name, hasKeToan: method === 'GET' });
    }
  });
  it('CSKH duyệt, huỷ, huỷ và mở lại mã, gắn và từ chối lần gửi mã', () => {
    for (const name of ['approve', 'void', 'voidAndReopen', 'attach', 'rejectAttempt']) expect(perms(name)).toEqual(['CSKH']);
  });
  it('chỉ ADMIN đảo điểm đã cộng: @AllowStaff() rỗng ở handler ghi đè nhóm CSKH của lớp', () => {
    expect(perms('reverse')).toEqual([]);
  });
});

describe('DTO', () => {
  it('lý do huỷ bắt buộc, không rỗng, tối đa 300', () => {
    expect(validateSync(plainToInstance(ClaimReasonDto, { reason: ' khách nhập nhầm ' }))).toHaveLength(0);
    expect(validateSync(plainToInstance(ClaimReasonDto, {})).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(ClaimReasonDto, { reason: '   ' })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(ClaimReasonDto, { reason: 'x'.repeat(301) })).length).toBeGreaterThan(0);
  });
  it('gắn lần gửi mã cần pancakeOrderId', () => {
    expect(validateSync(plainToInstance(AttachAttemptDto, { pancakeOrderId: '910001' }))).toHaveLength(0);
    expect(validateSync(plainToInstance(AttachAttemptDto, {})).length).toBeGreaterThan(0);
  });
  it('bộ lọc danh sách từ chối trạng thái lạ', () => {
    expect(validateSync(plainToInstance(ExternalClaimListQueryDto, { state: 'REVIEW', q: 'SPX', page: '2' }))).toHaveLength(0);
    expect(validateSync(plainToInstance(ExternalClaimListQueryDto, { state: 'PAID' })).length).toBeGreaterThan(0);
  });
  it('mã khách gửi: bắt buộc, cắt khoảng trắng, tối đa 100 ký tự', () => {
    expect(validateSync(plainToInstance(SubmitExternalClaimDto, { code: ' spx123456789 ' }))).toHaveLength(0);
    expect(validateSync(plainToInstance(SubmitExternalClaimDto, {})).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(SubmitExternalClaimDto, { code: 'x'.repeat(101) })).length).toBeGreaterThan(0);
  });
});

describe('ExternalClaimsController (khách)', () => {
  it('đường dẫn me/external-points, không có @Roles ở lớp (mọi người dùng đã đăng nhập)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ExternalClaimsController)).toBe('me/external-points');
    expect(Reflect.getMetadata(ROLES_KEY, ExternalClaimsController)).toBeUndefined();
  });
});
