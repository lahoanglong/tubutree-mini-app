import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('../utils/recently-viewed', () => ({ recordRecentlyViewed: mocks.record }));

import { useRecordRecentlyViewed } from './use-record-recently-viewed';

const P = (slug: string, over: object = {}) => ({ slug, name: `SP ${slug}`, thumbnail: null, images: ['https://img/1.jpg'], basePrice: 100000, salePrice: 80000, ...over });

describe('useRecordRecentlyViewed (spec 5b.4: ghi ở PDP mở thành công)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('chưa có sản phẩm (đang tải / lỗi) → không ghi', () => {
    renderHook(() => useRecordRecentlyViewed(undefined));
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('có sản phẩm → ghi 1 lần: giá đang bán, ảnh = thumbnail ?? ảnh đầu', () => {
    renderHook(() => useRecordRecentlyViewed(P('a')));
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith({ slug: 'a', name: 'SP a', thumbnail: 'https://img/1.jpg', price: 80000 });
  });

  it('refetch trả object mới cùng slug → không ghi lại; chuyển sang SP khác → ghi SP mới', () => {
    const { rerender } = renderHook(({ p }) => useRecordRecentlyViewed(p), { initialProps: { p: P('a') } });
    rerender({ p: P('a', { salePrice: null }) });
    expect(mocks.record).toHaveBeenCalledTimes(1);
    rerender({ p: P('b', { salePrice: null, thumbnail: 'https://img/b.jpg' }) });
    expect(mocks.record).toHaveBeenLastCalledWith({ slug: 'b', name: 'SP b', thumbnail: 'https://img/b.jpg', price: 100000 });
  });

  it('SP không có ảnh nào (thumbnail null, images rỗng/thiếu) → vẫn ghi với thumbnail null, không bao giờ undefined', () => {
    renderHook(() => useRecordRecentlyViewed(P('a', { images: [] })));
    expect(mocks.record).toHaveBeenLastCalledWith({ slug: 'a', name: 'SP a', thumbnail: null, price: 80000 });
    renderHook(() => useRecordRecentlyViewed(P('c', { thumbnail: undefined, images: undefined })));
    expect(mocks.record).toHaveBeenLastCalledWith({ slug: 'c', name: 'SP c', thumbnail: null, price: 80000 });
  });

  it('A → B → quay lại A (cùng component) → ghi lại A để A lên đầu danh sách', () => {
    const { rerender } = renderHook(({ p }) => useRecordRecentlyViewed(p), { initialProps: { p: P('a') } });
    rerender({ p: P('b') });
    rerender({ p: P('a') });
    expect(mocks.record.mock.calls.map((c) => c[0].slug)).toEqual(['a', 'b', 'a']);
  });

  it('đang tải lại giữa hai lần (product undefined rồi cùng slug) → không ghi trùng', () => {
    const { rerender } = renderHook(({ p }) => useRecordRecentlyViewed(p), { initialProps: { p: P('a') as ReturnType<typeof P> | undefined } });
    rerender({ p: undefined });
    rerender({ p: P('a') });
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });
});
