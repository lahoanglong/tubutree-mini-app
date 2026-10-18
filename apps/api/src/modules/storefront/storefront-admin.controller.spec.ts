import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import { StorefrontAdminController, StorefrontAdminListQueryDto, TakeDownStorefrontDto } from './storefront-admin.controller';

describe('StorefrontAdminController', () => {
  it('chỉ ADMIN, không nhóm việc STAFF nào mở được', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StorefrontAdminController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, StorefrontAdminController)).toBeUndefined();
    for (const name of ['list', 'detail', 'takeDown', 'reinstate', 'approval'] as const) {
      expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, StorefrontAdminController.prototype[name])).toBeUndefined();
    }
  });

  it('các đường dẫn dưới admin/storefronts', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StorefrontAdminController)).toBe('admin/storefronts');
    const route = (name: keyof StorefrontAdminController) => {
      const h = StorefrontAdminController.prototype[name] as unknown as object;
      return [RequestMethod[Reflect.getMetadata(METHOD_METADATA, h) as number], Reflect.getMetadata(PATH_METADATA, h)];
    };
    expect(route('list')).toEqual(['GET', '/']);
    expect(route('detail')).toEqual(['GET', ':id']);
    expect(route('takeDown')).toEqual(['POST', ':id/take-down']);
    expect(route('reinstate')).toEqual(['POST', ':id/reinstate']);
    expect(route('approval')).toEqual(['POST', ':id/approval']);
  });

  it('lý do gỡ đăng bắt buộc (chuỗi toàn khoảng trắng cũng bị từ chối) và tối đa 300 ký tự', async () => {
    const check = async (reason: unknown) => (await validate(plainToInstance(TakeDownStorefrontDto, { reason }))).length;
    expect(await check('   ')).toBeGreaterThan(0);
    expect(await check(undefined)).toBeGreaterThan(0);
    expect(await check('x'.repeat(301))).toBeGreaterThan(0);
    expect(await check(' Ảnh bìa vi phạm ')).toBe(0);
  });

  it('bộ lọc danh sách chỉ nhận trạng thái và loại có thật', async () => {
    const check = async (q: Record<string, unknown>) => (await validate(plainToInstance(StorefrontAdminListQueryDto, q))).length;
    expect(await check({ status: 'TAKEN_DOWN', type: 'CTV', q: 'linh', page: '2' })).toBe(0);
    expect(await check({ status: 'HACKED' })).toBeGreaterThan(0);
    expect(await check({ type: 'ADMIN' })).toBeGreaterThan(0);
  });
});
