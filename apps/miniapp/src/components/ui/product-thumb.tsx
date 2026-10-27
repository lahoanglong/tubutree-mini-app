import { useEffect, useState } from 'react';
import { LeafGlyph } from './product-image';

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
  const showImage = Boolean(src) && !failed;
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
        <img
          src={src ?? undefined}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <LeafGlyph size={Math.round(size * 0.5)} />
      )}
    </div>
  );
}
