import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { REFILL_ADMIN_LIST_MAX, RefillPairsAdminController, SaveRefillPairsDto } from './refill-pairs-admin.controller';

describe('RefillPairsAdminController', () => {
  const build = () => {
    const svc = { adminOverview: jest.fn(async () => ({ rows: [] })), adminSave: jest.fn(async () => ({ rows: [] })) };
    return { svc, ctl: new RefillPairsAdminController(svc as never) };
  };

  it('nhân viên MARKETING sửa cặp được, ghi đúng người sửa', async () => {
    const { svc, ctl } = build();
    await ctl.save({ sub: 'staff-1', role: 'STAFF' } as never, { block: ['a'] });
    expect(svc.adminSave).toHaveBeenCalledWith({ block: ['a'] }, 'staff-1');
  });

  it('bật/tắt cả tính năng chỉ ADMIN', async () => {
    const { svc, ctl } = build();
    expect(() => ctl.save({ sub: 'staff-1', role: 'STAFF' } as never, { enabled: true })).toThrow(ForbiddenException);
    expect(svc.adminSave).not.toHaveBeenCalled();
    await ctl.save({ sub: 'admin-1', role: 'ADMIN' } as never, { enabled: false });
    expect(svc.adminSave).toHaveBeenCalledWith({ enabled: false }, 'admin-1');
  });

  it('duyệt nhanh gợi ý (confirm): MARKETING gửi được như ghép tay từng cặp, chuyển nguyên danh sách xuống service (tubu-w11-01)', async () => {
    const { svc, ctl } = build();
    const confirm = [{ bottleSlug: 'nuoc-giat-huong-cam-fuwa3e-500ml', refillSlug: 'refill-nuoc-giat-cam-fuwa3e-10l' }];
    await ctl.save({ sub: 'staff-1', role: 'STAFF' } as never, { confirm });
    expect(svc.adminSave).toHaveBeenCalledWith({ confirm }, 'staff-1');
  });

  it('DTO confirm: mảng 1..REFILL_ADMIN_LIST_MAX cặp slug khác rỗng', async () => {
    const errorsOf = async (body: unknown) => (await validate(plainToInstance(SaveRefillPairsDto, body))).map((e) => e.property);
    const ok = { bottleSlug: 'a', refillSlug: 'refill-a' };
    expect(await errorsOf({ confirm: [ok] })).toEqual([]);
    expect(await errorsOf({ confirm: [] })).toEqual(['confirm']);
    expect(await errorsOf({ confirm: [{ bottleSlug: '', refillSlug: 'refill-a' }] })).toEqual(['confirm']);
    expect(await errorsOf({ confirm: 'a' })).toEqual(['confirm']);
    // null không phải "bỏ trường" (patch-null-contract): mọi trường của body PUT chặn null.
    for (const field of ['confirm', 'add', 'remove', 'overrides', 'block', 'enabled']) expect(await errorsOf({ [field]: null })).toEqual([field]);
    expect(await errorsOf({ confirm: Array.from({ length: REFILL_ADMIN_LIST_MAX + 1 }, () => ok) })).toEqual(['confirm']);
  });
});
