import { ValidationPipe } from '@nestjs/common';
import { OrderListQuery } from './orders.dto';

// Cùng cấu hình ValidationPipe với main.ts — forbidNonWhitelisted: field lạ bị từ chối.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asQuery = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'query', metatype, data: undefined });

describe('OrderListQuery', () => {
  it('nhận group=processing và group=closed', async () => {
    await expect(asQuery(OrderListQuery, { group: 'processing' })).resolves.toMatchObject({ group: 'processing' });
    await expect(asQuery(OrderListQuery, { group: 'closed' })).resolves.toMatchObject({ group: 'closed' });
  });

  it('từ chối group lạ', async () => {
    await expect(asQuery(OrderListQuery, { group: 'everything' })).rejects.toThrow();
  });

  it('status đơn lẻ vẫn nhận như cũ; page/limit ép sang số', async () => {
    await expect(asQuery(OrderListQuery, { status: 'PACKED', page: '2', limit: '5' })).resolves.toMatchObject({
      status: 'PACKED',
      page: 2,
      limit: 5,
    });
  });
});
