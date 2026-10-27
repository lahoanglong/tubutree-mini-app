import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBrandDto, UpdateBrandDto, UpdateOwnedBrandDto } from './brand.dto';

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
