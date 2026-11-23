import { describe, expect, it } from 'vitest';
import { orderReviewCta } from './order-review-cta';

describe('orderReviewCta (tubu-w21-02)', () => {
  it('đơn đã nhận còn sản phẩm chờ đánh giá: nhãn gọn; tên truy cập bắt đầu bằng đúng nhãn hiện trên nút rồi thêm mã đơn', () => {
    expect(orderReviewCta({ code: 'TUBU12345', status: 'DELIVERED', pendingReviewCount: 2 })).toEqual({
      label: 'Đánh giá (2 SP)',
      ariaLabel: 'Đánh giá (2 SP) của đơn TUBU12345',
    });
  });

  it.each([
    ['API cũ chưa trả trường', { status: 'DELIVERED' }],
    ['đã đánh giá hết', { status: 'DELIVERED', pendingReviewCount: 0 }],
    ['đơn chưa giao (trạng thái đổi sau khi tải danh sách)', { status: 'SHIPPING', pendingReviewCount: 1 }],
    ['đơn đã hoàn', { status: 'RETURNED', pendingReviewCount: 1 }],
    ['số lạ', { status: 'DELIVERED', pendingReviewCount: 1.5 }],
  ])('%s: không có nút', (_n, o) => {
    expect(orderReviewCta({ code: 'TUBU1', ...o })).toBeNull();
  });

  it('nhãn không quá 18 ký tự tới 99 sản phẩm', () => {
    expect(orderReviewCta({ code: 'TUBU1', status: 'DELIVERED', pendingReviewCount: 99 })!.label.length).toBeLessThanOrEqual(18);
  });
});
