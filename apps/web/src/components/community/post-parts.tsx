import type { ReactNode } from 'react';
import { BookMarked, Globe, HelpCircle, Leaf, Lightbulb, PenLine, Sprout, TreeDeciduous, type LucideIcon } from 'lucide-react';
import type { FeedPostKind } from '@tubutree/app-core/api/feed';
import { publicMediaUrl } from '@/lib/api';
import { RankBadge } from './rank';

export const KIND_LABEL: Record<FeedPostKind, string> = {
  QUESTION: 'Hỏi đáp',
  SHOWCASE: 'Trải nghiệm',
  TIP: 'Mẹo hay',
  HARVEST: 'Thu hoạch',
  SPECIES: 'Sưu tập loài',
  MILESTONE: 'Mốc cộng đồng',
  MANUAL: 'Chia sẻ',
};

export const KIND_ICON: Record<FeedPostKind, LucideIcon> = {
  QUESTION: HelpCircle,
  SHOWCASE: Leaf,
  TIP: Lightbulb,
  HARVEST: TreeDeciduous,
  SPECIES: BookMarked,
  MILESTONE: Globe,
  MANUAL: PenLine,
};

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return `${Math.floor(diff / 86400)} ngày trước`;
}

/**
 * Ảnh và avatar do người dùng đưa vào: chỉ nhận http(s), ảnh data: và đường dẫn tương đối của API (ghép với gốc API công khai).
 * `javascript:`, data không phải ảnh và "//host" trả null để nơi gọi không vẽ thẻ img.
 */
export function safeMediaUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  if (/^https?:\/\//i.test(src) || /^data:image\//i.test(src)) return src;
  if (src.startsWith('/') && !src.startsWith('//')) return publicMediaUrl(src);
  return null;
}

export function Avatar({ src, size = 32 }: { src?: string | null; size?: number }) {
  const url = safeMediaUrl(src);
  const box = { width: size, height: size };
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" style={box} className="shrink-0 rounded-full object-cover" />
  ) : (
    <span style={box} className="flex shrink-0 items-center justify-center rounded-full bg-forest-50 text-forest-600">
      <Sprout className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

export function ExpertBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-forest-700">
      <Leaf className="h-3.5 w-3.5" aria-hidden="true" />
      Chuyên gia Tubu
    </span>
  );
}

/** Tên một dòng (dài thì cắt "…"); huy hiệu và dòng phụ nằm dòng dưới, tự xuống dòng khi chật. */
export function AuthorLine({ name, badge, level, meta }: { name: string; badge?: string | null; level?: number; meta?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-semibold text-stone-900">{name}</div>
      <div className="flex flex-wrap items-center gap-x-1.5">
        {badge === 'EXPERT' && <ExpertBadge />}
        {level !== undefined && <RankBadge level={level} />}
        {meta && <span className="text-xs text-stone-600">{meta}</span>}
      </div>
    </div>
  );
}
