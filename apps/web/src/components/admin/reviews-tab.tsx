'use client';

import { useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAdminReviews,
  setReviewVisibility,
  type AdminReview,
  type ReviewVisibilityFilter,
} from '@/lib/admin-client';
import { reviewStarCount, safeHttpsLink } from '@/lib/admin-pickers';
import { useConfirm } from './confirm-dialog';
import { safeEvidenceImage } from './evidence-images';
import { PageNav } from './page-nav';
import { BTN_LINK, Notice, ToneBadge, chipClass } from './ui';
import { formatDateTime } from '@/lib/format-date';

const PAGE_SIZE = 20;
const VISIBILITY_CHIPS: { k: ReviewVisibilityFilter | ''; label: string }[] = [
  { k: '', label: 'Tất cả' },
  { k: 'visible', label: 'Đang hiện' },
  { k: 'hidden', label: 'Đã ẩn' },
];

/** Duyệt đánh giá của khách: ẩn đánh giá vi phạm / hiện lại. BE tính lại điểm sao của sản phẩm sau mỗi lần đổi. */
export function ReviewsTab() {
  const [page, setPage] = useState(1);
  const [visibility, setVisibility] = useState<ReviewVisibilityFilter | ''>('');
  const [rating, setRating] = useState(0);
  const q = useQuery({
    queryKey: ['admin-reviews', page, visibility, rating],
    queryFn: () => listAdminReviews(page, visibility || undefined, rating || undefined, PAGE_SIZE),
  });

  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-stone-900">Đánh giá</h2>
      <Notice>Đánh giá bị ẩn không hiện trên trang sản phẩm và không tính vào điểm sao; có thể hiện lại bất cứ lúc nào.</Notice>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Lọc đánh giá theo trạng thái" className="flex flex-wrap gap-2">
          {VISIBILITY_CHIPS.map((c) => (
            <button
              key={c.k || 'all'}
              type="button"
              role="tab"
              aria-selected={visibility === c.k}
              onClick={() => {
                setPage(1);
                setVisibility(c.k);
              }}
              className={chipClass(visibility === c.k)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Lọc theo số sao"
          value={rating}
          onChange={(e) => {
            setPage(1);
            setRating(Number(e.target.value));
          }}
          className="min-h-[44px] rounded-control border border-stone-450 bg-stone-0 px-2 py-1 text-sm text-stone-900 focus:border-forest-600 sm:min-h-[32px]"
        >
          <option value={0}>Mọi số sao</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} sao
            </option>
          ))}
        </select>
      </div>

      {q.isError && (
        <p role="alert" className="text-sm text-danger-fg">
          {(q.error as Error).message || 'Không tải được danh sách đánh giá.'}
        </p>
      )}
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải đánh giá…</p>}
      {q.data && q.data.data.length === 0 && <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-sm text-stone-500">Không có đánh giá nào khớp bộ lọc.</p>}
      <div className="space-y-3">
        {q.data?.data.map((r) => <ReviewRow key={r.id} review={r} />)}
      </div>
      {q.data && <PageNav page={q.data.meta.page} limit={q.data.meta.limit} total={q.data.meta.total} onPage={setPage} noun="đánh giá" />}
    </div>
  );
}

/** Điểm sao bằng icon lucide: sao đầy theo `reviewStarCount`, phần còn lại viền. */
export function ReviewStars({ rating }: { rating: number }) {
  const filled = reviewStarCount(rating);
  return (
    <span role="img" aria-label={`${rating} sao`} className="inline-flex gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} aria-hidden className={`h-4 w-4 ${i < filled ? 'fill-current text-honey-500' : 'text-stone-450'}`} />
      ))}
    </span>
  );
}

function ReviewRow({ review: r }: { review: AdminReview }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const inFlight = useRef(false);
  const mut = useMutation({
    mutationFn: (isVisible: boolean) => setReviewVisibility(r.id, isVisible),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-reviews'] }),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const who = r.user.fullName?.trim() || r.user.phone || 'Khách';
  const toggle = async () => {
    if (inFlight.current || mut.isPending) return;
    const hide = r.isVisible;
    const subject = `đánh giá ${r.rating} sao của ${who} cho “${r.product.name}”`;
    const ok = await confirm(
      hide
        ? {
            title: 'Ẩn đánh giá',
            message: `Ẩn ${subject}?\n\nĐánh giá sẽ biến mất khỏi trang sản phẩm và không còn tính vào điểm sao. Bạn có thể hiện lại sau.`,
            confirmLabel: 'Ẩn đánh giá',
            cancelLabel: 'Giữ nguyên',
            tone: 'danger',
          }
        : {
            title: 'Hiện lại đánh giá',
            message: `Hiện lại ${subject}?\n\nĐánh giá sẽ hiện công khai và tính vào điểm sao của sản phẩm.`,
            confirmLabel: 'Hiện lại',
          },
    );
    if (!ok || inFlight.current || mut.isPending) return;
    inFlight.current = true;
    mut.mutate(!hide);
  };

  const images = r.images.map(safeEvidenceImage).filter((x): x is { src: string; href: string | null } => x !== null);
  const video = safeHttpsLink(r.videoUrl);

  return (
    <article className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <ReviewStars rating={r.rating} />
        <ToneBadge tone={r.isVisible ? 'success' : 'neutral'}>{r.isVisible ? 'Đang hiện' : 'Đã ẩn'}</ToneBadge>
        {r.isVerified && <ToneBadge tone="info">Đã mua hàng</ToneBadge>}
        <span className="ml-auto text-xs text-stone-500">{formatDateTime(r.createdAt)}</span>
      </div>
      <div className="mt-1 font-medium">{r.product.name}</div>
      <div className="text-xs text-stone-500">
        {r.user.fullName?.trim() || 'Chưa có tên'} · {r.user.phone || 'chưa có SĐT'}
      </div>
      {r.comment && <p className="mt-2 whitespace-pre-wrap break-words text-stone-800">{r.comment}</p>}
      {(images.length > 0 || video) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {images.map((img, i) => {
            const thumb = (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.src}
                alt={`Ảnh đánh giá ${i + 1}`}
                referrerPolicy="no-referrer"
                className="h-16 w-16 rounded-control border border-stone-200 object-cover"
              />
            );
            return img.href ? (
              <a key={i} href={img.href} target="_blank" rel="noopener noreferrer" title="Mở ảnh lớn ở tab mới">
                {thumb}
              </a>
            ) : (
              <span key={i}>{thumb}</span>
            );
          })}
          {video && (
            <a href={video} target="_blank" rel="noopener noreferrer" className={`${BTN_LINK} text-xs font-medium`}>
              Xem video
            </a>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={mut.isPending}
          className={`min-h-[44px] rounded-control border px-3 text-sm font-medium disabled:opacity-50 sm:min-h-[32px] ${
            r.isVisible ? 'border-danger-fg text-danger-fg hover:bg-danger-bg' : 'border-forest-600 text-forest-700 hover:bg-forest-50'
          }`}
        >
          {mut.isPending ? 'Đang lưu…' : r.isVisible ? 'Ẩn đánh giá' : 'Hiện lại'}
        </button>
        {mut.isError && (
          <span role="alert" className="text-xs text-danger-fg">
            {(mut.error as Error).message || 'Không đổi được trạng thái đánh giá.'}
          </span>
        )}
      </div>
      {dialog}
    </article>
  );
}
