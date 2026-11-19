'use client';

import { useEffect, useId, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { trackPurchase } from '@/lib/analytics';
import { orderAgeDays } from '@/components/analytics/funnel';
import { ui } from '@/lib/guest-ui';
import { Chip } from '@/components/mini/chip';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { REVIEW_COMMENT_MAX, reviewFormIssue, type ReviewFormIssue } from '@tubutree/app-core/commerce/review-form';
import { isImeEnter, isSubmitShortcut } from '@tubutree/app-core/keyboard';
import { IMAGES_UPLOADING, MAX_PUBLIC_DATA_URL_LENGTH } from '@/lib/image-compress';
import {
  EDIT_HIDDEN_NOTE,
  VIDEO_UPLOADING,
  fetchMyReview,
  greenCornerHint,
  purchaseNote,
  rewardHint,
  saveReview,
  savedMessage,
  type MyReview,
} from '@/lib/reviews-client';
import type { GreenCornerRules } from '@tubutree/app-core/review-copy';
import { ECO_TAG_OPTIONS, ecoTagLabel, ecoTagLocked, toggleEcoTag } from '@tubutree/app-core/commerce/green-corner';
import { REVIEW_ECO_TAG_MAX, normalizeEcoTags, type ReviewEcoTag } from '@tubutree/shared-types';
import { EvidenceUpload } from '@/components/evidence-upload';
import { reviewVideoConfig } from './review-video-config';
import { actionErrorText } from '@/lib/error-text';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';
import { useRovingGroup } from '@/lib/use-roving-group';
import { usePressLock } from '@/lib/use-press-lock';

// Mã tải video (Cloudinary, đo độ dài) chỉ cần khi khách mở form đánh giá: tách khỏi First Load của trang sản phẩm.
const ReviewVideoUpload = dynamic(() => import('./review-video-upload').then((m) => m.ReviewVideoUpload), { ssr: false });

/**
 * Đánh giá đang soạn, luôn gắn một lần mua (đơn): viết mới cho đơn khách chọn từ chi tiết đơn, không chọn thì đơn còn viết
 * được nhận sớm nhất, chốt lúc mở form; sửa gắn đúng dòng đánh giá của đơn đó. Không bao giờ gửi đánh giá mới thiếu đơn: máy
 * chủ hiểu lần gửi không kèm đơn (bản app cũ) là sửa đánh giá mới nhất khi mọi lần mua đã có đánh giá.
 */
export type FormTarget =
  | { kind: 'new'; orderId: string; orderCode: string | null; deliveredAt: string | null }
  | { kind: 'edit'; reviewId: string; orderId: string; orderCode: string | null };

export function ReviewEditor({
  slug,
  target,
  ...rest
}: {
  slug: string;
  target: FormTarget;
  purchaseCount: number;
  rewardAvailable: boolean;
  rules: GreenCornerRules | null;
  hidden: boolean;
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
  const retryMy = usePressLock(() => myQ.refetch());
  if (editingId && myQ.isPending) {
    return (
      <p role="status" className="mt-3 text-sm text-stone-600">
        Đang tải đánh giá của bạn…
      </p>
    );
  }
  if (editingId && myQ.isError) {
    return (
      <div role="alert" className="mt-3">
        <p className={ui.error}>Không tải được đánh giá để sửa.</p>
        <button
          type="button"
          className={`${ui.btnText} text-forest-700`}
          onClick={retryMy.press}
          aria-busy={retryMy.busy || undefined}
          aria-disabled={retryMy.busy || undefined}
        >
          Thử lại
        </button>
        <button type="button" className={`${ui.btnText} text-stone-700`} onClick={rest.onCancel}>
          Đóng
        </button>
      </div>
    );
  }
  return (
    <ReviewForm
      slug={slug}
      isEdit={editingId !== null}
      initial={myQ.data}
      orderId={target.orderId}
      orderCode={target.orderCode}
      deliveredAt={target.kind === 'new' ? target.deliveredAt : null}
      {...rest}
    />
  );
}

function ReviewForm({
  slug,
  isEdit,
  initial,
  orderId,
  orderCode,
  deliveredAt,
  purchaseCount,
  rewardAvailable,
  rules,
  hidden,
  onCancel,
  onSaved,
}: {
  slug: string;
  isEdit: boolean;
  initial?: MyReview;
  orderId: string;
  orderCode: string | null;
  /** Mốc giao của lần mua đang đánh giá (chỉ đánh giá mới): tuổi đơn của `review_submitted`. */
  deliveredAt: string | null;
  purchaseCount: number;
  rewardAvailable: boolean;
  /** Luật Góc Sống Xanh khi cờ bật (thẻ cảm nhận, tối đa ảnh, thưởng sau duyệt); null thì form như cũ. */
  rules: GreenCornerRules | null;
  /** Đánh giá đang sửa bị Tubu ẩn: lưu không làm nó hiện lại, nên không được báo như thể đã đổi được gì. */
  hidden: boolean;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const qc = useQueryClient();
  const commentId = useId();
  const [rating, setRating] = useState(initial?.rating ?? 5);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const starsGroup = useRovingGroup();
  const [images, setImages] = useState<string[]>(initial?.images ?? []);
  const [videoUrl, setVideoUrl] = useState<string | null>(initial?.videoUrl ?? null);
  const [ecoTags, setEcoTags] = useState<ReviewEcoTag[]>(() => normalizeEcoTags(initial?.ecoTags));
  // Đánh giá cũ đã có hơn 3 ảnh vẫn sửa được (máy chủ nhận), chỉ không thêm.
  const maxPhotos = rules ? Math.max(rules.maxPhotos, initial?.images.length ?? 0) : 5;
  const wasHidden = hidden || (initial?.isVisible === false && initial.awaitingApproval !== true);
  // Đang tải video lên: gửi lúc này sẽ lưu đánh giá không kèm video (mất phần thưởng video, sửa lại cũng không được cộng thêm).
  const [videoBusy, setVideoBusy] = useState(false);
  // Ảnh còn đang xử lý cũng vậy: gửi lúc này lưu đánh giá thiếu ảnh, và ảnh chen vào sau khi đã gửi không vào bản đang gửi.
  const [imagesBusy, setImagesBusy] = useState(false);
  const mediaBusy = videoBusy || imagesBusy;
  // Lỗi ở hàng sao hay ô nhận xét trước khi gửi: đọc qua role=alert, focus tới chỗ cần sửa. Lỗi máy chủ nằm ở `save.error`.
  const [issue, setIssue] = useState<ReviewFormIssue | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const saveAlert = useRef<HTMLParagraphElement>(null);
  // Khoá đồng bộ chống gửi đúp (Enter hai lần, bấm hai lần cùng nhịp): isPending chỉ đổi sau lần vẽ kế tiếp.
  const sending = useRef(false);
  const ratingErrorId = useId();
  const commentErrorId = useId();
  // Lời lỗi máy chủ ở state riêng: `save.isError` chỉ bật sau khi `onError` (tải lại, tới 4 giây) xong, mà lời báo phải hiện và được focus ngay.
  // Mỗi lần lỗi là một đối tượng mới nên cùng một câu lặp lại vẫn được focus và đọc lại.
  const [saveError, setSaveError] = useState<{ message: string } | null>(null);

  const save = useMutation({
    mutationFn: () =>
      saveReview(slug, {
        rating,
        comment: comment.trim() || undefined,
        images: images.length > 0 ? images : undefined,
        videoUrl: videoUrl ?? undefined,
        orderId,
        ...(rules ? { ecoTags } : {}),
      }),
    onMutate: () => setSaveError(null),
    // "Đơn đã trả hàng", đơn không còn: quyền đánh giá đang hiện (nút "Viết đánh giá", đơn chốt lúc mở form) đã cũ, tải lại để trang hiện đúng.
    // Giữ khoá tới lúc đó (tối đa 4 giây); các lỗi khác không tải lại.
    onError: (e) => {
      setSaveError({ message: actionErrorText(e) });
      return serverRejectedState(e) ? settleWithin(qc.invalidateQueries({ queryKey: ['can-review', slug] })) : undefined;
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['reviews', slug] });
      void qc.invalidateQueries({ queryKey: ['can-review', slug] });
      void qc.invalidateQueries({ queryKey: ['order'] });
      // Đánh giá đầu tiên của sản phẩm cộng Điểm Xanh: trang Điểm Xanh, ví và Thanh toán đọc số dư từ ['loyalty'].
      void qc.invalidateQueries({ queryKey: ['loyalty'] });
      const age = isEdit ? null : orderAgeDays(deliveredAt);
      if (age !== null) trackPurchase('review_submitted', { orderAgeDays: age });
      onSaved(savedMessage(res, wasHidden));
    },
    onSettled: () => {
      sending.current = false;
    },
  });

  useEffect(() => {
    if (saveError) saveAlert.current?.focus();
  }, [saveError]);

  const pickRating = (i: number) => {
    setRating(i);
    if (issue?.field === 'rating') setIssue(null);
  };

  const send = () => {
    if (mediaBusy || save.isPending || sending.current) return;
    const found = reviewFormIssue({ rating, comment });
    if (found) {
      setIssue(found);
      if (found.field === 'comment') commentRef.current?.focus();
      else starsGroup.ref.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
      return;
    }
    setIssue(null);
    sending.current = true;
    save.mutate();
  };

  const hasMedia = images.length > 0 || videoUrl !== null;
  const hint = rules
    ? greenCornerHint({ isEdit, rewardAvailable, hasMedia, rules })
    : rewardHint({
        isEdit,
        rewardAvailable,
        hasImages: images.length > 0,
        hasVideo: videoUrl !== null,
        canUploadVideo: reviewVideoConfig() !== null,
      });
  const note = purchaseNote({ isEdit, purchaseCount, orderCode });

  return (
    <form
      aria-label={isEdit ? 'Sửa đánh giá' : 'Viết đánh giá'}
      className={`mt-3 p-4 ${ui.card}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      // Enter mà bộ gõ tiếng Việt dùng để chốt chữ không được gửi form hay bấm nút đang focus; ô nhận xét để bộ gõ tự xử lý.
      onKeyDown={(e) => {
        if (isImeEnter(e.nativeEvent) && !(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
      }}
    >
      <h3 className="text-base font-semibold text-stone-900">{isEdit ? 'Sửa đánh giá' : 'Đánh giá sản phẩm'}</h3>
      {note && <p className="mt-1 text-sm text-stone-600">{note}</p>}
      {isEdit && wasHidden && <p className="mt-1 text-sm text-warning-fg">{EDIT_HIDDEN_NOTE}</p>}
      <div
        ref={starsGroup.ref}
        onKeyDown={starsGroup.onKeyDown}
        role="radiogroup"
        aria-label="Số sao"
        aria-invalid={issue?.field === 'rating' || undefined}
        aria-describedby={issue?.field === 'rating' ? ratingErrorId : undefined}
        className="mt-2 flex gap-1"
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={i === rating}
            aria-label={`${i} sao`}
            onClick={() => pickRating(i)}
            className="tubu-press inline-flex h-11 w-11 items-center justify-center rounded-control"
          >
            <Star aria-hidden="true" className={`h-7 w-7 ${i <= rating ? 'fill-honey-500 text-honey-500' : 'fill-[color:var(--stone-450)] text-[color:var(--stone-450)]'}`} />
          </button>
        ))}
      </div>
      {issue?.field === 'rating' && (
        <p id={ratingErrorId} role="alert" className={`mt-1 ${ui.error}`}>
          {issue.message}
        </p>
      )}
      <label htmlFor={commentId} className="mt-3 block text-sm font-semibold text-stone-900">
        Nhận xét <span className="font-normal text-stone-600">(không bắt buộc)</span>
      </label>
      <textarea
        id={commentId}
        value={comment}
        ref={commentRef}
        onChange={(e) => {
          setComment(e.target.value);
          if (issue?.field === 'comment') setIssue(null);
        }}
        onKeyDown={(e) => {
          if (!isSubmitShortcut(e.nativeEvent)) return;
          e.preventDefault();
          send();
        }}
        aria-invalid={issue?.field === 'comment' || undefined}
        aria-describedby={issue?.field === 'comment' ? commentErrorId : undefined}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        maxLength={REVIEW_COMMENT_MAX}
        rows={4}
        placeholder="Chia sẻ cảm nhận của bạn về sản phẩm…"
        className={`${ui.field} mt-1 py-2`}
      />
      {issue?.field === 'comment' && (
        <p id={commentErrorId} role="alert" className={`mt-1 ${ui.error}`}>
          {issue.message}
        </p>
      )}
      {rules && (
        <fieldset className="mt-3" data-testid="review-eco-tags">
          <legend className="text-sm font-semibold text-[var(--color-text-primary)]">{fillCopy('review.ecoPick', { n: REVIEW_ECO_TAG_MAX })}</legend>
          {/* Hàng chip nhỏ xuống dòng cách nhau 12px: vùng chạm 44px của hai hàng không chồng lên nhau. */}
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-3">
            {ECO_TAG_OPTIONS.map((t) => (
              <Chip
                key={t}
                size="sm"
                variant="choice"
                selected={ecoTags.includes(t)}
                disabled={save.isPending || ecoTagLocked(ecoTags, t)}
                onPress={() => setEcoTags((cur) => toggleEcoTag(cur, t))}
              >
                {ecoTagLabel(t)}
              </Chip>
            ))}
          </div>
        </fieldset>
      )}
      <div className="mt-3">
        <EvidenceUpload
          value={images}
          onChange={setImages}
          max={maxPhotos}
          label="Ảnh đánh giá"
          hint="không bắt buộc"
          maxDataUrlLength={MAX_PUBLIC_DATA_URL_LENGTH}
          disabled={save.isPending}
          onBusyChange={setImagesBusy}
        />
      </div>
      <ReviewVideoUpload value={videoUrl} onChange={setVideoUrl} onBusyChange={setVideoBusy} disabled={save.isPending} />
      <p className={`mt-3 text-sm ${!isEdit && rewardAvailable && hasMedia ? 'font-semibold text-success-fg' : 'text-stone-600'}`}>{hint}</p>
      {saveError && (
        <p ref={saveAlert} tabIndex={-1} role="alert" className={`mt-2 ${ui.error}`}>
          {saveError.message}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {/* Đang gửi dùng aria-disabled chứ không `disabled`: nút đang giữ focus mà `disabled` thì Chromium thả focus về body.
            Lần bấm thứ hai đã bị send() chặn bằng `sending`/isPending. Đang tải video hay ảnh vẫn `disabled` như Mini App. */}
        <button
          type="submit"
          className={ui.btnPrimary}
          disabled={mediaBusy}
          aria-busy={save.isPending || undefined}
          aria-disabled={save.isPending || undefined}
        >
          {save.isPending ? 'Đang gửi…' : videoBusy ? VIDEO_UPLOADING : imagesBusy ? IMAGES_UPLOADING : isEdit ? 'Lưu đánh giá' : 'Gửi đánh giá'}
        </button>
        <button type="button" className={ui.btnSecondary} onClick={onCancel} disabled={save.isPending || mediaBusy}>
          Huỷ
        </button>
      </div>
    </form>
  );
}
