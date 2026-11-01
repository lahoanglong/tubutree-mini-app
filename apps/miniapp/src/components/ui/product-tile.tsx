import { useId, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'zmp-ui';
import { Zap } from 'lucide-react';
import type { CardBadge, CardVariant, ProductCardView } from '@tubutree/app-core/commerce/product-card-view';
import { fillTileCopy } from '@tubutree/app-core/commerce/tile-copy';
import { META_SHORT_MAX_CHARS, tileBodyHeight, TILE_METRICS } from '@tubutree/app-core/commerce/tile-metrics';
import { haptic } from '../../utils/haptic';
import { Badge, type BadgeTone } from './badge';
import { Button } from './button';
import { PriceTag } from './price-tag';
import { ProductImage } from './product-image';
import { SR_ONLY } from './sr-only';
import { STRETCHED_LINK_CLASS, STRETCHED_LINK_RESET } from './stretched-link';
import { Text } from './text';

/** Chiều cao tối thiểu ô tên (2 dòng body-sm) — khung chờ dựng từ cùng số đo trong app-core. */
export const TILE_NAME_MIN_HEIGHT = TILE_METRICS.name;

/** Nút tên thẻ: nút phủ cả thẻ (xem stretched-link.ts) trải hết bề ngang. */
const LINK_RESET: CSSProperties = { ...STRETCHED_LINK_RESET, display: 'block', width: '100%', margin: 0 };

export interface ProductTileProps {
  view: ProductCardView;
  variant: CardVariant;
  /** Đường dẫn trang chi tiết; thẻ tự `navigate` (Mini App không có thẻ `<a>`, nút tên phủ cả thẻ). */
  href: string;
  /** Nút phụ cuối thẻ (Mua lại, Thêm), nhãn `addLabel`. */
  onAdd?: () => void;
  addLabel?: string;
  /** Một dòng ghi chú dưới giá (phân loại, "Đã mua 3 lần"). Chuỗi rỗng giữ chỗ dòng đó để thẻ có ghi chú và thẻ không có vẫn thẳng giá trong cùng kệ. */
  note?: string;
  /** Câu đọc thay dòng `note` cho trình đọc màn hình (ghi chú nhìn thấy có ký hiệu như "/" đọc thành "gạch chéo"). Có thì dòng `note` bị ẩn khỏi cây trợ năng và câu này nằm cuối mô tả của thẻ; rỗng thì không đọc gì thêm. */
  noteSpoken?: string;
  /** Web: ảnh LCP tải ngay. Mini App tải lười như cũ nên bỏ qua. */
  priority?: boolean;
  /** Nút tim do nơi gọi dựng (cần đăng nhập + API riêng, không thuộc bộ thành phần giao diện). */
  wishlist?: ReactNode;
  /** Nút nổi trên ảnh (giỏ nhanh): góc phải dưới vùng ảnh, trên lớp phủ của nút tên; caller chỉ đưa nút. */
  imageOverlay?: ReactNode;
  /** Phần cuối thẻ (thanh % đã bán, nút nhắc). Nơi gọi truyền `footerHeight` để thân thẻ giữ chiều cao cố định. */
  footer?: ReactNode;
  footerHeight?: number;
  /** Làm mờ riêng vùng ảnh (món hết suất của Giờ vàng): chữ không mờ để giữ tương phản, mờ cả thẻ thì giá và chữ phụ tụt dưới 4,5:1. */
  dimMedia?: boolean;
  /** Nút tuỳ ý cuối hàng của thẻ `line` (Mua ngay, Nhắc tôi), thay chỗ nút `onAdd`; thẻ dọc không có chỗ nên bỏ qua. Nơi gọi tự đặt tên truy cập. */
  action?: ReactNode;
  /** Chưa biết giá (đang tải): không in giá, vẫn giữ chỗ. */
  hidePrice?: boolean;
  /** Hạng hụt vì kệ trên đã chiếm món (Bán chạy nhất đã chống trùng): ruy-băng ghi "Bán chạy" thay "#n" và dùng màu hạng thường, để khách không tưởng kệ lỗi. */
  rankPlain?: boolean;
  /** State điều hướng (listSource, variationId của suất Giờ vàng, phân loại ghim). */
  navState?: Record<string, unknown>;
  onOpen?: () => void;
}

const BADGE_TONE: Record<CardBadge['kind'], BadgeTone> = {
  flash: 'flash',
  discount: 'promo',
  combo: 'brand',
  featured: 'verified',
  loved: 'verified',
  new: 'brand',
  freeship: 'success',
};

const STACKED: ReadonlySet<CardVariant> = new Set(['rail-sm', 'rail-md', 'flash', 'rank']);
const CAPTION_NAME: ReadonlySet<CardVariant> = new Set(['rail-sm', 'flash']);
/** Thẻ Giờ vàng cắt tên một dòng (Q11); các thẻ còn lại hai dòng. */
const NAME_LINES = (variant: CardVariant): 1 | 2 => (variant === 'flash' ? 1 : 2);
const FIXED_LINE = (px: number): CSSProperties => ({ lineHeight: `${px}px` });

function rankBackground(rank: number, plain: boolean): { background: string; color: string } {
  if (!plain && rank >= 1 && rank <= 3) return { background: `var(--color-rank-${rank}-bg)`, color: 'var(--color-rank-fg)' };
  return { background: 'var(--color-rank-n-bg)', color: 'var(--color-rank-n-fg)' };
}

/**
 * Thẻ sản phẩm duy nhất (6 biến thể). Chỉ vẽ `ProductCardView` của app-core: giá, nhãn, meta, chữ đọc đã quyết ở đó, thẻ không tự tính gì.
 * Thân thẻ cao cố định theo `tileBodyHeight` (tên 2 dòng, giá neo đáy, meta một dòng giữ chỗ cả khi trống) nên thẻ cùng hàng luôn
 * thẳng giá; khung chờ dựng từ cùng số đo.
 *
 * Cấu trúc a11y: vỏ thẻ KHÔNG tương tác. Phần tử bấm được là nút tên (`.tubu-tile-link`, ::after phủ cả thẻ); tim, nút nổi và nút phụ
 * là anh em của nó (axe nested-interactive). Chữ nhìn thấy của nhãn/giá/meta là `aria-hidden` và được đọc MỘT lần qua `aria-describedby`
 * của nút tên (tình trạng, nhãn, sao và đã bán, giá): "ngôi sao đen", "một phẩy hai ca cộng" và gạch ngang giá gốc không còn ra tai người nghe.
 */
export function ProductTile({
  view,
  variant,
  href,
  onAdd,
  addLabel = 'Thêm',
  note,
  noteSpoken,
  wishlist,
  imageOverlay,
  footer,
  footerHeight,
  dimMedia,
  action,
  hidePrice,
  rankPlain = false,
  navState,
  onOpen,
}: ProductTileProps) {
  const navigate = useNavigate();
  const descId = useId();
  const isLine = variant === 'line';
  const out = view.stock === 'out';
  // Khe thương hiệu giữ chỗ cả khi chữ bị ẩn vì tên đã chứa thương hiệu (`brandLine` null, `brandSlot` true): tên thẻ cùng hàng không lệch nhau 16px.
  const hasBrand = (view.brandSlot ?? view.brandLine !== null) && (variant === 'grid' || variant === 'rail-md');
  const caption = CAPTION_NAME.has(variant);
  const hasMetaRow = variant === 'grid' || variant === 'rail-md' || variant === 'rank';
  const rankSpoken = view.rank !== null && variant === 'rank' ? (rankPlain ? fillTileCopy('rank.plain') : fillTileCopy('rank.spoken', { n: view.rank })) : null;
  const description = [rankSpoken, view.spoken.stock, view.spoken.badges, view.spoken.meta ?? null, hidePrice ? null : view.spoken.price, noteSpoken ?? null]
    .filter((x): x is string => Boolean(x))
    .join(', ');
  const hasNote = note !== undefined;
  const bodyMin = tileBodyHeight(variant, { brand: hasBrand, note: hasNote, footer: footerHeight });
  const nameLine = caption ? 20 : 22;

  const open = () => {
    haptic('light');
    onOpen?.();
    navigate(href, navState ? { state: navState } : undefined);
  };

  const imageBadge = view.imageBadge;
  const badgeNode = imageBadge && (
    <Badge tone={BADGE_TONE[imageBadge.kind]} size="sm" icon={imageBadge.kind === 'flash' ? Zap : undefined}>
      {imageBadge.short ? (
        <>
          <span className="tubu-badge-long">{imageBadge.text}</span>
          <span className="tubu-badge-short">{imageBadge.short}</span>
        </>
      ) : (
        imageBadge.text
      )}
    </Badge>
  );
  const label = view.label;

  const price = hidePrice ? null : (
    <PriceTag
      value={view.price}
      compareAt={view.compareAt}
      size={isLine ? 'sm' : 'tile'}
      tone={view.isDeal ? 'deal' : 'default'}
      layout={STACKED.has(variant) ? 'stack' : 'inline'}
    />
  );

  return (
    <div
      data-ds="product-tile"
      data-ds-variant={variant}
      className="tubu-press-card"
      style={{
        position: 'relative',
        isolation: 'isolate',
        display: 'flex',
        flexDirection: isLine ? 'row' : 'column',
        alignItems: isLine ? 'center' : undefined,
        gap: isLine ? 12 : 0,
        height: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        padding: isLine ? TILE_METRICS.inset : 0,
        minHeight: isLine ? tileBodyHeight('line') : undefined,
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--elevation-1)',
        overflow: 'hidden',
      }}
    >
      <div
        data-ds-part="media"
        className="tubu-tile-media"
        style={{
          position: 'relative',
          background: 'var(--color-bg-media)',
          flex: '0 0 auto',
          overflow: 'hidden',
          ...(isLine ? { width: 64, height: 64, borderRadius: 'var(--radius-media)' } : { aspectRatio: '1 / 1' }),
          ...(dimMedia ? { opacity: 0.55 } : null),
        }}
      >
        <ProductImage src={view.thumbnail} brand={view.brandLine ?? ''} width={isLine ? 64 : undefined} />
        <div aria-hidden>
          {!isLine && variant === 'rank' && view.rank !== null && (
            <span
              data-ds-part="rank"
              style={{
                position: 'absolute',
                top: 0,
                left: 8,
                maxWidth: 'calc(100% - 16px)',
                minWidth: 24,
                height: 28,
                padding: '0 6px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                borderRadius: '0 0 var(--radius-tag) var(--radius-tag)',
                fontSize: 'var(--type-label-size)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                ...rankBackground(view.rank, rankPlain),
              }}
            >
              {rankPlain ? fillTileCopy('rank.plain') : `#${view.rank}`}
            </span>
          )}
          {imageBadge && !isLine && (
            <div
              data-ds-part="image-badge"
              style={{ position: 'absolute', left: 8, ...(variant === 'rank' ? { bottom: 8 } : { top: 8 }) }}
            >
              {badgeNode}
            </div>
          )}
          {out && (
            <div style={{ position: 'absolute', inset: 0, background: 'var(--color-bg-scrim-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Text
                variant="caption"
                as="span"
                style={{
                  background: 'var(--color-bg-surface)',
                  padding: isLine ? '2px 6px' : '4px 12px',
                  borderRadius: 'var(--radius-pill)',
                  boxShadow: 'var(--elevation-1)',
                  fontWeight: 700,
                  ...(isLine ? { fontSize: 'var(--type-label-size)', lineHeight: 'normal' } : null),
                }}
              >
                {view.stockText}
              </Text>
            </div>
          )}
        </div>
      </div>

      <div
        data-ds-part="body"
        style={{
          flex: isLine ? 1 : '1 1 auto',
          minWidth: 0,
          minHeight: isLine ? undefined : bodyMin,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          padding: isLine ? 0 : 'var(--tile-inset)',
        }}
      >
        {hasBrand && (
          <Text
            data-ds-part="brand"
            variant="label"
            tone="tertiary"
            as="div"
            aria-hidden
            style={{ height: TILE_METRICS.brand, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...FIXED_LINE(TILE_METRICS.brand) }}
          >
            {view.brandLine}
          </Text>
        )}
        {/* aria-label trùng chữ hiển thị (không vi phạm "label in name"); giữ để mọi nơi tìm thẻ theo tên truy cập (e2e, trình đọc màn hình) không phụ thuộc cấu trúc con. */}
        <button type="button" className={STRETCHED_LINK_CLASS} aria-label={view.name} aria-describedby={descId} onClick={open} style={LINK_RESET}>
          <Text
            variant={caption ? 'caption' : 'body-sm'}
            as="span"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: NAME_LINES(variant),
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              minHeight: isLine ? undefined : variant === 'flash' ? TILE_METRICS.nameFlash : caption ? TILE_METRICS.nameCaption : TILE_METRICS.name,
              ...FIXED_LINE(nameLine),
              ...(isLine ? { fontWeight: 600 } : null),
            }}
          >
            {label && (
              <Badge tone={BADGE_TONE[label.kind]} size="sm" style={{ display: 'inline-block', verticalAlign: 'top', margin: '1px 4px 0 0', lineHeight: '16px' }}>
                {label.text}
              </Badge>
            )}
            {view.name}
          </Text>
        </button>
        <span id={descId} aria-hidden style={SR_ONLY}>
          {description}
        </span>
        {/* Anh em của nút tên (không phải con) để không lồng phần tử tương tác. Đứng NGAY SAU nút tên trong DOM để Tab/đọc đi tên rồi tới tim; vị trí thật do absolute theo vỏ thẻ. */}
        {wishlist && !isLine && <div style={{ position: 'absolute', top: 0, right: 0, zIndex: 1 }}>{wishlist}</div>}
        {imageOverlay && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              ...(isLine ? { width: 64, height: 64 } : { right: 0, aspectRatio: '1 / 1' }),
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            <div style={{ position: 'absolute', right: 2, bottom: 2, pointerEvents: 'auto' }}>{imageOverlay}</div>
          </div>
        )}
        <div style={{ marginTop: 'auto', paddingTop: TILE_METRICS.gap, minWidth: 0 }}>
          {/* Thẻ xếp chồng luôn giữ chỗ dòng giá gạch ngay dưới giá: thẻ giá thường đứng cạnh thẻ đang giảm vẫn có số giá cùng độ cao. */}
          <div data-ds-part="price" aria-hidden style={{ display: 'flex', minHeight: hidePrice || STACKED.has(variant) ? TILE_METRICS.price + (STACKED.has(variant) ? TILE_METRICS.compare : 0) : undefined }}>
            {price}
          </div>
          {hasNote && (
            <Text data-ds-part="note" aria-hidden={noteSpoken !== undefined || undefined} variant="label" tone="tertiary" as="div" style={{ height: TILE_METRICS.note, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...FIXED_LINE(TILE_METRICS.note) }}>
              {note}
            </Text>
          )}
          {hasMetaRow && (
            <Text
              data-ds-part="meta"
              className="tubu-tile-meta"
              variant="label"
              tone="tertiary"
              as="div"
              aria-hidden
              style={{ height: TILE_METRICS.meta, marginTop: TILE_METRICS.metaGap, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...FIXED_LINE(TILE_METRICS.meta) }}
            >
              {view.metaCompact && view.metaCompact !== view.meta ? (
                <span className="tubu-meta-text" data-compact={view.metaCompact} data-long={(view.meta?.length ?? 0) > META_SHORT_MAX_CHARS ? '' : undefined}>
                  <span className="tubu-meta-full">{view.meta}</span>
                </span>
              ) : (
                view.meta
              )}
            </Text>
          )}
        </div>
        {footer}
        {onAdd && !isLine && <AddButton block label={addLabel} onAdd={onAdd} />}
      </div>
      {isLine && action ? <LineAction>{action}</LineAction> : onAdd && isLine && <AddButton label={addLabel} onAdd={onAdd} />}
    </div>
  );
}

/** Chỗ của `action` ở thẻ `line`: anh em của nút tên, nổi trên lớp phủ của nó; chặn click lan lên hàng cha như AddButton. */
function LineAction({ children }: { children: ReactNode }) {
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', zIndex: 1, flex: '0 0 auto' }}>
      {children}
    </div>
  );
}

/**
 * Nút phụ của thẻ — anh em của nút tên (không lồng trong phần tử bấm được); `position:relative` + `zIndex:1` để nổi trên lớp phủ
 * `.tubu-tile-link::after`. `stopPropagation` giữ vì thẻ có thể nằm trong hàng cha tự bắt click (Button.onPress không nhận native event).
 * `block`: `.zaui-btn` có min-width 120px nên không vừa thẻ 148px → full width và bỏ min-width.
 */
function AddButton({ block = false, label, onAdd }: { block?: boolean; label: string; onAdd: () => void }) {
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', zIndex: 1, marginTop: block ? 8 : undefined, flex: block ? undefined : '0 0 auto' }}>
      <Button size="md" variant="secondary" fullWidth={block} style={block ? { minWidth: 0 } : undefined} onPress={() => onAdd()}>
        {label}
      </Button>
    </div>
  );
}
