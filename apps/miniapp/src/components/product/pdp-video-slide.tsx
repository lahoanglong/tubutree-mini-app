import { Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useSizedImage } from '../../utils/image-src';
import '../../css/pdp-video.css';

/**
 * Ô video của thư viện ảnh trang chi tiết (cùng khung vuông với ảnh, xem css/pdp-video.css). Chưa bấm thì chỉ có poster và nút phát: thẻ video
 * `preload="none"` nên không tải một byte video nào; không tự phát; `playsInline` để phát ngay trong trang. Cuộn sang ô khác (`active` = false)
 * thì tạm dừng. Dùng thẻ video của trình duyệt, không thêm thư viện (gói Mini App giữ dưới ngưỡng).
 */
export function PdpVideoSlide({ src, poster, name, active }: { src: string; poster: string | null; name: string; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const { img } = useSizedImage(poster, 480);

  // Chỉ khi ô vừa rời khỏi khung (đang là ô hiện hành, rồi không còn) và khách đã bấm phát: không đụng tới trình phát lúc mới dựng.
  const wasActive = useRef(active);
  const playedRef = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active && playedRef.current) ref.current?.pause();
    wasActive.current = active;
  }, [active]);

  if (failed) {
    return (
      <div className="tubu-pdp-video" role="status" data-testid="pdp-video-failed">
        <div className="tubu-pdp-video__failed">{fillCopy('pdp.videoFailed')}</div>
      </div>
    );
  }

  const play = () => {
    const el = ref.current;
    if (!el) return;
    playedRef.current = true;
    setStarted(true);
    // play() trả Promise (trình duyệt cũ thì không): định dạng không hỗ trợ thì báo hỏng, bị chặn/ngắt giữa chừng thì chỉ giữ thanh điều khiển.
    const p = el.play() as Promise<void> | undefined;
    p?.catch((e: unknown) => {
      if ((e as { name?: string } | null)?.name === 'NotSupportedError') setFailed(true);
    });
  };

  const label = fillCopy('pdp.videoPlayAria', { name });
  return (
    <div className="tubu-pdp-video" data-testid="pdp-video">
      <video
        ref={ref}
        className="tubu-pdp-video__media"
        src={src}
        poster={img?.src}
        preload="none"
        playsInline
        controls={started}
        aria-label={label}
        onError={() => setFailed(true)}
      />
      {!started && (
        <button type="button" className="tubu-pdp-video__play" onClick={play} aria-label={label} data-testid="pdp-video-play">
          <Play size={24} fill="currentColor" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
