import type { ReactNode } from 'react';
import { ui } from '@/lib/guest-ui';

/** Thẻ như `Card` raised của Mini App ở điện thoại (trắng, không viền, chỉ đổ bóng); từ md giữ viền của giao diện máy tính. */
export const miniSurface = 'rounded-card shadow-card md:border md:border-stone-200';
export const miniCard = `${miniSurface} bg-stone-0`;

/** Thẻ viền như `Card` outline của Mini App ở điện thoại (viền mảnh, không bóng); từ md giữ bóng của giao diện máy tính. */
export const miniOutline = 'rounded-card border border-stone-200 bg-stone-0 shadow-card max-md:shadow-none';

/** Nút phụ như nút secondary ZaUI của Mini App ở điện thoại (nền xanh nhạt, không viền, chữ brand); từ md giữ nút viền. */
export const miniBtnSecondary = `${ui.btnSecondary} max-md:border-transparent max-md:bg-forest-50 max-md:text-forest-700 max-md:hover:bg-forest-100`;

/** Tiêu đề trang cỡ title-lg của Mini App ở điện thoại. */
export const miniTitle =
  'max-md:text-[length:var(--type-title-lg-size)] max-md:leading-[var(--type-title-lg-lh)] max-md:tracking-[-0.01em]';

/**
 * Thanh tiêu đề trắng tràn ngang của Mini App ở điện thoại; chừa 48px bên trái cho nút lùi nổi do layout gắn.
 * Cha phải có `data-page-bleed` (bỏ đệm 48px của body) và `px-4`; từ md không có hiệu lực.
 */
export function MiniTitleBar({ children }: { children: ReactNode }) {
  return <div className="max-md:-mx-4 max-md:bg-stone-0 max-md:py-3 max-md:pl-16 max-md:pr-4">{children}</div>;
}
