import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CouponRemovedNotice } from './coupon-removed-notice';

// W28: lời báo mã bị gỡ vì giỏ rơi dưới đơn tối thiểu, dùng chung ở giỏ và thanh toán của Mini App (khớp khối trong CouponBox web).

const NOTICE = { code: 'MIN300', text: 'Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 90.000đ để dùng lại.' };

describe('CouponRemovedNotice', () => {
  it('đọc lời báo trong vùng trạng thái', () => {
    render(<CouponRemovedNotice notice={NOTICE} onDismiss={() => {}} />);
    const box = screen.getByTestId('coupon-removed-notice');
    expect(box).toHaveAttribute('role', 'status');
    expect(box).toHaveTextContent(NOTICE.text);
  });

  it('nút Đóng có nhãn nói rõ mã nào (vùng chạm 44 do DS Button, khoá ở hit-target-guard.spec)', () => {
    render(<CouponRemovedNotice notice={NOTICE} onDismiss={() => {}} />);
    const close = screen.getByRole('button', { name: 'Đóng lời báo mã MIN300 đã gỡ' });
    expect(close).toHaveTextContent('Đóng');
  });

  it('bấm Đóng gọi onDismiss đúng một lần', () => {
    const onDismiss = vi.fn();
    render(<CouponRemovedNotice notice={NOTICE} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /Đóng lời báo/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('không có lời báo: không dựng gì', () => {
    const { container } = render(<CouponRemovedNotice notice={null} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
