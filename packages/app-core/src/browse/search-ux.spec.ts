import { describe, expect, it, vi } from 'vitest';
import { nearCategories, popularSearchesQuery, zeroResultBlocks } from './search-ux';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const CATS = [
  { label: 'Chăm sóc nhà cửa' },
  { label: 'Giặt xả' },
  { label: 'Cho bé' },
  { label: 'Rau củ' },
  { label: 'Thực phẩm khô' },
];

describe('zeroResultBlocks', () => {
  it('đủ dữ liệu: Ý bạn là → danh mục gần → bán chạy còn hàng → nhắn Tubu', () => {
    expect(zeroResultBlocks({ didYouMean: 'nước giặt', nearCategories: 2, canChat: true })).toEqual(['didYouMean', 'categories', 'bestSellers', 'chat']);
  });
  it('khối không có dữ liệu thì bỏ; kệ bán chạy luôn có chỗ', () => {
    expect(zeroResultBlocks({ didYouMean: null, nearCategories: 0, canChat: false })).toEqual(['bestSellers']);
    expect(zeroResultBlocks({ didYouMean: '', nearCategories: 1, canChat: true })).toEqual(['categories', 'bestSellers', 'chat']);
  });
});

describe('nearCategories', () => {
  it('khớp đầu từ không dấu, tối đa 3, nhiều từ khớp xếp trước', () => {
    expect(nearCategories(CATS, 'giat do cho be', fold).map((c) => c.label)).toEqual(['Cho bé', 'Giặt xả']);
    expect(nearCategories(CATS, 'raucu', fold).map((c) => c.label)).toEqual(['Rau củ']);
    expect(nearCategories(CATS, 'NHÀ', fold).map((c) => c.label)).toEqual(['Chăm sóc nhà cửa']);
  });
  it('từ khoá vô nghĩa hay quá ngắn thì rỗng', () => {
    expect(nearCategories(CATS, 'qzxv', fold)).toEqual([]);
    expect(nearCategories(CATS, 'a', fold)).toEqual([]);
  });
  it('cắt ở max, bằng điểm giữ thứ tự cây', () => {
    const many = ['Rau a', 'Rau b', 'Rau c', 'Rau d'].map((label) => ({ label }));
    expect(nearCategories(many, 'rau', fold).map((c) => c.label)).toEqual(['Rau a', 'Rau b', 'Rau c']);
  });
});

describe('popularSearchesQuery', () => {
  it('gọi /search/popular không kèm đăng nhập, chỉ giữ chuỗi', async () => {
    const get = vi.fn().mockResolvedValue({ terms: ['nước giặt', 3, null, 'granola'] });
    const q = popularSearchesQuery({ get } as never);
    await expect(q.queryFn()).resolves.toEqual(['nước giặt', 'granola']);
    expect(get).toHaveBeenCalledWith('/search/popular', { anonymous: true });
  });
  it('phản hồi lạ thì mảng rỗng', async () => {
    const q = popularSearchesQuery({ get: vi.fn().mockResolvedValue({}) } as never);
    await expect(q.queryFn()).resolves.toEqual([]);
  });
});
