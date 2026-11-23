import { pendingReviewCounts, returnedProductsByOrder, returnWindowClosed, type PendingReviewOrder } from './review-eligibility';

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

describe('pendingReviewCounts (tubu-w21-02: nút "Đánh giá (n SP)" ở thẻ đơn)', () => {
  const ln = (id: string, productId: string | null, over: Partial<PendingReviewOrder['items'][number]> = {}) => ({ id, productId, isGift: false, open: true, ...over });
  const order = (id: string, items: PendingReviewOrder['items'], over: Partial<PendingReviewOrder> = {}): PendingReviewOrder => ({
    id, userId: 'u1', status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false, items, ...over,
  });
  const dbWith = (reviews: { orderId: string; productId: string; userId: string }[] = [], returned: { orderItemId: string }[] = []) => ({
    review: { findMany: jest.fn().mockResolvedValue(reviews) },
    returnRequestItem: { findMany: jest.fn().mockResolvedValue(returned) },
  });

  it('đếm sản phẩm (không phải dòng): hai biến thể cùng sản phẩm là một; bỏ sản phẩm đã đánh giá ở chính đơn đó', async () => {
    const db = dbWith([{ orderId: 'o1', productId: 'p2', userId: 'u1' }]);
    const counts = await pendingReviewCounts(db as never, [order('o1', [ln('i1', 'p1'), ln('i2', 'p1'), ln('i3', 'p2'), ln('i4', 'p3')])]);
    expect(counts.get('o1')).toBe(2);
  });

  it('cả trang đúng hai truy vấn theo lô, chạy một lần cho mọi đơn đủ điều kiện', async () => {
    const db = dbWith();
    await pendingReviewCounts(db as never, [order('o1', [ln('i1', 'p1')]), order('o2', [ln('i2', 'p2')]), order('o3', [ln('i3', 'p3')], { status: 'SHIPPING' })]);
    expect(db.review.findMany).toHaveBeenCalledTimes(1);
    expect(db.review.findMany).toHaveBeenCalledWith({
      where: { orderId: { in: ['o1', 'o2'] }, userId: { in: ['u1'] } },
      select: { orderId: true, productId: true, userId: true },
    });
    expect(db.returnRequestItem.findMany).toHaveBeenCalledTimes(1);
    expect(db.returnRequestItem.findMany).toHaveBeenCalledWith({
      where: { quantity: { gt: 0 }, returnRequest: { orderId: { in: ['o1', 'o2'] }, status: 'APPROVED' } },
      select: { orderItemId: true },
    });
  });

  it('bỏ quà tặng, dòng không mở được trang sản phẩm và biến thể đã xoá; còn 0 sản phẩm thì vẫn có số 0 và không truy vấn', async () => {
    const db = dbWith();
    const counts = await pendingReviewCounts(db as never, [
      order('o1', [ln('g1', 'p1', { isGift: true }), ln('i2', 'p2', { open: false }), ln('i3', null)]),
    ]);
    expect(counts.get('o1')).toBe(0);
    expect(db.review.findMany).not.toHaveBeenCalled();
    expect(db.returnRequestItem.findMany).not.toHaveBeenCalled();
  });

  it('bỏ sản phẩm đã có dòng trả được duyệt trên đơn đó, kể cả khi dòng trả là biến thể khác của cùng sản phẩm', async () => {
    const db = dbWith([], [{ orderItemId: 'i2' }]);
    const counts = await pendingReviewCounts(db as never, [order('o1', [ln('i1', 'p1'), ln('i2', 'p1', { open: false }), ln('i3', 'p3')])]);
    expect(counts.get('o1')).toBe(1);
  });

  it.each([
    ['chưa giao xong', { status: 'SHIPPING' }],
    ['đơn CTV lên hộ khách', { placedForCustomer: true }],
    ['đơn đại lý', { type: 'DEALER' }],
  ])('%s: không có trong Map, không truy vấn', async (_n, over) => {
    const db = dbWith();
    const counts = await pendingReviewCounts(db as never, [order('o1', [ln('i1', 'p1')], over)]);
    expect(counts.has('o1')).toBe(false);
    expect(db.review.findMany).not.toHaveBeenCalled();
  });

  it('đánh giá của người khác cho cùng đơn không làm giảm số (đơn phải của chính người viết)', async () => {
    const db = dbWith([{ orderId: 'o1', productId: 'p1', userId: 'u2' }]);
    expect((await pendingReviewCounts(db as never, [order('o1', [ln('i1', 'p1')])])).get('o1')).toBe(1);
  });
});
