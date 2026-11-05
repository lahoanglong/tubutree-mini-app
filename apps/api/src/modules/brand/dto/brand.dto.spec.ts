import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBrandDto, DealerRewardDto, PromotionDto, UpdateBrandDto, UpdateDealerRewardDto, UpdateOwnedBrandDto, UpdatePromotionDto } from './brand.dto';

const errors = (cls: new () => object, body: object) => validate(plainToInstance(cls, body));
const CLASSES = [CreateBrandDto, UpdateBrandDto, UpdateOwnedBrandDto];

// Loại ảnh được phép kiểm trong BrandService (chỉ khi giá trị đổi so với giá trị đang lưu), không ở DTO.
describe('Logo và ảnh bìa nhãn hàng ở DTO', () => {
  it('DTO không chặn giá trị ảnh (service kiểm theo giá trị đang lưu), chỉ chặn quá dài', async () => {
    for (const cls of CLASSES) {
      expect(await errors(cls, { name: 'Nhãn', logoUrl: 'http://old/logo.png', coverUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })).toHaveLength(0);
      expect(await errors(cls, { name: 'Nhãn', logoUrl: 'x'.repeat(3_000_000) })).not.toHaveLength(0);
    }
  });
});

describe('Trần độ dài chữ của DTO nhãn hàng (SEC-V11)', () => {
  const props = async (cls: new () => object, body: object) => (await errors(cls, body)).map((e) => e.property);
  it.each([
    [CreateBrandDto, 'name', 120],
    [CreateBrandDto, 'slug', 80],
    [UpdateBrandDto, 'name', 120],
    [UpdateBrandDto, 'slug', 80],
    [PromotionDto, 'title', 160],
    [PromotionDto, 'subtitle', 240],
    [UpdatePromotionDto, 'title', 160],
    [UpdatePromotionDto, 'subtitle', 240],
    [DealerRewardDto, 'title', 160],
    [DealerRewardDto, 'description', 5000],
    [UpdateDealerRewardDto, 'title', 160],
    [UpdateDealerRewardDto, 'description', 5000],
  ] as const)('%p.%s: đúng trần %i hợp lệ, quá 1 ký tự thì lỗi', async (cls, field, max) => {
    const valid = { name: 'N', title: 'T', type: 'GIFT', threshold: 1, startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-02T00:00:00Z' };
    expect(await props(cls as never, { ...valid, [field]: 'x'.repeat(max) })).not.toContain(field);
    expect(await props(cls as never, { ...valid, [field]: 'x'.repeat(max + 1) })).toContain(field);
  });
});

describe('Tiêu đề khuyến mãi và chương trình đại lý không được rỗng', () => {
  const messages = async (cls: new () => object, body: object) => (await errors(cls, body)).flatMap((e) => Object.values(e.constraints ?? {}));
  const valid = { type: 'GIFT', threshold: 1, startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-02T00:00:00Z' };

  it.each([
    [PromotionDto],
    [UpdatePromotionDto],
    [DealerRewardDto],
    [UpdateDealerRewardDto],
  ] as const)('%p: tiêu đề toàn khoảng trắng hay ký tự vô hình bị từ chối bằng lời tiếng Việt', async (cls) => {
    for (const title of ['', '   ', '​', ' ​﻿ ']) {
      expect(await messages(cls as never, { ...valid, title })).toContain('Tiêu đề không được để trống.');
    }
    expect(await messages(cls as never, { ...valid, title: 'Giảm 20%' })).not.toContain('Tiêu đề không được để trống.');
  });
});
