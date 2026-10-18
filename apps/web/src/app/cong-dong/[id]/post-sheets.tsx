'use client';

import type { FeedItem } from '@tubutree/app-core/api/feed';
import { Sheet } from '@/components/ui/sheet';
import { ui } from '@/lib/guest-ui';

const TITLE_PLACEHOLDER = 'Tiêu đề câu hỏi (vd: Nước rửa chén sinh học dùng được cho bình sữa không?)';

/** Sheet sửa bài của chủ bài: câu hỏi bắt buộc còn tiêu đề (giống khung soạn). */
export function EditPostSheet({
  open,
  kind,
  title,
  body,
  onTitle,
  onBody,
  onClose,
  onSave,
  saving,
  error,
}: {
  open: boolean;
  kind: FeedItem['kind'];
  title: string;
  body: string;
  onTitle: (v: string) => void;
  onBody: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error?: string | null;
}) {
  const needsTitle = kind === 'QUESTION' && title.trim().length === 0;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Sửa"
      footer={
        <button type="button" disabled={saving || needsTitle || body.trim().length === 0} onClick={onSave} className={`${ui.btnPrimary} w-full`}>
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
      }
    >
      {kind === 'QUESTION' && (
        <div className="mt-3">
          <input aria-label={TITLE_PLACEHOLDER} placeholder={TITLE_PLACEHOLDER} value={title} maxLength={160} onChange={(e) => onTitle(e.target.value)} className={ui.field} />
          {needsTitle && <p className="mt-1 text-xs text-danger-fg">Câu hỏi cần có tiêu đề</p>}
        </div>
      )}
      <div className="mt-3">
        <textarea
          aria-label="Chia sẻ chi tiết…"
          placeholder="Chia sẻ chi tiết…"
          value={body}
          maxLength={5000}
          rows={5}
          onChange={(e) => onBody(e.target.value)}
          className={`${ui.field} min-h-28 py-2`}
        />
      </div>
      {error && (
        <p role="alert" className={`mt-3 ${ui.error}`}>
          {error}
        </p>
      )}
    </Sheet>
  );
}

/** Xác nhận xoá bài (không hoàn tác). */
export function ConfirmDeleteSheet({ open, onClose, onConfirm, deleting }: { open: boolean; onClose: () => void; onConfirm: () => void; deleting: boolean }) {
  return (
    <Sheet open={open} onClose={onClose} title="Xoá bài viết này?">
      <div className="mt-3 flex flex-col gap-2.5">
        <button type="button" onClick={onClose} className={`${ui.btnSecondary} w-full`}>
          Hủy
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={onConfirm}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-control bg-danger-fg px-5 text-sm font-semibold text-stone-0 disabled:opacity-60"
        >
          {deleting ? 'Đang xoá…' : 'Xoá'}
        </button>
      </div>
    </Sheet>
  );
}

/** Sheet lý do báo cáo bài hoặc bình luận. */
export function ReportSheet({
  open,
  reason,
  onReason,
  onClose,
  onSubmit,
  sending,
  error,
}: {
  open: boolean;
  reason: string;
  onReason: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  sending: boolean;
  error?: string | null;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Báo cáo"
      footer={
        <button
          type="button"
          disabled={sending}
          onClick={onSubmit}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-control bg-danger-fg px-5 text-sm font-semibold text-stone-0 disabled:opacity-60"
        >
          {sending ? 'Đang gửi…' : 'Báo cáo'}
        </button>
      }
    >
      <textarea aria-label="Lý do báo cáo…" placeholder="Lý do báo cáo…" value={reason} maxLength={500} rows={3} onChange={(e) => onReason(e.target.value)} className={`${ui.field} mt-3 min-h-24 py-2`} />
      {error && (
        <p role="alert" className={`mt-3 ${ui.error}`}>
          {error}
        </p>
      )}
    </Sheet>
  );
}
