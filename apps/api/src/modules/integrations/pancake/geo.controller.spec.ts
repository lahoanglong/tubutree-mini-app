import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GeoCommunesQuery, GeoController } from './geo.controller';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const as = (value: unknown) => pipe.transform(value, { type: 'query', metatype: GeoCommunesQuery });

describe('GET /geo/communes query', () => {
  it('chuỗi hợp lệ qua được pipe', async () => {
    await expect(as({ provinceCode: '84_VN26' })).resolves.toMatchObject({ provinceCode: '84_VN26' });
  });

  it('mảng hoặc object bị chặn thay vì thành khoá cache', async () => {
    await expect(as({ provinceCode: ['a', 'b'] })).rejects.toThrow();
    await expect(as({ provinceCode: { a: 'b' } })).rejects.toThrow();
  });

  it('tham số lạ bị từ chối như các endpoint khác', async () => {
    await expect(as({ provinceCode: 'a', foo: '1' })).rejects.toThrow();
  });

  it('thiếu provinceCode vẫn trả thông điệp 400 cũ', async () => {
    const geo = { communes: jest.fn() };
    const c = new GeoController(geo as never);
    await expect(c.communes({})).rejects.toThrow(BadRequestException);
    await expect(c.communes({ provinceCode: '' })).rejects.toThrow('provinceCode là bắt buộc.');
    expect(geo.communes).not.toHaveBeenCalled();
  });

  it('controller khai báo query bằng DTO (để ValidationPipe áp dụng)', () => {
    const t = Reflect.getMetadata('design:paramtypes', GeoController.prototype, 'communes') as unknown[];
    expect(t).toContain(GeoCommunesQuery);
  });
});
