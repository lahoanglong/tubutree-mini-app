'use client';

import { SegmentError } from '@/components/segment-error';

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} message="Thông tin tài khoản chưa hiện được. Bạn thử lại nhé, dữ liệu của bạn vẫn an toàn." />;
}
