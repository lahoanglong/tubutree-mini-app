'use client';

import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useSizedImage } from '@/lib/image-src';
import { PDP_MAIN_IMAGE_SIZES } from '@/lib/image-sizes';
import { trackPdpAction } from '@/components/analytics/funnel';

/**
 * Ô video của thư viện ảnh PDP. Cùng khung vuông với ảnh nên không làm trang nhảy. Chưa bấm thì chỉ có poster và nút phát: thẻ video
 * `preload="none"` nên không tải một byte video nào; không tự phát; `playsInline` để iOS phát ngay trong trang chứ không bật toàn màn hình.
 * Cuộn sang ô khác (`active` = false) thì tạm dừng.
 */
export default function PdpVideoSlide({ src, poster, name, active, pdpSlug }: { src: string; poster: string | null; name: string; active: boolean; pdpSlug?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const { img } = useSizedImage(poster, 600, PDP_MAIN_IMAGE_SIZES);

  // Chỉ khi ô vừa rời khỏi khung (đang là ô hiện hành, rồi không còn) và khách đã bấm phát: không đụng tới trình phát lúc mới dựng.
  const wasActive = useRef(active);
  const playedRef = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active && playedRef.current) ref.current?.pause();
    wasActive.current = active;
  }, [active]);

  if (failed) {
    return (
      <div role="status" className="flex h-full w-full items-center justify-center bg-[var(--color-bg-subtle)] px-6 text-center text-sm text-[var(--color-text-secondary)]">
        {fillCopy('pdp.videoFailed')}
      </div>
    );
  }

  const play = () => {
    const el = ref.current;
    if (!el) return;
    if (pdpSlug) trackPdpAction('video_play', pdpSlug);
    playedRef.current = true;
    setStarted(true);
    // play() trả Promise (trình duyệt cũ thì không): trình duyệt không hiểu định dạng thì báo hỏng, chặn autoplay hay bị ngắt giữa chừng thì chỉ giữ thanh điều khiển.
    const p = el.play() as Promise<void> | undefined;
    p?.catch((e: unknown) => {
      if ((e as { name?: string } | null)?.name === 'NotSupportedError') setFailed(true);
    });
  };

  return (
    <div className="relative h-full w-full bg-[var(--color-bg-subtle)]">
      <video
        ref={ref}
        src={src}
        poster={img?.src}
        preload="none"
        playsInline
        controls={started}
        aria-label={fillCopy('pdp.videoPlayAria', { name })}
        className="h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
      {!started && (
        <button
          type="button"
          onClick={play}
          aria-label={fillCopy('pdp.videoPlayAria', { name })}
          className="absolute left-1/2 top-1/2 flex h-14 w-14 min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-stone-0/90 text-stone-900 shadow-card transition hover:bg-stone-0"
        >
          <Play className="h-6 w-6" fill="currentColor" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
