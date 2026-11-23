import { guestCopy, type GuestCopyKey } from '@/lib/guest-checkout/copy';
import type { GuestReorderNote, GuestReorderSkipReason } from '@/lib/guest-cart/reorder';

const REASON_COPY: Record<GuestReorderSkipReason, GuestCopyKey> = {
  OUT_OF_STOCK: 'reorderOutOfStock',
  INACTIVE: 'reorderInactive',
  NOT_ADDED: 'reorderNotAdded',
};

/** Các món "Mua lại đơn này" không thêm được vào giỏ khách, kèm lý do. `title` thay câu đầu (vd. khi không món nào vào giỏ). */
export function GuestReorderNoteBox({ note, title, testId }: { note: GuestReorderNote; title?: string; testId?: string }) {
  return (
    <div role="status" data-testid={testId} className="rounded-card border border-warning-fg bg-warning-bg px-4 py-3 text-sm text-warning-fg">
      <p className="font-semibold">{title ?? guestCopy('reorderSkipped', { n: note.skipped.length })}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {note.skipped.map((s, i) => (
          <li key={i}>
            {s.name} ({guestCopy(REASON_COPY[s.reason])})
          </li>
        ))}
      </ul>
    </div>
  );
}
