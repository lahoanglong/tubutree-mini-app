'use client';

import { useSelectedLayoutSegment } from 'next/navigation';

/**
 * `<script type="application/ld+json">` chỉ ở trang của chính layout, không ở trang con. Layout bọc cả trang con riêng tư (/ctv/gian-hang, /kho-qua/cua-toi:
 * noindex), mà dữ liệu WebPage của landing cha không được đi kèm chúng. `useSelectedLayoutSegment()` là null khi layout đang dựng chính trang của nó.
 * Nhận chuỗi JSON đã dựng và đã thoát "<" ở server (`jsonLdScript`) để client không phải kéo thêm hàm dựng dữ liệu hay danh sách route.
 */
export function SegmentJsonLd({ json }: { json: string }) {
  const childSegment = useSelectedLayoutSegment();
  if (childSegment !== null) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
