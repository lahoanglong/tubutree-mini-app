'use client';

import type { MouseEvent } from 'react';
import type { CampaignPlacement } from '@tubutree/app-core/api/campaign';
import { WIDE_BANNER_RATIO } from '@/components/campaign/campaign-banner';
import {
  BannerCarousel,
  WIDE_SLIDE_SIZES,
  type BannerSlide,
} from '@/components/mini/banner-carousel';

// Bề rộng slide trên máy tính: Trang chủ chiếm 8/12 cột của khung 1200px (~728px), Ưu đãi tràn khung nội dung (~1152px); xem banner-carousel.tsx.
const DESKTOP_MAX_W: Record<CampaignPlacement, string> = {
  HOME_TOP: 'max-w-[728px]',
  OFFERS_TOP: 'max-w-[1152px]',
};

/** Slide xem trước không dẫn đi đâu: bấm vào không được rời trang admin. */
const stayHere = (e: MouseEvent) => {
  if (e.target instanceof Element && e.target.closest('a')) e.preventDefault();
};

function Frame({
  testId,
  label,
  className,
  style,
  slide,
  wide,
}: {
  testId: string;
  label: string;
  className: string;
  style?: Record<string, string>;
  slide: BannerSlide;
  wide: boolean;
}) {
  return (
    <figure className="m-0 min-w-0 space-y-1">
      <figcaption className="text-xs font-medium text-stone-700">{label}</figcaption>
      <div
        data-testid={testId}
        className={`rounded-card border border-stone-200 bg-stone-50 p-4 ${className}`}
        style={style}
        onClickCapture={stayHere}
      >
        <BannerCarousel slides={[slide]} {...(wide ? { sizes: WIDE_SLIDE_SIZES } : {})} />
      </div>
    </figure>
  );
}

/**
 * Khách sẽ thấy banner thế nào, dựng bằng chính BannerCarousel của web (cùng ảnh phủ kín khung, cùng tỉ lệ `--banner-ratio`), không chép CSS.
 * Web khổ điện thoại giống Mini App nên khung 375px đại diện cho Mini App. Khung máy tính: Trang chủ giữ 5/2, Ưu đãi từ lg đổi sang 4/1.
 */
export function CampaignPreview({
  image,
  title,
  subtitle,
  placement,
}: {
  image: string;
  title: string;
  subtitle: string;
  placement: CampaignPlacement;
}) {
  const name = title.trim();
  const slide: BannerSlide = {
    id: 'preview',
    image: image.trim(),
    alt: name || 'Chưa có tên',
    href: '#',
  };
  const wide = placement === 'OFFERS_TOP';
  return (
    <section aria-label="Xem trước banner" className="space-y-2">
      <h3 className="text-xs font-medium text-stone-700">Xem trước banner</h3>
      {slide.image === '' ? (
        <p className="rounded-control bg-stone-50 px-3 py-6 text-center text-sm text-stone-500">
          Chọn ảnh để xem trước banner trên điện thoại và máy tính.
        </p>
      ) : (
        <div className="space-y-3">
          <Frame
            testId="campaign-preview-phone"
            label="Điện thoại 375px"
            className="w-[375px] max-w-full"
            slide={slide}
            wide={false}
          />
          <Frame
            testId="campaign-preview-desktop"
            label="Máy tính"
            className={`w-full ${DESKTOP_MAX_W[placement]}`}
            {...(wide ? { style: { '--banner-ratio': WIDE_BANNER_RATIO } } : {})}
            slide={slide}
            wide={wide}
          />
          <p data-testid="campaign-preview-caption" className="break-words text-xs text-stone-600">
            <span className="font-medium text-stone-800">{name || 'Chưa có tên'}</span>
            {subtitle.trim() ? ` · ${subtitle.trim()}` : ''}
          </p>
        </div>
      )}
    </section>
  );
}
