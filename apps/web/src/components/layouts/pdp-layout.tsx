import type { ReactNode } from 'react';

export interface PdpLayoutProps {
  /** Ô ảnh (khung bọc đã có `min-w-0` và phần dính từ lg). */
  gallery: ReactNode;
  /** Phần tử gốc của ô thông tin (cần `min-w-0`); là con trực tiếp của lưới. */
  info: ReactNode;
  /** Thành phần, cam kết, mô tả, đánh giá, dải gợi ý. */
  below: ReactNode;
  /** Cột phụ bên phải hàng dưới (từ lg, 280px); không truyền thì hàng dưới một cột. */
  aside?: ReactNode;
}

/**
 * Khung trang sản phẩm. Dưới md xếp dọc nguyên con (ảnh tràn mép, khối mua ngay dưới ảnh); từ md ảnh và thông tin chia đôi; từ lg
 * ảnh 440px và thông tin nằm trong MỘT thẻ trắng. Cột thông tin dài hơn cột ảnh hàng trăm px (giá, mua kèm, combo, đánh giá nhanh),
 * nên từ lg ô ảnh dính dưới header để cột trái không hở trắng; cột thông tin vẫn cuộn cùng trang (không vùng cuộn riêng), nên nút
 * "Thêm vào giỏ" nằm trong luồng trang. Ô ảnh cao khoảng 640px kể cả thanh Giờ vàng: khung nhìn thấp hơn 48rem thì không dính,
 * kẻo đáy ảnh và thanh Giờ vàng bị cắt mà không cuộn tới được.
 */
export function PdpLayout({ gallery, info, below, aside }: PdpLayoutProps) {
  return (
    <div className="flex flex-col md:mt-2 md:gap-6">
      <div
        data-testid="pdp-card"
        className="grid min-w-0 grid-cols-1 md:grid-cols-2 md:gap-8 lg:grid-cols-[440px_minmax(0,1fr)] lg:rounded-card lg:bg-[var(--color-bg-surface)] lg:p-6 lg:shadow-card"
      >
        <div
          data-testid="pdp-gallery-cell"
          className="min-w-0 lg:top-[calc(var(--header-h)+1rem)] lg:self-start lg:[@media(min-height:48rem)]:sticky"
        >
          {gallery}
        </div>
        {info}
      </div>
      <div data-testid="pdp-rest" className={`grid min-w-0 grid-cols-1 ${aside ? 'lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6' : ''}`}>
        <div className="min-w-0">{below}</div>
        {aside && <aside className="min-w-0">{aside}</aside>}
      </div>
    </div>
  );
}
