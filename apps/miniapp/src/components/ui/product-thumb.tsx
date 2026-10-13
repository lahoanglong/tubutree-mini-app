import { useEffect, useState } from 'react';

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
        <svg width={Math.round(size * 0.44)} height={Math.round(size * 0.44)} viewBox="0 0 48 48" fill="none" aria-hidden>
          <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="var(--forest-200)" />
        </svg>
      )}
    </div>
  );
}
