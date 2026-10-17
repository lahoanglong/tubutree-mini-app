import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CartQueryDto } from './cart.dto';

describe('CartQueryDto.itemIds (phần giỏ được chọn)', () => {
  const parse = async (plain: Record<string, unknown>) => {
    const dto = plainToInstance(CartQueryDto, plain);
    return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
  };

  it('chuỗi cách nhau dấu phẩy thành mảng, bỏ phần rỗng', async () => {
    const { dto, errors } = await parse({ itemIds: 'a,b,,c' });
    expect(errors).toHaveLength(0);
    expect(dto.itemIds).toEqual(['a', 'b', 'c']);
  });

  it('thiếu itemIds hợp lệ (cả giỏ); quá 200 dòng bị từ chối', async () => {
    expect((await parse({ storefrontSlug: 'shop' })).errors).toHaveLength(0);
    const { errors } = await parse({ itemIds: Array.from({ length: 201 }, (_, i) => `i${i}`).join(',') });
    expect(errors.map((e) => e.property)).toEqual(['itemIds']);
  });
});
