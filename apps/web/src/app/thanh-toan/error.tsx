'use client';

import { SegmentError } from '@/components/segment-error';

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} message="Trang thanh toán chưa hiện được. Bạn thử lại nhé; nếu đã bấm đặt hàng, hãy xem mục Đơn hàng trước khi đặt lại." />;
}
