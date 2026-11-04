import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation-pipe';
import { PickerQuery, UpdateStorefrontDto } from './storefront.controller';

const pipe = createValidationPipe();
const run = (value: unknown) => pipe.transform(value, { type: 'body', metatype: UpdateStorefrontDto }) as Promise<UpdateStorefrontDto>;

describe('DTO sửa gian hàng: ảnh đại diện và ảnh bìa', () => {
  it.each(['avatarUrl', 'coverUrl'])('%s chỉ kiểm là chuỗi và độ dài; việc kiểm https nằm ở service, chỉ khi giá trị đổi', async (field) => {
    await expect(run({ [field]: 'http://old.example/a.png' })).resolves.toBeDefined();
    await expect(run({ [field]: '' })).resolves.toBeDefined();
    await expect(run({ [field]: 123 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ [field]: 'a'.repeat(1_500_001) })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DTO sửa gian hàng: theme', () => {
  it('theme quá 40 ký tự → 400; ngắn → nhận', async () => {
    await expect(run({ theme: 'leaf-orange' })).resolves.toBeDefined();
    await expect(run({ theme: 'x'.repeat(41) })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PickerQuery (me/products): page/limit', () => {
  const pick = (value: unknown) => pipe.transform(value, { type: 'query', metatype: PickerQuery });
  it("page '1e20' → 400; '10000' hợp lệ", async () => {
    await expect(pick({ page: '1e20' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pick({ page: '10000' })).resolves.toBeDefined();
  });
});
