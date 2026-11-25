import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { fetchRepurchaseDue, parseRepurchaseDue, REPURCHASE_DUE_KEY, repurchaseDueQuery } from './repurchase-due';

const item = {
  key: 'o1:v-refill',
  days: 30,
  boughtName: 'Nước rửa chén Fuwa3e 500ml',
  kind: 'refill',
  variationId: 'v-refill',
  productId: 'p-refill',
  slug: 'nuoc-rua-chen-fuwa3e-refill-1l',
  productName: 'Túi Refill nước rửa chén Fuwa3e 1L',
  variationName: '',
  thumbnail: 'https://res.cloudinary.com/x/image/upload/t.jpg',
  price: 89000,
  listPrice: 99000,
};

describe('GET /me/repurchase-due', () => {
  it('một lời gọi, trả đúng món; khoá riêng ngoài [me]', async () => {
    const { http, calls } = fakeHttp(() => ({ item }));
    await expect(fetchRepurchaseDue(http)).resolves.toEqual({ item });
    expect(calls).toEqual([{ method: 'get', path: '/me/repurchase-due' }]);
    expect(repurchaseDueQuery(http).queryKey).toEqual(REPURCHASE_DUE_KEY);
    expect(REPURCHASE_DUE_KEY[0]).not.toBe('me');
    expect(repurchaseDueQuery(http).retry).toBe(false);
  });

  it('cờ tắt: { item: null }', async () => {
    await expect(fetchRepurchaseDue(fakeHttp(() => ({ item: null })).http)).resolves.toEqual({ item: null });
  });

  it.each([
    ['null', null],
    ['route khác trả nhầm', { orders: [] }],
    ['thiếu variationId', { item: { ...item, variationId: undefined } }],
    ['giá 0', { item: { ...item, price: 0 } }],
    ['giá là chuỗi', { item: { ...item, price: '89000' } }],
    ['kind lạ', { item: { ...item, kind: 'gift' } }],
    ['ngày âm', { item: { ...item, days: -1 } }],
    ['ảnh không phải chuỗi', { item: { ...item, thumbnail: 42 } }],
  ])('body lạ (%s): không có thẻ, không ném', (_n, bad) => {
    expect(parseRepurchaseDue(bad)).toEqual({ item: null });
  });

  it('không mang khoá lạ từ máy chủ sang máy khách', () => {
    expect(parseRepurchaseDue({ item: { ...item, phone: '0907345678' } }).item).not.toHaveProperty('phone');
  });
});
