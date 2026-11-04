import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { AdminController } from './admin.controller';
import { assertStaffUserListQuery, STAFF_USER_SEARCH_REQUIRED } from './admin-users-staff-limits';

const q = (over: Partial<{ search: string; page: number; limit: number }> = {}) => ({ search: '0912345678', page: 1, limit: 20, ...over });

describe('assertStaffUserListQuery (CSKH phải tìm mới thấy khách)', () => {
  it.each([
    ['SĐT đủ 10 số', '0912345678'],
    ['SĐT dạng +84', '+84 912 345 678'],
    ['SĐT có dấu chấm', '0912.345.678'],
    ['tên 3 ký tự', 'Lan'],
    ['tên có dấu', 'Nguyễn Văn An'],
    ['id khách', 'cmw206272002sluukpajmhopd'],
  ])('cho qua: %s', (_n, search) => {
    expect(() => assertStaffUserListQuery(q({ search }))).not.toThrow();
  });

  it.each([
    ['thiếu từ khoá', undefined],
    ['từ khoá toàn khoảng trắng', '   '],
    ['tên 2 ký tự', 'An'],
  ])('từ chối: %s', (_n, search) => {
    expect(() => assertStaffUserListQuery(q({ search }))).toThrow(STAFF_USER_SEARCH_REQUIRED);
  });

  it.each(['0912', '09123456', '+84 912', '123456789012'])('SĐT thiếu hoặc thừa số (%s) → 400 nói rõ cần đủ 10 số', (search) => {
    expect(() => assertStaffUserListQuery(q({ search }))).toThrow('đủ 10 số');
  });

  it('trang 6 và limit 21 bị từ chối, trang 5 và limit 20 qua', () => {
    expect(() => assertStaffUserListQuery(q({ page: 5, limit: 20 }))).not.toThrow();
    expect(() => assertStaffUserListQuery(q({ page: 6 }))).toThrow(BadRequestException);
    expect(() => assertStaffUserListQuery(q({ limit: 21 }))).toThrow('tối đa 20');
  });
});

describe('AdminController.users: áp luật CSKH, ADMIN không đổi', () => {
  const list = jest.fn().mockResolvedValue({ data: [] });
  const ctrl = new AdminController({ listUsers: list } as never, {} as never);
  const query = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, ...over }) as never;

  beforeEach(() => list.mockClear());

  it('STAFF không có search → 400, không truy vấn', () => {
    expect(() => ctrl.users(query(), { sub: 's1', role: 'STAFF' } as never)).toThrow(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });

  it('STAFF tìm đúng SĐT → truy vấn bình thường', async () => {
    await ctrl.users(query({ search: '0912345678' }), { sub: 's1', role: 'STAFF' } as never);
    expect(list).toHaveBeenCalledWith(1, 20, '0912345678', false);
  });

  it('ADMIN không search, limit 100, trang 50 → vẫn chạy như cũ', async () => {
    await ctrl.users(query({ page: 50, limit: 100 }), { sub: 'a1', role: 'ADMIN' } as never);
    expect(list).toHaveBeenCalledWith(50, 100, undefined, false);
  });

  it('route có hạn 30 lần mỗi phút riêng cho CSKH (ADMIN bỏ qua, xem throttle.config)', () => {
    const handler = AdminController.prototype.users;
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}staffLookup`, handler)).toBe(30);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}staffLookup`, handler)).toBe(60_000);
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBeUndefined();
  });
});
