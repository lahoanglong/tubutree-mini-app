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

  it('tham số lặp (?itemIds=a&itemIds=b,c): tách dấu phẩy ở từng phần tử, bỏ trùng', async () => {
    const { dto, errors } = await parse({ itemIds: ['a', 'b,c', 'a', ''] });
    expect(errors).toHaveLength(0);
    expect(dto.itemIds).toEqual(['a', 'b', 'c']);
  });

  it('trần 200 tính sau khi tách và bỏ trùng', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `i${i}`);
    expect((await parse({ itemIds: [ids.slice(0, 100).join(','), ids.slice(100).join(',')] })).errors.map((e) => e.property)).toEqual(['itemIds']);
    expect((await parse({ itemIds: [ids.join(','), ids.join(',')].map((x) => x.split(',').slice(0, 200).join(',')) })).errors).toHaveLength(0);
  });
});
