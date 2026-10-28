'use client';

// Nguồn: apps/miniapp/src/components/ui/product-image.tsx
import { useEffect, useRef, useState } from 'react';
import { brandAccent } from './brand-accent';
import { useSizedImage } from '@/lib/image-src';

/**
 * Ô thay thế khi sản phẩm chưa có ảnh (hay gặp với hàng Pancake chưa có thumbnail) hoặc ảnh tải lỗi: nền ngả màu nhãn,
 * lá xanh và tên nhãn ngắn. Thẻ không còn là ô xám trơn.
 */
export function LeafGlyph({ size }: { size: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden style={{ position: 'relative', flex: '0 0 auto' }}>
      <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="var(--forest-300)" />
      <path d="M12 38c5-9 11-15 20-20" stroke="var(--forest-600)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ProductImageFallback({ brand }: { brand: string }) {
  const accent = brandAccent(brand);
  return (
    <div
      data-testid="product-image-fallback"
      aria-hidden
      style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden' }}
    >
      <div style={{ position: 'absolute', inset: 0, background: accent, opacity: 0.12 }} />
      <LeafGlyph size={36} />
      {brand && (
        <span
          style={{
            position: 'relative',
            maxWidth: '80%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 'var(--type-caption-size)',
            fontWeight: 700,
            color: 'var(--forest-700)',
            fontFamily: 'var(--font-ui)',
          }}
        >
          {brand}
        </span>
      )}
    </div>
  );
}

/** Bề rộng thẻ sản phẩm lưới 2 cột ở khổ điện thoại (CSS px); chọn bản ảnh đổi cỡ 1x/2x theo số này. */
export const CARD_IMAGE_WIDTH = 170;

/** Ảnh thẻ sản phẩm: có ảnh thì vẽ bản đổi cỡ đúng bề rộng (srcset 1x/2x) (tải lỗi thì rơi về ô thay thế), không có thì ô thay thế. Cha phải `position: relative`. */
export function ProductImage({
  src,
  brand,
  alt = '',
  className,
  priority = false,
  size,
  width = CARD_IMAGE_WIDTH,
}: {
  src?: string | null;
  brand: string;
  alt?: string;
  className?: string;
  priority?: boolean;
  size?: number;
  /** Bề rộng hiển thị (CSS px) để chọn bản ảnh đổi cỡ 1x/2x. */
  width?: number;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => setFailed(false), [src]);
  const { img, fallBack } = useSizedImage(src, width);
  // Ảnh HTML dựng sẵn có thể đã lỗi trước khi React hydrate; sự kiện lỗi đó không phát lại nên `onError` không chạy.
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0 && !fallBack()) setFailed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  if (!img || failed) return <ProductImageFallback brand={brand} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={img.src}
      srcSet={img.srcSet}
      alt={alt}
      width={size ?? width}
      height={size ?? width}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      onError={() => fallBack() || setFailed(true)}
      className={className}
      style={className ? undefined : { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}
