import { useEffect, useState } from 'react';
import { imageVariants, type ImageVariants } from '@tubutree/app-core/image-src';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');

/** Ảnh gốc làm ảnh dự phòng khi ảnh đổi cỡ không có (host lạ, base64) hoặc chưa tải được. */
export function sizedImage(src: string, cssWidth: number): ImageVariants {
  return imageVariants(src, cssWidth, API_BASE) ?? { src };
}

/**
 * Ảnh đổi cỡ kèm đường lùi: nếu bản đổi cỡ lỗi (API đổi cỡ tạm hỏng, nguồn không tải được) thì thử ảnh gốc một lần rồi mới báo lỗi
 * để nơi gọi rơi về hình lá. `fallBack()` trả true khi đã chuyển sang ảnh gốc (nơi gọi không báo lỗi lần này).
 */
export function useSizedImage(src: string | null | undefined, cssWidth: number): { img: ImageVariants | null; fallBack: () => boolean } {
  const [original, setOriginal] = useState(false);
  useEffect(() => setOriginal(false), [src]);
  if (!src) return { img: null, fallBack: () => false };
  const sized = sizedImage(src, cssWidth);
  const resized = sized.src !== src;
  return {
    img: original ? { src } : sized,
    fallBack: () => {
      if (!resized || original) return false;
      setOriginal(true);
      return true;
    },
  };
}
