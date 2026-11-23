import { useEffect, useState } from 'react';
import { posterTarget, type PosterInput } from '@tubutree/app-core/commerce/share-poster-link';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { QrCode } from './qr-code';
import { Skeleton } from './ui/skeleton';
import { Text } from './ui/text';
import type * as Renderer from '../utils/share-poster-png';

export interface SharePosterProps {
  /** Gian hàng/trang chủ/thương hiệu hoặc một sản phẩm; QR trỏ trang web công khai kèm mã giới thiệu. */
  input: PosterInput;
}

type Rendered = { url: string; png: string };

/** Bộ vẽ nạp một lần cho mọi ảnh; nạp lỗi (mất mạng giữa chừng) thì lần mở sau thử lại. */
let renderer: Promise<typeof Renderer> | null = null;
function loadRenderer() {
  renderer ??= import('../utils/share-poster-png').catch((err: unknown) => {
    renderer = null;
    throw err;
  });
  return renderer;
}

/**
 * Ảnh chia sẻ có QR (1080×1350) trong bảng chia sẻ và bảng nội dung bán hàng. Bộ vẽ nạp lười lúc bảng mở. Lưu ảnh bằng nhấn giữ ảnh trong
 * Zalo (không gọi `saveImage` của Zalo: hàm đó chỉ nhận ảnh http, từ chối data URL). Webview không có canvas hoặc không nạp được bộ vẽ thì
 * hiện QR thường của cùng link.
 */
export function SharePoster({ input }: SharePosterProps) {
  const [res, setRes] = useState<Rendered | null>(null);
  const key = JSON.stringify(input);
  useEffect(() => {
    let live = true;
    const parsed = JSON.parse(key) as PosterInput;
    setRes(null);
    loadRenderer()
      .then((m) => m.renderPoster(parsed))
      .then((r) => live && setRes(r))
      .catch(() => live && setRes({ url: posterTarget(parsed).url, png: '' }));
    return () => {
      live = false;
    };
  }, [key]);

  const box = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-stack-xs)', margin: 0 } as const;
  if (!res) {
    return (
      <div role="status" aria-label={fillCopy('poster.making')} style={box}>
        <Skeleton width={200} height={250} radius="var(--radius-media)" />
      </div>
    );
  }
  if (!res.png) {
    return (
      <div style={box}>
        <QrCode value={res.url} />
      </div>
    );
  }
  return (
    <figure style={box}>
      <img
        src={res.png}
        alt={fillCopy('poster.alt', { title: input.kind === 'store' ? input.title : input.name })}
        width={200}
        height={250}
        style={{ borderRadius: 'var(--radius-media)' }}
      />
      <Text variant="caption" tone="secondary" as="figcaption">
        {fillCopy('poster.hold')}
      </Text>
    </figure>
  );
}
