'use client';

import { hideBrokenImage } from '@tubutree/app-core/image-fallback';
import { useEffect, useRef, useState } from 'react';
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
 * không tự tải được: lấy byte qua apiFetch kèm token rồi dựng blob URL.
 * Chỉ tải khi ảnh vào khung nhìn: lật trang có hàng chục ảnh mà tải hết một lúc sẽ dính giới hạn tần suất (429) của API.
 * Ảnh lỗi vẫn để lại ô báo "Không tải được ảnh" cùng cỡ, không để ảnh biến mất im lặng.
 */
export function AdminImage({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const admin = isAdminImageRef(src);
  const [state, setState] = useState<{ src: string } | 'loading' | 'error'>('loading');
  const [visible, setVisible] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!admin || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [admin, visible]);

  useEffect(() => {
    if (!admin || !visible) return;
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
  }, [admin, visible, src]);

  if (!admin) {
    const direct = directImageSrc(src);
    // eslint-disable-next-line @next/next/no-img-element
    return direct ? <img key={direct} src={direct} alt={alt} referrerPolicy="no-referrer" onError={hideBrokenImage} className={className} /> : null;
  }
  if (typeof state === 'object') {
    return (
      // Mở bản lớn trong tab mới: ảnh review ẩn trong danh sách chỉ hiện 64px, không đủ để đọc.
      // Mở bằng window.open không noopener: tài liệu mở ra chỉ là ảnh (không chạy script), còn noopener trên blob URL có thể bị
      // Chrome chặn ra about:blank#blocked do chia vùng lưu trữ.
      <a
        href={state.src}
        target="_blank"
        rel="noopener noreferrer"
        className="block shrink-0"
        onClick={(e) => {
          e.preventDefault();
          window.open(state.src, '_blank');
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={state.src} alt={alt} referrerPolicy="no-referrer" className={className} />
      </a>
    );
  }
  if (state === 'error') {
    return (
      <span role="img" aria-label="Không tải được ảnh" className={`${className ?? ''} inline-flex items-center justify-center bg-stone-100 p-1 text-center text-[10px] leading-tight text-stone-500`}>
        Không tải được ảnh
      </span>
    );
  }
  return <span ref={holder} className={`${className ?? ''} inline-block animate-pulse bg-stone-100`} aria-hidden />;
}
