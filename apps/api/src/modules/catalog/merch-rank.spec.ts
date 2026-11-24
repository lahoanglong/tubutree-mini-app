import { arrangeByMerchTier, HAS_IMAGE_WHERE, merchTier, MERCH_RANK_SELECT, stockTier, withImageFlags } from './merch-rank';

describe('merchTier', () => {
  it('có ảnh và còn hàng = 0; chưa ảnh còn hàng = 1; mọi phân loại hết (hoặc không còn phân loại) = 2', () => {
    expect(merchTier({ hasImage: true, variations: [{ stock: 0 }, { stock: 2 }] })).toBe(0);
    expect(merchTier({ hasImage: false, variations: [{ stock: 1 }] })).toBe(1);
    expect(merchTier({ variations: [{ stock: 1 }] })).toBe(1);
    expect(merchTier({ hasImage: true, variations: [{ stock: 0 }] })).toBe(2);
    expect(merchTier({ hasImage: true, variations: [] })).toBe(2);
    expect(merchTier({ hasImage: false, variations: [{ stock: 0 }] })).toBe(2);
  });

  it('stockTier chỉ xét còn hàng: ảnh không đổi tầng, hết sạch hay không còn phân loại = 1', () => {
    expect(stockTier({ hasImage: false, variations: [{ stock: 0 }, { stock: 1 }] })).toBe(0);
    expect(stockTier({ hasImage: true, variations: [{ stock: 1 }] })).toBe(0);
    expect(stockTier({ hasImage: true, variations: [{ stock: 0 }] })).toBe(1);
    expect(stockTier({ variations: [] })).toBe(1);
    expect(stockTier({})).toBe(1);
  });

  it('câu chọn của tầng trưng bày không đọc cột ảnh nặng (luật D2)', () => {
    expect(MERCH_RANK_SELECT).not.toHaveProperty('images');
    expect(MERCH_RANK_SELECT).not.toHaveProperty('thumbnail');
  });
});

describe('withImageFlags', () => {
  it('một truy vấn chỉ chọn id của hàng có ảnh (ảnh đại diện khác rỗng hoặc mảng ảnh không rỗng), không chọn cột ảnh', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'b' }]);
    const rows = await withImageFlags({ product: { findMany } }, [{ id: 'a' }, { id: 'b' }]);
    expect(rows).toEqual([
      { id: 'a', hasImage: false },
      { id: 'b', hasImage: true },
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({ where: { AND: [{ id: { in: ['a', 'b'] } }, HAS_IMAGE_WHERE] }, select: { id: true } });
    expect(HAS_IMAGE_WHERE).toEqual({ OR: [{ AND: [{ thumbnail: { not: null } }, { thumbnail: { not: '' } }] }, { images: { isEmpty: false } }] });
  });

  it('không có hàng thì không hỏi DB', async () => {
    const findMany = jest.fn();
    expect(await withImageFlags({ product: { findMany } }, [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('arrangeByMerchTier', () => {
  const row = (id: string, tier: 0 | 1 | 2) => ({ id, hasImage: tier !== 1, variations: [{ stock: tier === 2 ? 0 : 1 }] });

  it('giữ thứ tự vào trong từng tầng, không mất dòng nào', () => {
    const rows = [row('a', 2), row('b', 1), row('c', 0), row('d', 1), row('e', 0)];
    expect(arrangeByMerchTier(rows).map((r) => r.id)).toEqual(['c', 'e', 'b', 'd', 'a']);
  });

  it('chạy cách xếp riêng trong từng tầng', () => {
    const rows = [row('a', 0), row('b', 0), row('c', 1), row('d', 1)];
    expect(arrangeByMerchTier(rows, (t) => [...t].reverse()).map((r) => r.id)).toEqual(['b', 'a', 'd', 'c']);
  });
});
