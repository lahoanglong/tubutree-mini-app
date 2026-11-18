import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { Star } from 'lucide-react';
import { greenCornerCards } from '@tubutree/app-core/commerce/green-corner';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';
import { usePublicConfig } from '../../hooks/use-public-config';
import { apiMediaUrl } from '../../services/api';
import { fetchGreenCorner } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { ScrollRow } from '../ui/scroll-row';
import { SectionHeader } from '../ui/section-header';
import { Text } from '../ui/text';

export interface GreenCornerStripProps {
  /** Vẽ thay dải khi Góc Sống Xanh tắt, đang tải, API lỗi hay chưa đủ đánh giá ảnh đã duyệt (Trang chủ: thẻ Cộng đồng). */
  fallback?: ReactNode;
}

/**
 * "Khách hàng sống xanh cùng Tubu Tree": đánh giá có ảnh thật đã được Tubu duyệt, mỗi sản phẩm một thẻ, chạm thẻ mở trang sản phẩm. Đứng ở chỗ thẻ Cộng
 * đồng trong lưới Gợi ý (cùng ngày, không thêm khối). Số đo ở `.tubu-green-*` (css/tokens.css, giống mini.css của web).
 */
export function GreenCornerStrip({ fallback = null }: GreenCornerStripProps) {
  const navigate = useNavigate();
  const on = usePublicConfig().reviewGreenCorner?.enabled === true;
  // Gọi trễ như `usePublicConfig`: spec mock một phần `shop-api` không có hàm này vẫn vẽ được Trang chủ khi cờ tắt.
  const q = useQuery({ queryKey: ['green-corner'], queryFn: () => fetchGreenCorner(), enabled: on, staleTime: 5 * 60_000, retry: false });
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
          <button
            key={c.id}
            type="button"
            className="tubu-green-card tubu-press"
            aria-label={c.label}
            onClick={() => {
              haptic('light');
              navigate(`/product/${encodeURIComponent(c.productSlug)}`);
            }}
          >
            <img src={apiMediaUrl(c.image)} alt="" loading="lazy" onError={hideBrokenImage} />
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
          </button>
        ))}
      </ScrollRow>
    </section>
  );
}
