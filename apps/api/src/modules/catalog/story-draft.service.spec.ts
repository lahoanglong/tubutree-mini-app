import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StoryAiService } from '../ai-advisor/story-ai.service';
import { StoryDraftController } from './story-draft.controller';
import { StoryDraftService } from './story-draft.service';

const PRODUCT = {
  name: 'Đường hoa dừa SOKFARM',
  brand: 'Sokfarm',
  shortDesc: 'Đường từ mật hoa dừa',
  description: 'Mô tả dài',
  ingredients: [{ name: 'Mật hoa dừa', benefit: 'Không qua tinh luyện' }, { name: '' }, 'rác', null, { benefit: 'thiếu tên' }],
  certifications: ['Organic'],
  basePrice: 125_000,
  salePrice: null,
  categoryIds: ['c1', 'c2'],
  variations: [
    { name: '300g', retailPrice: 125_000, salePrice: null },
    { name: '[object Object]', retailPrice: 360_000, salePrice: null },
    { name: '', retailPrice: 1_500_000, salePrice: null },
    { name: '5KG', retailPrice: 1_500_000, salePrice: 1_400_000 },
  ],
};

function make(product: unknown) {
  const findUnique = jest.fn(async () => product);
  const findMany = jest.fn(async () => [{ name: 'Thực phẩm' }, { name: 'Đường' }]);
  const prisma = { product: { findUnique }, category: { findMany } } as unknown as PrismaService;
  const draft = jest.fn(async () => ({ config: { version: 1, enabled: true, scenes: [] }, warnings: [], provider: 'antigravity' as const }));
  const svc = new StoryDraftService(prisma, { draft } as unknown as StoryAiService);
  return { svc, findUnique, findMany, draft };
}

describe('StoryDraftService.generate', () => {
  it('lấy dữ liệu từ DB theo id, không tin gì từ máy khách ngoài ghi chú; bỏ tên phân loại hỏng và thành phần thiếu tên', async () => {
    const { svc, draft, findUnique, findMany } = make(PRODUCT);
    await svc.generate('p1', 'Ghi chú của admin');
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1' } }));
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: ['c1', 'c2'] } }, select: { name: true } });
    expect(draft).toHaveBeenCalledWith({
      name: 'Đường hoa dừa SOKFARM',
      brand: 'Sokfarm',
      categories: ['Thực phẩm', 'Đường'],
      price: 125_000,
      variations: [
        { name: '300g', price: 125_000 },
        { name: '5KG', price: 1_400_000 },
      ],
      shortDesc: 'Đường từ mật hoa dừa',
      description: 'Mô tả dài',
      ingredients: [{ name: 'Mật hoa dừa', benefit: 'Không qua tinh luyện' }],
      certifications: ['Organic'],
      note: 'Ghi chú của admin',
    });
  });

  it('giá lấy giá khuyến mãi nếu có; không có danh mục thì không truy vấn danh mục; ghi chú thiếu thành chuỗi rỗng', async () => {
    const { svc, draft, findMany } = make({ ...PRODUCT, salePrice: 99_000, categoryIds: [], ingredients: null });
    await svc.generate('p1', undefined);
    expect(findMany).not.toHaveBeenCalled();
    expect(draft).toHaveBeenCalledWith(expect.objectContaining({ price: 99_000, categories: [], ingredients: [], note: '' }));
  });

  it('không có sản phẩm thì 404 và không gọi AI', async () => {
    const { svc, draft } = make(null);
    await expect(svc.generate('nope', '')).rejects.toBeInstanceOf(NotFoundException);
    expect(draft).not.toHaveBeenCalled();
  });
});

describe('StoryDraftController', () => {
  it('chỉ ADMIN được gọi', () => {
    expect(Reflect.getMetadata('roles', StoryDraftController)).toEqual(['ADMIN']);
  });

  it('có giới hạn tốc độ riêng 6 lượt mỗi phút', () => {
    const proto = StoryDraftController.prototype;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.generate)).toBe(6);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', proto.generate)).toBe(60_000);
  });
});
