'use client';

// Nguồn: apps/miniapp/src/components/share-poster.tsx
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { posterTarget, type PosterInput } from '@tubutree/app-core/commerce/share-poster-link';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { QrCode } from '@/components/ui/qr-code';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/mini/text';
import { ui } from '@/lib/guest-ui';
import type * as Renderer from '@/lib/share-poster-png';
import type { RenderedPoster } from '@/lib/share-poster-png';

type Note = { text: string; error: boolean } | null;

/** Khoá thao tác của bảng chứa ảnh (`useActionLock`): nút ảnh chung khoá với nút chia sẻ và chép, một việc chạy một lúc. */
export interface PosterActionLock {
  busy: boolean;
  active: string | null;
  run: (kind: string, task: () => Promise<unknown>) => Promise<void>;
}

export interface SharePosterProps {
  /** Gian hàng/trang chủ/thương hiệu hoặc một sản phẩm; QR trỏ trang web công khai kèm mã giới thiệu. */
  input: PosterInput;
  lock: PosterActionLock;
  /** Dòng báo của bảng (vùng `status`/`alert` sẵn có). */
  onNote: (note: Note) => void;
}

/** Tải ảnh bằng một thẻ `<a download>` tạm: dùng khi hộp chia sẻ tệp báo lỗi (không phải khách tự đóng). */
function downloadPng(href: string, name: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

/** Bộ vẽ nạp một lần cho mọi ảnh; nạp lỗi (mất mạng giữa chừng) thì lần mở sau thử lại. */
let renderer: Promise<typeof Renderer> | null = null;
function loadRenderer() {
  renderer ??= import('@/lib/share-poster-png').catch((err: unknown) => {
    renderer = null;
    throw err;
  });
  return renderer;
}

/**
 * Ảnh chia sẻ có QR (1080×1350) trong bảng chia sẻ gian hàng và bảng nội dung bán hàng. Bộ vẽ và thư viện QR nạp lười lúc bảng mở.
 * Nút dưới ảnh là `<a download>` thật (máy tính: tải ảnh, chuột phải "Lưu"); máy nào chia sẻ được tệp (`navigator.canShare({ files })`) thì nút
 * thành "Gửi ảnh" và mở hộp chia sẻ của máy (có cả mục Lưu ảnh). Nút báo khoá bằng `aria-disabled` như các nút khác của bảng.
 * Không báo "đã lưu": trình duyệt trong Zalo/Facebook hay bỏ qua lệnh tải, nên dưới ảnh luôn có lời nhấn giữ ảnh để lưu.
 * Trình duyệt không có canvas hoặc không nạp được bộ vẽ thì hiện QR thường của cùng link.
 */
export function SharePoster({ input, lock, onNote }: SharePosterProps) {
  const [res, setRes] = useState<RenderedPoster | null>(null);
  const key = JSON.stringify(input);
  useEffect(() => {
    let live = true;
    const parsed = JSON.parse(key) as PosterInput;
    setRes(null);
    loadRenderer()
      .then((m) => m.renderPoster(parsed))
      .then((r) => live && setRes(r))
      .catch(() => live && setRes({ url: posterTarget(parsed).url, png: '', fileName: '', file: null }));
    return () => {
      live = false;
    };
  }, [key]);

  if (!res) {
    return (
      <div role="status" aria-label={fillCopy('poster.making')} className="flex justify-center">
        <Skeleton width={200} height={250} rounded="rounded-media" />
      </div>
    );
  }
  if (!res.png) {
    return (
      <div className="flex justify-center">
        <QrCode value={res.url} />
      </div>
    );
  }

  const title = input.kind === 'store' ? input.title : input.name;
  const file = res.file;
  const canShare = file !== null && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  return (
    <figure className="m-0 flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL vẽ tại máy, next/image không tối ưu được */}
      <img src={res.png} alt={fillCopy('poster.alt', { title })} width={200} height={250} className="rounded-media" />
      <Text variant="caption" tone="secondary" as="figcaption">
        {fillCopy('poster.hold')}
      </Text>
      <a
        href={res.png}
        download={res.fileName}
        className={`${ui.btnSecondary} gap-2`}
        aria-disabled={lock.busy || undefined}
        aria-busy={lock.active === 'poster' || undefined}
        onClick={(e) => {
          if (lock.busy) {
            e.preventDefault();
            return;
          }
          if (!canShare || !file) {
            onNote(null);
            return;
          }
          e.preventDefault();
          void lock.run('poster', async () => {
            try {
              await navigator.share({ files: [file], title });
              onNote(null);
              return;
            } catch (err) {
              // Khách đóng hộp chia sẻ: không phải lỗi, không tải thay.
              if (err instanceof DOMException && err.name === 'AbortError') return;
            }
            downloadPng(res.png, res.fileName);
            onNote(null);
          });
        }}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {fillCopy(canShare ? 'poster.send' : 'poster.save')}
      </a>
    </figure>
  );
}
