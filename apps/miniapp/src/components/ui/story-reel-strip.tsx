import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Badge } from './badge';
import { ProductThumb } from './product-thumb';
import { ScrollRow } from './scroll-row';
import { SectionTitle } from './section-title';
import '../../css/story-reel.css';

export interface StoryReelStripItem {
  slug: string;
  name: string;
  thumbnail: string | null;
  seen: boolean;
}

export interface StoryReelStripProps {
  items: readonly StoryReelStripItem[];
  loading?: boolean;
  onOpen: (slug: string) => void;
  /** Gọi khi khách vừa chạm xuống hoặc focus một vòng: nơi gọi tải trước chi tiết món để Reel mở ngay. */
  onWarm?: (slug: string) => void;
}

/** Số vòng xám của khung chờ: đủ lấp một màn ở 375px, phần dư nằm ngoài khung nhìn. */
const SKELETON_COUNT = 6;

/**
 * Dải Story đầu Trang chủ: hàng vòng tròn ảnh sản phẩm, chạm một vòng mở khung Reel toàn màn. Viền chuyển sắc báo chưa xem, xám khi đã xem trong phiên.
 * Khối cao đúng `HOME_SETTLING_HEIGHTS.stories` (144) cả lúc chờ lẫn lúc có dữ liệu; số đo ở `css/story-reel.css`. Không có món (và không đang tải) thì không vẽ gì.
 */
export function StoryReelStrip({ items, loading = false, onOpen, onWarm }: StoryReelStripProps) {
  if (loading) {
    return (
      <section data-testid="story-reel-skeleton" aria-busy="true" aria-hidden="true" className="tubu-reel-strip">
        <div className="tubu-reel-head">
          <div className="tubu-skeleton tubu-reel-skel-title" />
        </div>
        <div className="scroll-x tubu-reel-row">
          <div className="tubu-reel-track">
            {Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <div key={i} className="tubu-reel-skel-item">
                <div className="tubu-skeleton tubu-reel-skel-ring" />
                <div className="tubu-skeleton tubu-reel-skel-label" />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
  if (items.length === 0) return null;
  const title = fillCopy('story.title');
  return (
    <section data-testid="story-reel-strip" className="tubu-reel-strip">
      <div className="tubu-reel-head">
        <SectionTitle block>{title}</SectionTitle>
      </div>
      <ScrollRow label={title} className="tubu-reel-row">
        <div className="tubu-reel-track">
          {items.map((item) => (
            <button
              key={item.slug}
              type="button"
              data-testid="story-reel-item"
              data-slug={item.slug}
              data-seen={item.seen ? 'true' : 'false'}
              aria-label={fillCopy(item.seen ? 'reel.openAriaSeen' : 'reel.openAria', { name: item.name })}
              className="tubu-reel-item tubu-press tubu-hit-44-square"
              onPointerDown={() => onWarm?.(item.slug)}
              onFocus={() => onWarm?.(item.slug)}
              onClick={() => onOpen(item.slug)}
            >
              <span className="tubu-reel-ring">
                <span className="tubu-reel-photo">
                  <ProductThumb src={item.thumbnail} alt="" size={64} />
                </span>
                <span className="tubu-reel-badge">
                  <Badge tone="brand" size="sm">
                    {fillCopy('reel.badge')}
                  </Badge>
                </span>
              </span>
              {/* Dấu cách giữa huy hiệu và tên: axe (WCAG 2.5.3) nối chữ hiển thị không có ký tự ngăn, nên không có nó "Storytên" không nằm trong tên truy cập "Story tên, …". */}
              {' '}
              <span className="tubu-reel-label">{item.name}</span>
            </button>
          ))}
        </div>
      </ScrollRow>
    </section>
  );
}
