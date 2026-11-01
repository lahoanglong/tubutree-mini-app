'use client';

// Nguồn: apps/miniapp/src/components/ui/product-tile.tsx
import { useId, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import type { CardBadge, CardVariant, ProductCardView } from '@tubutree/app-core/commerce/product-card-view';
import { fillTileCopy } from '@tubutree/app-core/commerce/tile-copy';
import { META_SHORT_MAX_CHARS, tileBodyHeight, TILE_METRICS } from '@tubutree/app-core/commerce/tile-metrics';
import { Badge, type BadgeTone } from './badge';
import { Button } from './button';
import { PriceTag } from './price-tag';
import { ProductImage } from './product-image';
import { SR_ONLY } from './sr-only';
import { STRETCHED_LINK_CLASS } from './stretched-link';
import { Text } from './text';

/** Chiều cao tối thiểu ô tên (2 dòng body-sm) — khung chờ dựng từ cùng số đo trong app-core. */
export const TILE_NAME_MIN_HEIGHT = TILE_METRICS.name;

/** Liên kết tên thẻ: phủ cả thẻ (xem stretched-link.ts), trải hết bề ngang. Không đặt `color` (khác STRETCHED_LINK_RESET) để hover máy tính đổi màu tên bằng class. */
const LINK_RESET: CSSProperties = { padding: 0, border: 'none', background: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'block', width: '100%', margin: 0 };

export interface ProductTileProps {
  view: ProductCardView;
  variant: CardVariant;
  /** Đường dẫn trang chi tiết (`productHref`). */
  href: string;
  /** Nút phụ cuối thẻ (Mua lại, Thêm), nhãn `addLabel`. */
  onAdd?: () => void;
  addLabel?: string;
  /** Một dòng ghi chú dưới giá (phân loại, "Đã mua 3 lần"). Chuỗi rỗng giữ chỗ dòng đó để thẻ có ghi chú và thẻ không có vẫn thẳng giá trong cùng kệ. */
  note?: string;
  /** Ảnh LCP (thẻ đầu màn hình): tải ngay, ưu tiên cao. */
  priority?: boolean;
  /** Nút tim do nơi gọi dựng (cần đăng nhập + API riêng). */
  wishlist?: ReactNode;
  /** Nút nổi trên ảnh (giỏ nhanh): góc phải dưới vùng ảnh, trên lớp phủ của liên kết tên; caller chỉ đưa nút. */
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

function rankBackground(rank: number): { background: string; color: string } {
  if (rank >= 1 && rank <= 3) return { background: `var(--color-rank-${rank}-bg)`, color: 'var(--color-rank-fg)' };
  return { background: 'var(--color-rank-n-bg)', color: 'var(--color-rank-n-fg)' };
}

/**
 * Thẻ sản phẩm duy nhất của web (6 biến thể), cùng số đo với Mini App. Chỉ vẽ `ProductCardView` của app-core: giá, nhãn, meta, chữ đọc
 * đã quyết ở đó. Thân thẻ cao cố định theo `tileBodyHeight` (tên 2 dòng, giá neo đáy, meta một dòng giữ chỗ cả khi trống) nên thẻ cùng
 * hàng luôn thẳng giá.
 *
 * Một cây DOM cho cả hai khổ (HTML dựng sẵn ISR đúng ở cả hai): điện thoại là thẻ phẳng đổ bóng elevation-1, từ md thêm viền, bóng thẻ và
 * nâng nhẹ khi rê chuột.
 *
 * Cấu trúc a11y: vỏ thẻ KHÔNG tương tác. Liên kết duy nhất là tên (`.tubu-tile-link`, ::after phủ cả thẻ); tim, nút nổi và nút phụ
 * là anh em của nó. Chữ nhìn thấy của nhãn/giá/meta là `aria-hidden` và được đọc MỘT lần qua `aria-describedby` của liên kết.
 */
export function ProductTile({
  view,
  variant,
  href,
  onAdd,
  addLabel = 'Thêm',
  note,
  priority = false,
  wishlist,
  imageOverlay,
  footer,
  footerHeight,
  dimMedia,
  action,
  hidePrice,
  onOpen,
}: ProductTileProps) {
  const descId = useId();
  const isLine = variant === 'line';
  const out = view.stock === 'out';
  const hasBrand = view.brandLine !== null && (variant === 'grid' || variant === 'rail-md');
  const caption = CAPTION_NAME.has(variant);
  const hasMetaRow = variant === 'grid' || variant === 'rail-md' || variant === 'rank';
  const rankSpoken = view.rank !== null && variant === 'rank' ? fillTileCopy('rank.spoken', { n: view.rank }) : null;
  const description = [rankSpoken, view.spoken.stock, view.spoken.badges, view.spoken.meta ?? null, hidePrice ? null : view.spoken.price]
    .filter((x): x is string => Boolean(x))
    .join(', ');
  const hasNote = note !== undefined;
  const bodyMin = tileBodyHeight(variant, { brand: hasBrand, note: hasNote, footer: footerHeight });
  const nameLine = caption ? 20 : 22;

  const imageBadge = view.imageBadge;
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
      className="tubu-press-card group [box-shadow:var(--elevation-1)] md:border md:border-stone-200 md:shadow-card md:[transition-property:transform,box-shadow,border-color] md:duration-300 md:hover:-translate-y-1 md:hover:border-forest-600/40 md:hover:shadow-raised"
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
        color: 'var(--color-text-primary)',
        borderRadius: 'var(--radius-card)',
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
        <ProductImage src={view.thumbnail} brand={view.brandLine ?? ''} width={isLine ? 64 : undefined} size={isLine ? undefined : 400} priority={priority} />
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
                ...rankBackground(view.rank),
              }}
            >
              #{view.rank}
            </span>
          )}
          {imageBadge && !isLine && (
            <div data-ds-part="image-badge" style={{ position: 'absolute', left: 8, ...(variant === 'rank' ? { bottom: 8 } : { top: 8 }) }}>
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
        {/* Tên truy cập = tên sản phẩm (không kèm nhãn đầu tên, giá, meta: những thứ đó nằm ở mô tả). */}
        <Link
          href={href}
          className={`${STRETCHED_LINK_CLASS} md:transition-colors md:group-hover:text-forest-700`}
          aria-label={view.name}
          aria-describedby={descId}
          onClick={onOpen}
          style={LINK_RESET}
        >
          <Text
            variant={caption ? 'caption' : 'body-sm'}
            as="span"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: NAME_LINES(variant),
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              minHeight: isLine ? undefined : variant === 'flash' ? TILE_METRICS.nameFlash : caption ? TILE_METRICS.nameCaption : TILE_METRICS.name,
              color: 'inherit',
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
        </Link>
        <span id={descId} aria-hidden style={SR_ONLY}>
          {description}
        </span>
        {/* Anh em của liên kết tên (không phải con) để không lồng phần tử tương tác. Đứng NGAY SAU liên kết trong DOM để Tab/đọc đi tên rồi tới tim; vị trí thật do absolute theo vỏ thẻ. */}
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
            <Text data-ds-part="note" variant="label" tone="tertiary" as="div" style={{ height: TILE_METRICS.note, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...FIXED_LINE(TILE_METRICS.note) }}>
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

/** Chỗ của `action` ở thẻ `line`: anh em của liên kết tên, nổi trên lớp phủ của nó; chặn click lan lên hàng cha như AddButton. */
function LineAction({ children }: { children: ReactNode }) {
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', zIndex: 1, flex: '0 0 auto' }}>
      {children}
    </div>
  );
}

/**
 * Nút phụ của thẻ — anh em của liên kết tên (không lồng trong phần tử bấm được); `position:relative` + `zIndex:1` để nổi trên lớp phủ
 * `.tubu-tile-link::after`. `block`: `.zaui-btn` có min-width 120px nên không vừa thẻ 148px → full width và bỏ min-width.
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
