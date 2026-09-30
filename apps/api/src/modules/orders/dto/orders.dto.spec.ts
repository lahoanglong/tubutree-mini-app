import { ValidationPipe } from '@nestjs/common';
import { OrderListQuery, PurchasedItemsQuery, RepurchaseDto } from './orders.dto';

// Cùng cấu hình ValidationPipe với main.ts — forbidNonWhitelisted: field lạ bị từ chối.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asQuery = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'query', metatype, data: undefined });
const asBody = (metatype: new () => object, value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype, data: undefined });

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

describe('RepurchaseDto', () => {
  it('body rỗng hợp lệ (client cũ không gửi gì)', async () => {
    await expect(asBody(RepurchaseDto, {})).resolves.toBeDefined();
  });

  it('nhận items + addSource hợp lệ', async () => {
    await expect(
      asBody(RepurchaseDto, { items: [{ orderItemId: 'oi1', quantity: 2 }], addSource: 'reorder_notification' }),
    ).resolves.toMatchObject({ items: [{ orderItemId: 'oi1', quantity: 2 }], addSource: 'reorder_notification' });
  });

  it.each([
    ['items rỗng', { items: [] }],
    ['quantity 0', { items: [{ orderItemId: 'oi1', quantity: 0 }] }],
    ['quantity 1000', { items: [{ orderItemId: 'oi1', quantity: 1000 }] }],
    ['thiếu orderItemId', { items: [{ quantity: 1 }] }],
    ['addSource lạ', { addSource: 'pdp' }],
    ['field lạ', { foo: 1 }],
  ])('từ chối %s', async (_l, body) => {
    await expect(asBody(RepurchaseDto, body)).rejects.toThrow();
  });
});

describe('PurchasedItemsQuery', () => {
  it('mặc định limit=20; ép kiểu limit chuỗi', async () => {
    await expect(asQuery(PurchasedItemsQuery, {})).resolves.toMatchObject({ limit: 20 });
    await expect(asQuery(PurchasedItemsQuery, { limit: '10', variationId: 'v1' })).resolves.toMatchObject({ limit: 10, variationId: 'v1' });
  });
  it.each([[{ variationId: 'a\u0000b' }], [{ variationId: 'a b' }], [{ variationId: "x';--" }], [{ variationId: 'a'.repeat(65) }], [{ variationId: '' }]])(
    'từ chối variationId sai định dạng %p',
    async (q) => {
      await expect(asQuery(PurchasedItemsQuery, q)).rejects.toThrow();
    },
  );
  it('nhận variationId dạng cuid / id có gạch', async () => {
    await expect(asQuery(PurchasedItemsQuery, { variationId: 'clx0abc123_DEF-9' })).resolves.toMatchObject({ variationId: 'clx0abc123_DEF-9' });
  });
  it.each([[{ limit: '51' }], [{ limit: '0' }], [{ userId: 'u2' }]])('từ chối %p (không nhận userId từ client)', async (q) => {
    await expect(asQuery(PurchasedItemsQuery, q)).rejects.toThrow();
  });
});
