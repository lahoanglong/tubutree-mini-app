'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Star } from 'lucide-react';
import { useAuthPhase } from '@/lib/auth-phase';
import { apiMediaUrl } from '@/lib/client-api';
import { formatDate } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';
import { MAX_PUBLIC_DATA_URL_LENGTH } from '@/lib/image-compress';
import { loginHref } from '@/lib/return-to';
import {
  REVIEW_ORDER_PARAM,
  fetchCanReview,
  fetchMyReview,
  fetchProductReviews,
  purchaseNote,
  rewardHint,
  saveReview,
  savedMessage,
  type MyReview,
  type MyReviewRef,
} from '@/lib/reviews-client';
import { EvidenceUpload } from '@/components/evidence-upload';

const PAGE_SIZE = 5;

/**
 * Đánh giá đang soạn. Mỗi lần mua (đơn) một đánh giá: sửa thì gắn đúng dòng đánh giá của đơn đó; viết mới gắn đơn khách
 * chọn từ chi tiết đơn, không chọn thì đơn còn viết được nhận sớm nhất.
 */
type FormTarget = { kind: 'new'; orderId?: string } | { kind: 'edit'; reviewId: string; orderId: string; orderCode: string | null };

function Stars({ value, small = false }: { value: number; small?: boolean }) {
  return (
    <span role="img" aria-label={`${value} trên 5 sao`} className="inline-flex whitespace-nowrap">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={`${small ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${i <= Math.round(value) ? 'fill-honey-500 text-honey-500' : 'fill-stone-200 text-stone-200'}`}
        />
      ))}
    </span>
  );
}

/** Khung chờ khi trang được dựng sẵn (ISR): tham số mở form chỉ đọc được ở trình duyệt. Giữ id để link #danh-gia cuộn tới. */
export function ProductReviewsFallback() {
  return (
    <section id="danh-gia" aria-labelledby="danh-gia-title" className="mt-8 scroll-mt-20">
      <h2 id="danh-gia-title" className={ui.sectionTitle}>
        Đánh giá
      </h2>
      <p className="mt-2 text-sm text-stone-600">Đang tải đánh giá…</p>
    </section>
  );
}

/**
 * Đánh giá trên trang sản phẩm web: danh sách công khai (mọi đánh giá đang hiện, mới nhất trước) và form viết/sửa theo
 * cùng luật với Mini App. `?danh-gia=<id đơn>` (từ chi tiết đơn) mở sẵn form cho đúng lần mua đó.
 */
export function ProductReviews({ slug }: { slug: string }) {
  const params = useSearchParams();
  const openForOrderId = params?.get(REVIEW_ORDER_PARAM) ?? undefined;
  const phase = useAuthPhase();
  const listQ = useQuery({ queryKey: ['reviews', slug], queryFn: () => fetchProductReviews(slug) });
  const eligQ = useQuery({
    queryKey: ['can-review', slug],
    queryFn: () => fetchCanReview(slug),
    enabled: phase === 'authenticated',
    retry: false,
  });
  const [target, setTarget] = useState<FormTarget | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [notice, setNotice] = useState<string | null>(null);

  const elig = phase === 'authenticated' ? eligQ.data : undefined;
  const myReviews = elig?.myReviews ?? [];
  const mineById = new Map(myReviews.map((r) => [r.id, r]));
  const latestMine = myReviews[0];

  const openForm = (t: FormTarget) => {
    setNotice(null);
    setTarget(t);
  };
  const openEdit = (r: MyReviewRef) => openForm({ kind: 'edit', reviewId: r.id, orderId: r.orderId, orderCode: r.orderCode });

  const deepLinked = useRef(false);
  useEffect(() => {
    if (!openForOrderId || !elig || deepLinked.current) return;
    deepLinked.current = true;
    const mine = elig.myReviews?.find((r) => r.orderId === openForOrderId);
    if (elig.reviewableOrders?.some((o) => o.orderId === openForOrderId)) setTarget({ kind: 'new', orderId: openForOrderId });
    else if (mine) setTarget({ kind: 'edit', reviewId: mine.id, orderId: mine.orderId, orderCode: mine.orderCode });
  }, [openForOrderId, elig]);

  const formOrderId = target?.kind === 'edit' ? target.orderId : (target?.orderId ?? elig?.reviewableOrders?.[0]?.orderId);
  const formOrderCode =
    target?.kind === 'edit' ? target.orderCode : (elig?.reviewableOrders?.find((o) => o.orderId === formOrderId)?.code ?? null);
  const returnTo = `/san-pham/${encodeURIComponent(slug)}${openForOrderId ? `?${REVIEW_ORDER_PARAM}=${encodeURIComponent(openForOrderId)}` : ''}`;

  const data = listQ.data;
  const dist = data?.distribution ?? {};
  const items = data?.items ?? [];

  return (
    <section id="danh-gia" aria-labelledby="danh-gia-title" className="mt-8 scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="danh-gia-title" className={ui.sectionTitle}>
          Đánh giá{data && data.count > 0 ? ` (${data.count})` : ''}
        </h2>
        {phase === 'guest' && (
          <Link href={loginHref(returnTo)} className={`${ui.btnText} text-forest-700`}>
            Đăng nhập để đánh giá
          </Link>
        )}
        {elig && !target && (
          <>
            {elig.canReview ? (
              <button type="button" className={ui.btnSecondary} onClick={() => openForm({ kind: 'new' })}>
                Viết đánh giá
              </button>
            ) : elig.reason === 'ALL_REVIEWED' && latestMine ? (
              <button type="button" className={ui.btnSecondary} onClick={() => openEdit(latestMine)}>
                Sửa đánh giá của bạn
              </button>
            ) : (
              <span className="text-sm text-stone-600">Mua và nhận hàng để đánh giá</span>
            )}
          </>
        )}
      </div>

      {notice && (
        <p role="status" className="mt-2 rounded-control bg-success-bg px-3 py-2 text-sm font-medium text-success-fg">
          {notice}
        </p>
      )}

      {target && (
        <ReviewEditor
          key={target.kind === 'edit' ? `edit:${target.reviewId}` : 'new'}
          slug={slug}
          target={target}
          orderId={formOrderId}
          orderCode={formOrderCode}
          purchaseCount={elig?.purchaseCount ?? 0}
          rewardAvailable={elig?.rewardAvailable !== false}
          onCancel={() => setTarget(null)}
          onSaved={(message) => {
            setTarget(null);
            setNotice(message);
          }}
        />
      )}

      {listQ.isLoading ? (
        <p className="mt-3 text-sm text-stone-600">Đang tải đánh giá…</p>
      ) : listQ.isError ? (
        <div className="mt-3">
          <p className={ui.error}>Không tải được đánh giá.</p>
          <button type="button" className={`${ui.btnText} text-forest-700`} onClick={() => void listQ.refetch()}>
            Thử lại
          </button>
        </div>
      ) : !data || data.count === 0 ? (
        <p className="mt-3 text-sm text-stone-600">Chưa có đánh giá. Hãy là người đầu tiên chia sẻ trải nghiệm.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-6">
            <div className="text-center">
              <div className="font-display text-4xl font-semibold text-stone-900">{data.average.toFixed(1)}</div>
              <Stars value={data.average} />
              <div className="text-xs text-stone-600">{data.count} đánh giá</div>
            </div>
            <ul aria-label="Phân bổ số sao" className="min-w-[12rem] flex-1 space-y-1">
              {[5, 4, 3, 2, 1].map((star) => {
                const n = dist[String(star)] ?? 0;
                const pct = data.count > 0 ? Math.round((n / data.count) * 100) : 0;
                return (
                  <li key={star} className="flex items-center gap-2 text-xs text-stone-600">
                    <span className="w-3 text-right">{star}</span>
                    <Star aria-hidden="true" className="h-3 w-3 flex-none fill-honey-500 text-honey-500" />
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                      <span className="block h-full bg-honey-500" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="w-6 text-right">{n}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <ul className="mt-3">
            {items.slice(0, visible).map((r) => {
              const mine = mineById.get(r.id);
              return (
                <li key={r.id} className="border-t border-stone-200 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-forest-50 text-sm font-semibold text-forest-800"
                    >
                      {r.author.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-stone-900">{r.author}</span>
                        {r.verifiedPurchase && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-fg">
                            <Check className="h-3 w-3" aria-hidden="true" />
                            Đã mua
                          </span>
                        )}
                        {mine && (
                          <span className="rounded-full bg-forest-50 px-2 py-0.5 text-xs font-medium text-forest-800">Của bạn</span>
                        )}
                      </div>
                      <Stars value={r.rating} small />
                    </div>
                    <span className="flex-none text-xs text-stone-600">{formatDate(r.createdAt)}</span>
                  </div>
                  {mine && (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      {mine.orderCode && <span className="text-xs text-stone-600">Đơn {mine.orderCode}</span>}
                      <button
                        type="button"
                        className={`${ui.btnText} ml-auto text-forest-700`}
                        aria-label={mine.orderCode ? `Sửa đánh giá đơn ${mine.orderCode}` : 'Sửa đánh giá này'}
                        onClick={() => openEdit(mine)}
                      >
                        Sửa
                      </button>
                    </div>
                  )}
                  {r.comment && <p className="mt-2 whitespace-pre-line break-words text-sm text-stone-700">{r.comment}</p>}
                  {r.images.length > 0 && (
                    <div className="mt-2 flex gap-2 overflow-x-auto">
                      {r.images.map((img) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={img}
                          src={img.startsWith('/') ? apiMediaUrl(img) : img}
                          alt="Ảnh đánh giá"
                          loading="lazy"
                          className="h-16 w-16 flex-none rounded-control object-cover"
                        />
                      ))}
                    </div>
                  )}
                  {r.videoUrl && (
                    <video src={r.videoUrl} controls preload="metadata" playsInline className="mt-2 max-h-56 w-full rounded-control bg-stone-900" />
                  )}
                </li>
              );
            })}
          </ul>
          {items.length > visible && (
            <button type="button" className={`${ui.btnSecondary} w-full`} onClick={() => setVisible((v) => v + PAGE_SIZE)}>
              Xem thêm ({items.length - visible})
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ReviewEditor({
  slug,
  target,
  ...rest
}: {
  slug: string;
  target: FormTarget;
  orderId?: string;
  orderCode: string | null;
  purchaseCount: number;
  rewardAvailable: boolean;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const editingId = target.kind === 'edit' ? target.reviewId : null;
  // Danh sách công khai trả ảnh base64 dạng đường dẫn; sửa phải gửi lại đúng ảnh cũ nên đọc nguyên đánh giá của mình.
  // gcTime 0: mở lại sau khi lưu phải đọc nội dung mới, không điền form bằng bản cũ trong bộ nhớ đệm.
  const myQ = useQuery({
    queryKey: ['my-review', editingId],
    queryFn: () => fetchMyReview(editingId!),
    enabled: editingId !== null,
    retry: false,
    gcTime: 0,
  });
  if (editingId && myQ.isPending) {
    return (
      <p role="status" className="mt-3 text-sm text-stone-600">
        Đang tải đánh giá của bạn…
      </p>
    );
  }
  if (editingId && myQ.isError) {
    return (
      <div className="mt-3">
        <p className={ui.error}>Không tải được đánh giá để sửa.</p>
        <button type="button" className={`${ui.btnText} text-forest-700`} onClick={() => void myQ.refetch()}>
          Thử lại
        </button>
        <button type="button" className={`${ui.btnText} text-stone-700`} onClick={rest.onCancel}>
          Đóng
        </button>
      </div>
    );
  }
  return <ReviewForm slug={slug} isEdit={editingId !== null} initial={myQ.data} {...rest} />;
}

function ReviewForm({
  slug,
  isEdit,
  initial,
  orderId,
  orderCode,
  purchaseCount,
  rewardAvailable,
  onCancel,
  onSaved,
}: {
  slug: string;
  isEdit: boolean;
  initial?: MyReview;
  orderId?: string;
  orderCode: string | null;
  purchaseCount: number;
  rewardAvailable: boolean;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const qc = useQueryClient();
  const commentId = useId();
  const [rating, setRating] = useState(initial?.rating ?? 5);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [images, setImages] = useState<string[]>(initial?.images ?? []);
  // Web chưa tải video lên được: sửa đánh giá có video thì gửi lại đúng video cũ để không mất.
  const videoUrl = initial?.videoUrl ?? null;

  const save = useMutation({
    mutationFn: () =>
      saveReview(slug, {
        rating,
        comment: comment.trim() || undefined,
        images: images.length > 0 ? images : undefined,
        videoUrl: videoUrl ?? undefined,
        orderId,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['reviews', slug] });
      void qc.invalidateQueries({ queryKey: ['can-review', slug] });
      void qc.invalidateQueries({ queryKey: ['order'] });
      onSaved(savedMessage(res));
    },
  });

  const hasMedia = images.length > 0 || videoUrl !== null;
  const hint = rewardHint({ isEdit, rewardAvailable, hasImages: images.length > 0, hasVideo: videoUrl !== null });
  const note = purchaseNote({ isEdit, purchaseCount, orderCode });

  return (
    <form
      aria-label={isEdit ? 'Sửa đánh giá' : 'Viết đánh giá'}
      className={`mt-3 p-4 ${ui.card}`}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h3 className="text-base font-semibold text-stone-900">{isEdit ? 'Sửa đánh giá' : 'Đánh giá sản phẩm'}</h3>
      {note && <p className="mt-1 text-sm text-stone-600">{note}</p>}
      <div role="radiogroup" aria-label="Số sao" className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={i === rating}
            aria-label={`${i} sao`}
            onClick={() => setRating(i)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-control"
          >
            <Star aria-hidden="true" className={`h-7 w-7 ${i <= rating ? 'fill-honey-500 text-honey-500' : 'fill-stone-200 text-stone-200'}`} />
          </button>
        ))}
      </div>
      <label htmlFor={commentId} className="mt-3 block text-sm font-semibold text-stone-900">
        Nhận xét <span className="font-normal text-stone-600">(không bắt buộc)</span>
      </label>
      <textarea
        id={commentId}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
        rows={4}
        placeholder="Chia sẻ cảm nhận của bạn về sản phẩm…"
        className={`${ui.field} mt-1 py-2`}
      />
      <div className="mt-3">
        <EvidenceUpload
          value={images}
          onChange={setImages}
          max={5}
          label="Ảnh đánh giá"
          hint="không bắt buộc"
          maxDataUrlLength={MAX_PUBLIC_DATA_URL_LENGTH}
          disabled={save.isPending}
        />
      </div>
      {videoUrl && <p className="mt-2 text-sm text-stone-600">Video đã gửi kèm đánh giá này được giữ nguyên.</p>}
      <p className={`mt-3 text-sm ${!isEdit && rewardAvailable && hasMedia ? 'font-semibold text-success-fg' : 'text-stone-600'}`}>{hint}</p>
      {save.isError && (
        <p role="alert" className={`mt-2 ${ui.error}`}>
          {save.error instanceof Error ? save.error.message : 'Không gửi được đánh giá, vui lòng thử lại.'}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className={ui.btnPrimary} disabled={save.isPending}>
          {save.isPending ? 'Đang gửi…' : isEdit ? 'Lưu đánh giá' : 'Gửi đánh giá'}
        </button>
        <button type="button" className={ui.btnSecondary} onClick={onCancel} disabled={save.isPending}>
          Hủy
        </button>
      </div>
    </form>
  );
}
