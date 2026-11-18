'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { fetchGreenCorner } from '@tubutree/app-core/api/reviews';
import { greenCornerCards } from '@tubutree/app-core/commerce/green-corner';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';
import { apiMediaUrl } from '@/lib/client-api';
import { coreHttp } from '@/lib/core-http';
import { productHref } from '@/lib/product-href';
import { usePublicConfig } from '@/lib/use-public-config';
import { ScrollRow, SectionHeader, Text } from '@/components/mini';

export interface GreenCornerStripProps {
  /** Vẽ thay dải khi Góc Sống Xanh tắt, đang tải, API lỗi hay chưa đủ đánh giá ảnh đã duyệt (Trang chủ: thẻ Cộng đồng). */
  fallback?: ReactNode;
}

const mediaSrc = (src: string) => (src.startsWith('/') && !src.startsWith('//') ? apiMediaUrl(src) : src);

/**
 * "Khách hàng sống xanh cùng Tubu Tree" (bản web của `green-corner-strip.tsx` ở Mini App): đánh giá có ảnh thật đã được Tubu duyệt, mỗi sản phẩm một thẻ,
 * thẻ là liên kết tới trang sản phẩm. Đứng ở chỗ thẻ Cộng đồng trong lưới Gợi ý; từ 360 tới 1440px cùng số đo thẻ (`.tubu-green-*` trong mini.css), màn rộng
 * chỉ thấy nhiều thẻ hơn trong hàng cuộn.
 */
export function GreenCornerStrip({ fallback = null }: GreenCornerStripProps) {
  const on = usePublicConfig().reviewGreenCorner?.enabled === true;
  const q = useQuery({ queryKey: ['green-corner'], queryFn: () => fetchGreenCorner(coreHttp), enabled: on, staleTime: 5 * 60_000, retry: false });
  // Đang tải cũng vẽ thẻ Cộng đồng: lúc mới bật thường chưa đủ 3 đánh giá ảnh đã duyệt, khung chờ cao hơn thẻ Cộng đồng sẽ co lại mỗi lần
  // mở Trang chủ. Dải chỉ thay chỗ khi đã có đủ thẻ (truy vấn giữ 5 phút nên một phiên chỉ đổi một lần).
  const cards = on ? greenCornerCards(q.data) : [];
  if (cards.length === 0) return <>{fallback}</>;
  const title = fillCopy('home.greenCorner.title');
  return (
    <section aria-label={title} data-testid="green-corner">
      <SectionHeader title={title} />
      <ScrollRow label={title} className="tubu-green-row">
        {cards.map((c) => (
          <Link key={c.id} href={productHref(c.productSlug)} className="tubu-green-card tubu-press" aria-label={c.label}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaSrc(c.image)} alt="" loading="lazy" onError={hideBrokenImage} />
            <span className="tubu-green-body" aria-hidden="true">
              <span style={{ display: 'inline-flex', color: 'var(--color-rating)' }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} size={11} strokeWidth={1.75} style={{ fill: i <= c.rating ? 'currentColor' : 'none' }} />
                ))}
              </span>
              <Text variant="caption" tone="brand" className="tubu-green-line" style={{ fontWeight: 600 }}>
                {c.tagLine ?? c.author}
              </Text>
              <Text variant="caption" tone="secondary" className="tubu-green-clamp">
                {c.comment ?? ''}
              </Text>
              <Text variant="caption" tone="tertiary" className="tubu-green-line">
                {c.productName}
              </Text>
            </span>
          </Link>
        ))}
      </ScrollRow>
    </section>
  );
}
