import type { ReactNode } from 'react';

export interface PdpLayoutProps {
  /** Phần tử gốc của ô ảnh (cần `min-w-0` để lưới không bị ảnh nới ra). */
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
 * ảnh 440px và thông tin nằm trong MỘT thẻ trắng, mọi thứ cuộn cùng một trang: không cột dính, không vùng cuộn riêng, nên nút
 * "Thêm vào giỏ" không bị đẩy xuống dưới khung 1280×800 bởi chiều cao một cột tự cuộn.
 */
export function PdpLayout({ gallery, info, below, aside }: PdpLayoutProps) {
  return (
    <div className="flex flex-col md:mt-2 md:gap-6">
      <div
        data-testid="pdp-card"
        className="grid min-w-0 grid-cols-1 md:grid-cols-2 md:gap-8 lg:grid-cols-[440px_minmax(0,1fr)] lg:rounded-card lg:bg-[var(--color-bg-surface)] lg:p-6 lg:shadow-card"
      >
        {gallery}
        {info}
      </div>
      <div data-testid="pdp-rest" className={`grid min-w-0 grid-cols-1 ${aside ? 'lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6' : ''}`}>
        <div className="min-w-0">{below}</div>
        {aside && <aside className="min-w-0">{aside}</aside>}
      </div>
    </div>
  );
}
