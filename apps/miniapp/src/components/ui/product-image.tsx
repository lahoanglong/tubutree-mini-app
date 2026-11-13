import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { avatarInitial } from '@tubutree/app-core/initials-avatar';
import { useSizedImage } from '../../utils/image-src';

/**
 * Ô thay thế khi sản phẩm chưa có ảnh (hay gặp với hàng Pancake chưa có thumbnail) hoặc ảnh tải lỗi: lá xanh trên nền trung tính
 * `--color-bg-media` của khung ảnh (PL-15c: nhuộm theo màu nhãn làm lưới thành mảng be, xám, xám xanh xen kẽ; tên nhãn đã có ở dòng nhãn hiệu).
 */
export function LeafGlyph({ size }: { size: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden style={{ position: 'relative', flex: '0 0 auto' }}>
      <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="var(--forest-300)" />
      <path d="M12 38c5-9 11-15 20-20" stroke="var(--forest-600)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Chữ trên ô thay thế: tên nhãn viết hoa, tối đa `FALLBACK_NAME_MAX` ký tự (cắt thêm "…" khi dài hơn); rỗng thì "Tubu Tree". */
const FALLBACK_NAME_MAX = 14;
const FALLBACK_LEAF = 'M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z';

function fallbackLabel(brand: string): { initial: string; name: string } {
  const clean = brand.replace(/\s+/g, ' ').trim() || 'Tubu Tree';
  const name = clean.length > FALLBACK_NAME_MAX ? `${clean.slice(0, FALLBACK_NAME_MAX - 1).trimEnd()}…` : clean;
  return { initial: avatarInitial(clean), name: name.toLocaleUpperCase('vi') };
}

/**
 * Ô thay thế khi sản phẩm chưa có ảnh (hay gặp với hàng Pancake chưa có thumbnail) hoặc ảnh tải lỗi: thẻ thực vật gọn trên nền trung tính `--color-bg-media`
 * của khung ảnh, gồm hai chiếc lá mờ làm hoạ tiết, chữ cái đầu của nhãn trong vòng tròn và tên nhãn viết hoa bên dưới. Chỉ dùng một tông xanh lá (không nhuộm màu nhãn: PL-15c,
 * lưới sẽ thành mảng màu xen kẽ). Vẽ bằng SVG theo khung nên co giãn cùng ô ảnh; `compact` (ảnh nhỏ, ví dụ ô 56px) bỏ dòng tên vì chữ sẽ nhỏ thành vệt.
 */
export function ProductImageFallback({ brand, compact = false }: { brand: string; compact?: boolean }) {
  const { initial, name } = fallbackLabel(brand);
  return (
    <div
      data-testid="product-image-fallback"
      aria-hidden
      style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    >
      <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="none" style={{ display: 'block' }}>
        <g transform="translate(46 -14) rotate(24) scale(1.6)" fill="var(--forest-200)" opacity="0.55">
          <path d={FALLBACK_LEAF} />
        </g>
        <g transform="translate(60 108) rotate(204) scale(1.3)" fill="var(--forest-200)" opacity="0.4">
          <path d={FALLBACK_LEAF} />
        </g>
        <circle cx="50" cy={compact ? 50 : 44} r="19" fill="var(--color-bg-surface)" stroke="var(--forest-300)" strokeWidth="1.4" />
        <text
          x="50"
          y={compact ? 50 : 44}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="22"
          fontWeight="700"
          fill="var(--forest-700)"
          style={{ fontFamily: 'inherit' }}
        >
          {initial}
        </text>
        {!compact && (
          <text x="50" y="80" textAnchor="middle" fontSize={name.length > 10 ? 6.5 : 7.5} fontWeight="600" letterSpacing="0.6" fill="var(--forest-700)" style={{ fontFamily: 'inherit' }}>
            {name}
          </text>
        )}
      </svg>
    </div>
  );
}

/** Ảnh nhỏ hơn hoặc bằng cỡ này (CSS px, ví dụ ô 56px) vẽ ô thay thế gọn: bỏ dòng tên nhãn. */
const COMPACT_FALLBACK_MAX = 96;

/** Bề rộng thẻ sản phẩm lưới 2 cột ở khổ điện thoại (CSS px); chọn bản ảnh đổi cỡ 1x/2x/3x theo số này. */
export const CARD_IMAGE_WIDTH = 170;

/**
 * Ảnh thẻ sản phẩm: có ảnh thì vẽ bản đổi cỡ đúng bề rộng (srcset 1x/2x/3x; ảnh tải lỗi thì rơi về ô thay thế), không có thì ô thay thế.
 * Cha phải `position: relative`; ô vuông của cha giữ chỗ nên ảnh về không làm nhảy bố cục.
 */
/** `fit="contain"` cho ảnh tách nền (hình dọc, vùng trong suốt): hiện trọn, không viền 1px; mặc định `cover` cho ô vuông thẻ. */
export function ProductImage({ src, brand, width = CARD_IMAGE_WIDTH, fit = 'cover' }: { src?: string | null; brand: string; width?: number; fit?: 'cover' | 'contain' }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => setFailed(false), [src]);
  const { img, fallBack } = useSizedImage(src, width);
  // Ảnh lấy từ bộ nhớ đệm đã `complete` trước khi React gắn sự kiện: hiện ngay, không chớp từ trong suốt (PL-15a).
  useLayoutEffect(() => {
    const el = ref.current;
    setLoaded(Boolean(el && el.complete && el.naturalWidth > 0));
  }, [img?.src]);
  if (!img || failed) return <ProductImageFallback brand={brand} compact={width <= COMPACT_FALLBACK_MAX} />;
  return (
    <img
      ref={ref}
      src={img.src}
      srcSet={img.srcSet}
      alt=""
      width={width}
      height={width}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => fallBack() || setFailed(true)}
      style={{
        width: '100%',
        height: '100%',
        objectFit: fit,
        display: 'block',
        opacity: loaded ? 1 : 0,
        transition: 'opacity 200ms var(--p-ease-out)',
        // Ảnh nền trắng (đa số ảnh Pancake) không hoà vào thân thẻ trắng.
        outline: fit === 'contain' ? undefined : '1px solid var(--color-media-outline)',
        outlineOffset: fit === 'contain' ? undefined : -1,
      }}
    />
  );
}
