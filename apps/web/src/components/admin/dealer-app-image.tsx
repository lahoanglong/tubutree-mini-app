'use client';

import { useEffect, useState } from 'react';
import { getDealerAppImage, type DealerAppImageField } from '@/lib/admin-client';
import { safeEvidenceImage } from './evidence-images';

const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Chuyển phản hồi của route ảnh hồ sơ thành địa chỉ an toàn cho thẻ img: byte raster → blob URL, JSON `{ url }` → chỉ nhận
 * https qua safeEvidenceImage. Loại khác (SVG, HTML) bị từ chối.
 */
export async function resolveDealerImage(res: { type: string; blob: Blob }): Promise<{ src: string; revoke: boolean } | null> {
  if (RASTER_TYPES.has(res.type)) return { src: URL.createObjectURL(res.blob), revoke: true };
  if (res.type === 'application/json') {
    try {
      const url = (JSON.parse(await res.blob.text()) as { url?: unknown }).url;
      const safe = typeof url === 'string' && url.startsWith('https://') ? safeEvidenceImage(url) : null;
      return safe && safe.href ? { src: safe.src, revoke: false } : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Ảnh CCCD/mặt tiền của hồ sơ đại lý: chỉ tải khi quản trị bấm xem, vì danh sách không còn mang nội dung ảnh. */
export function DealerAppImage({ appId, field, label }: { appId: string; field: DealerAppImageField; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ src: string } | 'loading' | 'error' | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let created: string | null = null;
    setState('loading');
    getDealerAppImage(appId, field)
      .then(resolveDealerImage)
      .then((r) => {
        if (cancelled) {
          if (r?.revoke) URL.revokeObjectURL(r.src);
          return;
        }
        if (r?.revoke) created = r.src;
        setState(r ? { src: r.src } : 'error');
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [open, appId, field]);

  return (
    <div className="min-w-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-forest-700 hover:underline">
        {open ? `Ẩn ${label}` : `Xem ${label}`}
      </button>
      {open && state === 'loading' && <p className="text-xs text-stone-500">Đang tải ảnh...</p>}
      {open && state === 'error' && <p className="text-xs text-danger-fg">Không tải được ảnh (ảnh không hợp lệ hoặc đã bị xoá).</p>}
      {open && state && typeof state === 'object' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={state.src} alt={label} referrerPolicy="no-referrer" className="mt-1 h-32 rounded-control border border-stone-200" />
      )}
    </div>
  );
}
