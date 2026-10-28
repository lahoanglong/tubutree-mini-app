'use client';

// Nguồn: apps/miniapp/src/components/ui/product-thumb.tsx
import { useEffect, useState } from 'react';
import { LeafGlyph } from './product-image';
import { useSizedImage } from '@/lib/image-src';

export interface ProductThumbProps {
  src?: string | null;
  alt: string;
  size?: number;
}

/**
 * Ảnh sản phẩm dạng ô vuông cho dòng hàng (giỏ, thanh toán). Sản phẩm chưa có ảnh (hay gặp với hàng Pancake chưa có
 * thumbnail) hoặc ảnh tải lỗi hiện lá xanh thay cho icon ảnh vỡ kèm chữ alt.
 */
export function ProductThumb({ src, alt, size = 64 }: ProductThumbProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const { img, fallBack } = useSizedImage(src, size);
  const showImage = Boolean(img) && !failed;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-media)',
        overflow: 'hidden',
        background: 'var(--color-bg-subtle)',
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img?.src}
          srcSet={img?.srcSet}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => fallBack() || setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <LeafGlyph size={Math.round(size * 0.5)} />
      )}
    </div>
  );
}
