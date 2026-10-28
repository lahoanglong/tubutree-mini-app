'use client';

import { SegmentError } from '@/components/segment-error';

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} message="Sản phẩm này chưa hiện được. Bạn thử lại nhé." />;
}
