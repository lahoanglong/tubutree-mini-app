import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation-pipe';
import { UpdateStorefrontDto } from './storefront.controller';

const pipe = createValidationPipe();
const run = (value: unknown) => pipe.transform(value, { type: 'body', metatype: UpdateStorefrontDto }) as Promise<UpdateStorefrontDto>;

describe('DTO sửa gian hàng: ảnh đại diện và ảnh bìa', () => {
  it.each(['avatarUrl', 'coverUrl'])('%s chỉ nhận https, ảnh raster base64 hoặc chuỗi rỗng', async (field) => {
    for (const ok of ['https://res.cloudinary.com/x/a.jpg', `data:image/png;base64,${'A'.repeat(64)}`, '']) {
      await expect(run({ [field]: ok })).resolves.toBeDefined();
    }
    for (const bad of ['http://api:3001/a.png', 'http://127.0.0.1/a.png', 'https://u:p@evil.vn/a.png', 'data:text/html;base64,PGgxPg==']) {
      await expect(run({ [field]: bad })).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
