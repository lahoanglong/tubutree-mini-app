'use client';

import { useState } from 'react';
import { Package } from 'lucide-react';
import { previewableImageUrl } from './image-url-field';

/** Ảnh 40px đầu hàng sản phẩm. alt rỗng vì tên sản phẩm nằm ngay cạnh; ảnh hỏng hoặc thiếu thì hiện khung trống. */
export function ProductThumb({ product }: { product: { thumbnail?: string | null; images: string[] } }) {
  const src = previewableImageUrl(product.thumbnail ?? '') ?? previewableImageUrl(product.images[0] ?? '');
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = src !== null && failedUrl !== src;

  return (
    <div
      data-thumb
      className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-control border border-stone-200 bg-stone-50 text-stone-400"
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(src)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Package className="h-5 w-5" aria-hidden="true" />
      )}
    </div>
  );
}
