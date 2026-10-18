import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation-pipe';
import { UpdateStorefrontDto } from './storefront.controller';

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
