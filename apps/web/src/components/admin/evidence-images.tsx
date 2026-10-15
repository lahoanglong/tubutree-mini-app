'use client';

import { useState } from 'react';
import { apiMediaUrl } from '@/lib/client-api';

const RASTER_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const API_IMAGE_REF_RE = /^\/(?:returns|reviews)\/[A-Za-z0-9_-]{1,64}\/images\/\d{1,2}\?v=[0-9a-f]{8,64}$/;

/**
 * Ảnh minh chứng đổi trả do khách gửi — dữ liệu không tin cậy (C-050). Chỉ hiện:
 * - https:// → ảnh + link mở tab mới;
 * - ảnh base64 raster (fallback của ImageUpload miniapp khi chưa cấu hình Cloudinary) → chỉ ảnh, không link
 *   (data: SVG/HTML chạy được script, còn trong <img> ảnh raster thì không);
 * - đường dẫn ảnh do chính API phục vụ (danh sách không nhúng base64 nữa: "/returns/:id/images/:i?v=…") → ghép gốc API,
 *   ảnh + link mở ảnh lớn. Chỉ khớp đúng dạng đó, đường dẫn tương đối khác bị từ chối.
 * Hàng cũ trong DB lưu trước khi API chặn vẫn có thể chứa javascript:/data:text/html, nên lọc cả ở đây.
 */
export function safeEvidenceImage(raw: string): { src: string; href: string | null } | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.startsWith('data:')) return RASTER_DATA_URL_RE.test(raw) ? { src: raw, href: null } : null;
  if (raw.startsWith('/')) {
    if (!API_IMAGE_REF_RE.test(raw)) return null;
    const src = apiMediaUrl(raw);
    return { src, href: src };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || raw !== raw.trim()) return null;
  return { src: url.href, href: url.href };
}

export function EvidenceImages({ images }: { images: string[] | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!images || images.length === 0) return null;
  const safe = images.map(safeEvidenceImage).filter((x): x is { src: string; href: string | null } => x !== null);
  const rejected = images.length - safe.length;

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(!open)} className="text-xs font-medium text-forest-700 hover:underline">
        {open ? 'Ẩn ảnh minh chứng' : `Xem ${images.length} ảnh minh chứng`}
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          {safe.map((img, idx) => {
            const thumb = (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.src}
                alt={`Ảnh minh chứng ${idx + 1}`}
                referrerPolicy="no-referrer"
                loading="lazy"
                className="h-20 w-20 rounded-media border border-stone-200 object-cover shadow-card transition hover:opacity-80"
              />
            );
            return img.href ? (
              <a key={idx} href={img.href} target="_blank" rel="noopener noreferrer" title="Mở ảnh lớn ở tab mới">
                {thumb}
              </a>
            ) : (
              <span key={idx}>{thumb}</span>
            );
          })}
          {rejected > 0 && (
            <p className="w-full text-xs text-danger-fg">Đã ẩn {rejected} ảnh không hợp lệ (không phải ảnh https/ảnh tải lên).</p>
          )}
        </div>
      )}
    </div>
  );
}
