'use client';

import { useEffect, useState } from 'react';
import { getAdminImage } from '@/lib/admin-client';
import { apiMediaUrl } from '@/lib/client-api';
import { resolveDealerImage } from './dealer-app-image';
import { safeEvidenceImage } from './evidence-images';

const ADMIN_IMAGE_REF_RE =
  /^\/admin\/(?:reviews\/[A-Za-z0-9_-]{1,64}\/images\/\d{1,2}|merchant-products\/[A-Za-z0-9_-]{1,64}\/images\/(?:product|draft)\/(?:thumb|\d{1,2}))\?v=[0-9a-f]{8,64}$/;
const PUBLIC_IMAGE_REF_RE = /^\/public-image\/(?:product|brand|academy|campaign)\/[A-Za-z0-9_-]{1,64}\/(?:thumb|logo|cover|\d{1,2})\?v=[0-9a-f]{8,64}$/;

export function isAdminImageRef(raw: unknown): raw is string {
  return typeof raw === 'string' && ADMIN_IMAGE_REF_RE.test(raw);
}

/** Địa chỉ dùng thẳng cho thẻ img: https, ảnh raster base64 của API cũ, đường dẫn công khai của API. Đường dẫn của admin cần đăng nhập nên đi qua AdminImage. */
export function directImageSrc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (PUBLIC_IMAGE_REF_RE.test(raw)) return apiMediaUrl(raw);
  return safeEvidenceImage(raw)?.src ?? null;
}

/**
 * Ảnh trong danh sách của admin. Danh sách không nhúng base64 nữa mà trả đường dẫn; đường dẫn `/admin/...` cần token nên thẻ img
 * không tự tải được: lấy byte qua apiFetch kèm token rồi dựng blob URL. Ảnh không tải được thì không hiện gì.
 */
export function AdminImage({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const admin = isAdminImageRef(src);
  const [state, setState] = useState<{ src: string } | 'loading' | 'error'>('loading');

  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    let created: string | null = null;
    setState('loading');
    getAdminImage(src)
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
  }, [admin, src]);

  const shown = admin ? (typeof state === 'object' ? state.src : null) : directImageSrc(src);
  if (!shown) {
    return admin && state === 'loading' ? <span className={`${className ?? ''} inline-block animate-pulse bg-stone-100`} aria-hidden /> : null;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={shown} alt={alt} referrerPolicy="no-referrer" className={className} />;
}
