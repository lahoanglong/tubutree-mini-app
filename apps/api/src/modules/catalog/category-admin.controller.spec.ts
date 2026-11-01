import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CATEGORY_MAX_CHILDREN } from './category-tree';
import {
  CategoryAdminController,
  CreateCategoryDto,
  ReorderCategoriesDto,
  UpdateCategoryDto,
} from './category-admin.controller';
import type { CategoryAdminService } from './category-admin.service';

const errs = (cls: new () => object, body: object) => validate(plainToInstance(cls, body));

describe('DTO của admin/categories', () => {
  it('tạo: tên 1–60 ký tự sau khi cắt khoảng trắng; parentId tuỳ chọn', async () => {
    expect(await errs(CreateCategoryDto, { name: ' Nhà bếp ' })).toHaveLength(0);
    expect(await errs(CreateCategoryDto, { name: 'Con', parentId: 'cha1' })).toHaveLength(0);
    expect(await errs(CreateCategoryDto, { name: '   ' })).not.toHaveLength(0);
    expect(await errs(CreateCategoryDto, { name: 'x'.repeat(61) })).not.toHaveLength(0);
    expect(plainToInstance(CreateCategoryDto, { name: '  A  ' }).name).toBe('A');
  });

  it('sửa: tên và parentId đều tuỳ chọn; parentId null là chuyển lên gốc; tên null bị chặn', async () => {
    expect(await errs(UpdateCategoryDto, {})).toHaveLength(0);
    expect(await errs(UpdateCategoryDto, { name: 'Mới' })).toHaveLength(0);
    expect(await errs(UpdateCategoryDto, { parentId: null })).toHaveLength(0);
    expect(await errs(UpdateCategoryDto, { name: null })).not.toHaveLength(0);
    expect(await errs(UpdateCategoryDto, { name: '' })).not.toHaveLength(0);
  });

  it('sắp xếp: parentId (có thể null) bắt buộc, orderedIds 1–8 chuỗi', async () => {
    expect(await errs(ReorderCategoriesDto, { parentId: null, orderedIds: ['a', 'b'] })).toHaveLength(0);
    expect(await errs(ReorderCategoriesDto, { parentId: 'p', orderedIds: ['a'] })).toHaveLength(0);
    expect(await errs(ReorderCategoriesDto, { parentId: null, orderedIds: [] })).not.toHaveLength(0);
    const nine = Array.from({ length: CATEGORY_MAX_CHILDREN + 1 }, (_, i) => `c${i}`);
    expect(await errs(ReorderCategoriesDto, { parentId: null, orderedIds: nine })).not.toHaveLength(0);
    expect(await errs(ReorderCategoriesDto, { orderedIds: ['a'] })).not.toHaveLength(0);
  });
});

describe('CategoryAdminController', () => {
  const svc = {
    list: jest.fn().mockResolvedValue({ items: [], limits: {} }),
    create: jest.fn().mockResolvedValue({ id: 'n' }),
    update: jest.fn().mockResolvedValue({ id: 'a' }),
    reorder: jest.fn().mockResolvedValue({ items: [] }),
    remove: jest.fn().mockResolvedValue({ id: 'a' }),
  };
  const ctrl = new CategoryAdminController(svc as unknown as CategoryAdminService);

  it('chuyển đúng tham số và id quản trị cho dịch vụ', async () => {
    await ctrl.list();
    await ctrl.create('adm', { name: 'A', parentId: 'p' });
    await ctrl.update('adm', 'a', { name: 'B' });
    await ctrl.reorder('adm', { parentId: null, orderedIds: ['b', 'a'] });
    await ctrl.remove('adm', 'a');
    expect(svc.create).toHaveBeenCalledWith('adm', { name: 'A', parentId: 'p' });
    expect(svc.update).toHaveBeenCalledWith('adm', 'a', { name: 'B' });
    expect(svc.reorder).toHaveBeenCalledWith('adm', null, ['b', 'a']);
    expect(svc.remove).toHaveBeenCalledWith('adm', 'a');
  });
});
