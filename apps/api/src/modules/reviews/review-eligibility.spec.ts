import { returnedProductsByOrder, returnWindowClosed } from './review-eligibility';

describe('returnWindowClosed', () => {
  const NOW = new Date('2026-10-20T00:00:00.000Z');
  const daysBefore = (n: number, extraMs = 0) => new Date(NOW.getTime() - n * 864e5 - extraMs);

  it('đúng hạn (đủ N ngày) vẫn còn gửi được yêu cầu trả như OrderReturnsService.request; quá một mili giây là hết hạn', () => {
    expect(returnWindowClosed({ deliveredAt: daysBefore(7), updatedAt: NOW }, 7, NOW)).toBe(false);
    expect(returnWindowClosed({ deliveredAt: daysBefore(7, 1), updatedAt: NOW }, 7, NOW)).toBe(true);
  });

  it('đơn cũ thiếu deliveredAt dùng updatedAt', () => {
    expect(returnWindowClosed({ deliveredAt: null, updatedAt: daysBefore(30) }, 7, NOW)).toBe(true);
    expect(returnWindowClosed({ deliveredAt: null, updatedAt: daysBefore(1) }, 7, NOW)).toBe(false);
  });

  it('cửa sổ 0 ngày: đơn giao trước đó đã hết hạn', () => {
    expect(returnWindowClosed({ deliveredAt: daysBefore(0, 1), updatedAt: NOW }, 0, NOW)).toBe(true);
  });
});

describe('returnedProductsByOrder', () => {
  const dbWith = (lines: { orderItemId: string }[], items: { orderId: string; variationId: string }[], variations: { id: string; productId: string }[]) => ({
    returnRequestItem: { findMany: jest.fn().mockResolvedValue(lines) },
    orderItem: { findMany: jest.fn().mockResolvedValue(items) },
    variation: { findMany: jest.fn().mockResolvedValue(variations) },
  });

  it('không có đơn nào: không truy vấn', async () => {
    const db = dbWith([], [], []);
    expect((await returnedProductsByOrder(db as never, [])).size).toBe(0);
    expect(db.returnRequestItem.findMany).not.toHaveBeenCalled();
  });

  it('chỉ tính dòng trả của yêu cầu đã duyệt (APPROVED) và số lượng > 0; chưa có lần trả nào thì dừng sau một truy vấn', async () => {
    const db = dbWith([], [], []);
    expect((await returnedProductsByOrder(db as never, ['o1'])).size).toBe(0);
    expect(db.returnRequestItem.findMany).toHaveBeenCalledWith({
      where: { quantity: { gt: 0 }, returnRequest: { orderId: { in: ['o1'] }, status: 'APPROVED' } },
      select: { orderItemId: true },
    });
    expect(db.orderItem.findMany).not.toHaveBeenCalled();
  });

  it('gom sản phẩm bị trả theo từng đơn; hai biến thể cùng sản phẩm chỉ một phần tử', async () => {
    const db = dbWith(
      [{ orderItemId: 'i1' }, { orderItemId: 'i2' }, { orderItemId: 'i3' }],
      [
        { orderId: 'o1', variationId: 'v1' },
        { orderId: 'o1', variationId: 'v1b' },
        { orderId: 'o2', variationId: 'v2' },
      ],
      [
        { id: 'v1', productId: 'p1' },
        { id: 'v1b', productId: 'p1' },
        { id: 'v2', productId: 'p2' },
      ],
    );
    const out = await returnedProductsByOrder(db as never, ['o1', 'o2', 'o3']);
    expect([...out.keys()].sort()).toEqual(['o1', 'o2']);
    expect([...out.get('o1')!]).toEqual(['p1']);
    expect([...out.get('o2')!]).toEqual(['p2']);
  });
});
