'use client';

// Nguồn: apps/miniapp/src/components/ui/story-reel-strip.tsx (cùng props, cùng test-id).
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Badge } from './badge';
import { ProductThumb } from './product-thumb';
import { ScrollRow } from './scroll-row';
import { SectionTitle } from './section-title';

export interface StoryReelStripItem {
  slug: string;
  name: string;
  thumbnail: string | null;
  /** Đã mở Reel của món này trong phiên: viền vòng đổi từ chuyển sắc sang xám. */
  seen: boolean;
}

export interface StoryReelStripProps {
  items: readonly StoryReelStripItem[];
  /** Chưa có dữ liệu: vẽ khung chờ cùng số đo với vòng thật. */
  loading?: boolean;
  onOpen: (slug: string) => void;
  /** Gọi khi khách vừa chạm hoặc lấy nét vòng: nơi dùng tải trước chi tiết để Reel mở ngay. */
  onWarm?: (slug: string) => void;
}

const SKELETON_COUNT = 6;

/**
 * Dải vòng tròn Story đầu Trang chủ: mỗi vòng mở khung Reel toàn màn của một sản phẩm. Số đo (cao 144 ở 375px, vòng 72 gồm viền 4, nhãn hai dòng 32)
 * nằm ở `.tubu-reel-*` của mini.css và khung chờ dùng đúng các lớp đó, nên đổi từ chờ sang thật không làm trang nhảy. Rỗng và không chờ thì không vẽ gì.
 */
export function StoryReelStrip({ items, loading = false, onOpen, onWarm }: StoryReelStripProps) {
  if (!loading && items.length === 0) return null;
  const title = fillCopy('story.title');
  return (
    <section data-testid="story-reel-strip" aria-busy={loading || undefined} className="tubu-reel-strip">
      <div className="tubu-reel-head">
        <SectionTitle block>{title}</SectionTitle>
      </div>
      <ScrollRow label={title} className="tubu-bleed-rail tubu-reel-row">
        {loading
          ? Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <span key={i} data-testid="story-reel-skeleton" aria-hidden="true" className="tubu-reel-item">
                <span className="tubu-skeleton tubu-reel-skel-ring" />
                <span className="tubu-reel-skel-label">
                  <span className="tubu-skeleton" />
                </span>
              </span>
            ))
          : items.map((it) => (
              <button
                key={it.slug}
                type="button"
                data-testid="story-reel-item"
                data-slug={it.slug}
                data-seen={it.seen ? 'true' : 'false'}
                aria-label={fillCopy(it.seen ? 'reel.openAriaSeen' : 'reel.openAria', { name: it.name })}
                className="tubu-reel-item tubu-press"
                onClick={() => onOpen(it.slug)}
                onPointerDown={() => onWarm?.(it.slug)}
                onFocus={() => onWarm?.(it.slug)}
              >
                <span className="tubu-reel-ring" data-seen={it.seen ? 'true' : 'false'}>
                  <span className="tubu-reel-photo">
                    <ProductThumb src={it.thumbnail} alt="" size={60} />
                  </span>
                  <Badge tone="brand" size="sm" className="tubu-reel-badge">
                    {fillCopy('reel.badge')}
                  </Badge>
                </span>
                <span className="tubu-reel-label">{it.name}</span>
              </button>
            ))}
      </ScrollRow>
    </section>
  );
}
