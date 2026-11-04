import { useEffect, useState } from 'react';
import { IMAGE_WIDTHS, imageVariants, pickImageWidth, type ImageVariants } from '@tubutree/app-core/image-src';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');

/** Ảnh dựng cho `<img>`: `srcSet` theo bề rộng (w) cần đi kèm `sizes`, thiếu `sizes` trình duyệt coi ảnh rộng 100vw và tải bản to nhất. */
export interface SizedImage extends ImageVariants {
  sizes?: string;
}

/**
 * Ảnh gốc làm ảnh dự phòng khi ảnh đổi cỡ không có (host lạ, base64) hoặc chưa tải được.
 * `cssWidth` là bề rộng hiển thị lớn nhất (CSS px); `sizes` là bề rộng thật theo khung nhìn (mặc định đúng `cssWidth`).
 * srcset dùng mô tả w (không dùng 1x/2x): ô lưới ~165px ở máy 2x chỉ cần bản 320 chứ không phải 640.
 */
export function sizedImage(src: string, cssWidth: number, sizes?: string): SizedImage {
  const one = imageVariants(src, cssWidth, API_BASE);
  if (!one) return { src };
  // Tới màn 3x thì bản kế tiếp là thừa; bản 960 chỉ dành cho ảnh to (PDP).
  const widths = IMAGE_WIDTHS.filter((w) => w <= pickImageWidth(cssWidth * 3));
  if (widths.length < 2) return { src: one.src };
  const srcSet = widths.map((w) => `${imageVariants(src, w, API_BASE)!.src} ${w}w`).join(', ');
  return { src: one.src, srcSet, sizes: sizes ?? `${Math.round(cssWidth)}px` };
}

/**
 * Ảnh đổi cỡ kèm đường lùi: nếu bản đổi cỡ lỗi (API đổi cỡ tạm hỏng, nguồn không tải được) thì thử ảnh gốc một lần rồi mới báo lỗi
 * để nơi gọi rơi về hình lá. `fallBack()` trả true khi đã chuyển sang ảnh gốc (nơi gọi không báo lỗi lần này).
 */
export function useSizedImage(src: string | null | undefined, cssWidth: number, sizes?: string): { img: SizedImage | null; fallBack: () => boolean } {
  const [original, setOriginal] = useState(false);
  useEffect(() => setOriginal(false), [src]);
  if (!src) return { img: null, fallBack: () => false };
  const sized = sizedImage(src, cssWidth, sizes);
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
