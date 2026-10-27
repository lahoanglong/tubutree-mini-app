'use client';

// Nguồn: apps/miniapp/src/components/ui/product-image.tsx
import { useEffect, useState } from 'react';
import { brandAccent } from './brand-accent';

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

/** Ảnh thẻ sản phẩm: có ảnh thì vẽ ảnh (tải lỗi thì rơi về ô thay thế), không có thì ô thay thế. Cha phải `position: relative`. */
export function ProductImage({
  src,
  brand,
  alt = '',
  className,
  priority = false,
  size,
}: {
  src?: string | null;
  brand: string;
  alt?: string;
  className?: string;
  priority?: boolean;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <ProductImageFallback brand={brand} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
      style={className ? undefined : { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}
