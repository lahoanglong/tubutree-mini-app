import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

export function ProductImageFallback(_props: { brand: string }) {
  return (
    <div
      data-testid="product-image-fallback"
      aria-hidden
      style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    >
      <LeafGlyph size={36} />
    </div>
  );
}

/** Bề rộng thẻ sản phẩm lưới 2 cột ở khổ điện thoại (CSS px); chọn bản ảnh đổi cỡ 1x/2x theo số này. */
export const CARD_IMAGE_WIDTH = 170;

/**
 * Ảnh thẻ sản phẩm: có ảnh thì vẽ bản đổi cỡ đúng bề rộng (srcset 1x/2x; ảnh tải lỗi thì rơi về ô thay thế), không có thì ô thay thế.
 * Cha phải `position: relative`; ô vuông của cha giữ chỗ nên ảnh về không làm nhảy bố cục.
 */
export function ProductImage({ src, brand, width = CARD_IMAGE_WIDTH }: { src?: string | null; brand: string; width?: number }) {
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
  if (!img || failed) return <ProductImageFallback brand={brand} />;
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
        objectFit: 'cover',
        display: 'block',
        opacity: loaded ? 1 : 0,
        transition: 'opacity 200ms var(--p-ease-out)',
        // Ảnh nền trắng (đa số ảnh Pancake) không hoà vào thân thẻ trắng.
        outline: '1px solid var(--color-media-outline)',
        outlineOffset: -1,
      }}
    />
  );
}
